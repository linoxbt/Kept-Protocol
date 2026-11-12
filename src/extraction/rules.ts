/**
 * The verifiability policy matrix, in code. SERV Multipath applies the same numbered rules from
 * the classify prompt; this deterministic copy cross-checks it. Disagreement sends the draft to
 * review. The method a draft finally gets is always one registered here.
 */
import type { ClassifyOut, ExtractOut } from "@/serv/schemas";

export interface RuleDecision {
  verifiability: ClassifyOut["verifiability"];
  method_id: ClassifyOut["method_id"];
  rule: string;
}

const EXTERNAL = /\b(audit|audited|partnership|listing|listed on|exchange|kyc|regulat|license)\w*/i;

export function classifyByRules(d: ExtractOut, excerpt: string): RuleDecision {
  const flags = new Set(d.ambiguity_flags);
  if (d.category === "other" || flags.has("NOT_A_COMMITMENT")) return { verifiability: "not_verifiable", method_id: "none", rule: "R1" };
  if (d.amount_unit === "usd") return { verifiability: "partial", method_id: "none", rule: "R2" };
  if (d.category === "treasury" || d.category === "governance" || d.category === "fee_distribution")
    return { verifiability: "partial", method_id: "none", rule: "R3" };
  if (d.category === "vesting" && d.vesting_contract) return { verifiability: "direct", method_id: "vesting_schedule_v1", rule: "R4" };
  if ((d.category === "vesting" || d.category === "token_lock") && d.subjects.length > 0 && d.amount_unit === "tokens")
    return { verifiability: "direct", method_id: "erc20_outflow_v1", rule: "R5" };
  if (d.category === "burn" && d.subjects.some((s) => s.role === "executor") && d.amount_unit === "tokens")
    return { verifiability: "direct", method_id: "burn_v1", rule: "R6" };
  if (d.category === "burn" && (d.amount_unit === "percent_of_supply" || d.amount_unit === "percent_of_allocation"))
    return { verifiability: "partial", method_id: "none", rule: "R7" };
  if (d.subjects.length === 0) return { verifiability: "partial", method_id: "none", rule: "R8" };
  if (EXTERNAL.test(excerpt)) return { verifiability: "external", method_id: "none", rule: "R9" };
  return { verifiability: "not_verifiable", method_id: "none", rule: "R10" };
}
