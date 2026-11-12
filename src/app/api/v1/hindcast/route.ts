import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { runHindcastFor } from "@/services/hindcast";

export const maxDuration = 300;

const Body = z.object({
  commitment_id: z.string(),
  versions: z.array(z.number().int().positive()).max(5).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const POST = route(async (req: Request) => {
  await requireAdmin(req);
  const b = await parseBody(req, Body);
  const run = await runHindcastFor(b.commitment_id, { versions: b.versions, from: b.from, to: b.to });
  return json({ id: run.id, receipt_id: run.receiptId, versions: run.versions, lanes: run.result.lanes.map((l) => ({ version: l.version, changes: l.changes, first_breached_at: l.firstBreachedAt, first_verified_final_at: l.firstVerifiedFinalAt })), divergences: run.result.divergences.length }, { status: 201 });
});
