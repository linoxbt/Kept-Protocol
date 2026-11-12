/**
 * Try-it mode. Anyone can paste a URL or text and see what Kept extracts and what the chain
 * shows, without an account. Guard rails:
 *  - every draft and result is an "Unconfirmed preview": never published, never in the feed;
 *  - every subject is `unconfirmed`, so the worst status a preview can show is At risk;
 *  - previews expire after 24 hours;
 *  - per-requester hourly limit and the shared daily SERV budget.
 */
import { db, type Sql } from "@/db/client";
import { captureText, fetchSource } from "@/extraction/capture";
import { env } from "@/lib/env";
import type { MethodId } from "@/core/types";
import { getExtraction, prepareSpec, runAndStoreExtraction, type ExtractionRow } from "./extractions";
import { hit } from "./ratelimit";
import { Invalid } from "./sources";
import { evaluate } from "./verify";

export const PREVIEW_SCAN_BLOCKS = 600_000n;

export class RateLimited extends Error {
  constructor(readonly resetAt: Date) {
    super("too many previews from this address; try again later");
  }
}

export async function startPreview(input: { url?: string | null; text?: string | null; requester: string }, sql: Sql = db()): Promise<ExtractionRow> {
  const limit = await hit(`tryit:${input.requester}`, env().TRYIT_PER_HOUR, 3600, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const cap = input.url ? await fetchSource(input.url) : input.text ? captureText(input.text) : null;
  if (!cap) throw new Invalid("send a url or a text");
  return runAndStoreExtraction({ project: null, sourceId: null, snapshot: null, preview: { text: cap.text, url: input.url ?? null, sha256: cap.sha256, requesterHash: input.requester } }, sql);
}

export interface PreviewCheck {
  label: "Unconfirmed preview";
  status: string;
  final: boolean;
  reason: string;
  computed_value: string;
  threshold_base_units: string;
  decimals: number;
  symbol: string | null;
  evidence_count: number;
  as_of_block: string;
  complete: boolean;
  checked_at: string;
}

export async function previewCheck(
  input: { extractionId: string; draftIndex: number; tokenAddress?: string | null; methodId?: MethodId; requester: string },
  sql: Sql = db(),
): Promise<PreviewCheck> {
  const limit = await hit(`tryit-check:${input.requester}`, env().TRYIT_PER_HOUR * 4, 3600, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const ex = await getExtraction(input.extractionId, sql);
  if (!ex?.preview) throw new Invalid("not a preview");
  const { spec } = await prepareSpec(
    { extractionId: input.extractionId, draftIndex: input.draftIndex, tokenAddress: input.tokenAddress, methodId: input.methodId, reviewer: "preview" },
    sql,
    { previewAttribution: true },
  );
  const { decision, result, collected } = await evaluate(spec, sql, { budgetBlocks: PREVIEW_SCAN_BLOCKS });
  const out: PreviewCheck = {
    label: "Unconfirmed preview",
    status: decision.status,
    final: decision.final,
    reason: collected.complete ? decision.reason : `${decision.reason} Previews scan at most ${PREVIEW_SCAN_BLOCKS.toLocaleString("en-US")} blocks.`,
    computed_value: result.computed_value,
    threshold_base_units: result.threshold_base_units,
    decimals: spec.token.decimals,
    symbol: spec.token.symbol,
    evidence_count: result.counted.length,
    as_of_block: collected.evidence.finalizedBlock.toString(),
    complete: collected.complete,
    checked_at: new Date().toISOString(),
  };
  await sql`update extractions set result = jsonb_set(coalesce(result, '{}'::jsonb), ${sql.array(["previews", String(input.draftIndex)])}::text[], ${sql.json(out as never)}, true)
            where id = ${input.extractionId}`;
  return out;
}

export async function purgeExpiredPreviews(sql: Sql = db()): Promise<number> {
  const r = await sql`delete from extractions where preview and expires_at < now()`;
  return r.count;
}
