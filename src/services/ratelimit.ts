import { createHash } from "node:crypto";
import { db, type Sql } from "@/db/client";

/** Fixed-window counter in Postgres, so limits hold across serverless instances. */
export async function hit(key: string, limit: number, windowSeconds: number, sql: Sql = db()): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await sql<{ count: number }[]>`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (Math.random() < 0.02) await sql`delete from rate_limits where window_start < now() - interval '2 days'`;
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt: new Date(windowStart.getTime() + windowSeconds * 1000) };
}

/** Reads a counter without incrementing it (used before an expensive check such as scrypt). */
export async function peek(key: string, limit: number, windowSeconds: number, sql: Sql = db()): Promise<{ allowed: boolean; resetAt: Date }> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await sql<{ count: number }[]>`select count from rate_limits where key = ${key} and window_start = ${windowStart}`;
  return { allowed: (row?.count ?? 0) < limit, resetAt: new Date(windowStart.getTime() + windowSeconds * 1000) };
}

/** Requesters are stored only as salted hashes. */
export function requesterHash(ip: string): string {
  return createHash("sha256").update(`kept:${process.env.KEPT_SESSION_SECRET ?? process.env.KEPT_ADMIN_KEY ?? "dev"}:${ip}`).digest("hex").slice(0, 32);
}
