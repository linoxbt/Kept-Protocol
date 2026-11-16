import { z } from "zod";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { rejectDraft } from "@/services/monitoring";

const Body = z.object({ reason: z.string().min(5).max(2000) });

/** Admin: record that a draft will not be confirmed, with the reason. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string; index: string }> }) => {
  await requireAdmin(req);
  const { id, index } = await ctx.params;
  const b = await parseBody(req, Body);
  await rejectDraft(id, Number(index), b.reason, reviewerName(req));
  return json({ extraction_id: id, draft_index: Number(index), rejected: true });
});
