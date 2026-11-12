import { z } from "zod";
import { MethodId } from "@/core/types";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { confirmDraft } from "@/services/extractions";
import { runCheck } from "@/services/verify";

export const maxDuration = 300;

export const ConfirmBody = z.object({
  extraction_id: z.string(),
  draft_index: z.number().int().min(0),
  edits: z.record(z.string(), z.unknown()).optional(),
  method_id: MethodId.optional(),
  token_address: z.string().optional().nullable(),
  reviewer_evidence: z.record(z.string(), z.string().max(2000)).optional(),
  internal_addresses: z.array(z.string()).max(50).optional(),
  verify_now: z.boolean().default(true),
});

/** Confirm a draft: it becomes version 1 of a commitment and enters monitoring. */
export const POST = route(async (req: Request) => {
  await requireAdmin(req);
  const b = await parseBody(req, ConfirmBody);
  const { commitmentId } = await confirmDraft({
    extractionId: b.extraction_id,
    draftIndex: b.draft_index,
    edits: b.edits,
    methodId: b.method_id,
    tokenAddress: b.token_address,
    reviewerEvidence: b.reviewer_evidence,
    internalAddresses: b.internal_addresses,
    reviewer: reviewerName(req),
  });
  let first = null;
  let first_check_error: string | null = null;
  if (b.verify_now) {
    try {
      const r = await runCheck(commitmentId, { trigger: "confirm" });
      first = { status: r.decision.status, final: r.decision.final, reason: r.decision.reason, receipt_id: r.receipt.id };
    } catch (e) {
      first_check_error = e instanceof Error ? e.message : String(e);
    }
  }
  return json({ commitment_id: commitmentId, first_check: first, first_check_error }, { status: 201 });
});
