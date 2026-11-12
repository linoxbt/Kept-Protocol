import { isAdminRequest } from "@/lib/auth";
import { json, Problem, route } from "@/lib/http";
import { getExtraction } from "@/services/extractions";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const ex = await getExtraction(id);
  if (!ex || (!ex.preview && !isAdminRequest(req))) throw new Problem(404, "Not found", "no such extraction");
  const { preview_text, ...rest } = ex;
  return json({ ...rest, label: ex.preview ? "Unconfirmed preview" : undefined, source_chars: preview_text?.length });
});
