import { z } from "zod";
import { requireAdmin, reviewerName } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { decideDeclaration } from "@/services/declarations";

const Body = z.object({ action: z.enum(["accept", "reject"]), note: z.string().min(3).max(2000) });

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  return json(await decideDeclaration(id, b.action, b.note, reviewerName(req)));
});
