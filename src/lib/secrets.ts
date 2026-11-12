/**
 * Self-bootstrapping secrets. On first start a deployment generates its own receipt-signing key,
 * session secret and cron secret with a CSPRNG and stores them in its own database, so no secret
 * is ever copied by hand or passed through a dashboard. Every process sharing the database (web
 * and worker) loads the same values. An environment variable, when set, always wins.
 *
 * The admin credential is never generated: the first person to open /admin/setup sets a password,
 * stored as an scrypt hash, and the setup page locks itself from then on.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import { resetEnvCache } from "./env";

const GENERATED: Record<string, () => string> = {
  KEPT_SIGNER_PRIVATE_KEY: () => `0x${randomBytes(32).toString("hex")}`,
  KEPT_SESSION_SECRET: () => randomBytes(32).toString("hex"),
  CRON_SECRET: () => randomBytes(24).toString("hex"),
};

let loaded = false;

/** Loads (and if needed creates) bootstrapped secrets into process.env. Idempotent and race-safe. */
export async function bootstrapSecrets(): Promise<void> {
  if (loaded) return;
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const missing = Object.keys(GENERATED).filter((k) => !process.env[k]);
  if (missing.length === 0) {
    loaded = true;
    return;
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
  try {
    await sql`create table if not exists kept_secrets (name text primary key, value text not null, created_at timestamptz not null default now())`;
    for (const name of missing) {
      await sql`insert into kept_secrets (name, value) values (${name}, ${GENERATED[name]()}) on conflict (name) do nothing`;
    }
    const rows = await sql<{ name: string; value: string }[]>`select name, value from kept_secrets where name in ${sql(missing)}`;
    for (const r of rows) process.env[r.name] = r.value;
    resetEnvCache();
    loaded = true;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: 16384, r: 8, p: 1 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
