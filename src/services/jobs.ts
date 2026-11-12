/**
 * Background jobs. Long work (a check that scans millions of blocks, a Hindcast replay, a preview
 * check) runs after the response is sent, so no request waits on it and no proxy timeout can cut it
 * off. The client polls GET /api/v1/jobs/{id}. A job left running by a restarted process is marked
 * failed by the monitor after 15 minutes.
 */
import { db, type Sql } from "@/db/client";
import { newId } from "@/lib/ids";

export type Defer = (work: () => Promise<void>) => void;

export interface JobRow {
  id: string;
  kind: string;
  target: string | null;
  status: "running" | "done" | "failed";
  result: unknown;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export async function startJob(kind: string, target: string | null, work: () => Promise<unknown>, defer: Defer, sql: Sql = db()): Promise<{ id: string; poll: string }> {
  const id = newId("kj");
  await sql`insert into jobs (id, kind, target) values (${id}, ${kind}, ${target})`;
  defer(async () => {
    try {
      const result = JSON.parse(JSON.stringify((await work()) ?? null, replacer));
      await sql`update jobs set status = 'done', result = ${sql.json(result)}, finished_at = now() where id = ${id}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`update jobs set status = 'failed', error = ${msg.slice(0, 1000)}, finished_at = now() where id = ${id}`.catch(() => {});
    }
  });
  return { id, poll: `/api/v1/jobs/${id}` };
}

export async function getJob(id: string, sql: Sql = db()): Promise<JobRow | null> {
  const [r] = await sql<JobRow[]>`select id, kind, target, status, result, error, created_at, finished_at from jobs where id = ${id}`;
  return r ?? null;
}

export async function failStaleJobs(sql: Sql = db()): Promise<number> {
  const r = await sql`update jobs set status = 'failed', error = 'the process running this job restarted; start it again', finished_at = now()
                      where status = 'running' and created_at < now() - interval '15 minutes'`;
  await sql`delete from jobs where finished_at < now() - interval '7 days'`;
  return r.count;
}
