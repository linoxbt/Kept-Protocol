/** Read models shared by the public API and the UI. */
import type { CommitmentSpec, Status } from "@/core/types";
import { db, type Sql } from "@/db/client";
import { listVersions, loadCommitment, type ProjectRow } from "./commitments";

export interface ProjectSummary extends ProjectRow {
  commitments: number;
  counts: Partial<Record<Status, number>>;
  last_checked_at: Date | null;
}

export async function listProjects(sql: Sql = db()): Promise<ProjectSummary[]> {
  const projects = await sql<ProjectRow[]>`select * from projects order by is_demo asc, created_at desc`;
  const counts = await sql<{ project_id: string; status: Status; n: number; last: Date | null }[]>`
    select project_id, status, count(*)::int as n, max(last_checked_at) as last from commitments group by project_id, status`;
  return projects.map((p) => {
    const rows = counts.filter((c) => c.project_id === p.id);
    return {
      ...p,
      commitments: rows.reduce((a, r) => a + r.n, 0),
      counts: Object.fromEntries(rows.map((r) => [r.status, r.n])),
      last_checked_at: rows.reduce<Date | null>((a, r) => (r.last && (!a || r.last > a) ? r.last : a), null),
    };
  });
}

export interface CommitmentListItem {
  id: string;
  status: Status;
  final: boolean;
  status_reason: string | null;
  last_checked_at: Date | null;
  version: number;
  spec: CommitmentSpec;
}

export async function projectCommitments(projectId: string, sql: Sql = db()): Promise<CommitmentListItem[]> {
  return sql<CommitmentListItem[]>`
    select c.id, c.status, c.final, c.status_reason, c.last_checked_at, v.version, v.spec
    from commitments c join commitment_versions v on v.id = c.current_version_id
    where c.project_id = ${projectId}
    order by case c.status when 'breached' then 0 when 'at_risk' then 1 when 'disputed' then 2 when 'pending' then 3 when 'awaiting_evidence' then 3 else 4 end, c.created_at`;
}

export async function projectSources(projectId: string, sql: Sql = db()) {
  return sql<{ id: string; url: string | null; kind: string; status: string; last_checked_at: Date | null; snapshots: number; latest_sha: string | null; latest_at: Date | null }[]>`
    select s.id, s.url, s.kind, s.status, s.last_checked_at,
      (select count(*)::int from source_snapshots n where n.source_id = s.id) as snapshots,
      (select content_sha256 from source_snapshots n where n.source_id = s.id order by captured_at desc limit 1) as latest_sha,
      (select captured_at from source_snapshots n where n.source_id = s.id order by captured_at desc limit 1) as latest_at
    from sources s where s.project_id = ${projectId} order by s.created_at`;
}

export async function commitmentDetail(id: string, sql: Sql = db()) {
  const bundle = await loadCommitment(id, sql);
  if (!bundle) return null;
  const [versions, changes, checks, receipts, hindcasts, retro] = await Promise.all([
    listVersions(id, sql),
    sql<{ id: string; from_status: string | null; to_status: Status; final: boolean; receipt_id: string | null; reason: string; at: Date }[]>`
      select * from status_changes where commitment_id = ${id} order by at desc limit 50`,
    sql<{ id: string; status: string | null; final: boolean | null; to_block: string | null; receipt_id: string | null; error: string | null; started_at: Date; finished_at: Date | null; computed_value: string | null }[]>`
      select id, status, final, to_block::text, receipt_id, error, started_at, finished_at, computed_value::text from checks where commitment_id = ${id} order by started_at desc limit 20`,
    sql<{ id: string; kind: string; sha256: string; created_at: Date; anchor_id: string | null }[]>`
      select id, kind, sha256, created_at, anchor_id from receipts where commitment_id = ${id} order by created_at desc limit 20`,
    sql<{ id: string; created_at: Date }[]>`select id, created_at from hindcast_runs where commitment_id = ${id} order by created_at desc limit 5`,
    sql<{ tx_hash: string; block_time: Date; amount: string; from_addr: string; to_addr: string; kind: string; block_number: string }[]>`
      select distinct on (e.tx_hash, e.log_index) e.tx_hash, e.block_time, e.amount::text, e.from_addr, e.to_addr, e.kind, e.block_number::text
      from evidence_events e join checks k on k.id = e.check_id
      where k.commitment_id = ${id} and k.commitment_version_id = ${bundle.version.id}
      order by e.tx_hash, e.log_index, e.block_time`,
  ]);
  return { ...bundle, versions, changes, checks, receipts, hindcasts, events: retro };
}

export interface FeedItem {
  commitment_id: string;
  project_slug: string;
  project_name: string;
  is_demo: boolean;
  from_status: string | null;
  to_status: Status;
  final: boolean;
  reason: string;
  receipt_id: string | null;
  at: Date;
  summary: string;
}

