/**
 * Public lookup: "does Kept track this token, project or wallet?" Matches monitored projects by
 * name, slug, symbol or token address; monitored commitments by token or any wallet they name;
 * and public previews by URL. No match is not a clean record: it means Kept has not checked it.
 */
import { db, type Sql } from "@/db/client";
import type { Status } from "@/core/types";

export interface SearchResults {
  query: string;
  kind: "address" | "text";
  projects: { slug: string; name: string; token_symbol: string | null; token_address: string | null; is_demo: boolean; commitments: number }[];
  commitments: { id: string; project_slug: string; project_name: string; status: Status; final: boolean; summary: string; matched: "token" | "wallet" | "project" }[];
  previews: { id: string; url: string; created_at: Date; drafts: number }[];
}

export function normalizeQuery(raw: string): { q: string; kind: "address" | "text" } {
  const q = raw.trim().slice(0, 120);
  return /^0x[0-9a-fA-F]{40}$/.test(q) ? { q: q.toLowerCase(), kind: "address" } : { q, kind: "text" };
}

export async function search(raw: string, sql: Sql = db()): Promise<SearchResults> {
  const { q, kind } = normalizeQuery(raw);
  const empty: SearchResults = { query: q, kind, projects: [], commitments: [], previews: [] };
  if (q.length < 2) return empty;
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).toLowerCase()}%`;

  const projects = await sql<SearchResults["projects"]>`
    select p.slug, p.name, p.token_symbol, p.token_address, p.is_demo, (select count(*)::int from commitments c where c.project_id = p.id) as commitments
    from projects p
    where ${kind === "address" ? sql`lower(p.token_address) = ${q}` : sql`lower(p.name) like ${like} or lower(p.slug) like ${like} or lower(coalesce(p.token_symbol, '')) like ${like}`}
    order by p.is_demo, p.name limit 20`;

  const commitments = await sql<SearchResults["commitments"]>`
    select c.id, p.slug as project_slug, p.name as project_name, c.status, c.final, v.spec->>'condition_summary' as summary,
      case
        when ${kind === "address"} and lower(v.spec->'token'->>'address') = ${q} then 'token'
        when ${kind === "address"} then 'wallet'
        else 'project'
      end as matched
    from commitments c
    join commitment_versions v on v.id = c.current_version_id
    join projects p on p.id = c.project_id
    where ${
      kind === "address"
        ? sql`lower(v.spec->'token'->>'address') = ${q}
              or exists (select 1 from jsonb_array_elements(v.spec->'subjects') s where lower(s->>'address') = ${q})
              or lower(coalesce(v.spec->'vesting'->>'contract', '')) = ${q}
              or lower(coalesce(v.spec->'burn'->>'executor', '')) = ${q}`
        : sql`lower(p.name) like ${like} or lower(p.slug) like ${like} or lower(coalesce(v.spec->'token'->>'symbol', '')) like ${like}`
    }
    order by p.is_demo, c.last_checked_at desc nulls last limit 50`;

  const previews =
    kind === "text"
      ? await sql<SearchResults["previews"]>`
          select id, preview_url as url, created_at, coalesce(jsonb_array_length(result->'drafts'), 0)::int as drafts
          from extractions
          where preview and preview_url is not null and (expires_at is null or expires_at > now()) and lower(preview_url) like ${like}
          order by created_at desc limit 20`
      : [];

  return { query: q, kind, projects, commitments, previews };
}
