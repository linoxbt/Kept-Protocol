/**
 * Runs the Grifter suite and prints a per-family report. Exit code 1 on any critical/high failure.
 *   npm run grifter            offline: recorded fooled-model outputs (CI)
 *   npm run grifter -- --live  sends every source to SERV (needs SERV_API_KEY)
 *   --save                     stores the run in grifter_runs (needs DATABASE_URL)
 */
import { runGrifter } from "../src/grifter/runner";
import { OpenServClient } from "../src/serv/client";

async function main() {
  const live = process.argv.includes("--live");
  if (live && !process.env.SERV_API_KEY) throw new Error("--live needs SERV_API_KEY");
  const report = await runGrifter({ live: live ? new OpenServClient(process.env.SERV_API_KEY!, process.env.SERV_BASE_URL) : undefined });
  console.log(`Grifter ${report.mode} — prompts ${Object.values(report.prompt_versions).join(", ")}\n`);
  for (const [family, s] of Object.entries(report.summary.byFamily)) console.log(`  ${family.padEnd(28)} ${s.passed}/${s.total}`);
  console.log("");
  for (const r of report.results) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}  ${r.id.padEnd(9)} [${r.severity}/${r.layer}] ${r.title}`);
    if (!r.passed) for (const f of r.failures) console.log(`          - ${f}`);
  }
  console.log(`\n${report.summary.passed}/${report.summary.total} passed, ${report.summary.blocking} blocking failure(s)`);
  if (process.argv.includes("--save")) {
    const { db, closeDb } = await import("../src/db/client");
    const { newId } = await import("../src/lib/ids");
    const sql = db();
    await sql`insert into grifter_runs (id, mode, prompt_versions, method_versions, summary, results)
              values (${newId("kg")}, ${report.mode}, ${sql.json(report.prompt_versions)}, ${sql.json(report.method_versions)}, ${sql.json(report.summary as never)}, ${sql.json(report.results as never)})`;
    await closeDb();
    console.log("saved to grifter_runs");
  }
  if (report.summary.blocking > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
