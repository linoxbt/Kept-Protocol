import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  /** Hex private key for receipt and response signatures. Required in production. */
  KEPT_SIGNER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  /** Admin key for write operations (review, confirm, verify, versions). Required in production. */
  KEPT_ADMIN_KEY: z.string().min(24).optional(),
  /** HMAC secret for admin session cookies. Defaults to a hash of the admin key. */
  KEPT_SESSION_SECRET: z.string().min(24).optional(),
  SERV_API_KEY: z.string().optional(),
  SERV_BASE_URL: z.string().url().default("https://inference-api.openserv.ai/v1"),
  SERV_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
  BASE_RPC_URL: z.string().url().default("https://base-rpc.publicnode.com"),
  /** An independent RPC used to confirm breach evidence (two-provider rule). */
  BASE_RPC_URL_CONFIRM: z.string().url().default("https://mainnet.base.org"),
  /** Max blocks per eth_getLogs call for the primary RPC. Learned downward automatically. */
  BASE_RPC_MAX_RANGE: z.coerce.number().int().positive().default(50_000),
  BASE_SEPOLIA_RPC_URL: z.string().url().default("https://base-sepolia-rpc.publicnode.com"),
  BASE_SEPOLIA_RPC_URL_CONFIRM: z.string().url().default("https://sepolia.base.org"),
  X402_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  X402_NETWORK: z.string().default("eip155:84532"),
  X402_FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  X402_PRICE: z.string().default("$0.01"),
  CRON_SECRET: z.string().min(16).optional(),
  KEPT_CODE_COMMIT: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  TRYIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  ANCHOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  EAS_SCHEMA_UID: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

export type EnvT = z.infer<typeof Env>;

let cached: EnvT | null = null;

export function env(): EnvT {
  if (cached) return cached;
  // Empty strings (e.g. an unresolved platform variable reference) count as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = Env.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Fail fast on misconfiguration in production. Called from instrumentation at server start. */
export function assertProductionEnv(): void {
  const e = env();
  if (e.NODE_ENV !== "production" || process.env.KEPT_ALLOW_DEV_KEYS === "1") return;
  const missing = (["DATABASE_URL", "KEPT_SIGNER_PRIVATE_KEY"] as const).filter((k) => !e[k]);
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
}

export function codeCommit(): string {
  const e = env();
  return e.KEPT_CODE_COMMIT ?? e.VERCEL_GIT_COMMIT_SHA ?? "dev";
}

export function resetEnvCache(): void {
  cached = null;
}
