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

export const CURATED: CuratedCommitment[] = [
  {
    slug: "degen",
    name: "Degen",
    description: "DEGEN, the Farcaster-native community token on Base. The project burns about 5 million DEGEN a day through a public burn contract until mid 2027.",
    chainId: 8453,
    tokenAddress: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    sourceUrl: "https://www.degen.tips/",
    sourceKind: "docs",
    quote: "yes. about 5 million DEGEN get burned every day, until mid 2027.",
    methodId: "burn_v1",
    fields: {
      category: "burn",
      responsible_entity: "Degen",
      token_symbol: "DEGEN",
      token_address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
      subjects: [{ address: "0x21bb2A7e0e26449e60E6Fb994cd435b11BFe1a1A", role: "executor", label: "DegenYearBurner (burn contract)" }],
      comparator: "gte",
      amount: "895000000",
      amount_unit: "tokens",
      window_start: "2026-11-13",
      window_end: "2027-05-11",
      duration_months: null,
      cliff_months: null,
      vesting_contract: null,
      derived: [
        { field: "window_start", rule: "start of tracking on Kept" },
        { field: "window_end", rule: "\"until mid 2027\": the burn contract's full daily rate ends 2027-05-11 15:42 UTC (on-chain schedule of 0x21bb…1a1A)" },
        { field: "amount", rule: "\"about 5 million … every day\": 5,000,000 DEGEN × 179 days (2026-11-13 to 2027-05-11)" },
      ],
      ambiguity_flags: ["\"about\" 5 million per day; checked as a cumulative 5,000,000 per day over the window"],
      condition_summary: "At least 895,000,000 DEGEN burned by the burn contract between 2026-11-13 and 2027-05-11.",
    },
    reviewerEvidence: {
      "0x21bb2a7e0e26449e60e6fb994cd435b11bfe1a1a":
        "degen.tips links this address as \"the burn contract is public on basescan\" (the address is in the link, not the page text). Verified source on Sourcify: DegenYearBurner, permissionless burn() calling DEGEN.burn(), no withdraw.",
    },
  },
  {
    slug: "alien-base",
    name: "Alien Base",
    description: "Alien Base, a DEX native to Base. Legacy ALB and esALB migrated to the new token are locked in the Migration Contract, which has no withdraw function and no owner.",
    chainId: 8453,
    tokenAddress: "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
    sourceUrl: "https://docs.alienbase.xyz/alb-migration/migration",
    sourceKind: "docs",
    quote: "Old tokens you migrate are locked in the Migration Contract forever. It has no withdraw function and no owner.",
    methodId: "erc20_outflow_v1",
    fields: {
      category: "token_lock",
      responsible_entity: "Alien Base",
      token_symbol: "ALB",
      token_address: "0x1dd2d631c92b1aCdFCDd51A0F7145A50130050C4",
      subjects: [{ address: "0xa53d1fd0aae780f5f4f3c2f75a35ca9e74269d3d", role: "holder", label: "ALB Migration Contract" }],
      comparator: "lte",
      amount: "0",
      amount_unit: "tokens",
      window_start: "2026-10-01",
      window_end: "2027-10-01",
      duration_months: null,
      cliff_months: null,
      vesting_contract: null,
      derived: [
        { field: "window_start", rule: "deployment of the Migration Contract (Base block 52036938, 2026-10-01 14:00 UTC)" },
        { field: "window_end", rule: "the promise is permanent; Kept checks a one-year horizon from deployment and extends it" },
        { field: "amount", rule: "\"locked forever … no withdraw function\" permits 0 outflow" },
      ],
      ambiguity_flags: [],
      condition_summary: "No legacy ALB may leave the Alien Base Migration Contract.",
    },
  },
  {
    slug: "alien-base",
    name: "Alien Base",
    description: "Alien Base, a DEX native to Base. Legacy ALB and esALB migrated to the new token are locked in the Migration Contract, which has no withdraw function and no owner.",
    chainId: 8453,
    tokenAddress: "0x365c6d588e8611125De3bEA5B9280C304FA54113",
    sourceUrl: "https://docs.alienbase.xyz/alb-migration/migration",
    sourceKind: "docs",
    quote: "Old tokens you migrate are locked in the Migration Contract forever. It has no withdraw function and no owner.",
    methodId: "erc20_outflow_v1",
    fields: {
      category: "token_lock",
      responsible_entity: "Alien Base",
      token_symbol: "esALB",
      token_address: "0x365c6d588e8611125De3bEA5B9280C304FA54113",
      subjects: [{ address: "0xa53d1fd0aae780f5f4f3c2f75a35ca9e74269d3d", role: "holder", label: "ALB Migration Contract" }],
      comparator: "lte",
      amount: "0",
      amount_unit: "tokens",
      window_start: "2026-10-01",
      window_end: "2027-10-01",
      duration_months: null,
      cliff_months: null,
      vesting_contract: null,
      derived: [
        { field: "window_start", rule: "deployment of the Migration Contract (Base block 52036938, 2026-10-01 14:00 UTC)" },
        { field: "window_end", rule: "the promise is permanent; Kept checks a one-year horizon from deployment and extends it" },
        { field: "amount", rule: "\"locked forever … no withdraw function\" permits 0 outflow" },
      ],
      ambiguity_flags: [],
      condition_summary: "No legacy esALB may leave the Alien Base Migration Contract.",
    },
  },
];

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
        // One commitment per (project, token, quote): already added means nothing to do.
        const [has] = await sql<{ n: number }[]>`
          select count(*)::int as n from commitments k join commitment_versions v on v.commitment_id = k.id and v.version = 1
          where k.project_id = ${project.id} and lower(v.spec->'token'->>'address') = ${c.tokenAddress.toLowerCase()} and v.spec->>'excerpt' = ${c.quote}`;
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
