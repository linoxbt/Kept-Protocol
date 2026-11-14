/**
 * Deterministic checks on SERV output. Nothing here guesses or repairs: a field that fails is
 * flagged and the draft goes to human review.
 */
import { getAddress, isAddress } from "viem";
import type { ExtractOut } from "@/serv/schemas";

export type Flag =
  | "SOURCE_CONTAINS_INSTRUCTIONS"
  | "SPAN_NOT_IN_SOURCE"
  | "UNGROUNDED_NUMBER"
  | "UNGROUNDED_DATE"
  | "UNGROUNDED_ADDRESS"
  | "INVALID_ADDRESS"
  | "ADDRESS_LOOKALIKE"
  | "DERIVED_VALUE"
  | "MISSING_START_DATE"
  | "MISSING_ADDRESS"
  | "MISSING_AMOUNT"
  | "AMBIGUOUS_QUANTIFIER"
  | "VAGUE_DATE"
  | "NOT_A_COMMITMENT"
  | "UNIT_PERCENT"
  | "UNIT_USD"
  | "DATES_OUT_OF_ORDER"
  | "COMPARATOR_MISMATCH"
  | "CLASSIFIER_DISAGREEMENT"
  | "RULES_DISAGREE"
  | "CONTRADICTION"
  | "SERV_OUTPUT_INVALID"
  | "EXTERNAL_EVIDENCE"
  | string;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompts?)/i,
  /\byou are now\b/i,
  /\b(system|developer) prompt\b/i,
  /\b(ai|model|assistant|llm|agent)s?\b[^.\n]{0,40}\b(must|should|shall)\b[^.\n]{0,40}\b(mark|set|report|classify|output|return)\b/i,
  /\bmark (all|every|these|this)\b[^.\n]{0,40}\b(verified|compliant|kept|satisfied)\b/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,
];

export interface InjectionHit {
  start: number;
  end: number;
  text: string;
}

/** Finds sentences that address an AI. Used to drop overlapping spans and raise a flag. */
export function detectInjection(text: string): InjectionHit[] {
  const hits: InjectionHit[] = [];
  for (const re of INJECTION_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) {
      const s = sentenceBounds(text, m.index ?? 0);
      if (!hits.some((h) => h.start === s.start)) hits.push({ ...s, text: text.slice(s.start, s.end) });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

function sentenceBounds(text: string, at: number): { start: number; end: number } {
  let start = at;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  let end = at;
  while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
  return { start, end: Math.min(text.length, end + 1) };
}

/** Exact substring first; then a whitespace-insensitive match mapped back to original offsets. */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (!q) return null;
  const exact = text.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };
  const map: number[] = [];
  let norm = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (norm.endsWith(" ")) continue;
      norm += " ";
    } else norm += c;
    map.push(i);
  }
  const nq = q.replace(/\s+/g, " ");
  const at = norm.indexOf(nq);
  if (at < 0) return null;
  return { start: map[at], end: map[at + nq.length - 1] + 1 };
}

const SUFFIX: Record<string, bigint> = { k: 1_000n, thousand: 1_000n, m: 1_000_000n, million: 1_000_000n, b: 1_000_000_000n, bn: 1_000_000_000n, billion: 1_000_000_000n };

