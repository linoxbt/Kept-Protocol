/**
 * Self-bootstrapping secrets. On first start a deployment generates its own receipt-signing key,
 * operator (anchoring) key, session secret, cron secret and one-time admin setup token with a
 * CSPRNG and stores them in its own database, so no secret is ever copied by hand or passed
 * through a dashboard. Every process sharing the database (web and worker) loads the same values.
 * An environment variable, when set, always wins.
 *
 * At rest: when KEPT_SECRETS_KEK (64 hex chars) is set, every stored value is encrypted with
 * AES-256-GCM under that key, and plaintext rows left from before are re-encrypted in place on
 * the next start. A database dump alone then reveals no signing key.
 *
 * The admin credential is never generated: /admin/setup sets a password (scrypt hash) and needs
 * the setup token printed in the server log, so a stranger cannot claim a fresh deployment.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import { resetEnvCache } from "./env";

const GENERATED: Record<string, () => string> = {
  KEPT_SIGNER_PRIVATE_KEY: () => `0x${randomBytes(32).toString("hex")}`,
  ANCHOR_PRIVATE_KEY: () => `0x${randomBytes(32).toString("hex")}`,
  KEPT_SESSION_SECRET: () => randomBytes(32).toString("hex"),
  CRON_SECRET: () => randomBytes(24).toString("hex"),
  ADMIN_SETUP_TOKEN: () => randomBytes(12).toString("hex"),
};

const ENC_PREFIX = "enc:v1:";

function kek(): Buffer | null {
  const k = process.env.KEPT_SECRETS_KEK;
  if (!k) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error("KEPT_SECRETS_KEK must be 64 hex characters");
  return Buffer.from(k, "hex");
}

export function secretsEncrypted(): boolean {
  try {
    return kek() !== null;
  } catch {
    return false;
  }
}

/** Encrypts a value for storage when a KEK is configured; otherwise returns it unchanged. */
export function sealValue(plain: string): string {
  const key = kek();
  if (!key) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${ENC_PREFIX}${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

/** Reverses sealValue. Plaintext values (stored before a KEK existed) pass through. */
export function openValue(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = kek();
  if (!key) throw new Error("a stored secret is encrypted but KEPT_SECRETS_KEK is not set");
  const [ivHex, tagHex, ctHex] = stored.slice(ENC_PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(ctHex, "hex")), d.final()]).toString("utf8");
}

let loaded = false;

/** Loads (and if needed creates) bootstrapped secrets into process.env. Idempotent and race-safe. */
export async function bootstrapSecrets(): Promise<void> {
  if (loaded) return;
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const missing = Object.keys(GENERATED).filter((k) => !process.env[k]);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
  try {
    await sql`create table if not exists kept_secrets (name text primary key, value text not null, created_at timestamptz not null default now())`;
    for (const name of missing) {
      await sql`insert into kept_secrets (name, value) values (${name}, ${sealValue(GENERATED[name]())}) on conflict (name) do nothing`;
    }
    const rows = await sql<{ name: string; value: string }[]>`select name, value from kept_secrets where name <> 'ADMIN_PASSWORD_HASH'`;
    for (const r of rows) {
      // Re-encrypt rows stored in plaintext before a KEK was configured.
      if (kek() && !r.value.startsWith(ENC_PREFIX)) {
        await sql`update kept_secrets set value = ${sealValue(r.value)} where name = ${r.name} and value = ${r.value}`;
      }
      if (missing.includes(r.name)) process.env[r.name] = openValue(r.value);
    }
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
