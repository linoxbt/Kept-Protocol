import { z } from "zod";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";

const Body = z.object({ title: z.string().min(2).max(200), body: z.string().min(20).max(50_000) });

/** Demo promise pages stand in for a project's own docs. Editing one is how the Precedent demo changes a promise. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  requireAdmin(req);
  const { slug } = await ctx.params;
  const b = await parseBody(req, Body);
  await db()`insert into demo_pages (slug, title, body) values (${slug}, ${b.title}, ${b.body})
             on conflict (slug) do update set title = excluded.title, body = excluded.body, updated_at = now()`;
  await db()`insert into admin_log (action, target) values ('edit_demo_page', ${slug})`;
  return json({ slug, updated: true });
});
