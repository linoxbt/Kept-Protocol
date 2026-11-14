/**
 * The condition in one plain sentence, written by code from the spec. This is what the UI shows
 * as "what exactly is checked": a model's paraphrase can be wrong, the spec cannot disagree with
 * itself.
 */
import { formatUnits } from "./amounts";
import type { CommitmentSpec } from "./types";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function describeCondition(spec: CommitmentSpec): string {
  const sym = spec.token.symbol ?? "tokens";
  const amount = formatUnits(BigInt(spec.threshold_base_units), spec.token.decimals);
  const from = day(spec.window.start);
  const to = day(spec.window.end);
  if (spec.method_id === "burn_v1" && spec.burn) {
    return `Executor ${short(spec.burn.executor)} must burn at least ${amount} ${sym} between ${from} and ${to}.`;
  }
  if (spec.method_id === "vesting_schedule_v1" && spec.vesting) {
    const start = Date.parse(spec.vesting.start) / 1000;
    const cliffEnd = new Date((start + spec.vesting.cliff_seconds) * 1000).toISOString().slice(0, 10);
    const cliff = spec.vesting.cliff_seconds > 0 ? `nothing before ${cliffEnd}, then ` : "";
    return `Vesting contract ${short(spec.vesting.contract)} may release its ${amount} ${sym} no faster than the stated schedule: ${cliff}linearly from ${day(spec.vesting.start)} to ${to}.`;
  }
  const who = spec.subjects.length === 1 ? short(spec.subjects[0].address) : `${spec.subjects.length} subject addresses`;
  return BigInt(spec.threshold_base_units) === 0n
    ? `No ${sym} may leave ${who} between ${from} and ${to}.`
    : `No more than ${amount} ${sym} may leave ${who} between ${from} and ${to}.`;
}
