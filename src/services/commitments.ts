import type { CommitmentSpec, Status } from "@/core/types";
import { CommitmentSpec as SpecSchema } from "@/core/types";
import { db, type Sql } from "@/db/client";

export interface CommitmentRow {
  id: string;
  project_id: string;
  current_version_id: string;
  status: Status;
  final: boolean;
  status_reason: string | null;
  check_interval_s: number;
  last_checked_at: Date | null;
  next_check_at: Date;
  created_at: Date;
}

export interface VersionRow {
  id: string;
  commitment_id: string;
  version: number;
  parent_version_id: string | null;
  snapshot_id: string;
  spec: CommitmentSpec;
  change_kind: string;
  change_reason: string | null;
  confirmed_by: string;
  confirmed_at: Date;
  published_at: Date;
}

export interface SnapshotRow {
  id: string;
  source_id: string | null;
  content_sha256: string;
  text: string;
  http_status: number | null;
  final_url: string | null;
  captured_at: Date;
}

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  chain_id: number;
  token_address: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  registration_level: string;
  is_demo: boolean;
  description: string | null;
  created_at: Date;
}

export interface CommitmentBundle {
  commitment: CommitmentRow;
  version: VersionRow;
  snapshot: SnapshotRow;
  source: { id: string; url: string | null; kind: string } | null;
  project: ProjectRow;
}

function parseVersion(v: VersionRow): VersionRow {
  return { ...v, spec: SpecSchema.parse(v.spec) };
}

export async function loadCommitment(id: string, sql: Sql = db()): Promise<CommitmentBundle | null> {
  const [c] = await sql<CommitmentRow[]>`select * from commitments where id = ${id}`;
  if (!c) return null;
  const [v] = await sql<VersionRow[]>`select * from commitment_versions where id = ${c.current_version_id}`;
  const [s] = await sql<SnapshotRow[]>`select * from source_snapshots where id = ${v.snapshot_id}`;
  const src = s.source_id ? (await sql<{ id: string; url: string | null; kind: string }[]>`select id, url, kind from sources where id = ${s.source_id}`)[0] ?? null : null;
  const [p] = await sql<ProjectRow[]>`select * from projects where id = ${c.project_id}`;
  return { commitment: c, version: parseVersion(v), snapshot: s, source: src, project: p };
}

export async function listVersions(commitmentId: string, sql: Sql = db()): Promise<VersionRow[]> {
  const rows = await sql<VersionRow[]>`select * from commitment_versions where commitment_id = ${commitmentId} order by version`;
  return rows.map(parseVersion);
}

export async function getSnapshot(id: string, sql: Sql = db()): Promise<SnapshotRow | null> {
  const [s] = await sql<SnapshotRow[]>`select * from source_snapshots where id = ${id}`;
  return s ?? null;
}
