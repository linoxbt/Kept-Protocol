/**
 * System 01 — Promise Intelligence Engine.
 *
 *   capture → locate (SERV, prompt guard) → substring check (code)
 *           → extract (SERV, Kronos, strict schema, Shadow Agent) → Zod + grounding (code)
 *           → classify ×2 (SERV Multipath) + policy rules (code) → draft with computed confidence
 *
 * A draft is never a commitment. A human confirms it (or a try-it preview shows it as
 * "Unconfirmed preview") before anything is monitored.
 */
import { CLASSIFY_PROMPT, EXTRACT_PROMPT, LOCATE_PROMPT, SHADOW_HINT_EXTRACT } from "@/serv/prompts";
import { CLASSIFY_JSON_SCHEMA, ClassifyOut, EXTRACT_JSON_SCHEMA, ExtractOut, LOCATE_JSON_SCHEMA, LocateOut } from "@/serv/schemas";
import { ServError, type CallSite, type ServClient, type ServRequest, type ServResponse } from "@/serv/client";
import type { z } from "zod";
import { classifyByRules } from "./rules";
import { checkGrounding, detectInjection, locateQuote, lookalikes, addressesInText, type Flag } from "./validate";

export const MODELS = {
  locate: process.env.SERV_MODEL_LOCATE ?? "gpt-5.4-mini",
  extract: process.env.SERV_MODEL_EXTRACT ?? "gpt-5.4-mini-serv-kronos",
  classify: process.env.SERV_MODEL_CLASSIFY ?? "gpt-6-luna-serv-multipath",
};

export const MAX_SPANS = 8;
const CONTEXT_CHARS = 2000;

export interface ProjectContext {
  name: string | null;
  chainId: number;
  tokenAddress: string | null;
  tokenSymbol: string | null;
}

export interface Draft {
  index: number;
  quote: string;
  start: number;
  end: number;
  category_hint: string;
  /** Surrounding text sent to SERV; grounding for reviewer edits is checked against it too. */
  context: string;
  fields: ExtractOut | null;
  classification: { verifiability: string; method_id: string; agreed: boolean; rules: string; rule_ids: string[] } | null;
  flags: Flag[];
  problems: string[];
  confidence: { grounding: boolean; classifier_agreement: boolean; rules_agreement: boolean };
  needs_review: boolean;
  error: string | null;
}

export interface ExtractionResult {
  drafts: Draft[];
  source_flags: Flag[];
  injection: { start: number; end: number; text: string }[];
  dropped_spans: { quote: string; reason: string }[];
  serv_calls: number;
}

export interface CallRecord {
  callSite: CallSite;
  model: string;
  promptVersion: string;
  promptSha256: string;
  response: ServResponse | null;
  outcome: "ok" | "invalid" | "error";
  error?: string;
}

export interface PipelineDeps {
  serv: ServClient;
  /** Persist metering; may throw ServError('budget') to stop extraction. */
  meter: (rec: CallRecord) => Promise<void>;
  onProgress?: (event: { stage: string; detail?: string }) => void;
}

