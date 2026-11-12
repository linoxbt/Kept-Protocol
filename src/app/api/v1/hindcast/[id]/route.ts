import { json, Problem, route } from "@/lib/http";
import { getHindcast } from "@/services/hindcast";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const h = await getHindcast(id);
  if (!h) throw new Problem(404, "Not found", "no such hindcast run");
  return json(h, { sign: true });
});
