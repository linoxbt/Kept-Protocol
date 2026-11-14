/**
 * Status engine: maps a method result plus attribution and provider confirmation onto Kept's
 * public status. Code only. Status and finality are two separate fields: "Verified to date"
 * and "Verified, final" are different claims.
 */
import { formatUnits } from "./amounts";
import type { AttributionLevel, CommitmentSpec, MethodResult, Status, Subject } from "./types";

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

/** The subject whose action (or inaction) decides a violation. */
export function responsibleSubject(spec: CommitmentSpec, result: MethodResult): Subject | undefined {
  if (spec.method_id === "burn_v1") return subjectFor(spec, spec.burn?.executor);
  if (spec.method_id === "vesting_schedule_v1") return subjectFor(spec, spec.vesting?.contract);
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
      return { status: "unverifiable", final: false, reason: result.notes[0] ?? "the condition cannot be checked on-chain" };
    case "not_started":
      return { status: "pending", final: false, reason: "the commitment window has not started" };
    case "violated": {
      const subject = responsibleSubject(spec, result);
      const level = subject?.attribution.level ?? "unconfirmed";
      const what = violationSentence(spec, result);
      if (!BREACH_CAPABLE.has(level)) {
        return { status: "at_risk", final: false, reason: `${what}; attribution unconfirmed, so this cannot be a breach` };
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
