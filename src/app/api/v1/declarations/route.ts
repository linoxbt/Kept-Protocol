import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { DECLARATION_ROLES, submitDeclaration } from "@/services/declarations";
import { requesterHash } from "@/services/ratelimit";

const Body = z.object({
  project: z.string().min(2).max(100),
  address: z.string().max(42),
  role: z.enum(DECLARATION_ROLES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signature: z.string().min(10).max(20_000),
  contact: z.string().max(200).nullable().optional(),
  evidence_url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "use an http(s) link").nullable().optional(),
});

/** A project declares an address by signing Kept's message with it. Verified, then reviewed by a person. */
export const POST = route(async (req: Request) => {
  const b = await parseBody(req, Body);
  const r = await submitDeclaration({ ...b, evidenceUrl: b.evidence_url ?? null, contact: b.contact ?? null, requester: requesterHash(clientIp(req)) });
  return json(r, { status: 201 });
});
