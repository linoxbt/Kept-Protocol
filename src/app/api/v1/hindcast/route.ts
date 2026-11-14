import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { runHindcastFor } from "@/services/hindcast";
import { startJob } from "@/services/jobs";
import { NotFound } from "@/services/sources";
import { db } from "@/db/client";

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
  const [c] = await db()<{ id: string }[]>`select id from commitments where id = ${b.commitment_id}`;
  if (!c) throw new NotFound("commitment not found");
  // Replays can scan long histories: run in the background and poll the job.
  const job = await startJob("hindcast", b.commitment_id, async () => {
    const run = await runHindcastFor(b.commitment_id, { versions: b.versions, from: b.from, to: b.to });
    return { id: run.id, receipt_id: run.receiptId, versions: run.versions, lanes: run.result.lanes.map((l) => ({ version: l.version, changes: l.changes, first_breached_at: l.firstBreachedAt, first_verified_final_at: l.firstVerifiedFinalAt })), divergences: run.result.divergences.length };
  }, (w) => after(w));
  return json({ job_id: job.id, poll: job.poll, status: "running" }, { status: 202 });
});
