import type { CommitmentSpec, Evidence, Transfer } from "@/core/types";

export const TOKEN = "0x1111111111111111111111111111111111111111" as const;
export const TEAM = "0x2222222222222222222222222222222222222222" as const;
export const TEAM2 = "0x3333333333333333333333333333333333333333" as const;
export const BUYER = "0x4444444444444444444444444444444444444444" as const;
export const VESTING = "0x5555555555555555555555555555555555555555" as const;
export const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
export const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
export const E18 = 10n ** 18n;

let n = 0;
export function transfer(p: Partial<Transfer> & { from: `0x${string}`; to: `0x${string}`; amount: bigint; at: string }): Transfer {
  n++;
  return {
    txHash: (`0x${n.toString(16).padStart(64, "0")}`) as `0x${string}`,
    logIndex: 0,
    blockNumber: BigInt(1000 + n),
    blockTime: t(p.at),
    token: TOKEN,
    ...p,
  } as Transfer;
}

export function lockSpec(over: Partial<CommitmentSpec> = {}): CommitmentSpec {
  return {
    schema_version: 1,
    category: "token_lock",
    method_id: "erc20_outflow_v1",
    chain_id: 8453,
    token: { address: TOKEN, symbol: "XYZ", decimals: 18 },
    subjects: [{ address: TEAM, role: "holder", label: "team", attribution: { level: "declared_by_project", evidence: "docs", confirmed_by: null } }],
    comparator: "lte",
    threshold: "0",
    threshold_base_units: "0",
    window: { start: "2026-03-01T00:00:00.000Z", end: "2027-03-01T00:00:00.000Z" },
    vesting: null,
    burn: null,
    internal_addresses: [],
    responsible_entity: "XYZ Labs",
    condition_summary: "No team tokens leave the team wallet until 1 March 2027.",
    excerpt: "Team tokens are locked for 12 months from 1 March 2026.",
    derived: [],
    ambiguity_flags: [],
    ...over,
  };
}

export function evidence(transfers: Transfer[], asOfIso: string, over: Partial<Evidence> = {}): Evidence {
  return {
    finalizedBlock: 100_000n,
    finalizedTime: t(asOfIso),
    latestBlock: 100_100n,
    fromBlock: 0n,
    transfers,
    unfinalizedTransfers: [],
    vesting: null,
    asOf: t(asOfIso),
    ...over,
  };
}
