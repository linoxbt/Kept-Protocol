/**
 * Background monitoring. One tick: claim due commitments (SKIP LOCKED, so parallel workers never
 * double-check), run checks, re-capture due sources, raise deadline alerts, deliver the outbox,
 * purge expired previews. Driven by the worker process or the cron endpoint.
 */
import { db, type Sql } from "@/db/client";
import type { CommitmentSpec } from "@/core/types";
import { autoAnchor } from "./anchor";
import { advanceDemo } from "./demo";
import { seedCurated } from "./curated";
import { failStaleJobs } from "./jobs";
import { recaptureSource, type WatchResult } from "./precedent";
import { purgeExpiredPreviews } from "./preview";
import { enqueue, runCheck } from "./verify";
import { deliverOutbox } from "./webhooks";

export interface TickReport {
  checks: { commitmentId: string; status?: string; changed?: boolean; error?: string }[];
  sources: WatchResult[];
  deadlines: number;
  outbox: { queued: number; delivered: number; failed: number };
  purged: number;
  anchor: { anchored: number; skipped?: string; tx?: string };
  demo: { stage: string; detail?: string };
  curated?: { added: string[]; failed: { slug: string; error: string }[] };
  ms: number;
}

export async function claimDue(limit: number, sql: Sql = db()): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    update commitments set checking_since = now()
    where id in (
      select id from commitments
      where final = false and next_check_at <= now()
        and (checking_since is null or checking_since < now() - interval '10 minutes')
      order by next_check_at
      limit ${limit}
      for update skip locked)
    returning id`;
  return rows.map((r) => r.id);
}

export async function raiseDeadlineAlerts(sql: Sql = db()): Promise<number> {
  const rows = await sql<{ id: string; spec: CommitmentSpec; status: string }[]>`
    select c.id, v.spec, c.status from commitments c join commitment_versions v on v.id = c.current_version_id
    where c.final = false and c.status in ('verified', 'at_risk', 'pending', 'awaiting_evidence', 'disputed')
      and v.spec->>'method_id' = 'burn_v1'
      and (v.spec->'window'->>'end')::timestamptz between now() and now() + interval '8 days'`;
  let n = 0;
  const now = Date.now();
  for (const r of rows) {
    const end = Date.parse(r.spec.window.end);
    const days = Math.ceil((end - now) / 86_400_000);
    // Deadlines matter for targets (burns); the query already selects burns ending within 8 days.
    for (const d of [7, 3, 1]) {
      if (days === d) {
        await enqueue(sql, "commitment.deadline_approaching", r.id, `${r.id}:deadline:${d}`, { commitment_id: r.id, days_left: d, window_end: r.spec.window.end });
        n++;
      }
    }
  }
  return n;
}

export async function tick(opts: { maxChecks?: number; maxSources?: number; deadlineMs?: number } = {}, sql: Sql = db()): Promise<TickReport> {
  const started = Date.now();
  const budget = opts.deadlineMs ?? 50_000;
  const report: TickReport = { checks: [], sources: [], deadlines: 0, outbox: { queued: 0, delivered: 0, failed: 0 }, purged: 0, anchor: { anchored: 0 }, demo: { stage: "none" }, ms: 0 };
  const ids = await claimDue(opts.maxChecks ?? 10, sql);
  for (const id of ids) {
    if (Date.now() - started > budget) {
      await sql`update commitments set checking_since = null where id = ${id}`;
      continue;
    }
    try {
      const r = await runCheck(id, { sql, trigger: "scheduler" });
      report.checks.push({ commitmentId: id, status: r.decision.status, changed: r.changed });
    } catch (e) {
      report.checks.push({ commitmentId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const dueSources = await sql<{ id: string }[]>`
    select id from sources where status <> 'paused' and (last_checked_at is null or last_checked_at < now() - make_interval(secs => watch_interval_s))
    order by last_checked_at nulls first limit ${opts.maxSources ?? 3}`;
  for (const s of dueSources) {
    if (Date.now() - started > budget) break;
    report.sources.push(await recaptureSource(s.id, sql));
  }
  report.deadlines = await raiseDeadlineAlerts(sql);
  report.outbox = await deliverOutbox(50, sql);
  report.purged = await purgeExpiredPreviews(sql);
  await failStaleJobs(sql);
  report.anchor = await autoAnchor(sql);
  report.demo = await advanceDemo(sql);
  report.curated = await seedCurated(sql);
  report.ms = Date.now() - started;
  return report;
}
