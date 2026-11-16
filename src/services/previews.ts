/**
 * Public view of try-it previews. Only previews of public URLs are listed (a pasted text may be
 * private, so it stays reachable only through its own link). Everything here is an Unconfirmed
 * preview: read by SERV, checked by Kept's code, never reviewed, never a verdict.
 */
import { db, type Sql } from "@/db/client";
import { getExtraction, type ExtractionRow } from "./extractions";

const CHECKABLE = ["erc20_outflow_v1", "vesting_schedule_v1", "burn_v1"];

export interface PreviewListItem {
  id: string;
  url: string;
  status: "running" | "done" | "failed";
  created_at: Date;
  drafts: number;
  checkable: number;
  categories: string[];
  checks: string[];
  serv_calls: number;
  error: string | null;
}

export async function listPublicPreviews(limit = 100, sql: Sql = db()): Promise<PreviewListItem[]> {
  return sql<PreviewListItem[]>`
    select id, preview_url as url, status, created_at, error,
      coalesce(jsonb_array_length(result->'drafts'), 0)::int as drafts,
      coalesce((select count(*) from jsonb_array_elements(result->'drafts') d
                where d->'classification'->>'method_id' = any(${CHECKABLE})), 0)::int as checkable,
      coalesce((select array_agg(distinct d->'fields'->>'category') from jsonb_array_elements(result->'drafts') d
                where d->'fields'->>'category' is not null), '{}') as categories,
      coalesce((select array_agg(v->>'status') from jsonb_each(result->'previews') as e(k, v)), '{}') as checks,
      coalesce((result->>'serv_calls')::int, 0) as serv_calls
    from extractions
    where preview and preview_url is not null and (expires_at is null or expires_at > now())
    order by created_at desc
    limit ${limit}`;
}

export interface PreviewStats {
  previews: number;
  sites: number;
  commitments: number;
  checks: number;
}

export async function publicPreviewStats(sql: Sql = db()): Promise<PreviewStats> {
  const [r] = await sql<PreviewStats[]>`
    select count(*)::int as previews,
      count(distinct split_part(split_part(preview_url, '://', 2), '/', 1))::int as sites,
      coalesce(sum(jsonb_array_length(result->'drafts')) filter (where status = 'done'), 0)::int as commitments,
      coalesce(sum((select count(*) from jsonb_object_keys(coalesce(result->'previews', '{}'::jsonb)))), 0)::int as checks
    from extractions
    where preview and preview_url is not null and (expires_at is null or expires_at > now())`;
  return r;
}

/** A preview by id (listed or not), or null if it does not exist, is not a preview, or expired. */
export async function getPublicPreview(id: string, sql: Sql = db()): Promise<ExtractionRow | null> {
  const ex = await getExtraction(id, sql);
  if (!ex?.preview) return null;
  if (ex.expires_at && ex.expires_at.getTime() < Date.now()) return null;
  return ex;
}

/** Plain-language meaning of each draft flag, for readers who are not reviewers. */
export const FLAG_HELP: Record<string, string> = {
  SOURCE_CONTAINS_INSTRUCTIONS: "The page contains text addressed to AI systems. Kept ignored it.",
  SPAN_NOT_IN_SOURCE: "The quote was not found word for word on the page, so it was dropped.",
  UNGROUNDED_NUMBER: "A number in the reading does not appear on the page.",
  UNGROUNDED_DATE: "A date in the reading does not appear on the page.",
  UNGROUNDED_ADDRESS: "An address in the reading does not appear on the page.",
  INVALID_ADDRESS: "An address is malformed or incomplete.",
  ADDRESS_LOOKALIKE: "An address looks like another one on the page: a possible lookalike.",
  DERIVED_VALUE: "A value was worked out from the text rather than stated outright.",
  MISSING_START_DATE: "The page gives no start date, so this cannot be checked onchain yet.",
  MISSING_ADDRESS: "The page names no wallet or contract, so there is nothing onchain to check.",
  MISSING_AMOUNT: "The page states no amount.",
  AMBIGUOUS_QUANTIFIER: "Words like \"about\" or \"up to\" make the amount imprecise.",
  VAGUE_DATE: "A date is vague (for example \"mid 2027\" or \"Q3\").",
  NOT_A_COMMITMENT: "This reads as a description, not a promise.",
  UNIT_PERCENT: "The amount is a percentage, which needs a fixed supply figure to check.",
  UNIT_USD: "The amount is in dollars, which cannot be checked from token transfers alone.",
  DATES_OUT_OF_ORDER: "The end date is before the start date.",
  COMPARATOR_MISMATCH: "The direction of the condition does not fit the kind of promise.",
  CLASSIFIER_DISAGREEMENT: "Two independent readings disagreed on how to verify this.",
  RULES_DISAGREE: "The reading disagrees with Kept's coded policy rules.",
  CONTRADICTION: "The page says something that contradicts this elsewhere.",
  SERV_OUTPUT_INVALID: "The model's answer could not be used for this passage.",
  EXTERNAL_EVIDENCE: "Checking this needs evidence from outside the chain.",
};
