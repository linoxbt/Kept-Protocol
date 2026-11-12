/**
 * Verification methods. Each is a pure function of (spec, evidence): the same inputs always
 * give the same output, so anyone holding a receipt can rerun it. A logic change ships as a
 * new method version; old receipts keep pointing at the version they were issued with.
 */
import { compare, formatUnits, sum } from "./amounts";
import type { CommitmentSpec, Evidence, MethodId, MethodResult, Transfer, Warning } from "./types";

const DAY = 86_400;
export const DEADLINE_WARNING_SECONDS = 7 * DAY;
export const FUNDING_GRACE_SECONDS = 7 * DAY;

export const METHOD_VERSIONS: Record<MethodId, number> = {
  erc20_outflow_v1: 1,
  vesting_schedule_v1: 1,
  burn_v1: 1,
};

const lc = (a: string) => a.toLowerCase();
const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function orderTransfers(list: Transfer[]): Transfer[] {
  return [...list].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}

function base(spec: CommitmentSpec): Omit<MethodResult, "outcome" | "computed_value" | "window_closed" | "counted" | "violating" | "warnings" | "notes"> {
  return {
    method_id: spec.method_id,
    method_version: METHOD_VERSIONS[spec.method_id],
    threshold_base_units: spec.threshold_base_units,
    comparator: spec.comparator,
  };
}

/**
 * erc20_outflow_v1 — locks. Sum outbound transfers of the token from subject addresses inside
 * the window, excluding moves between the entity's own addresses, and compare with the threshold
 * (normally 0, comparator lte).
 */
export function erc20OutflowV1(spec: CommitmentSpec, ev: Evidence): MethodResult {
  const start = ts(spec.window.start);
  const end = ts(spec.window.end);
  const threshold = BigInt(spec.threshold_base_units);
  const notes: string[] = [];
  const warnings: Warning[] = [];
  if (spec.comparator !== "lte") {
    return {
      ...base(spec),
      outcome: "unverifiable",
      computed_value: "0",
      window_closed: false,
      counted: [],
      violating: [],
      warnings,
      notes: ["erc20_outflow_v1 only supports an upper bound (lte) on outflows"],
    };
  }
  if (ev.asOf < start) {
    return { ...base(spec), outcome: "not_started", computed_value: "0", window_closed: false, counted: [], violating: [], warnings, notes: ["window has not started"] };
  }
  const subjects = new Set(spec.subjects.map((s) => lc(s.address)));
  const internal = new Set([...subjects, ...spec.internal_addresses.map(lc)]);
  const token = lc(spec.token.address);
  const isOutflow = (t: Transfer) =>
    lc(t.token) === token && subjects.has(lc(t.from)) && !internal.has(lc(t.to)) && t.blockTime >= start && t.blockTime < end;

  const counted = orderTransfers(ev.transfers.filter(isOutflow));
  let running = 0n;
  let firstBad = -1;
  counted.forEach((t, i) => {
    running += t.amount;
    if (firstBad < 0 && !compare(running, "lte", threshold)) firstBad = i;
  });
  const total = running;
  const windowClosed = ev.asOf >= end;
  const pendingOut = orderTransfers(ev.unfinalizedTransfers.filter(isOutflow));
  if (firstBad < 0 && pendingOut.length > 0 && !compare(total + sum(pendingOut.map((t) => t.amount)), "lte", threshold)) {
    for (const t of pendingOut) {
      warnings.push({
        code: "UNFINALIZED_OUTFLOW",
        detail: `${formatUnits(t.amount, spec.token.decimals)} left ${t.from} in a block that is not yet finalized`,
        txHash: t.txHash,
      });
    }
  }
  const internalMoves = ev.transfers.filter(
    (t) => lc(t.token) === token && subjects.has(lc(t.from)) && internal.has(lc(t.to)) && t.blockTime >= start && t.blockTime < end,
  ).length;
  if (internalMoves > 0) notes.push(`${internalMoves} transfer(s) between the entity's own addresses were not counted`);

  return {
    ...base(spec),
    outcome: firstBad >= 0 ? "violated" : windowClosed ? "satisfied" : "in_progress",
    computed_value: total.toString(),
    window_closed: windowClosed,
    counted,
    violating: firstBad >= 0 ? counted.slice(firstBad) : [],
    warnings,
    notes,
  };
}

/** Amount the stated schedule allows to be released by time t (linear after the cliff). */
export function statedVestedAt(spec: CommitmentSpec, t: number): bigint {
  if (!spec.vesting) return 0n;
  const allocation = BigInt(spec.threshold_base_units);
  const start = ts(spec.vesting.start);
  if (t < start + spec.vesting.cliff_seconds) return 0n;
  const elapsed = BigInt(Math.min(Math.max(t - start, 0), spec.vesting.duration_seconds));
  return (allocation * elapsed) / BigInt(spec.vesting.duration_seconds);
}

/**
 * vesting_schedule_v1 — vesting. Two checks:
 *  1. Releases: cumulative tokens leaving the vesting contract must never exceed what the
 *     STATED schedule allows at that moment. Exceeding it is a breach.
 *  2. Contract: a contract whose own schedule unlocks faster than stated, or that holds less than
 *     the allocation after the grace period, is an early warning (At risk) until tokens actually
 *     leave early.
 */
