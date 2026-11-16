import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { requestMonitoring } from "@/services/monitoring";
import { requesterHash } from "@/services/ratelimit";

const Body = z.object({
  draft_index: z.number().int().min(0).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  contact: z.string().max(200).nullable().optional(),
});

/** Anyone may ask Kept to monitor a preview of a public URL (5 per requester per day). A reviewer decides. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const r = await requestMonitoring({ extractionId: id, draftIndex: b.draft_index ?? null, note: b.note?.trim() || null, contact: b.contact?.trim() || null, requester: requesterHash(clientIp(req)) });
  // The contact is for the reviewer only; it is never returned.
  const { id: requestId, status, created_at } = r.request;
  return json({ id: requestId, status, created_at, existing: r.existing }, { status: r.existing ? 200 : 201 });
});
