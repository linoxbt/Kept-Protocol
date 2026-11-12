import { db } from "@/db/client";
import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { newId } from "@/lib/ids";
import { runGrifter } from "@/grifter/runner";
import { servClient } from "@/services/serv";

export const maxDuration = 300;

/** Runs the suite (offline by default; ?live=1 sends every source to SERV) and stores the report. */
export const POST = route(async (req: Request) => {
  await requireAdmin(req);
  const live = new URL(req.url).searchParams.get("live") === "1" ? (servClient() ?? undefined) : undefined;
  const report = await runGrifter({ live });
  const id = newId("kg");
  const sql = db();
  await sql`insert into grifter_runs (id, mode, prompt_versions, method_versions, summary, results)
            values (${id}, ${report.mode}, ${sql.json(report.prompt_versions)}, ${sql.json(report.method_versions)}, ${sql.json(report.summary as never)}, ${sql.json(report.results as never)})`;
  return json({ id, ...report }, { status: 201 });
});

export const GET = route(async () => {
  const runs = await db()`select id, mode, prompt_versions, method_versions, summary, created_at from grifter_runs order by created_at desc limit 20`;
  return json({ data: runs });
});
