import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, parseBody, Problem, route } from "@/lib/http";
import { captureText } from "@/extraction/capture";
import { runAndStoreExtraction } from "@/services/extractions";
import { servAvailable } from "@/services/serv";
import { addSource, captureForSource, getProjectBySlugOrId, storeSnapshot } from "@/services/sources";

export const maxDuration = 300;

const Body = z
  .object({
    project_id: z.string(),
    url: z.string().url().optional(),
    text: z.string().min(20).max(200_000).optional(),
    kind: z.enum(["docs", "blog", "governance", "social", "manual", "demo"]).default("docs"),
    extract: z.boolean().default(true),
  })
  .refine((b) => b.url || b.text, "send a url or a text");

export const POST = route(async (req: Request) => {
  await requireAdmin(req);
  const b = await parseBody(req, Body);
  const project = await getProjectBySlugOrId(b.project_id);
  if (!project) throw new Problem(404, "Not found", "no such project");
  const source = await addSource({ projectId: project.id, url: b.url ?? null, kind: b.text && !b.url ? "manual" : b.kind });
  const cap = b.text && !b.url ? captureText(b.text) : await captureForSource(source);
  const { snapshot } = await storeSnapshot(source.id, cap);
  let extraction = null;
  let extraction_error: string | null = null;
  if (b.extract) {
    if (!servAvailable()) extraction_error = "SERV is not configured; write a manual draft for this snapshot instead";
    else {
      try {
        extraction = await runAndStoreExtraction({ project, sourceId: source.id, snapshot }, undefined, { defer: (work) => after(work) });
      } catch (e) {
        extraction_error = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return json({ source, snapshot: { id: snapshot.id, content_sha256: snapshot.content_sha256, captured_at: snapshot.captured_at, chars: snapshot.text.length }, extraction, extraction_error }, { status: 201 });
});
