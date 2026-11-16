import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { submitContact } from "@/services/declarations";
import { requesterHash } from "@/services/ratelimit";

const Body = z.object({
  kind: z.enum(["pilot", "contact"]),
  name: z.string().min(2).max(100),
  organisation: z.string().max(150).nullable().optional(),
  contact: z.string().min(3).max(200),
  message: z.string().min(10).max(4000),
});

/** Pilot and contact requests (3 per requester per day), read by the Kept team. */
export const POST = route(async (req: Request) => {
  const b = await parseBody(req, Body);
  return json(await submitContact({ ...b, organisation: b.organisation ?? null, requester: requesterHash(clientIp(req)) }), { status: 201 });
});
