/**
 * SERV Reasoning client. SERV interprets language; it is never asked whether something happened
 * on-chain. Transport policy (section 4 of the PRD):
 *  - 429: exponential backoff with jitter (1s, 2s, 4s; cap 30s), honouring Retry-After.
 *  - 5xx / 502 from Shadow Agent: up to 2 retries, then the item goes to review.
 *  - 400: no retry (a code or prompt bug). 401: fatal, extraction halts.
 *  - 60s timeout per call, treated as 5xx.
 *  - 5 consecutive failures open the circuit for 5 minutes.
 */
import { createHash } from "node:crypto";
import type { PromptDef } from "./prompts";

export type CallSite = "locate" | "extract" | "classify";

export interface ServRequest {
  callSite: CallSite;
  model: string;
  prompt: PromptDef;
  user: string;
  jsonSchema: { name: string; strict: boolean; schema: object };
  /** serv_* tools: prompt guard, shadow agent. */
  servTools: ServTool[];
  maxTokens: number;
}

export type ServTool = { kind: "prompt_guard" } | { kind: "shadow_agent"; hint: string; maxIterations: number };

export interface ServResponse {
  content: string | null;
  finishReason: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number } | null;
  latencyMs: number;
  /** Number of transport retries before this response. */
  retries: number;
}

export interface ServClient {
  readonly live: boolean;
  complete(req: ServRequest): Promise<ServResponse>;
}

export class ServError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "bad_request" | "rate_limited" | "upstream" | "timeout" | "circuit_open" | "not_configured" | "budget",
    readonly status?: number,
  ) {
    super(message);
  }
}

export function toolDefs(tools: ServTool[]): object[] {
  return tools.map((t) =>
    t.kind === "prompt_guard"
      ? { type: "function", function: { name: "serv_prompt_guard" } }
      : {
          type: "function",
          function: {
            name: "serv_shadow_agent",
            description: "Enable SERV shadow-agent validation.",
            parameters: {
              type: "object",
              properties: {
                hint: { type: "string", default: t.hint },
                max_iterations: { type: "integer", default: t.maxIterations },
              },
            },
          },
        },
  );
}

/** Wire body for POST /v1/chat/completions. Exported for tests. */
export function requestBody(req: ServRequest): object {
  const tools = toolDefs(req.servTools);
  return {
    model: req.model,
    messages: [
      { role: "system", content: req.prompt.text },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_schema", json_schema: req.jsonSchema },
    max_completion_tokens: req.maxTokens,
    ...(tools.length ? { tools } : {}),
    stream: false,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenServClient implements ServClient {
  readonly live = true;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://inference-api.openserv.ai/v1",
    private readonly timeoutMs = 60_000,
    /** Kronos audits and Shadow Agent revisions make uncached extract calls slow (measured: ~116 s). */
    private readonly extractTimeoutMs = 180_000,
  ) {}

  async complete(req: ServRequest): Promise<ServResponse> {
    if (Date.now() < this.openUntil) throw new ServError("SERV circuit open after repeated failures", "circuit_open");
    let retries = 0;
    let rateLimitRetries = 0;
    for (;;) {
      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody(req)),
          signal: AbortSignal.timeout(req.callSite === "extract" ? this.extractTimeoutMs : this.timeoutMs),
        });
      } catch (e) {
        this.fail();
        if (retries < 2) {
          retries++;
          continue;
        }
        throw new ServError(`SERV request failed: ${e instanceof Error ? e.message : e}`, "timeout");
      }
      if (res.status === 429) {
        if (rateLimitRetries >= 3) {
          this.fail();
          throw new ServError("SERV rate limit persisted", "rate_limited", 429);
        }
        const after = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(30_000, 1000 * 2 ** rateLimitRetries);
        rateLimitRetries++;
        await sleep(backoff + Math.random() * 250);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        this.fail();
        throw new ServError("SERV rejected the API key", "auth", res.status);
      }
      if (res.status === 400 || res.status === 404) {
        const detail = await res.text().catch(() => "");
        throw new ServError(`SERV ${res.status}: ${detail.slice(0, 300)}`, "bad_request", res.status);
      }
      if (res.status >= 500) {
        this.fail();
        if (retries < 2) {
          retries++;
          await sleep(500 * retries);
          continue;
        }
        throw new ServError(`SERV upstream error ${res.status}`, "upstream", res.status);
      }
      const json = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      this.consecutiveFailures = 0;
      const choice = json.choices?.[0];
      return {
        content: choice?.message?.refusal ? null : (choice?.message?.content ?? null),
        finishReason: choice?.finish_reason ?? null,
        model: json.model ?? req.model,
        usage: json.usage ? { input_tokens: json.usage.prompt_tokens ?? 0, output_tokens: json.usage.completion_tokens ?? 0 } : null,
        latencyMs: Date.now() - t0,
        retries,
      };
    }
  }

  private fail() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 5) {
      this.openUntil = Date.now() + 5 * 60_000;
      this.consecutiveFailures = 0;
    }
  }
}

/** Key for recorded responses: call site + model-independent hash of the user content. */
export function fixtureKey(callSite: CallSite, user: string): string {
  return `${callSite}:${createHash("sha256").update(user).digest("hex").slice(0, 16)}`;
}

/**
 * Replays recorded SERV outputs. Used by tests, CI and Grifter's offline mode. A fixture can also
 * hold a deliberately bad model output, to test that Kept's own validators catch it.
 */
export class FixtureServClient implements ServClient {
  readonly live = false;
  constructor(private readonly responses: Map<string, unknown> | ((req: ServRequest) => unknown)) {}

  async complete(req: ServRequest): Promise<ServResponse> {
    const value =
      typeof this.responses === "function" ? this.responses(req) : this.responses.get(fixtureKey(req.callSite, req.user));
    if (value === undefined) throw new ServError(`no recorded SERV response for ${req.callSite}`, "not_configured");
    if (value instanceof ServError) throw value;
    return {
      content: typeof value === "string" ? value : JSON.stringify(value),
      finishReason: "stop",
      model: req.model,
      usage: { input_tokens: Math.ceil(req.user.length / 4), output_tokens: 200 },
      latencyMs: 0,
      retries: 0,
    };
  }
}

/** Catalog prices, USD per million tokens (docs.openserv.ai/serv-reasoning/models). */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.13, output: 0.65 },
  "gpt-5.4-mini": { input: 1.0, output: 6.0 },
  "gpt-5.4-nano": { input: 0.25, output: 1.6 },
  "claude-sonnet-5.5": { input: 2.4, output: 12.0 },
};

export function baseModel(model: string): string {
  return model.replace(/-serv-(kronos-multipath|multipath-kronos|kronos|multipath)$/, "");
}

export function estimateCostUsd(model: string, usage: { input_tokens: number; output_tokens: number } | null): number {
  const p = MODEL_PRICES[baseModel(model)];
  if (!p || !usage) return 0;
  return (usage.input_tokens * p.input + usage.output_tokens * p.output) / 1_000_000;
}
