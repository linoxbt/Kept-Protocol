/**
 * Core domain types for Kept's deterministic verification layer.
 *
 * Nothing in src/core may import from src/serv or any AI client. The ESLint
 * boundary rule in eslint.config.mjs enforces this: verification cannot depend on AI.
 */
import { z } from "zod";

export const CHAIN_IDS = { base: 8453, baseSepolia: 84532 } as const;

export const HexAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

export const Category = z.enum(["token_lock", "vesting", "burn"]);
export type Category = z.infer<typeof Category>;

export const MethodId = z.enum(["erc20_outflow_v1", "vesting_schedule_v1", "burn_v1"]);
export type MethodId = z.infer<typeof MethodId>;

export const Comparator = z.enum(["lte", "gte", "eq"]);
export type Comparator = z.infer<typeof Comparator>;

export const AttributionLevel = z.enum([
  "onchain_proven",
  "declared_by_project",
  "confirmed_by_reviewer",
  "unconfirmed",
]);
export type AttributionLevel = z.infer<typeof AttributionLevel>;

export const SubjectRole = z.enum(["holder", "vesting", "treasury", "executor", "collector"]);

export const Subject = z.object({
  address: HexAddress,
  role: SubjectRole,
  label: z.string().max(120).nullable().default(null),
  attribution: z
    .object({
      level: AttributionLevel,
      evidence: z.string().max(2000).nullable().default(null),
      confirmed_by: z.string().max(120).nullable().default(null),
    })
    .default({ level: "unconfirmed", evidence: null, confirmed_by: null }),
});
export type Subject = z.infer<typeof Subject>;

const IsoDateTime = z.string().datetime({ offset: true });

export const Derived = z.object({ field: z.string(), rule: z.string() });

/**
 * A commitment spec is the immutable, structured content of one commitment version.
 * Every amount is an integer string in token base units, so it round-trips through JSON
 * without precision loss.
 */
export const CommitmentSpec = z.object({
  schema_version: z.literal(1),
  category: Category,
  method_id: MethodId,
  chain_id: z.number().int().positive(),
  token: z.object({
    address: HexAddress,
    symbol: z.string().max(32).nullable(),
    decimals: z.number().int().min(0).max(36),
  }),
  subjects: z.array(Subject).min(1).max(20),
  comparator: Comparator,
  /** Threshold as stated in the source, in whole-token units (for display and grounding). */
  threshold: z.string().regex(/^\d+(\.\d+)?$/),
  /** Threshold in base units, computed by code from `threshold` and `token.decimals`. */
  threshold_base_units: z.string().regex(/^\d+$/),
  window: z.object({ start: IsoDateTime, end: IsoDateTime }),
  vesting: z
    .object({
      contract: HexAddress,
      start: IsoDateTime,
      cliff_seconds: z.number().int().min(0),
      duration_seconds: z.number().int().positive(),
    })
    .nullable()
    .default(null),
  burn: z
    .object({
      executor: HexAddress,
      burn_addresses: z.array(HexAddress).min(1),
    })
    .nullable()
    .default(null),
  /** Reviewer-confirmed addresses that belong to the same entity (internal moves are not outflows). */
  internal_addresses: z.array(HexAddress).default([]),
  responsible_entity: z.string().max(200).nullable(),
  condition_summary: z.string().max(500),
  excerpt: z.string().min(1).max(4000),
  derived: z.array(Derived).default([]),
  ambiguity_flags: z.array(z.string()).default([]),
});
export type CommitmentSpec = z.infer<typeof CommitmentSpec>;

export const Status = z.enum([
  "pending",
  "awaiting_evidence",
  "verified",
  "at_risk",
  "breached",
  "unverifiable",
  "disputed",
]);
export type Status = z.infer<typeof Status>;

/** An ERC-20 Transfer log, decoded. Amounts are bigint base units. */
export interface Transfer {
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  /** Unix seconds. */
  blockTime: number;
  token: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
}

export interface VestingReads {
  start: number;
  duration: number;
  /** Seconds; OpenZeppelin VestingWallet has none, VestingWalletCliff exposes cliff(). */
  cliff: number | null;
  beneficiary: `0x${string}` | null;
  /** Total tokens ever received by the vesting contract, base units. */
  funded: bigint;
}

export interface Evidence {
  /** Highest block whose data counts toward a status. */
  finalizedBlock: bigint;
  finalizedTime: number;
  /** Highest block seen at all (for early warnings only). */
  latestBlock: bigint;
  fromBlock: bigint;
  /** Finalized transfers relevant to the spec, from fromBlock..finalizedBlock. */
  transfers: Transfer[];
  /** Transfers seen above finalizedBlock. They never set Verified or Breached. */
  unfinalizedTransfers: Transfer[];
  vesting: VestingReads | null;
  /** Evaluation time, unix seconds. Live checks use the finalized block time. */
  asOf: number;
}

export type Outcome = "satisfied" | "violated" | "not_started" | "in_progress" | "unverifiable";

export interface MethodResult {
  method_id: MethodId;
  method_version: number;
  outcome: Outcome;
  /** Computed quantity compared against the threshold, base units. */
  computed_value: string;
  threshold_base_units: string;
  comparator: Comparator;
  /** True once the window closed (or a gte target was met, which cannot be undone). */
  window_closed: boolean;
  /** Transfers that count toward the computed value, in block order. */
  counted: Transfer[];
  /** The transfer at which the condition first failed, if any. */
  violating: Transfer[];
  /** Early-warning signals that map to At risk. */
  warnings: Warning[];
  notes: string[];
}

export type WarningCode =
  | "UNFINALIZED_OUTFLOW"
  | "SCHEDULE_FASTER_THAN_STATED"
  | "UNDERFUNDED"
  | "DEADLINE_NEAR_TARGET_UNMET"
  | "BENEFICIARY_MISMATCH";

export interface Warning {
  code: WarningCode;
  detail: string;
  txHash?: string;
}