export async function feed(limit = 20, sql: Sql = db()): Promise<FeedItem[]> {
  return sql<FeedItem[]>`
    select sc.commitment_id, p.slug as project_slug, p.name as project_name, p.is_demo, sc.from_status, sc.to_status, sc.final, sc.reason, sc.receipt_id, sc.at,
           coalesce(r.body->'spec'->>'condition_summary', v.spec->>'condition_summary') as summary
    from status_changes sc
    join commitments c on c.id = sc.commitment_id
    join projects p on p.id = c.project_id
    join commitment_versions v on v.id = c.current_version_id
    left join receipts r on r.id = sc.receipt_id
    order by sc.at desc limit ${limit}`;
}

export async function globalStats(sql: Sql = db()) {
  const [r] = await sql<{ projects: number; commitments: number; at_risk: number; breached: number; receipts: number; deadlines: number }[]>`
    select (select count(*)::int from projects) as projects,
           (select count(*)::int from commitments) as commitments,
           (select count(*)::int from commitments where status = 'at_risk') as at_risk,
           (select count(*)::int from commitments where status = 'breached') as breached,
           (select count(*)::int from receipts) as receipts,
           (select count(*)::int from commitments c join commitment_versions v on v.id = c.current_version_id
              where c.final = false and (v.spec->'window'->>'end')::timestamptz between now() and now() + interval '7 days') as deadlines`;
  return r;
}

/** Public, machine-readable view of one commitment. */
export function publicCommitment(d: NonNullable<Awaited<ReturnType<typeof commitmentDetail>>>, base: string) {
  const s = d.version.spec;
  return {
    id: d.commitment.id,
    project: { id: d.project.id, slug: d.project.slug, name: d.project.name, is_demo: d.project.is_demo },
    status: d.commitment.status,
    final: d.commitment.final,
    status_reason: d.commitment.status_reason,
    last_checked_at: d.commitment.last_checked_at,
    version: d.version.version,
    versions: d.versions.map((v) => ({ version: v.version, change_kind: v.change_kind, published_at: v.published_at, confirmed_at: v.confirmed_at })),
    category: s.category,
    method: s.method_id,
    condition: s.condition_summary,
    statement: { excerpt: s.excerpt, url: d.source?.url ?? null, captured_at: d.snapshot.captured_at, content_sha256: d.snapshot.content_sha256 },
    chain_id: s.chain_id,
    token: s.token,
    window: s.window,
    comparator: s.comparator,
    threshold: s.threshold,
    subjects: s.subjects.map((x) => ({ address: x.address, role: x.role, label: x.label, attribution: x.attribution.level, attribution_evidence: x.attribution.evidence })),
    latest_receipt: d.receipts[0] ? { id: d.receipts[0].id, sha256: d.receipts[0].sha256, url: `${base}/api/v1/receipts/${d.receipts[0].id}` } : null,
  };
}

export async function agentLookup(chainId: number, token: string, base: string, sql: Sql = db()) {
  const rows = await sql<{ id: string; status: Status; final: boolean; last_checked_at: Date | null; spec: CommitmentSpec; registration_level: string; receipt_id: string | null; sha256: string | null; anchor_id: string | null }[]>`
    select c.id, c.status, c.final, c.last_checked_at, v.spec, p.registration_level,
           r.id as receipt_id, r.sha256, r.anchor_id
    from commitments c
    join commitment_versions v on v.id = c.current_version_id
    join projects p on p.id = c.project_id
    left join lateral (select id, sha256, anchor_id from receipts where commitment_id = c.id order by created_at desc limit 1) r on true
    where (v.spec->>'chain_id')::int = ${chainId} and lower(v.spec->'token'->>'address') = ${token.toLowerCase()}`;
  const coverage = rows.length === 0 ? "none" : rows.some((r) => r.status === "pending" || r.status === "awaiting_evidence" || r.status === "unverifiable") ? "partial" : "full";
  return {
    coverage,
    note: coverage === "none" ? "Kept has no record for this token. That is not evidence that it is clean." : undefined,
    chain_id: chainId,
    token,
    registration_level: rows[0]?.registration_level ?? null,
    commitments: rows.map((r) => ({
      id: r.id,
      category: r.spec.category,
      condition: r.spec.condition_summary,
      status: r.status,
      final: r.final,
      attribution: r.spec.subjects.map((s) => s.attribution.level),
      window: r.spec.window,
      as_of: r.last_checked_at,
      receipt: r.receipt_id ? `${base}/api/v1/receipts/${r.receipt_id}` : null,
      receipt_sha256: r.sha256,
      anchored: !!r.anchor_id,
    })),
    generated_at: new Date().toISOString(),
  };
}
