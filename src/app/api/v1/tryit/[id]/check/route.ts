import { after } from "next/server";
import { z } from "zod";
import { MethodId } from "@/core/types";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { preparePreviewCheck } from "@/services/preview";
import { startJob } from "@/services/jobs";
import { requesterHash } from "@/services/ratelimit";

export const maxDuration = 300;

const Body = z.object({ draft_index: z.number().int().min(0), token_address: z.string().optional().nullable(), method_id: MethodId.optional() });

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const requester = requesterHash(clientIp(req));
  // Validate and rate-limit now, so errors come back immediately; scan in the background.
  const run = await preparePreviewCheck({ extractionId: id, draftIndex: b.draft_index, tokenAddress: b.token_address, methodId: b.method_id, requester });
  const job = await startJob("preview_check", id, () => run(), (w) => after(w));
  return json({ job_id: job.id, poll: job.poll, status: "running", label: "Unconfirmed preview" }, { status: 202 });
});
