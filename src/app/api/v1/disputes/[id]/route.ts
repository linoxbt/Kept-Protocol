import { z } from "zod";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { decideDispute } from "@/services/disputes";

const Body = z.object({ action: z.enum(["accept", "reject", "resolve"]), note: z.string().min(5).max(4000) });

/** Admin decision on a dispute: accept (status shows Disputed), reject, or resolve (overlay lifted). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  return json(await decideDispute({ id, action: b.action, note: b.note, reviewer: reviewerName(req) }));
});
