import { json, Problem, route } from "@/lib/http";
import { getJob } from "@/services/jobs";

/** Poll a background job (202 responses point here). Results are public evidence data only. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) throw new Problem(404, "Not found", "no such job");
  return json(job);
});
