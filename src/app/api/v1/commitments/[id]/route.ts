import { baseUrl, json, Problem, route } from "@/lib/http";
import { commitmentDetail, publicCommitment } from "@/services/queries";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const d = await commitmentDetail(id);
  if (!d) throw new Problem(404, "Not found", "no such commitment");
  return json(publicCommitment(d, baseUrl(req)), { sign: true });
});
