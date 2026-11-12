/**
 * Structured-output schemas sent to SERV (strict JSON Schema) and the Zod schemas the app uses
 * to validate the same output again at its boundary. A response can still be refused, truncated
 * or invalid, so nothing from SERV is trusted until it passes these.
 */
import { z } from "zod";

const CATEGORY_HINTS = ["token_lock", "vesting", "burn", "treasury", "governance", "fee_distribution", "other"] as const;

export const LocateOut = z.object({
  spans: z.array(z.object({ quote: z.string().min(1).max(1200), category_hint: z.enum(CATEGORY_HINTS) })).max(12),
  instructions_detected: z.boolean(),
  injection_quotes: z.array(z.string()).max(10),
});
export type LocateOut = z.infer<typeof LocateOut>;

export const LOCATE_JSON_SCHEMA = {
  name: "kept_locate",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["spans", "instructions_detected", "injection_quotes"],
    properties: {
      spans: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["quote", "category_hint"],
          properties: { quote: { type: "string" }, category_hint: { type: "string", enum: [...CATEGORY_HINTS] } },
        },
      },
      instructions_detected: { type: "boolean" },
      injection_quotes: { type: "array", items: { type: "string" } },
    },
  },
} as const;

const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;

export const ExtractOut = z.object({
  category: z.enum(CATEGORY_HINTS),
  responsible_entity: z.string().nullable(),
  token_symbol: z.string().nullable(),
  token_address: z.string().nullable(),
  subjects: z
    .array(z.object({ address: z.string(), role: z.enum(["holder", "vesting", "treasury", "executor", "collector"]), label: z.string().nullable() }))
    .max(20),
  comparator: z.enum(["lte", "gte", "eq"]).nullable(),
  amount: z.string().nullable(),
  amount_unit: z.enum(["tokens", "percent_of_supply", "percent_of_allocation", "usd"]).nullable(),
  window_start: z.string().nullable(),
  window_end: z.string().nullable(),
  duration_months: z.number().nullable(),
  cliff_months: z.number().nullable(),
  vesting_contract: z.string().nullable(),
  derived: z.array(z.object({ field: z.string(), rule: z.string() })),
  ambiguity_flags: z.array(z.string()),
  condition_summary: z.string(),
});
export type ExtractOut = z.infer<typeof ExtractOut>;

export const EXTRACT_JSON_SCHEMA = {
  name: "kept_extract",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "category",
      "responsible_entity",
      "token_symbol",
      "token_address",
      "subjects",
      "comparator",
      "amount",
      "amount_unit",
      "window_start",
      "window_end",
      "duration_months",
      "cliff_months",
      "vesting_contract",
      "derived",
      "ambiguity_flags",
      "condition_summary",
    ],
    properties: {
      category: { type: "string", enum: [...CATEGORY_HINTS] },
      responsible_entity: nullableString,
      token_symbol: nullableString,
      token_address: nullableString,
      subjects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["address", "role", "label"],
          properties: {
            address: { type: "string" },
            role: { type: "string", enum: ["holder", "vesting", "treasury", "executor", "collector"] },
            label: nullableString,
          },
        },
      },
      comparator: { type: ["string", "null"], enum: ["lte", "gte", "eq", null] },
      amount: nullableString,
      amount_unit: { type: ["string", "null"], enum: ["tokens", "percent_of_supply", "percent_of_allocation", "usd", null] },
      window_start: nullableString,
      window_end: nullableString,
      duration_months: nullableNumber,
      cliff_months: nullableNumber,
      vesting_contract: nullableString,
      derived: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "rule"],
          properties: { field: { type: "string" }, rule: { type: "string" } },
        },
      },
      ambiguity_flags: { type: "array", items: { type: "string" } },
      condition_summary: { type: "string" },
    },
  },
} as const;

export const VERIFIABILITY = ["direct", "partial", "external", "not_verifiable"] as const;
export const METHOD_CHOICES = ["erc20_outflow_v1", "vesting_schedule_v1", "burn_v1", "none"] as const;

export const ClassifyOut = z.object({
  verifiability: z.enum(VERIFIABILITY),
  method_id: z.enum(METHOD_CHOICES),
  ambiguity_flags: z.array(z.string()),
  rule_ids: z.array(z.string()),
});
export type ClassifyOut = z.infer<typeof ClassifyOut>;

export const CLASSIFY_JSON_SCHEMA = {
  name: "kept_classify",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verifiability", "method_id", "ambiguity_flags", "rule_ids"],
    properties: {
      verifiability: { type: "string", enum: [...VERIFIABILITY] },
      method_id: { type: "string", enum: [...METHOD_CHOICES] },
      ambiguity_flags: { type: "array", items: { type: "string" } },
      rule_ids: { type: "array", items: { type: "string" } },
    },
  },
} as const;
