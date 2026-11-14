/**
 * Curated real-world commitments, added by Kept's operator through the same grounded path a
 * reviewer uses: the worker fetches the project's own public page, the promise must appear in it
 * verbatim, the fields are grounded against that snapshot, and attribution follows the normal rules
 * (declared_by_project only when the address is on the project's page; otherwise the reviewer's
 * cited evidence). Each entry is added once; failures are retried on later ticks and reported.
 * KEPT_CURATED_AUTO=0 disables it.
 */
import { db, type Sql } from "@/db/client";
import type { MethodId } from "@/core/types";
import { confirmDraft, createManualDraft } from "./extractions";
import { addSource, captureForSource, createProject, getProjectBySlugOrId, storeSnapshot, type SourceRow } from "./sources";

export interface CuratedCommitment {
  slug: string;
  name: string;
  description: string;
  chainId: number;
  tokenAddress: string;
  sourceUrl: string;
  sourceKind: "docs" | "blog" | "governance";
  /** Exact text as it appears on the captured page. */
  quote: string;
  methodId: MethodId;
  fields: Record<string, unknown>;
  /** Address → evidence, for subjects not listed on the project's page. */
  reviewerEvidence?: Record<string, string>;
}

export const CURATED: CuratedCommitment[] = [];

let done = false;
let lastRun = 0;

export async function seedCurated(sql: Sql = db()): Promise<{ added: string[]; failed: { slug: string; error: string }[] }> {
  const added: string[] = [];
  const failed: { slug: string; error: string }[] = [];
  if (done || process.env.KEPT_CURATED_AUTO === "0" || CURATED.length === 0 || Date.now() - lastRun < 600_000) return { added, failed };
  lastRun = Date.now();
  for (const c of CURATED) {
    try {
      let project = await getProjectBySlugOrId(c.slug, sql);
      if (project) {
        const [has] = await sql<{ n: number }[]>`select count(*)::int as n from commitments where project_id = ${project.id}`;
        if (has.n > 0) continue;
      }
      project ??= await createProject({ name: c.name, slug: c.slug, chainId: c.chainId, tokenAddress: c.tokenAddress, description: c.description, registrationLevel: "unregistered" }, sql);
      const [existing] = await sql<SourceRow[]>`select * from sources where project_id = ${project.id} and url = ${c.sourceUrl} limit 1`;
      const source = existing ?? (await addSource({ projectId: project.id, url: c.sourceUrl, kind: c.sourceKind }, sql));
      const { snapshot } = await storeSnapshot(source.id, await captureForSource(source, sql), sql);
      const ex = await createManualDraft({ snapshotId: snapshot.id, projectId: project.id, quote: c.quote, fields: c.fields }, sql);
      const { commitmentId } = await confirmDraft(
        { extractionId: ex.id, draftIndex: 0, methodId: c.methodId, tokenAddress: c.tokenAddress, reviewerEvidence: c.reviewerEvidence, reviewer: "kept-curation" },
        sql,
      );
      await sql`update commitments set next_check_at = now() where id = ${commitmentId}`;
      added.push(c.slug);
    } catch (e) {
      failed.push({ slug: c.slug, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
  }
  if (failed.length === 0) done = true;
  return { added, failed };
}