export function vestingScheduleV1(spec: CommitmentSpec, ev: Evidence): MethodResult {
  const notes: string[] = [];
  const warnings: Warning[] = [];
  if (!spec.vesting) {
    return { ...base(spec), outcome: "unverifiable", computed_value: "0", window_closed: false, counted: [], violating: [], warnings, notes: ["no vesting contract in the spec"] };
  }
  const contract = lc(spec.vesting.contract);
  const token = lc(spec.token.address);
  const statedStart = ts(spec.vesting.start);
  const statedEnd = statedStart + spec.vesting.duration_seconds;
  const allocation = BigInt(spec.threshold_base_units);

  const releases = orderTransfers(
    ev.transfers.filter((t) => lc(t.token) === token && lc(t.from) === contract && t.blockTime >= ts(spec.window.start)),
  );
  let released = 0n;
  let firstBad = -1;
  releases.forEach((t, i) => {
    released += t.amount;
    if (firstBad < 0 && released > statedVestedAt(spec, t.blockTime)) firstBad = i;
  });

  if (ev.vesting) {
    const r = ev.vesting;
    const contractEnd = r.start + r.duration;
    const statedCliffEnd = statedStart + spec.vesting.cliff_seconds;
    const contractCliffEnd = r.start + (r.cliff ?? 0);
    if (r.start < statedStart || contractEnd < statedEnd || contractCliffEnd < statedCliffEnd) {
      warnings.push({
        code: "SCHEDULE_FASTER_THAN_STATED",
        detail: `contract schedule ${iso(r.start)} → ${iso(contractEnd)} (cliff to ${iso(contractCliffEnd)}) is faster than stated ${iso(statedStart)} → ${iso(statedEnd)} (cliff to ${iso(statedCliffEnd)})`,
      });
    }
    if (ev.asOf > statedStart + FUNDING_GRACE_SECONDS && r.funded < allocation) {
      warnings.push({
        code: "UNDERFUNDED",
        detail: `vesting contract received ${formatUnits(r.funded, spec.token.decimals)} of the stated ${formatUnits(allocation, spec.token.decimals)}`,
      });
    }
  } else {
    notes.push("vesting contract schedule could not be read; only releases were checked");
  }

  const windowClosed = ev.asOf >= statedEnd;
  return {
    ...base(spec),
    outcome: firstBad >= 0 ? "violated" : ev.asOf < statedStart ? "not_started" : windowClosed ? "satisfied" : "in_progress",
    computed_value: released.toString(),
    window_closed: windowClosed,
    counted: releases,
    violating: firstBad >= 0 ? releases.slice(firstBad) : [],
    warnings,
    notes,
  };
}

/**
 * burn_v1 — burns. Sum transfers from the attributed executor to the burn set inside the
 * period. Meeting the target is final immediately (a burn cannot be undone). Falling short when
 * the period closes is a breach. Burns by anyone else are ignored.
 */
export function burnV1(spec: CommitmentSpec, ev: Evidence): MethodResult {
  const notes: string[] = [];
  const warnings: Warning[] = [];
  if (!spec.burn) {
    return { ...base(spec), outcome: "unverifiable", computed_value: "0", window_closed: false, counted: [], violating: [], warnings, notes: ["no burn executor in the spec"] };
  }
  const start = ts(spec.window.start);
  const end = ts(spec.window.end);
  const executor = lc(spec.burn.executor);
  const burnSet = new Set(spec.burn.burn_addresses.map(lc));
  const token = lc(spec.token.address);
  const threshold = BigInt(spec.threshold_base_units);
  if (ev.asOf < start) {
    return { ...base(spec), outcome: "not_started", computed_value: "0", window_closed: false, counted: [], violating: [], warnings, notes: ["period has not started"] };
  }
  const counted = orderTransfers(
    ev.transfers.filter(
      (t) => lc(t.token) === token && lc(t.from) === executor && burnSet.has(lc(t.to)) && t.blockTime >= start && t.blockTime < end,
    ),
  );
  const burned = sum(counted.map((t) => t.amount));
  const others = ev.transfers.filter((t) => lc(t.token) === token && burnSet.has(lc(t.to)) && lc(t.from) !== executor).length;
  if (others) notes.push(`${others} burn transfer(s) from non-executor addresses were not counted`);

  const met = compare(burned, spec.comparator === "lte" ? "lte" : "gte", threshold);
  const periodClosed = ev.asOf >= end;
  if (!met && !periodClosed && end - ev.asOf <= DEADLINE_WARNING_SECONDS) {
    warnings.push({
      code: "DEADLINE_NEAR_TARGET_UNMET",
      detail: `${formatUnits(burned, spec.token.decimals)} of ${formatUnits(threshold, spec.token.decimals)} burned with ${Math.ceil((end - ev.asOf) / DAY)} day(s) left`,
    });
  }
  return {
    ...base(spec),
    outcome: met ? "satisfied" : periodClosed ? "violated" : "in_progress",
    computed_value: burned.toString(),
    window_closed: met || periodClosed,
    counted,
    violating: [],
    warnings,
    notes,
  };
}

export const METHODS: Record<MethodId, (spec: CommitmentSpec, ev: Evidence) => MethodResult> = {
  erc20_outflow_v1: erc20OutflowV1,
  vesting_schedule_v1: vestingScheduleV1,
  burn_v1: burnV1,
};

export function runMethod(spec: CommitmentSpec, ev: Evidence): MethodResult {
  const fn = METHODS[spec.method_id];
  if (!fn) throw new Error(`unregistered method: ${spec.method_id}`);
  return fn(spec, ev);
}

function iso(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}
