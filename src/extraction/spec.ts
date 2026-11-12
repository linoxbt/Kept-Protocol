/**
 * Builds an immutable CommitmentSpec from a confirmed draft. Code computes every derived value
 * (base units, window end from a duration, schedule seconds) and records how; it never fills a
 * missing fact with a guess.
 */
import { toBaseUnits } from "@/core/amounts";
import { CommitmentSpec, type AttributionLevel, type MethodId } from "@/core/types";
import type { ExtractOut } from "@/serv/schemas";
import { checksum } from "./validate";

export const BURN_ADDRESSES = ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dEaD"] as const;

export interface ConfirmInput {
  fields: ExtractOut;
  method_id: MethodId;
  chain_id: number;
  token: { address: string; symbol: string | null; decimals: number };
  excerpt: string;
  attribution: Record<string, { level: AttributionLevel; evidence: string | null; confirmed_by: string | null }>;
  internal_addresses?: string[];
}

export function addMonthsUtc(isoDate: string, months: number): Date {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const whole = Math.trunc(months);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + whole);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  const frac = months - whole;
  if (frac) d.setUTCSeconds(d.getUTCSeconds() + Math.round(frac * 30.436875 * 86400));
  return d;
}

const isoMidnight = (date: string) => `${date.slice(0, 10)}T00:00:00.000Z`;

export function buildSpec(input: ConfirmInput): { spec: CommitmentSpec | null; errors: string[] } {
  const f = input.fields;
  const errors: string[] = [];
  const derived = [...f.derived];
  const token = checksum(input.token.address);
  if (!token) errors.push("token address is missing or invalid");

  const subjects = f.subjects
    .map((s) => ({ ...s, address: checksum(s.address) }))
    .filter((s): s is typeof s & { address: `0x${string}` } => s.address !== null)
    .map((s) => ({
      address: s.address,
      role: s.role,
      label: s.label,
      attribution: input.attribution[s.address.toLowerCase()] ?? { level: "unconfirmed" as const, evidence: null, confirmed_by: null },
    }));
  const vestingContract = checksum(f.vesting_contract);
  if (input.method_id === "vesting_schedule_v1" && vestingContract && !subjects.some((s) => s.address === vestingContract)) {
    subjects.push({
      address: vestingContract,
      role: "vesting",
      label: "vesting contract",
      attribution: input.attribution[vestingContract.toLowerCase()] ?? { level: "unconfirmed", evidence: null, confirmed_by: null },
    });
  }
  if (subjects.length === 0) errors.push("at least one subject address is required");

  let start = f.window_start;
  let end = f.window_end;
  if (!start) errors.push("a start date is required (the source gives none; it cannot be guessed)");
  if (start && !end && f.duration_months) {
    end = addMonthsUtc(start, f.duration_months).toISOString().slice(0, 10);
    derived.push({ field: "window_end", rule: `window_start + ${f.duration_months} months (calendar, UTC)` });
  }
  if (!end) errors.push("an end date or a duration is required");

  let amount = f.amount;
  if (amount === null && (input.method_id === "erc20_outflow_v1")) {
    amount = "0";
    derived.push({ field: "amount", rule: "a lock with no stated allowance permits 0 outflow" });
  }
  if (amount === null) errors.push("an amount is required");
  if (f.amount_unit && f.amount_unit !== "tokens") errors.push(`amount unit ${f.amount_unit} cannot be checked by ${input.method_id} in this release`);

  let comparator = f.comparator ?? (input.method_id === "burn_v1" ? "gte" : "lte");
  if (input.method_id === "burn_v1") comparator = "gte";
  if (input.method_id === "erc20_outflow_v1") comparator = "lte";

  let thresholdBase = "0";
  if (amount !== null) {
    try {
      thresholdBase = toBaseUnits(amount, input.token.decimals).toString();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  let vesting: CommitmentSpec["vesting"] = null;
  if (input.method_id === "vesting_schedule_v1") {
    if (!vestingContract) errors.push("vesting_schedule_v1 needs the vesting contract address");
    if (!f.duration_months && !(start && end)) errors.push("vesting needs a duration");
    if (vestingContract && start && end) {
      const s = Date.parse(isoMidnight(start)) / 1000;
      const e = Date.parse(isoMidnight(end)) / 1000;
      const cliff = f.cliff_months ? Math.round(addMonthsUtc(start, f.cliff_months).getTime() / 1000 - s) : 0;
      vesting = { contract: vestingContract, start: isoMidnight(start), duration_seconds: e - s, cliff_seconds: cliff };
    }
  }

  let burn: CommitmentSpec["burn"] = null;
  if (input.method_id === "burn_v1") {
    const executor = subjects.find((s) => s.role === "executor");
    if (!executor) errors.push("burn_v1 needs an executor address");
    else burn = { executor: executor.address, burn_addresses: [...BURN_ADDRESSES] };
  }

  const category = input.method_id === "burn_v1" ? "burn" : input.method_id === "vesting_schedule_v1" ? "vesting" : f.category === "vesting" ? "vesting" : "token_lock";
  if (errors.length || !token || !start || !end) return { spec: null, errors };

  const parsed = CommitmentSpec.safeParse({
    schema_version: 1,
    category,
    method_id: input.method_id,
    chain_id: input.chain_id,
    token: { address: token, symbol: input.token.symbol ?? f.token_symbol, decimals: input.token.decimals },
    subjects,
    comparator,
    threshold: amount,
    threshold_base_units: thresholdBase,
    window: { start: isoMidnight(start), end: isoMidnight(end) },
    vesting,
    burn,
    internal_addresses: (input.internal_addresses ?? []).map(checksum).filter(Boolean),
    responsible_entity: f.responsible_entity,
    condition_summary: f.condition_summary.slice(0, 500),
    excerpt: input.excerpt,
    derived,
    ambiguity_flags: f.ambiguity_flags,
  });
  if (!parsed.success) return { spec: null, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  if (parsed.data.window.start >= parsed.data.window.end) return { spec: null, errors: ["window start must be before window end"] };
  return { spec: parsed.data, errors: [] };
}
