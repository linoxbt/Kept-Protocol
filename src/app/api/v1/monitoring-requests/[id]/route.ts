import { after } from "next/server";
import { z } from "zod";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { declineRequest, promoteRequest } from "@/services/monitoring";

export const maxDuration = 300;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("decline"), reason: z.string().min(5).max(2000) }),
  z.object({
    action: z.literal("promote"),
    project_slug: z.string().max(100).nullable().optional(),
    name: z.string().max(100).nullable().optional(),
    token_address: z.string().max(42).nullable().optional(),
    chain_id: z.number().int().optional(),
  }),
]);

/** Admin: promote a monitoring request into a project source (extraction then goes to review), or decline it. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b.action === "decline") return json(await declineRequest(id, b.reason, reviewerName(req)));
  const r = await promoteRequest(id, { projectSlug: b.project_slug || null, name: b.name || null, tokenAddress: b.token_address || null, chainId: b.chain_id }, reviewerName(req), (work) => after(work));
  return json({ ...r, review: `/admin/extractions/${r.extractionId}` });
});
