import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { setWebhookActive, testWebhook } from "@/services/webhooks";

const Body = z.object({ action: z.enum(["test", "deactivate", "activate"]) });

/** Admin: send a signed test event, or switch a webhook off and on. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b.action === "test") return json(await testWebhook(id));
  await setWebhookActive(id, b.action === "activate");
  return json({ id, active: b.action === "activate" });
});
