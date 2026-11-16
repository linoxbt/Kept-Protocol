import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { startFollow } from "@/services/follow";
import { requesterHash } from "@/services/ratelimit";

const Body = z.object({ url: z.string().url().max(2000) });

/**
 * Follow one commitment with a signed webhook (5 per requester per day). Returns the signing secret
 * and a manage token once; a one-time code is POSTed to the endpoint and must be submitted back to
 * POST /api/v1/follows/{id} to activate.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const r = await startFollow({ commitmentId: id, url: b.url, requester: requesterHash(clientIp(req)) });
  return json({ ...r, next: "submit the code your endpoint received to POST /api/v1/follows/{id} with {action: 'verify', token, code}" }, { status: 201 });
});
