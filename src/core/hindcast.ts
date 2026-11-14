/**
 * Hindcast: replay one or more commitment versions over the same historical evidence and report
 * what Kept would have shown on each date. Same method, same code, same evidence; a replay never
 * implies an outcome was predictable, and a gap in evidence is shown as a gap.
 */
import { runMethod } from "./methods";
import { deriveStatus, type ProviderConfirmation } from "./status";
import type { CommitmentSpec, Evidence, Status, Transfer, VestingReads } from "./types";

export interface HindcastVersionInput {
  version: number;
  spec: CommitmentSpec;
  /** Unix seconds the version's source was published or captured. */
  publishedAt: number;
}

export interface HindcastPoint {
  t: number;
  status: Status;
  final: boolean;
  reason: string;
  computed_value: string;
  /** The transfer that produced this sample, if the sample is an evidence event. */
  txHash?: string;
}

export interface HindcastChange {
  t: number;
  from: Status | null;
  to: Status;
  reason: string;
  txHash?: string;
}

export interface HindcastLane {
  version: number;
  points: HindcastPoint[];
  changes: HindcastChange[];
  firstBreachedAt: number | null;
  firstVerifiedFinalAt: number | null;
}

export interface HindcastResult {
  from: number;
  to: number;
  lanes: HindcastLane[];
  /** Times where the lanes disagree on status. */
  divergences: { t: number; statuses: Record<number, Status> }[];
}

const DAY = 86_400;

export function sampleTimes(from: number, to: number, transfers: Transfer[], specs: CommitmentSpec[]): number[] {
  const set = new Set<number>();
  for (let t = from; t <= to; t += DAY) set.add(t);
  set.add(to);
  for (const tr of transfers) if (tr.blockTime >= from && tr.blockTime <= to) set.add(tr.blockTime);
  for (const s of specs) {
    for (const iso of [s.window.start, s.window.end]) {
      const t = Math.floor(Date.parse(iso) / 1000);
      if (t >= from && t <= to) set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function runHindcast(
  versions: HindcastVersionInput[],
  transfers: Transfer[],
  opts: {
    from: number;
    to: number;
    vesting: VestingReads | null;
    confirmation: ProviderConfirmation;
    blockAt: (t: number) => bigint;
  },
): HindcastResult {
  const times = sampleTimes(opts.from, opts.to, transfers, versions.map((v) => v.spec));
  const byTime = new Map<number, Transfer>();
  for (const t of transfers) if (!byTime.has(t.blockTime)) byTime.set(t.blockTime, t);

  const lanes: HindcastLane[] = versions.map((v) => {
    const points: HindcastPoint[] = [];
    const changes: HindcastChange[] = [];
    let prev: Status | null = null;
    let firstBreachedAt: number | null = null;
    let firstVerifiedFinalAt: number | null = null;
    for (const t of times) {
      const ev: Evidence = {
        finalizedBlock: opts.blockAt(t),
        finalizedTime: t,
        latestBlock: opts.blockAt(t),
        fromBlock: opts.blockAt(opts.from),
        transfers: transfers.filter((x) => x.blockTime <= t),
        unfinalizedTransfers: [],
        vesting: opts.vesting,
        asOf: t,
      };
      const result = runMethod(v.spec, ev);
      const decision = deriveStatus(v.spec, result, opts.confirmation);
      const trigger = byTime.get(t);
      points.push({ t, status: decision.status, final: decision.final, reason: decision.reason, computed_value: result.computed_value, txHash: trigger?.txHash });
      if (decision.status !== prev) {
        changes.push({ t, from: prev, to: decision.status, reason: decision.reason, txHash: trigger?.txHash });
        prev = decision.status;
      }
      if (decision.status === "breached" && firstBreachedAt === null) firstBreachedAt = t;
      if (decision.status === "verified" && decision.final && firstVerifiedFinalAt === null) firstVerifiedFinalAt = t;
    }
    return { version: v.version, points, changes, firstBreachedAt, firstVerifiedFinalAt };
  });

  const divergences: HindcastResult["divergences"] = [];
  if (lanes.length > 1) {
    times.forEach((t, i) => {
      const statuses: Record<number, Status> = {};
      for (const lane of lanes) statuses[lane.version] = lane.points[i].status;
      if (new Set(Object.values(statuses)).size > 1) divergences.push({ t, statuses });
    });
  }
  return { from: opts.from, to: opts.to, lanes, divergences };
}
