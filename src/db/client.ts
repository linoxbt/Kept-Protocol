import postgres from "postgres";
import { env } from "@/lib/env";

export type Sql = postgres.Sql;
/** A connection or an open transaction: anything that can run a query. */
export type Q = postgres.Sql | postgres.TransactionSql;

const g = globalThis as unknown as { __keptSql?: Sql };

/** One pool per process. `prepare: false` keeps it compatible with transaction-mode poolers. */
export function db(): Sql {
  if (g.__keptSql) return g.__keptSql;
  const url = env().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  g.__keptSql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    types: { bigint: postgres.BigInt },
    onnotice: () => {},
  });
  return g.__keptSql;
}

export async function closeDb(): Promise<void> {
  if (g.__keptSql) {
    await g.__keptSql.end({ timeout: 5 });
    g.__keptSql = undefined;
  }
}
