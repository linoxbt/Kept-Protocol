/**
 * From preview to monitored commitment. A visitor requests monitoring for a preview of a public
 * URL; the reviewer promotes it (creates or reuses the project, adds the URL as a source, captures
 * an immutable snapshot and runs the normal extraction, which then goes through normal review) or
 * declines it with a reason. Nothing is published or monitored without that review.
 */
import { db, type Sql } from "@/db/client";
import { newId } from "@/lib/ids";
import { getExtraction, runAndStoreExtraction } from "./extractions";
import { RateLimited } from "./preview";
import { hit } from "./ratelimit";
import { addSource, captureForSource, createProject, getProjectBySlugOrId, Invalid, NotFound, storeSnapshot, type SourceRow } from "./sources";

export interface MonitoringRequest {
  id: string;
  extraction_id: string;
  url: string;
  draft_index: number | null;
  note: string | null;
  contact: string | null;
  status: "open" | "promoted" | "declined";
  resolution: string | null;
  project_id: string | null;
  promoted_extraction_id: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export async function requestMonitoring(
  input: { extractionId: string; draftIndex?: number | null; note?: string | null; contact?: string | null; requester: string },
  sql: Sql = db(),
): Promise<{ request: MonitoringRequest; existing: boolean }> {
  const ex = await getExtraction(input.extractionId, sql);
  if (!ex?.preview || (ex.expires_at && ex.expires_at.getTime() < Date.now())) throw new NotFound("preview not found");
  if (!ex.preview_url) throw new Invalid("only previews of a public URL can be monitored; Kept needs the project's own page as the source");
  if (ex.status !== "done") throw new Invalid("the preview has not finished yet");
  const drafts = ex.result?.drafts.length ?? 0;
  if (input.draftIndex !== null && input.draftIndex !== undefined && (input.draftIndex < 0 || input.draftIndex >= drafts)) throw new Invalid("no such commitment in this preview");
  const [open] = await sql<MonitoringRequest[]>`select * from monitoring_requests where extraction_id = ${ex.id} and status = 'open'`;
  if (open) return { request: open, existing: true };
  const limit = await hit(`monitor-request:${input.requester}`, 5, 86_400, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const [row] = await sql<MonitoringRequest[]>`
    insert into monitoring_requests (id, extraction_id, url, draft_index, note, contact, requester_hash)
    values (${newId("kmr")}, ${ex.id}, ${ex.preview_url}, ${input.draftIndex ?? null}, ${input.note ?? null}, ${input.contact ?? null}, ${input.requester})
    on conflict (extraction_id) where status = 'open' do update set note = coalesce(monitoring_requests.note, excluded.note)
    returning *`;
  return { request: row, existing: false };
}

export async function openRequests(sql: Sql = db()) {
  return sql<(MonitoringRequest & { drafts: number; checkable: number })[]>`
    select r.*, coalesce(jsonb_array_length(e.result->'drafts'), 0)::int as drafts,
      coalesce((select count(*) from jsonb_array_elements(e.result->'drafts') d where d->'classification'->>'method_id' <> 'none'), 0)::int as checkable
    from monitoring_requests r left join extractions e on e.id = r.extraction_id
    where r.status = 'open' order by r.created_at`;
}

export async function getRequest(id: string, sql: Sql = db()): Promise<MonitoringRequest | null> {
  const [r] = await sql<MonitoringRequest[]>`select * from monitoring_requests where id = ${id}`;
  return r ?? null;
}

export async function declineRequest(id: string, reason: string, reviewer: string, sql: Sql = db()): Promise<MonitoringRequest> {
  const [r] = await sql<MonitoringRequest[]>`
    update monitoring_requests set status = 'declined', resolution = ${reason}, decided_at = now() where id = ${id} and status = 'open' returning *`;
  if (!r) throw new NotFound("no open request with that id");
  await sql`insert into admin_log (action, target, detail) values ('decline_monitoring_request', ${id}, ${sql.json({ reason, reviewer })})`;
  return r;
}

/**
 * Promote: reuse a project (by slug) or create one, add the preview's URL as a source (reusing an
 * existing source with the same URL), capture an immutable snapshot and start the normal
 * extraction. The reviewer then confirms drafts on the usual review page.
 */
export async function promoteRequest(
  id: string,
  input: { projectSlug?: string | null; name?: string | null; tokenAddress?: string | null; chainId?: number },
  reviewer: string,
  defer: (work: () => Promise<void>) => void,
  sql: Sql = db(),
): Promise<{ request: MonitoringRequest; extractionId: string; projectSlug: string }> {
  const req = await getRequest(id, sql);
  if (!req || req.status !== "open") throw new NotFound("no open request with that id");
  let project = input.projectSlug ? await getProjectBySlugOrId(input.projectSlug, sql) : null;
  if (input.projectSlug && !project) throw new NotFound("no project with that slug");
  if (!project) {
    if (!input.name?.trim()) throw new Invalid("give an existing project slug or a name for a new project");
    project = await createProject({ name: input.name.trim(), chainId: input.chainId ?? 8453, tokenAddress: input.tokenAddress || null, registrationLevel: "unregistered" }, sql);
  }
  const [existing] = await sql<SourceRow[]>`select * from sources where project_id = ${project.id} and url = ${req.url} limit 1`;
  const source = existing ?? (await addSource({ projectId: project.id, url: req.url, kind: "docs" }, sql));
  const { snapshot } = await storeSnapshot(source.id, await captureForSource(source, sql), sql);
  const ex = await runAndStoreExtraction({ project, sourceId: source.id, snapshot }, sql, { defer });
  const [r] = await sql<MonitoringRequest[]>`
    update monitoring_requests set status = 'promoted', resolution = ${`added to ${project.name} for review`}, project_id = ${project.id}, source_id = ${source.id},
      promoted_extraction_id = ${ex.id}, decided_at = now()
    where id = ${id} returning *`;
  await sql`insert into admin_log (action, target, detail) values ('promote_monitoring_request', ${id}, ${sql.json({ project: project.slug, extraction: ex.id, reviewer })})`;
  return { request: r, extractionId: ex.id, projectSlug: project.slug };
}

export async function rejectDraft(extractionId: string, draftIndex: number, reason: string, reviewer: string, sql: Sql = db()): Promise<void> {
  const ex = await getExtraction(extractionId, sql);
  if (!ex?.result || ex.preview) throw new NotFound("extraction not found");
  if (draftIndex < 0 || draftIndex >= ex.result.drafts.length) throw new Invalid("no such draft");
  const [done] = await sql`select 1 from commitment_versions where extraction_id = ${extractionId} and draft_index = ${draftIndex} limit 1`;
  if (done) throw new Invalid("this draft is already confirmed");
  await sql`insert into draft_rejections (extraction_id, draft_index, reason, rejected_by) values (${extractionId}, ${draftIndex}, ${reason}, ${reviewer})
            on conflict (extraction_id, draft_index) do update set reason = excluded.reason, rejected_by = excluded.rejected_by, rejected_at = now()`;
  await sql`insert into admin_log (action, target, detail) values ('reject_draft', ${extractionId}, ${sql.json({ draft: draftIndex, reason, reviewer })})`;
}

export async function draftDecisions(extractionId: string, sql: Sql = db()) {
  const [rejected, confirmed] = await Promise.all([
    sql<{ draft_index: number; reason: string; rejected_at: Date }[]>`select draft_index, reason, rejected_at from draft_rejections where extraction_id = ${extractionId}`,
    sql<{ draft_index: number; commitment_id: string }[]>`select draft_index, commitment_id from commitment_versions where extraction_id = ${extractionId} and draft_index is not null`,
  ]);
  return { rejected: new Map(rejected.map((r) => [r.draft_index, r])), confirmed: new Map(confirmed.map((c) => [c.draft_index, c.commitment_id])) };
}