async function call<T>(deps: PipelineDeps, req: ServRequest, schema: z.ZodType<T>): Promise<{ value: T | null; error: string | null }> {
  let lastError = "";
  // One retry with an identical request on invalid output, then give up (review queue).
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: ServResponse | null = null;
    try {
      response = await deps.serv.complete(req);
    } catch (e) {
      const err = e instanceof ServError ? e : new ServError(String(e), "upstream");
      await deps.meter({ callSite: req.callSite, model: req.model, promptVersion: req.prompt.version, promptSha256: req.prompt.sha256, response: null, outcome: "error", error: err.message });
      throw err;
    }
    let problem: string | null = null;
    let value: T | null = null;
    if (response.finishReason === "length") problem = "output truncated (finish_reason=length)";
    else if (response.content === null) problem = "model refused or returned no content";
    else {
      try {
        const parsed = schema.safeParse(JSON.parse(response.content));
        if (parsed.success) value = parsed.data;
        else problem = `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
      } catch {
        problem = "output is not valid JSON";
      }
    }
    await deps.meter({
      callSite: req.callSite,
      model: req.model,
      promptVersion: req.prompt.version,
      promptSha256: req.prompt.sha256,
      response,
      outcome: problem ? "invalid" : "ok",
      error: problem ?? undefined,
    });
    if (!problem) return { value, error: null };
    lastError = problem;
  }
  return { value: null, error: lastError };
}

export function fence(label: string, text: string): string {
  // Neutralize marker collisions so source text cannot close the fence.
  const safe = text.replaceAll("<<<", "‹‹‹").replaceAll(">>>", "›››");
  return `<<<${label}\n${safe}\n${label}>>>`;
}

export async function runExtraction(text: string, project: ProjectContext, deps: PipelineDeps): Promise<ExtractionResult> {
  const sourceFlags = new Set<Flag>();
  const injection = detectInjection(text);
  if (injection.length) sourceFlags.add("SOURCE_CONTAINS_INSTRUCTIONS");
  const dropped: ExtractionResult["dropped_spans"] = [];
  let calls = 0;

  deps.onProgress?.({ stage: "locate" });
  calls++;
  const located = await call(
    deps,
    {
      callSite: "locate",
      model: MODELS.locate,
      prompt: LOCATE_PROMPT,
      user: fence("SOURCE", text.slice(0, 120_000)),
      jsonSchema: LOCATE_JSON_SCHEMA,
      servTools: [{ kind: "prompt_guard" }],
      maxTokens: 4000,
    },
    LocateOut,
  );
  if (!located.value) {
    return { drafts: [], source_flags: [...sourceFlags, "SERV_OUTPUT_INVALID"], injection, dropped_spans: [{ quote: "", reason: located.error ?? "locate failed" }], serv_calls: calls };
  }
  if (located.value.instructions_detected) sourceFlags.add("SOURCE_CONTAINS_INSTRUCTIONS");
  for (const q of located.value.injection_quotes) {
    const at = locateQuote(text, q);
    if (at && !injection.some((h) => h.start <= at.start && h.end >= at.end)) injection.push({ ...at, text: text.slice(at.start, at.end) });
  }

  const spans: { quote: string; start: number; end: number; category_hint: string }[] = [];
  for (const s of located.value.spans) {
    const at = locateQuote(text, s.quote);
    if (!at) {
      dropped.push({ quote: s.quote.slice(0, 200), reason: "not an exact substring of the source" });
      continue;
    }
    if (injection.some((h) => at.start < h.end && h.start < at.end)) {
      dropped.push({ quote: s.quote.slice(0, 200), reason: "overlaps text that addresses an AI" });
      continue;
    }
    if (spans.some((x) => x.start === at.start && x.end === at.end)) continue;
    spans.push({ quote: text.slice(at.start, at.end), start: at.start, end: at.end, category_hint: s.category_hint });
  }
  for (const s of spans.slice(MAX_SPANS)) dropped.push({ quote: s.quote.slice(0, 200), reason: `more than ${MAX_SPANS} spans in one source` });

  const projectBlock = JSON.stringify({ name: project.name, chain_id: project.chainId, token_address: project.tokenAddress, token_symbol: project.tokenSymbol });
  const knownAddresses = [...addressesInText(text)];

  const drafts: Draft[] = [];
  for (const [index, span] of spans.slice(0, MAX_SPANS).entries()) {
    deps.onProgress?.({ stage: "extract", detail: `${index + 1}/${Math.min(spans.length, MAX_SPANS)}` });
    const context = text.slice(Math.max(0, span.start - CONTEXT_CHARS / 2), Math.min(text.length, span.end + CONTEXT_CHARS / 2));
    calls++;
    const extracted = await call(
      deps,
      {
        callSite: "extract",
        model: MODELS.extract,
        prompt: EXTRACT_PROMPT,
        user: `${fence("EXCERPT", span.quote)}\n${fence("CONTEXT", context)}\n${fence("PROJECT", projectBlock)}`,
        jsonSchema: EXTRACT_JSON_SCHEMA,
        servTools: [{ kind: "shadow_agent", hint: SHADOW_HINT_EXTRACT, maxIterations: 3 }],
        maxTokens: 2000,
      },
      ExtractOut,
    );
    const draft: Draft = {
      index,
      ...span,
      context,
      fields: extracted.value,
      classification: null,
      flags: [],
      problems: [],
      confidence: { grounding: false, classifier_agreement: false, rules_agreement: false },
      needs_review: true,
      error: extracted.error,
    };
    if (!extracted.value) {
      draft.flags.push("SERV_OUTPUT_INVALID");
      drafts.push(draft);
      continue;
    }
    const fields = extracted.value;
    const grounding = checkGrounding(fields, span.quote, context);
    draft.flags.push(...grounding.flags, ...fields.ambiguity_flags);
    draft.problems.push(...grounding.problems);
    draft.confidence.grounding = !grounding.flags.some((f) => f.startsWith("UNGROUNDED") || f === "INVALID_ADDRESS");
    const subjectAddrs = fields.subjects.map((s) => s.address);
    const look = lookalikes(subjectAddrs, knownAddresses.filter((a) => !subjectAddrs.some((s) => s.toLowerCase() === a)));
    if (look.length) {
      draft.flags.push("ADDRESS_LOOKALIKE");
      draft.problems.push(...look.map((l) => `${l.candidate} resembles ${l.resembles} (possible address poisoning)`));
    }

    deps.onProgress?.({ stage: "classify", detail: `${index + 1}` });
    const classifyReq: ServRequest = {
      callSite: "classify",
      model: MODELS.classify,
      prompt: CLASSIFY_PROMPT,
      user: JSON.stringify({ ...fields, excerpt: span.quote }),
      jsonSchema: CLASSIFY_JSON_SCHEMA,
      servTools: [],
      maxTokens: 600,
    };
    calls += 2;
    const [c1, c2] = await Promise.all([call(deps, classifyReq, ClassifyOut), call(deps, classifyReq, ClassifyOut)]);
    const rules = classifyByRules(fields, span.quote);
    if (c1.value && c2.value) {
      const agreed = c1.value.verifiability === c2.value.verifiability && c1.value.method_id === c2.value.method_id;
      const rulesAgree = c1.value.method_id === rules.method_id && c1.value.verifiability === rules.verifiability;
      draft.classification = {
        verifiability: rules.verifiability,
        method_id: rules.method_id,
        agreed,
        rules: rules.rule,
        rule_ids: c1.value.rule_ids,
      };
      draft.confidence.classifier_agreement = agreed;
      draft.confidence.rules_agreement = rulesAgree;
      if (!agreed) draft.flags.push("CLASSIFIER_DISAGREEMENT");
      if (!rulesAgree) draft.flags.push("RULES_DISAGREE");
      for (const f of [...c1.value.ambiguity_flags, ...c2.value.ambiguity_flags]) draft.flags.push(f);
    } else {
      draft.classification = { verifiability: rules.verifiability, method_id: rules.method_id, agreed: false, rules: rules.rule, rule_ids: [] };
      draft.flags.push("SERV_OUTPUT_INVALID");
      draft.problems.push(`classification failed: ${c1.error ?? c2.error}`);
    }
    if (rules.verifiability === "external") draft.flags.push("EXTERNAL_EVIDENCE");
    draft.flags = [...new Set(draft.flags)];
    draft.needs_review = true;
    drafts.push(draft);
  }

  markContradictions(drafts);
  return { drafts, source_flags: [...sourceFlags], injection, dropped_spans: dropped, serv_calls: calls };
}

/** Two drafts about the same subject and category with different thresholds or dates. */
export function markContradictions(drafts: Draft[]): void {
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      const a = drafts[i].fields;
      const b = drafts[j].fields;
      if (!a || !b) continue;
      const sameCategory = a.category === b.category || (["token_lock", "vesting"].includes(a.category) && ["token_lock", "vesting"].includes(b.category));
      const sameSubject =
        a.subjects.some((s) => b.subjects.some((t) => t.address.toLowerCase() === s.address.toLowerCase())) ||
        (a.subjects.length === 0 && b.subjects.length === 0 && (a.responsible_entity ?? "") === (b.responsible_entity ?? ""));
      if (!sameCategory || !sameSubject) continue;
      const differs =
        (a.duration_months !== null && b.duration_months !== null && a.duration_months !== b.duration_months) ||
        (a.cliff_months !== null && b.cliff_months !== null && a.cliff_months !== b.cliff_months) ||
        (a.window_end !== null && b.window_end !== null && a.window_end !== b.window_end) ||
        (a.amount !== null && b.amount !== null && a.amount !== b.amount && a.category === b.category);
      if (differs) {
        for (const d of [drafts[i], drafts[j]]) {
          if (!d.flags.includes("CONTRADICTION")) d.flags.push("CONTRADICTION");
          d.problems.push(`conflicts with commitment ${d === drafts[i] ? j + 1 : i + 1} from the same source`);
        }
      }
    }
  }
}
