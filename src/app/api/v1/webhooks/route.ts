import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, Problem, route } from "@/lib/http";
import { EVENT_TYPES, registerWebhook } from "@/services/webhooks";

const Body = z.object({ url: z.string().url(), events: z.array(z.enum(EVENT_TYPES)).min(1), project_id: z.string().optional().nullable() });

/** Registers an endpoint. The signing secret is returned once, here, and never again. */
export const POST = route(async (req: Request) => {
  await requireAdmin(req);
  const b = await parseBody(req, Body);
  try {
    return json(await registerWebhook({ url: b.url, events: b.events, projectId: b.project_id }), { status: 201 });
  } catch (e) {
    throw new Problem(422, "Invalid webhook", e instanceof Error ? e.message : String(e));
  }
});
