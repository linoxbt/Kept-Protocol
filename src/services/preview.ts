/**
 * Try-it mode. Anyone can paste a URL or text and see what Kept extracts and what the chain
 * shows, without an account. Guard rails:
 *  - every draft and result is an "Unconfirmed preview": never reviewed, never in the commitments feed;
 *  - every subject is `unconfirmed`, so the worst status a preview can show is At risk;
 *  - previews of public URLs are listed on /previews for 30 days (noindex); pasted text is reachable
 *    only through its own link and expires after 24 hours;
 *  - per-requester hourly limit and the shared daily SERV budget.
 */
import { db, type Sql } from "@/db/client";
import { captureText, fetchSource } from "@/extraction/capture";
import { env } from "@/lib/env";
import type { MethodId } from "@/core/types";
import {
  getExtraction,
  prepareSpec,
  runAndStoreExtraction,
  type ExtractionRow,
} from "./extractions";
import { hit } from "./ratelimit";
import { Invalid } from "./sources";
import { evaluate } from "./verify";

export const PREVIEW_SCAN_BLOCKS = 600_000n;

export class RateLimited extends Error {
  constructor(readonly resetAt: Date) {
    super("too many previews from this address; try again later");
  }
}

export async function startPreview(
  input: { url?: string | null; text?: string | null; requester: string },
  sql: Sql = db(),
  defer?: (work: () => Promise<void>) => void,
): Promise<ExtractionRow> {
  const limit = await hit(
    `tryit:${input.requester}`,
    env().TRYIT_PER_HOUR,
    3600,
    sql,
  );
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const cap = input.url
    ? await fetchSource(input.url)
    : input.text
      ? captureText(input.text)
      : null;
  if (!cap) throw new Invalid("send a url or a text");
  return runAndStoreExtraction(
    {
      project: null,
      sourceId: null,
      snapshot: null,
      preview: {
        text: cap.text,
        url: input.url ?? null,
        sha256: cap.sha256,
        requesterHash: input.requester,
      },
    },
    sql,
    { defer },
  );
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
  /** Values the visitor supplied because the page did not state them. */
  visitor_supplied?: Record<string, unknown>;
}

/** Gaps a visitor may fill for an unconfirmed check. Everything else must come from the page. */
export interface SuppliedValues {
  window_start?: string | null;
  window_end?: string | null;
  duration_months?: number | null;
  amount?: string | null;
  subject_address?: string | null;
}

type PreviewInput = {
  extractionId: string;
  draftIndex: number;
  tokenAddress?: string | null;
  methodId?: MethodId;
  requester: string;
  supplied?: SuppliedValues;
};

export async function previewCheck(
  input: PreviewInput,
  sql: Sql = db(),
): Promise<PreviewCheck> {
  return (await preparePreviewCheck(input, sql))();
}

/** Validates and rate-limits a preview check now; the returned function does the chain scan. */
export async function preparePreviewCheck(
  input: PreviewInput,
  sql: Sql = db(),
): Promise<() => Promise<PreviewCheck>> {
  const limit = await hit(
    `tryit-check:${input.requester}`,
    env().TRYIT_PER_HOUR * 4,
    3600,
    sql,
  );
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const ex = await getExtraction(input.extractionId, sql);
  if (!ex?.preview) throw new Invalid("not a preview");
  const supplied = Object.fromEntries(Object.entries(input.supplied ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "")) as SuppliedValues;
  let edits: Record<string, unknown> | undefined;
  if (Object.keys(supplied).length) {
    const draft = ex.result?.drafts[input.draftIndex];
    if (!draft?.fields) throw new Invalid("that commitment has no structured fields");
    edits = { ...supplied };
    delete edits.subject_address;
    if (supplied.subject_address) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(supplied.subject_address)) throw new Invalid("the wallet address is not a valid address");
      const others = draft.fields.subjects.filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s.address));
      edits.subjects = [{ address: supplied.subject_address, role: draft.fields.category === "burn" ? "executor" : draft.fields.category === "vesting" ? "vesting" : "holder", label: "supplied by a visitor" }, ...others];
      if (draft.fields.category === "vesting") edits.vesting_contract = supplied.subject_address;
    }
    if (supplied.amount !== undefined && !/^\d+(\.\d+)?$/.test(String(supplied.amount))) throw new Invalid("the amount must be a plain number");
  }
  const { spec } = await prepareSpec(
    {
      extractionId: input.extractionId,
      draftIndex: input.draftIndex,
      tokenAddress: input.tokenAddress,
      methodId: input.methodId,
      reviewer: "preview",
      edits,
    },
    sql,
    { previewAttribution: true, visitorSupplied: !!edits },
  );
  return async () => {
    const { decision, result, collected } = await evaluate(spec, sql, {
      budgetBlocks: PREVIEW_SCAN_BLOCKS,
      confirm: false,
    });
    const out: PreviewCheck = {
      label: "Unconfirmed preview",
      status: decision.status,
      final: decision.final,
      reason: collected.complete
        ? decision.reason
        : `${decision.reason} Previews scan at most ${PREVIEW_SCAN_BLOCKS.toLocaleString("en-US")} blocks.`,
      computed_value: result.computed_value,
      threshold_base_units: result.threshold_base_units,
      decimals: spec.token.decimals,
      symbol: spec.token.symbol,
      evidence_count: result.counted.length,
      as_of_block: collected.evidence.finalizedBlock.toString(),
      complete: collected.complete,
      checked_at: new Date().toISOString(),
      ...(Object.keys(supplied).length ? { visitor_supplied: supplied as Record<string, unknown> } : {}),
    };
    await sql`update extractions set result = jsonb_set(coalesce(result, '{}'::jsonb), ${sql.array(["previews", String(input.draftIndex)])}::text[], ${sql.json(out as never)}, true)
            where id = ${input.extractionId}`;
    return out;
  };
}

export async function purgeExpiredPreviews(sql: Sql = db()): Promise<number> {
  const r =
    await sql`delete from extractions where preview and expires_at < now()`;
  return r.count;
}
