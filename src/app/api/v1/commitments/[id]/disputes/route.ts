import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { listDisputes, openDispute } from "@/services/disputes";
import { requesterHash } from "@/services/ratelimit";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  // Unreviewed and rejected disputes are public as a fact (id, status, date), not as text: a reason
  // and link are published only once a reviewer accepts them, so the record cannot carry spam.
  const rows = await listDisputes(id);
  return json({ data: rows.map((d) => (d.status === "open" || d.status === "rejected" ? { ...d, reason: null, evidence_url: null } : d)) });
});

const Body = z.object({
  reason: z.string().min(20).max(4000),
  // http(s) only: z.url() also accepts javascript: and data: URLs.
  evidence_url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "evidence must be an http(s) link").optional().nullable(),
  contact: z.string().max(200).optional().nullable(),
});

/** Anyone may dispute a record (3 per requester per day). The admin reviews every dispute. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  const d = await openDispute({ commitmentId: id, reason: b.reason, evidenceUrl: b.evidence_url, contact: b.contact, requester: requesterHash(clientIp(req)) });
  return json(d, { status: 201 });
});
