/**
 * Status engine: maps a method result plus attribution and provider confirmation onto Kept's
 * public status. Code only. Status and finality are two separate fields: "Verified to date"
 * and "Verified, final" are different claims.
 */
import { formatUnits } from "./amounts";
import { statedVestedAt, vestingSlackSeconds } from "./methods";
import type { AttributionLevel, CommitmentSpec, MethodResult, Status, Subject, Transfer } from "./types";

export type ProviderConfirmation = "confirmed" | "disagreed" | "unavailable" | "not_needed";

export interface StatusDecision {
  status: Status;
  final: boolean;
  /** Mechanical, neutral reason. Never "fraud", "scam", "rug" or "lied". */
  reason: string;
}

export const BREACH_CAPABLE: ReadonlySet<AttributionLevel> = new Set([
  "onchain_proven",
  "declared_by_project",
  "confirmed_by_reviewer",
]);

export function subjectFor(spec: CommitmentSpec, address: string | undefined): Subject | undefined {
  if (!address) return undefined;
  return spec.subjects.find((s) => s.address.toLowerCase() === address.toLowerCase());
}

/** At most this many transfers are re-confirmed one by one on the second provider. */
export const MAX_PROOF_TRANSFERS = 25;

export interface BreachProof {
  /** Transfers whose sum alone exceeds `limit`; all of them must be confirmed on the second provider. */
  transfers: Transfer[];
  limit: bigint;
  subject: Subject;
}

/**
 * The smallest set of transfers that, on its own, proves a violation, using ONLY subjects whose
 * attribution can support a breach. Null when the breach-capable subjects' own outflow stays
 * within the limit: the excess then comes from addresses with unconfirmed attribution, which can
 * only ever produce At risk. (Deciding by the single transfer that crossed the aggregate threshold
 * would let an unconfirmed address's outflow be blamed on a declared one, or hide a declared
 * address's large outflow behind an unconfirmed address that crossed first.)
 */
export function breachProof(spec: CommitmentSpec, result: MethodResult): BreachProof | null {
  if (result.outcome !== "violated" || result.violating.length === 0) return null;
  const pickLargest = (candidates: Transfer[], limit: bigint, subject: Subject | undefined): BreachProof | null => {
    if (!subject) return null;
    const sorted = [...candidates].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
    const transfers: Transfer[] = [];
    let sum = 0n;
    for (const t of sorted) {
      transfers.push(t);
      sum += t.amount;
      if (sum > limit) return { transfers, limit, subject };
    }
    return null;
  };
  if (spec.method_id === "vesting_schedule_v1") {
    const subject = subjectFor(spec, spec.vesting?.contract);
    if (!subject || !BREACH_CAPABLE.has(subject.attribution.level)) return null;
    const crossing = result.violating[0];
    const upTo = result.counted.slice(0, result.counted.indexOf(crossing) + 1);
    return pickLargest(upTo, statedVestedAt(spec, crossing.blockTime + vestingSlackSeconds(spec)), subject);
  }
  if (spec.method_id === "erc20_outflow_v1") {
    const limit = BigInt(result.threshold_base_units);
    const capable = new Set(spec.subjects.filter((s) => BREACH_CAPABLE.has(s.attribution.level)).map((s) => s.address.toLowerCase()));
    const own = result.counted.filter((t) => capable.has(t.from.toLowerCase()));
    let running = 0n;
    const crossing = own.findIndex((t) => (running += t.amount) > limit);
    if (crossing < 0) return null;
    const upTo = own.slice(0, crossing + 1);
    return pickLargest(upTo, limit, subjectFor(spec, own[crossing].from));
  }
  return null;
}

/** The subject whose action (or inaction) decides a violation. */
export function responsibleSubject(spec: CommitmentSpec, result: MethodResult): Subject | undefined {
  if (spec.method_id === "burn_v1") return subjectFor(spec, spec.burn?.executor);
  if (spec.method_id === "vesting_schedule_v1") return subjectFor(spec, spec.vesting?.contract);
  // Outflows: a breach needs the breach-capable subjects' own outflow to exceed the limit.
  const proof = breachProof(spec, result);
  if (proof) return proof.subject;
  return subjectFor(spec, result.violating[0]?.from);
}

