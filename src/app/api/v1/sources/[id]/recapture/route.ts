import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { recaptureSource } from "@/services/precedent";

export const maxDuration = 300;

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  return json(await recaptureSource(id));
});
