/**
 * Keeps two public records present that judges and visitors should never find empty:
 *  - one Hindcast replay of the live demo commitment (both versions on one timeline), run once the
 *    demo has finished, over the evidence Kept has scanned;
 *  - one stored offline Grifter run (the adversarial suite against the fooled fixture model; no
 *    SERV calls, no cost).
 * Each is created once if missing and never repeated; failures retry on a later tick.
 * KEPT_SHOWCASE_AUTO=0 disables it.
 */
import { db, type Sql } from "@/db/client";
import { newId } from "@/lib/ids";
import { runGrifter } from "@/grifter/runner";
import { demoStatus } from "./demo";
import { runHindcastFor } from "./hindcast";

let done = false;
let lastRun = 0;

export async function ensureShowcase(sql: Sql = db()): Promise<{ hindcast?: string; grifter?: string; error?: string } | undefined> {
  if (done || process.env.KEPT_SHOWCASE_AUTO === "0" || Date.now() - lastRun < 600_000) return undefined;
  lastRun = Date.now();
  const out: { hindcast?: string; grifter?: string; error?: string } = {};
  try {
    const [g] = await sql<{ n: number }[]>`select count(*)::int as n from grifter_runs`;
    if (g.n === 0) {
      const report = await runGrifter();
      const id = newId("kg");
      await sql`insert into grifter_runs (id, mode, prompt_versions, method_versions, summary, results)
                values (${id}, ${report.mode}, ${sql.json(report.prompt_versions)}, ${sql.json(report.method_versions)}, ${sql.json(report.summary as never)}, ${sql.json(report.results as never)})`;
      out.grifter = id;
    }
    const demo = await demoStatus(sql);
    // Settled only once the replay exists, or when no demo will ever run in this deployment.
    let hindcastSettled = process.env.KEPT_DEMO_AUTO === "0";
    if (demo?.commitment_id) {
      hindcastSettled = true;
      if (demo.stage !== "done") hindcastSettled = false;
      else {
        const [h] = await sql<{ n: number }[]>`select count(*)::int as n from hindcast_runs where commitment_id = ${demo.commitment_id}`;
        if (h.n === 0) out.hindcast = (await runHindcastFor(demo.commitment_id, { refresh: true }, sql)).id;
      }
    }
    if (hindcastSettled) done = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 300) : String(e);
  }
  return out.hindcast || out.grifter || out.error ? out : undefined;
}
