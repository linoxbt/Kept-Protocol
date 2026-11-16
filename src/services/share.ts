/** Small, public facts used for page titles and share cards. */
import { db, type Sql } from "@/db/client";
import { STATUS_LABEL } from "@/core/status";
import type { Status } from "@/core/types";

export function statusLabel(status: Status, final: boolean): string {
  return status === "verified" ? (final ? "Verified, final" : "Verified to date") : `${STATUS_LABEL[status]}${final ? ", final" : ""}`;
}

export async function commitmentShare(id: string, sql: Sql = db()) {
  const [r] = await sql<{ id: string; status: Status; final: boolean; project: string; is_demo: boolean; summary: string | null; reason: string | null }[]>`
    select c.id, c.status, c.final, p.name as project, p.is_demo, v.spec->>'condition_summary' as summary, c.status_reason as reason
    from commitments c join projects p on p.id = c.project_id join commitment_versions v on v.id = c.current_version_id where c.id = ${id}`;
  return r ?? null;
}

export async function receiptShare(id: string, sql: Sql = db()) {
  const [r] = await sql<{ id: string; kind: string; status: Status | null; final: boolean | null; project: string | null; summary: string | null; anchored: boolean }[]>`
    select r.id, r.kind, (r.body->'result'->>'status') as status, (r.body->'result'->>'final')::boolean as final, p.name as project,
      r.body->'spec'->>'condition_summary' as summary, r.anchor_id is not null as anchored
    from receipts r left join commitments c on c.id = r.commitment_id left join projects p on p.id = c.project_id where r.id = ${id}`;
  return r ?? null;
}

export async function previewShare(id: string, sql: Sql = db()) {
  const [r] = await sql<{ id: string; url: string | null; status: string; drafts: number }[]>`
    select id, preview_url as url, status, coalesce(jsonb_array_length(result->'drafts'), 0)::int as drafts
    from extractions where id = ${id} and preview and (expires_at is null or expires_at > now())`;
  return r ?? null;
}

export function hostOf(url: string | null): string {
  if (!url) return "Pasted text";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