export function deriveStatus(
  spec: CommitmentSpec,
  result: MethodResult,
  confirmation: ProviderConfirmation,
): StatusDecision {
  const d = spec.token.decimals;
  const sym = spec.token.symbol ?? "tokens";
  switch (result.outcome) {
    case "unverifiable":
      return { status: "unverifiable", final: false, reason: result.notes[0] ?? "the condition cannot be checked onchain" };
    case "not_started":
      return { status: "pending", final: false, reason: "the commitment window has not started" };
    case "violated": {
      const subject = responsibleSubject(spec, result);
      const level = subject?.attribution.level ?? "unconfirmed";
      const what = violationSentence(spec, result);
      if (!BREACH_CAPABLE.has(level)) {
        return { status: "at_risk", final: false, reason: `${what}; attribution unconfirmed, so this cannot be a breach` };
      }
      if (spec.method_id !== "burn_v1" && !breachProof(spec, result)) {
        return { status: "at_risk", final: false, reason: `${what}; addresses with confirmed attribution stayed within the limit (the excess left addresses whose attribution is unconfirmed), so this cannot be a breach` };
      }
      if (confirmation === "disagreed") {
        return { status: "at_risk", final: false, reason: `${what}; evidence providers disagree, incident opened` };
      }
      if (confirmation !== "confirmed" && confirmation !== "not_needed") {
        return { status: "at_risk", final: false, reason: `${what}; awaiting confirmation from a second evidence provider` };
      }
      return { status: "breached", final: true, reason: `Condition not met: ${what}` };
    }
    case "in_progress":
    case "satisfied": {
      if (result.warnings.length > 0) {
        return { status: "at_risk", final: false, reason: result.warnings.map((w) => w.detail).join("; ") };
      }
      if (result.outcome === "in_progress" && spec.method_id === "burn_v1") {
        // A target not yet met is not "verified to date": nothing has been delivered yet.
        const burned = `${formatUnits(BigInt(result.computed_value), d)} ${sym}`;
        const target = `${formatUnits(BigInt(result.threshold_base_units), d)} ${sym}`;
        return { status: "pending", final: false, reason: `${burned} of ${target} burned so far; the period ends ${spec.window.end.slice(0, 10)}` };
      }
      const value = `${formatUnits(BigInt(result.computed_value), d)} ${sym}`;
      const limit = `${formatUnits(BigInt(result.threshold_base_units), d)} ${sym}`;
      const final = result.outcome === "satisfied" && result.window_closed;
      return {
        status: "verified",
        final,
        reason: final ? `condition held: ${value} against ${limit}` : `condition holding to date: ${value} against ${limit}`,
      };
    }
  }
}

export function violationSentence(spec: CommitmentSpec, result: MethodResult): string {
  const d = spec.token.decimals;
  const sym = spec.token.symbol ?? "tokens";
  const value = `${formatUnits(BigInt(result.computed_value), d)} ${sym}`;
  const limit = `${formatUnits(BigInt(result.threshold_base_units), d)} ${sym}`;
  if (spec.method_id === "burn_v1") return `${value} burned by the executor in the period, below the stated ${limit}`;
  if (spec.method_id === "vesting_schedule_v1") {
    const t = result.violating[0];
    return `${value} left vesting contract ${spec.vesting?.contract} by ${t ? new Date(t.blockTime * 1000).toISOString().slice(0, 10) : "the check"}, more than the stated schedule allows`;
  }
  const t = result.violating[0];
  const startT = Math.floor(Date.parse(spec.window.start) / 1000);
  const endT = Math.floor(Date.parse(spec.window.end) / 1000);
  const day = t ? Math.floor((t.blockTime - startT) / 86400) + 1 : 0;
  const len = Math.round((endT - startT) / 86400);
  return `${value} left ${t?.from ?? "subject addresses"} on day ${day} of a ${len}-day window (allowed: ${limit})`;
}

export const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  awaiting_evidence: "Awaiting evidence",
  verified: "Verified",
  at_risk: "At risk",
  breached: "Breached",
  unverifiable: "Unverifiable",
  disputed: "Disputed",
};
