import { db } from "@/db/client";
import { json, Problem, route } from "@/lib/http";
import { inclusionProof } from "@/services/anchor";
import { getReceipt } from "@/services/receipts";

/** Receipt JSON exactly as hashed and signed, plus its Merkle inclusion proof once anchored. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if ((req.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL(`/receipts/${id}`, req.url), 303);
  const r = await getReceipt(db(), id);
  if (!r) throw new Problem(404, "Not found", "no such receipt");
  return json({ receipt: r.body, sha256: r.sha256, signature: r.signature, anchor: await inclusionProof(id) }, { cache: "public, max-age=60" });
});
