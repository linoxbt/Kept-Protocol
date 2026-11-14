import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { json, Problem, route } from "@/lib/http";
import { startCheckJob } from "@/services/verify";

export const maxDuration = 300;

/** Runs a check now, in the background. 202 + job to poll; 409 if a check is already running. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const job = await startCheckJob(id, "manual", (w) => after(w));
  if (!job) throw new Problem(409, "Check in progress", "a check for this commitment is already running; it will finish shortly");
  return json({ job_id: job.id, poll: job.poll, status: "running" }, { status: 202 });
});
