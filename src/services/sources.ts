import { getChain } from "@/chain";
import { db, type Sql } from "@/db/client";
import { captureText, fetchSource, type Captured } from "@/extraction/capture";
import { checksum } from "@/extraction/validate";
import { newId } from "@/lib/ids";
import type { ProjectRow, SnapshotRow } from "./commitments";

export class NotFound extends Error {}
export class Conflict extends Error {}
export class Invalid extends Error {}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";
}

export async function createProject(
  input: { name: string; slug?: string; chainId: number; tokenAddress?: string | null; description?: string | null; registrationLevel?: string; isDemo?: boolean },
  sql: Sql = db(),
): Promise<ProjectRow> {
  let token: { address: string; symbol: string | null; decimals: number } | null = null;
  if (input.tokenAddress) {
    const addr = checksum(input.tokenAddress);
    if (!addr) throw new Invalid("token address is not a valid address");
    const meta = await getChain(input.chainId).primary.erc20Meta(addr).catch(() => null);
    if (!meta) throw new Invalid("could not read decimals() from the token contract on that chain");
    token = { address: addr, ...meta };
  }
  const slug = slugify(input.slug ?? input.name);
  const exists = await sql`select 1 from projects where slug = ${slug}`;
  if (exists.length) throw new Conflict(`a project with slug ${slug} already exists`);
  const [row] = await sql<ProjectRow[]>`
    insert into projects (id, slug, name, chain_id, token_address, token_symbol, token_decimals, registration_level, is_demo, description)
    values (${newId("kp")}, ${slug}, ${input.name}, ${input.chainId}, ${token?.address.toLowerCase() ?? null}, ${token?.symbol ?? null}, ${token?.decimals ?? null},
            ${input.registrationLevel ?? "unregistered"}, ${input.isDemo ?? false}, ${input.description ?? null})
    returning *`;
  return row;
}

export async function getProjectBySlugOrId(key: string, sql: Sql = db()): Promise<ProjectRow | null> {
  const [p] = await sql<ProjectRow[]>`select * from projects where id = ${key} or slug = ${key}`;
  return p ?? null;
}

export interface SourceRow {
  id: string;
  project_id: string;
  url: string | null;
  kind: string;
  watch_interval_s: number;
  status: string;
  consecutive_failures: number;
  last_checked_at: Date | null;
  created_at: Date;
}

export async function addSource(input: { projectId: string; url?: string | null; kind: string }, sql: Sql = db()): Promise<SourceRow> {
  const [row] = await sql<SourceRow[]>`
    insert into sources (id, project_id, url, kind) values (${newId("ks")}, ${input.projectId}, ${input.url ?? null}, ${input.kind}) returning *`;
  return row;
}

/** Demo sources point at a page Kept hosts; capture reads it straight from the database. */
export function demoSlugFromUrl(url: string | null): string | null {
  const m = url ? /\/demo\/([a-z0-9-]+)\/?$/.exec(url) : null;
  return m ? m[1] : null;
}

export async function captureForSource(source: SourceRow, sql: Sql = db()): Promise<Captured> {
  if (source.kind === "demo") {
    const slug = demoSlugFromUrl(source.url);
    const [page] = slug ? await sql<{ title: string; body: string }[]>`select title, body from demo_pages where slug = ${slug}` : [];
    if (!page) throw new NotFound("demo page not found");
    return { ...captureText(`${page.title}\n\n${page.body}`), url: source.url, finalUrl: source.url, httpStatus: 200 };
  }
  if (!source.url) throw new Invalid("this source has no URL; paste a new text instead");
  return fetchSource(source.url);
}

/** Stores a snapshot unless the latest one for this source has the same content hash. */
export async function storeSnapshot(sourceId: string | null, cap: Captured, sql: Sql = db()): Promise<{ snapshot: SnapshotRow; changed: boolean }> {
  if (sourceId) {
    const [last] = await sql<SnapshotRow[]>`select * from source_snapshots where source_id = ${sourceId} order by captured_at desc limit 1`;
    if (last && last.content_sha256 === cap.sha256) return { snapshot: last, changed: false };
  }
  const [snapshot] = await sql<SnapshotRow[]>`
    insert into source_snapshots (id, source_id, content_sha256, text, http_status, final_url, captured_at)
    values (${newId("kn")}, ${sourceId}, ${cap.sha256}, ${cap.text}, ${cap.httpStatus}, ${cap.finalUrl}, ${cap.capturedAt})
    returning *`;
  return { snapshot, changed: true };
}

export async function latestSnapshot(sourceId: string, sql: Sql = db()): Promise<SnapshotRow | null> {
  const [s] = await sql<SnapshotRow[]>`select * from source_snapshots where source_id = ${sourceId} order by captured_at desc limit 1`;
  return s ?? null;
}