/** Every number written in the text, as normalized decimal strings (separators removed, suffixes expanded). */
export function numbersInText(text: string): Set<string> {
  const out = new Set<string>();
  const re = /(\d[\d,\s]*(?:\.\d+)?)\s*(k|m|b|bn|thousand|million|billion)?\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/[,\s]/g, "");
    if (!raw) continue;
    out.add(stripZeros(raw));
    if (m[2]) {
      const mult = SUFFIX[m[2].toLowerCase()];
      const [w, f = ""] = raw.split(".");
      const scaled = (BigInt(w + f) * mult) / 10n ** BigInt(f.length);
      out.add(scaled.toString());
    }
  }
  const words: Record<string, string> = { zero: "0", no: "0", none: "0", one: "1", two: "2", three: "3", four: "4", six: "6", nine: "9", twelve: "12", eighteen: "18", "twenty-four": "24", "thirty-six": "36" };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`, "i").test(text)) out.add(n);
  if (/\b(a|one)\s+year\b/i.test(text)) out.add("12");
  for (const m of text.matchAll(/\b(\d+)\s+years?\b/gi)) out.add(String(Number(m[1]) * 12));
  return out;
}

function stripZeros(n: string): string {
  if (!n.includes(".")) return n.replace(/^0+(?=\d)/, "");
  return n.replace(/^0+(?=\d)/, "").replace(/\.?0+$/, "");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Every calendar date written in the text, as YYYY-MM-DD. */
export function datesInText(text: string): Set<string> {
  const out = new Set<string>();
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  const mon = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const idx = (s: string) => MONTHS.findIndex((x) => x.startsWith(s.toLowerCase().slice(0, 3))) + 1;
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon},?\\s+(\\d{4})\\b`, "gi"))) out.add(`${m[3]}-${pad(idx(m[2]))}-${pad(Number(m[1]))}`);
  for (const m of text.matchAll(new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"))) out.add(`${m[3]}-${pad(idx(m[1]))}-${pad(Number(m[2]))}`);
  return out;
}

export function addressesInText(text: string): Set<string> {
  return new Set([...text.matchAll(/0x[0-9a-fA-F]{40}\b/g)].map((m) => m[0].toLowerCase()));
}

export interface GroundingResult {
  flags: Flag[];
  problems: string[];
}

/**
 * Every number, date and address in the structured fields must appear in the excerpt or its
 * context, or carry a `derived` entry that explains how it was computed.
 */
export function checkGrounding(draft: ExtractOut, excerpt: string, context: string): GroundingResult {
  const flags = new Set<Flag>();
  const problems: string[] = [];
  const src = `${excerpt}\n${context}`;
  const nums = numbersInText(src);
  const dates = datesInText(src);
  const addrs = addressesInText(src);
  const derived = new Set(draft.derived.map((d) => d.field));
  if (draft.derived.length) flags.add("DERIVED_VALUE");

  const checkNum = (field: string, v: string | number | null) => {
    if (v === null || v === undefined) return;
    const s = stripZeros(String(v));
    if (!nums.has(s) && !derived.has(field)) {
      flags.add("UNGROUNDED_NUMBER");
      problems.push(`${field} = ${v} does not appear in the excerpt`);
    }
  };
  checkNum("amount", draft.amount);
  checkNum("duration_months", draft.duration_months);
  checkNum("cliff_months", draft.cliff_months);

  for (const field of ["window_start", "window_end"] as const) {
    const v = draft[field];
    if (!v) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
      flags.add("UNGROUNDED_DATE");
      problems.push(`${field} = ${v} is not an ISO calendar date`);
    } else if (!dates.has(v) && !derived.has(field)) {
      flags.add("UNGROUNDED_DATE");
      problems.push(`${field} = ${v} does not appear in the excerpt`);
    }
  }
  if (draft.window_start && draft.window_end && draft.window_start >= draft.window_end) {
    flags.add("DATES_OUT_OF_ORDER");
    problems.push("window_start is not before window_end");
  }

  const addrFields: [string, string | null][] = [
    ["token_address", draft.token_address],
    ["vesting_contract", draft.vesting_contract],
    ...draft.subjects.map((s, i) => [`subjects[${i}].address`, s.address] as [string, string]),
  ];
  for (const [field, a] of addrFields) {
    if (!a) continue;
    if (!isAddress(a, { strict: false })) {
      flags.add("INVALID_ADDRESS");
      problems.push(`${field} = ${a} is not a valid address`);
    } else if (!addrs.has(a.toLowerCase())) {
      flags.add("UNGROUNDED_ADDRESS");
      problems.push(`${field} = ${a} does not appear in the source`);
    }
  }

  if (draft.amount_unit === "percent_of_supply" || draft.amount_unit === "percent_of_allocation") flags.add("UNIT_PERCENT");
  if (draft.amount && draft.amount_unit === "tokens" && writtenAsPercent(src, draft.amount)) {
    flags.add("UNIT_MISMATCH");
    problems.push(`amount ${draft.amount} is written as a percentage or basis points in the source, not a token count`);
  }
  for (const s of draft.subjects) {
    if (s.address && isAddress(s.address, { strict: false }) && nearThirdParty(src, s.address, s.label)) {
      flags.add("THIRD_PARTY_ADDRESS");
      problems.push(`${s.address} is described as a third party (partner, exchange, market maker or advisor), not the team`);
    }
  }
  if (draft.amount_unit === "usd") flags.add("UNIT_USD");
  if (draft.category === "burn" && draft.comparator === "lte") {
    flags.add("COMPARATOR_MISMATCH");
    problems.push("a burn target must be a minimum (gte)");
  }
  if ((draft.category === "token_lock" || draft.category === "vesting") && !draft.vesting_contract && draft.comparator === "gte") {
    flags.add("COMPARATOR_MISMATCH");
    problems.push("a lock limits outflows, so it needs an upper bound (lte)");
  }
  return { flags: [...flags], problems };
}

const PERCENT_AFTER = /^\s*(%|percent\b|per cent\b|bps\b|basis points\b)/i;

/** True if every written occurrence of `amount` in the text is followed by %, percent or bps. */
export function writtenAsPercent(text: string, amount: string): boolean {
  const re = new RegExp(`(?<![\\d.,])${amount.replace(/[.]/g, "\\.")}(?![\\d])`, "g");
  let seen = 0;
  let pct = 0;
  for (const m of text.matchAll(re)) {
    seen++;
    if (PERCENT_AFTER.test(text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16))) pct++;
  }
  return seen > 0 && pct === seen;
}

export const THIRD_PARTY = /\b(partner|market[- ]?maker|exchange|cex|third[- ]party|advisor|adviser|investor|vc|custodian|liquidity provider)s?\b/i;

/** The words right around an address (or its label) describe someone other than the team. */
export function nearThirdParty(text: string, address: string, label: string | null): boolean {
  if (label && THIRD_PARTY.test(label)) return true;
  const lower = text.toLowerCase();
  const at = lower.indexOf(address.toLowerCase());
  if (at < 0) return false;
  return THIRD_PARTY.test(text.slice(Math.max(0, at - 60), at + address.length + 30));
}

/** EIP-55 checksum, or null if invalid. */
export function checksum(a: string | null): `0x${string}` | null {
  if (!a || !isAddress(a, { strict: false })) return null;
  return getAddress(a);
}

/**
 * Address poisoning: a candidate that shares the first and last 4 hex characters with a known
 * address but is not equal to it.
 */
export function lookalikes(candidates: string[], known: string[]): { candidate: string; resembles: string }[] {
  const out: { candidate: string; resembles: string }[] = [];
  const sig = (a: string) => a.toLowerCase().slice(2, 6) + a.toLowerCase().slice(-4);
  for (const c of candidates) {
    for (const k of known) {
      if (c.toLowerCase() !== k.toLowerCase() && sig(c) === sig(k)) out.push({ candidate: c, resembles: k });
    }
  }
  return out;
}
