import { db } from "@/db/client";
import { json, Problem, route } from "@/lib/http";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const [a] = await db()`select * from anchors where id = ${id}`;
  if (!a) throw new Problem(404, "Not found", "no such anchor");
  return json(a, { sign: true });
});
