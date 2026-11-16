import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { markContactHandled } from "@/services/declarations";

/** Admin: mark a contact or pilot request as handled. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  await markContactHandled(id);
  return json({ id, handled: true });
});
