import { env } from "@/lib/env";
import { json, problem, route } from "@/lib/http";
import { tick } from "@/services/monitor";

export const maxDuration = 300;

/** Scheduler entry point (Vercel Cron, GitHub Actions or any HTTP cron). Bearer CRON_SECRET. */
export const GET = route(async (req: Request) => {
  const secret = env().CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return problem(401, "Unauthorized", "cron secret required");
  return json(await tick({ maxChecks: 20, deadlineMs: 240_000 }));
});
