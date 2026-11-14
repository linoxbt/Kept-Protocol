import { json, Problem, route } from "@/lib/http";
import { diffVersions } from "@/services/precedent";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const u = new URL(req.url);
  const from = Number(u.searchParams.get("from") ?? 1);
  const to = Number(u.searchParams.get("to") ?? 2);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) throw new Problem(400, "Bad request", "from and to must be two different version numbers");
  const d = await diffVersions(id, from, to);
  return json({ from: d.from.version, to: d.to.version, change_kind: d.changeKind, changes: d.changes, text_diff: d.textDiff, retroactive_revision: d.retroactive, evidence_available: d.evidenceAvailable }, { sign: true });
});
