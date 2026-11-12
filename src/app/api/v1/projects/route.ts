import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, route } from "@/lib/http";
import { listProjects } from "@/services/queries";
import { createProject } from "@/services/sources";

export const GET = route(async () => json({ data: await listProjects() }, { sign: true }));

const Body = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().max(60).optional(),
  chain_id: z.union([z.literal(8453), z.literal(84532)]).default(8453),
  token_address: z.string().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  registration_level: z.enum(["unregistered", "self", "launchpad"]).optional(),
  is_demo: z.boolean().optional(),
});

export const POST = route(async (req: Request) => {
  requireAdmin(req);
  const b = await parseBody(req, Body);
  const p = await createProject({ name: b.name, slug: b.slug, chainId: b.chain_id, tokenAddress: b.token_address, description: b.description, registrationLevel: b.registration_level, isDemo: b.is_demo });
  return json(p, { status: 201 });
});
