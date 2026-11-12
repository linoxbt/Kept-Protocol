import { after } from "next/server";
import { z } from "zod";
import { MethodId } from "@/core/types";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { confirmDraft } from "@/services/extractions";
import { startCheckJob } from "@/services/verify";

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
  // The first check can backfill millions of blocks, so it runs in the background (poll the job);
  // without verify_now the worker picks the commitment up on its next tick.
  const job = b.verify_now ? await startCheckJob(commitmentId, "confirm", (w) => after(w)) : null;
  return json({ commitment_id: commitmentId, first_check: job ? { job_id: job.id, poll: job.poll, status: "running" } : null }, { status: 201 });
});
