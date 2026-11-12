import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { createManualDraft } from "@/services/extractions";

const Body = z.object({
  snapshot_id: z.string(),
  project_id: z.string(),
  quote: z.string().min(10).max(4000),
  fields: z.record(z.string(), z.unknown()),
  target_commitment_id: z.string().optional().nullable(),
});

export const POST = route(async (req: Request) => {
  requireAdmin(req);
  const b = await parseBody(req, Body);
  return json(await createManualDraft({ snapshotId: b.snapshot_id, projectId: b.project_id, quote: b.quote, fields: b.fields, targetCommitmentId: b.target_commitment_id }), { status: 201 });
});
