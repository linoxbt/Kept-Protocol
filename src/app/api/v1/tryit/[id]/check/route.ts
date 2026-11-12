import { z } from "zod";
import { MethodId } from "@/core/types";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { previewCheck } from "@/services/preview";
import { requesterHash } from "@/services/ratelimit";

export const maxDuration = 300;

const Body = z.object({ draft_index: z.number().int().min(0), token_address: z.string().optional().nullable(), method_id: MethodId.optional() });

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  return json(await previewCheck({ extractionId: id, draftIndex: b.draft_index, tokenAddress: b.token_address, methodId: b.method_id, requester: requesterHash(clientIp(req)) }));
});
