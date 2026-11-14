import { after } from "next/server";
import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/http";
import { startPreview } from "@/services/preview";
import { requesterHash } from "@/services/ratelimit";

export const maxDuration = 300;

const Body = z.object({ url: z.string().url().optional(), text: z.string().min(20).max(50_000).optional() }).refine((b) => b.url || b.text, "send a url or a text");

/** Try-it mode: public, rate-limited, results labelled "Unconfirmed preview" and never published. */
export const POST = route(async (req: Request) => {
  const b = await parseBody(req, Body);
  const ex = await startPreview({ url: b.url, text: b.text, requester: requesterHash(clientIp(req)) }, undefined, (work) => after(work));
  // 202: the extraction runs in the background; poll GET /api/v1/extractions/{id}.
  return json({ id: ex.id, label: "Unconfirmed preview", status: ex.status, result: ex.result, expires_at: ex.expires_at, poll: `/api/v1/extractions/${ex.id}` }, { status: ex.status === "running" ? 202 : 201 });
});
