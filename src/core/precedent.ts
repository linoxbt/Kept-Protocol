/**
 * Precedent: deterministic comparison of two commitment versions, and the retroactive-revision
 * flag. Versions are immutable; this module only reads them.
 */
import { runMethod } from "./methods";
import type { CommitmentSpec, Evidence, Transfer } from "./types";

export type ChangeKind = "initial" | "policy_change" | "editorial" | "correction" | "supersede";

/** Fields whose change alters what is checked. Any change here is a policy change. */
export const POLICY_FIELDS = [
  "category",
  "method_id",
  "token.address",
  "comparator",
  "threshold",
  "window.start",
  "window.end",
  "subjects",
  "vesting.start",
  "vesting.cliff_seconds",
  "vesting.duration_seconds",
  "vesting.contract",
  "burn.executor",
  "burn.burn_addresses",
  "responsible_entity",
] as const;

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
  policy: boolean;
}

function get(spec: CommitmentSpec, path: string): string | null {
  if (path === "subjects") {
    return spec.subjects.map((s) => s.address.toLowerCase()).sort().join(",") || null;
  }
  if (path === "burn.burn_addresses") {
    return spec.burn ? spec.burn.burn_addresses.map((a) => a.toLowerCase()).sort().join(",") : null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = spec;
  for (const key of path.split(".")) {
    if (cur == null) return null;
    cur = cur[key];
  }
  if (cur == null) return null;
  return typeof cur === "string" ? (path.endsWith("address") || path.endsWith("contract") || path.endsWith("executor") ? cur.toLowerCase() : cur) : String(cur);
}

export function fieldDiff(a: CommitmentSpec, b: CommitmentSpec): FieldChange[] {
  const fields = [...POLICY_FIELDS, "condition_summary", "excerpt"] as const;
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const from = get(a, field);
    const to = get(b, field);
    if (from !== to) changes.push({ field, from, to, policy: (POLICY_FIELDS as readonly string[]).includes(field) });
  }
  return changes;
}

export function classifyChange(a: CommitmentSpec, b: CommitmentSpec): "policy_change" | "editorial" | "none" {
  const changes = fieldDiff(a, b);
  if (changes.length === 0) return "none";
  return changes.some((c) => c.policy) ? "policy_change" : "editorial";
}

export interface RetroactiveFlag {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockTime: number;
  /** Neutral, mechanical wording. */
  message: string;
}

/**
 * Flags transfers that would breach the earlier version, would not breach the later one, and
 * happened BEFORE the later version was published: "condition relaxed after the event".
 */
export function retroactiveRevisionFlags(
  earlier: CommitmentSpec,
  later: CommitmentSpec,
  laterPublishedAt: number,
  transfers: Transfer[],
  base: Omit<Evidence, "transfers" | "unfinalizedTransfers" | "asOf">,
): RetroactiveFlag[] {
  const before = transfers.filter((t) => t.blockTime < laterPublishedAt);
  const ev: Evidence = { ...base, transfers: before, unfinalizedTransfers: [], asOf: laterPublishedAt };
  const r1 = runMethod(earlier, ev);
  const r2 = runMethod(later, ev);
  if (r1.outcome !== "violated") return [];
  const key = (t: Transfer) => `${t.txHash}:${t.logIndex}`;
  const stillBad = new Set(r2.outcome === "violated" ? r2.violating.map(key) : []);
  return r1.violating
    .filter((t) => !stillBad.has(key(t)))
    .map((t) => ({
      txHash: t.txHash,
      logIndex: t.logIndex,
      blockNumber: t.blockNumber.toString(),
      blockTime: t.blockTime,
      message: `Condition relaxed after the event: this transfer on ${new Date(t.blockTime * 1000).toISOString().slice(0, 10)} falls outside the revised condition, which was published on ${new Date(laterPublishedAt * 1000).toISOString().slice(0, 10)}.`,
    }));
}
