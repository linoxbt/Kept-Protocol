import { db, type Sql } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { CallRecord } from "@/extraction/pipeline";
import { estimateCostUsd, OpenServClient, ServError, type ServClient } from "@/serv/client";

let override: ServClient | null = null;
let live: OpenServClient | null = null;

/** Tests and the Grifter offline mode inject a recorded client. */
export function setServClient(client: ServClient | null): void {
  override = client;
}

export function servClient(): ServClient | null {
  if (override) return override;
  const key = env().SERV_API_KEY;
  if (!key) return null;
  live ??= new OpenServClient(key, env().SERV_BASE_URL);
  return live;
}

export function servAvailable(): boolean {
  return servClient() !== null;
}

export async function spentTodayUsd(sql: Sql = db()): Promise<number> {
  const [r] = await sql<{ total: string | null }[]>`select sum(est_cost_usd)::text as total from serv_calls where created_at >= date_trunc('day', now())`;
  return Number(r?.total ?? 0);
}

export async function assertBudget(sql: Sql = db()): Promise<void> {
  const spent = await spentTodayUsd(sql);
  if (spent >= env().SERV_DAILY_BUDGET_USD) {
    throw new ServError(`daily SERV budget reached ($${spent.toFixed(2)} of $${env().SERV_DAILY_BUDGET_USD})`, "budget");
  }
}

export function meterFor(extractionId: string | null, sql: Sql = db()) {
  return async (rec: CallRecord) => {
    await sql`insert into serv_calls (id, extraction_id, call_site, model_id, prompt_version, prompt_sha256, input_tokens, output_tokens, latency_ms, retries, outcome, error, est_cost_usd)
              values (${newId("ksv")}, ${extractionId}, ${rec.callSite}, ${rec.model}, ${rec.promptVersion}, ${rec.promptSha256},
                      ${rec.response?.usage?.input_tokens ?? null}, ${rec.response?.usage?.output_tokens ?? null}, ${rec.response?.latencyMs ?? null},
                      ${rec.response?.retries ?? 0}, ${rec.outcome}, ${rec.error ?? null}, ${estimateCostUsd(rec.model, rec.response?.usage ?? null)})`;
  };
}

export interface ServStats {
  calls: number;
  commitments: number;
  perCommitment: number;
  costUsd: number;
  byCallSite: { call_site: string; calls: number }[];
}

export async function servStats(sql: Sql = db()): Promise<ServStats> {
  const [[t], [c], sites] = await Promise.all([
    sql<{ calls: number; cost: string | null }[]>`select count(*)::int as calls, sum(est_cost_usd)::text as cost from serv_calls`,
    sql<{ n: number }[]>`select count(*)::int as n from commitments`,
    sql<{ call_site: string; calls: number }[]>`select call_site, count(*)::int as calls from serv_calls group by call_site order by call_site`,
  ]);
  return {
    calls: t.calls,
    commitments: c.n,
    perCommitment: c.n ? Math.round((t.calls / c.n) * 10) / 10 : 0,
    costUsd: Number(t.cost ?? 0),
    byCallSite: sites,
  };
}
