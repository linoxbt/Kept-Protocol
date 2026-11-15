/**
 * Applies SQL migrations in order, each in its own transaction, recording them in
 * schema_migrations. Both the web service (at boot, before it serves) and the worker run it, so
 * neither ever runs against a schema older than its code. A session advisory lock on a dedicated
 * connection makes concurrent boots safe: the second waits, then finds nothing left to apply.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATE_LOCK = 0x4b4550544d; // "KEPTM"

export async function migrate(url: string, log: (m: string) => void = console.log): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${MIGRATE_LOCK})`;
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = join(process.cwd(), "src/db/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    const ran: string[] = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      const body = readFileSync(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${f})`;
      });
      log(`applied ${f}`);
      ran.push(f);
    }
    if (!ran.length) log("database is up to date");
    return ran;
  } finally {
    // Ending the only connection releases the session lock.
    await sql.end();
  }
}
