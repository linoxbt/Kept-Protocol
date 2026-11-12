/**
 * Applies SQL migrations in order, each in its own transaction, recording them in
 * schema_migrations. Usage: npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

export async function migrate(url: string, log = console.log): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
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
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
