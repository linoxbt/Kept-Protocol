import { requireAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { runCheck } from "@/services/verify";

export const maxDuration = 300;

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireAdmin(req);
  const { id } = await ctx.params;
  const r = await runCheck(id, { trigger: "manual" });
  return json({ check_id: r.checkId, status: r.decision.status, final: r.decision.final, reason: r.decision.reason, changed: r.changed, receipt_id: r.receipt.id, receipt_sha256: r.receipt.sha256 });
});
