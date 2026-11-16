import { z } from "zod";
import { json, parseBody, route } from "@/lib/http";
import { followStatus, stopFollow, verifyFollow } from "@/services/follow";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), token: z.string().min(10).max(100), code: z.string().min(4).max(12) }),
  z.object({ action: z.literal("stop"), token: z.string().min(10).max(100) }),
  z.object({ action: z.literal("status"), token: z.string().min(10).max(100) }),
]);

/** Manage a follow with its token (kept in the body, never in a URL): verify, stop or read status. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b.action === "verify") return json(await verifyFollow({ id, token: b.token, code: b.code }));
  if (b.action === "stop") return json(await stopFollow({ id, token: b.token }));
  return json(await followStatus({ id, token: b.token }));
});
