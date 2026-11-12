import { z } from "zod";
import { MethodId } from "@/core/types";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { listVersions } from "@/services/commitments";
import { confirmVersion } from "@/services/precedent";
import { runCheck } from "@/services/verify";

export const maxDuration = 300;

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const versions = await listVersions(id);
  return json({ data: versions.map((v) => ({ version: v.version, change_kind: v.change_kind, change_reason: v.change_reason, published_at: v.published_at, confirmed_by: v.confirmed_by, confirmed_at: v.confirmed_at, spec: v.spec })) }, { sign: true });
});

const Body = z.object({
  extraction_id: z.string(),
  draft_index: z.number().int().min(0),
  edits: z.record(z.string(), z.unknown()).optional(),
  method_id: MethodId.optional(),
  reviewer_evidence: z.record(z.string(), z.string()).optional(),
  internal_addresses: z.array(z.string()).optional(),
  change_reason: z.string().max(1000).optional().nullable(),
  change_kind: z.enum(["correction", "supersede"]).optional().nullable(),
});

/** Confirm a policy change as the next version. The old version is frozen, never edited. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireAdmin(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const r = await confirmVersion(id, {
    extractionId: b.extraction_id,
    draftIndex: b.draft_index,
    edits: b.edits,
    methodId: b.method_id,
    reviewerEvidence: b.reviewer_evidence,
    internalAddresses: b.internal_addresses,
    reviewer: reviewerName(req),
    changeReason: b.change_reason,
    changeKind: b.change_kind,
  });
  let check = null;
  try {
    const c = await runCheck(id, { trigger: "version" });
    check = { status: c.decision.status, final: c.decision.final, reason: c.decision.reason, receipt_id: c.receipt.id };
  } catch (e) {
    check = { error: e instanceof Error ? e.message : String(e) };
  }
  return json({ ...r, first_check: check }, { status: 201 });
});
