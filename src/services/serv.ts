import { db, type Sql } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { BudgetHold, CallRecord } from "@/extraction/pipeline";
import { estimateCostUsd, featureMultiplier, OpenServClient, ServError, worstCaseCostUsd, type ServClient, type ServRequest } from "@/serv/client";

/** Serialises budget reservations across every web and worker process. */
const BUDGET_LOCK = 0x4b45505442; // "KEPTB"
/** A hold older than this belongs to a crashed process and no longer counts. */
const HOLD_TTL_MINUTES = 15;

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

function budgetError(committed: number): ServError {
  return new ServError(`daily SERV budget reached ($${committed.toFixed(2)} of $${env().SERV_DAILY_BUDGET_USD})`, "budget");
}

/** Cheap early refusal before an extraction starts; reserveServCall is the real guard. */
export async function assertBudget(sql: Sql = db()): Promise<void> {
  const spent = await spentTodayUsd(sql);
  if (spent >= env().SERV_DAILY_BUDGET_USD) throw budgetError(spent);
}

/**
 * Reserves a call's worst-case cost before it is sent. Under one advisory lock shared by every
 * process, today's metered spend plus live holds plus this call must fit the daily budget, so
 * concurrent extractions cannot overshoot it together. Unpriced models are refused outright.
 */
export async function reserveServCall(req: ServRequest, sql: Sql = db()): Promise<BudgetHold> {
  const amountUsd = worstCaseCostUsd(req);
  if (amountUsd === null) throw new ServError(`no price is configured for model ${req.model}; Kept will not call a model it cannot budget for`, "not_configured");
  const id = newId("ksh");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BUDGET_LOCK})`;
    await tx`delete from serv_budget_holds where created_at < now() - make_interval(mins => ${HOLD_TTL_MINUTES})`;
    const [r] = await tx<{ committed: string }[]>`
      select (coalesce((select sum(est_cost_usd) from serv_calls where created_at >= date_trunc('day', now())), 0)
            + coalesce((select sum(amount_usd) from serv_budget_holds), 0))::text as committed`;
    const committed = Number(r.committed);
    if (committed + amountUsd > env().SERV_DAILY_BUDGET_USD) throw budgetError(committed);
    await tx`insert into serv_budget_holds (id, amount_usd) values (${id}, ${amountUsd})`;
  });
  return { id, amountUsd };
}

/**
 * Records one call and releases its hold in the same statement. A call that failed or timed out
 * may still have been billed, so it is charged its reserved worst case rather than $0; transport
 * retries are charged the worst case each for the same reason.
 */
export function meterFor(extractionId: string | null, sql: Sql = db()) {
  return async (rec: CallRecord) => {
    const worst = rec.hold?.amountUsd ?? 0;
    const retries = rec.response?.retries ?? 0;
    const cost = rec.response?.usage
      ? estimateCostUsd(rec.model, rec.response.usage, featureMultiplier(rec.model, rec.servTools)) + worst * retries
      : worst * (1 + retries);
    await sql`
      with released as (delete from serv_budget_holds where id = ${rec.hold?.id ?? null})
      insert into serv_calls (id, extraction_id, call_site, model_id, prompt_version, prompt_sha256, input_tokens, output_tokens, latency_ms, retries, outcome, error, est_cost_usd)
      values (${newId("ksv")}, ${extractionId}, ${rec.callSite}, ${rec.model}, ${rec.promptVersion}, ${rec.promptSha256},
              ${rec.response?.usage?.input_tokens ?? null}, ${rec.response?.usage?.output_tokens ?? null}, ${rec.response?.latencyMs ?? null},
              ${retries}, ${rec.outcome}, ${rec.error ?? null}, ${cost})`;
  };
}

/** Pipeline dependencies that meter every call and enforce the daily budget per call. */
export function budgetedDeps(extractionId: string | null, sql: Sql = db()) {
  return { meter: meterFor(extractionId, sql), reserve: (req: ServRequest) => reserveServCall(req, sql) };
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
