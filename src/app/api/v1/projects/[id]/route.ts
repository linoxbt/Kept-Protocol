import { json, route, Problem } from "@/lib/http";
import { projectCommitments, projectSources } from "@/services/queries";
import { getProjectBySlugOrId } from "@/services/sources";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const project = await getProjectBySlugOrId(id);
  if (!project) throw new Problem(404, "Not found", "no such project");
  const [commitments, sources] = await Promise.all([projectCommitments(project.id), projectSources(project.id)]);
  return json({ project, commitments: commitments.map((c) => ({ id: c.id, status: c.status, final: c.final, version: c.version, condition: c.spec.condition_summary, method: c.spec.method_id })), sources }, { sign: true });
});
