/**
 * Background jobs. Long work (a check that scans millions of blocks, a Hindcast replay, a preview
 * check) runs after the response is sent, so no request waits on it and no proxy timeout can cut it
 * off. The client polls GET /api/v1/jobs/{id}. Running work records a heartbeat every 30 s; work
 * whose process died (a restart or deploy) stops beating and the monitor fails it within minutes,
 * however long legitimate work runs.
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

const HEARTBEAT_MS = 30_000;
/** No heartbeat for this long means the process running the work is gone. */
export const STALE_AFTER_SECONDS = 180;

/** Runs `fn` while recording a heartbeat on the row, so the monitor can tell live work from orphaned work. */
export async function withHeartbeat<T>(table: "jobs" | "extractions", id: string, sql: Sql, fn: () => Promise<T>): Promise<T> {
  const beat = setInterval(() => {
    void sql`update ${sql(table)} set heartbeat_at = now() where id = ${id} and status = 'running'`.catch(() => {});
  }, HEARTBEAT_MS);
  beat.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(beat);
  }
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export async function startJob(kind: string, target: string | null, work: () => Promise<unknown>, defer: Defer, sql: Sql = db()): Promise<{ id: string; poll: string }> {
  const id = newId("kj");
  await sql`insert into jobs (id, kind, target) values (${id}, ${kind}, ${target})`;
  defer(async () => {
    try {
      const result = JSON.parse(JSON.stringify((await withHeartbeat("jobs", id, sql, work)) ?? null, replacer));
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

/** Fails jobs and extractions whose process stopped beating (restart, deploy, crash). */
export async function failStaleJobs(sql: Sql = db()): Promise<number> {
  const r = await sql`update jobs set status = 'failed', error = 'the process running this job restarted; start it again', finished_at = now()
                      where status = 'running' and heartbeat_at < now() - make_interval(secs => ${STALE_AFTER_SECONDS})`;
  const x = await sql`update extractions set status = 'failed', error = 'the process running this extraction restarted; start it again'
                      where status = 'running' and heartbeat_at < now() - make_interval(secs => ${STALE_AFTER_SECONDS})`;
  await sql`delete from jobs where finished_at < now() - interval '7 days'`;
  return r.count + x.count;
}
