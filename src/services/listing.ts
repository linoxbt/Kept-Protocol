/** Public, filterable lists: every monitored commitment, and the full activity feed. */
import { db, type Sql } from "@/db/client";
import type { Status } from "@/core/types";

export const PAGE_SIZE = 25;
const KINDS = ["token_lock", "vesting", "burn"] as const;
const STATUSES: Status[] = ["pending", "awaiting_evidence", "verified", "at_risk", "breached", "unverifiable", "disputed"];

export interface CommitmentFilters {
  status?: string | null;
  kind?: string | null;
  project?: string | null;
  page?: number;
}

export interface CommitmentRow {
  id: string;
  project_slug: string;
  project_name: string;
  is_demo: boolean;
  status: Status;
  final: boolean;
  category: string;
  method_id: string;
  summary: string;
  window_start: string;
  window_end: string;
  version: number;
  last_checked_at: Date | null;
  last_change_at: Date | null;
}

export function cleanFilters(f: CommitmentFilters): Required<CommitmentFilters> {
  return {
    status: f.status && (STATUSES as string[]).includes(f.status) ? f.status : null,
    kind: f.kind && (KINDS as readonly string[]).includes(f.kind) ? f.kind : null,
    project: f.project && /^[a-z0-9-]{1,80}$/.test(f.project) ? f.project : null,
    page: Number.isInteger(f.page) && f.page! > 0 ? Math.min(f.page!, 1000) : 1,
  };
}

export async function listCommitments(raw: CommitmentFilters, sql: Sql = db()): Promise<{ rows: CommitmentRow[]; total: number; page: number; pages: number }> {
  const f = cleanFilters(raw);
  const where = sql`
    where (${f.status}::text is null or c.status = ${f.status})
      and (${f.kind}::text is null or v.spec->>'category' = ${f.kind})
      and (${f.project}::text is null or p.slug = ${f.project})`;
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from commitments c join projects p on p.id = c.project_id join commitment_versions v on v.id = c.current_version_id ${where}`;
  const rows = await sql<CommitmentRow[]>`
    select c.id, p.slug as project_slug, p.name as project_name, p.is_demo, c.status, c.final,
      v.spec->>'category' as category, v.spec->>'method_id' as method_id, v.spec->>'condition_summary' as summary,
      v.spec->'window'->>'start' as window_start, v.spec->'window'->>'end' as window_end, v.version, c.last_checked_at,
      (select max(sc.at) from status_changes sc where sc.commitment_id = c.id) as last_change_at
    from commitments c join projects p on p.id = c.project_id join commitment_versions v on v.id = c.current_version_id
    ${where}
    order by p.is_demo, last_change_at desc nulls last, c.created_at desc
    limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`;
  return { rows, total: n, page: f.page, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
}

export interface ActivityFilters {
  kind?: string | null;
  page?: number;
}

/** Activity kinds map onto the status a change moved to. */
export const ACTIVITY_KINDS: Record<string, { label: string; statuses: Status[] }> = {
  breach: { label: "Breaches", statuses: ["breached"] },
  at_risk: { label: "At risk", statuses: ["at_risk"] },
  verified: { label: "Verified", statuses: ["verified"] },
  disputed: { label: "Disputes", statuses: ["disputed"] },
  other: { label: "Other", statuses: ["pending", "awaiting_evidence", "unverifiable"] },
};

export interface ActivityRow {
  commitment_id: string;
  project_slug: string;
  project_name: string;
  is_demo: boolean;
  from_status: Status | null;
  to_status: Status;
  final: boolean;
  reason: string;
  receipt_id: string | null;
  at: Date;
  version: number | null;
}

export async function listActivity(raw: ActivityFilters, sql: Sql = db()): Promise<{ rows: ActivityRow[]; total: number; page: number; pages: number; kind: string | null }> {
  const kind = raw.kind && raw.kind in ACTIVITY_KINDS ? raw.kind : null;
  const statuses = kind ? ACTIVITY_KINDS[kind].statuses : null;
  const page = Number.isInteger(raw.page) && raw.page! > 0 ? Math.min(raw.page!, 1000) : 1;
  const where = sql`where (${statuses}::text[] is null or sc.to_status = any(${statuses}::text[]))`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from status_changes sc ${where}`;
  const rows = await sql<ActivityRow[]>`
    select sc.commitment_id, p.slug as project_slug, p.name as project_name, p.is_demo, sc.from_status, sc.to_status, sc.final, sc.reason, sc.receipt_id, sc.at,
      (r.body->>'commitment_version')::int as version
    from status_changes sc join commitments c on c.id = sc.commitment_id join projects p on p.id = c.project_id left join receipts r on r.id = sc.receipt_id
    ${where}
    order by sc.at desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  return { rows, total: n, page, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)), kind };
}
