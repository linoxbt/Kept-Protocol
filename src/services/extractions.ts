/**
 * Extraction jobs, draft confirmation and attribution. A draft becomes a commitment only through
 * confirmDraft, which builds the spec in code and decides attribution from evidence, never from
 * a reviewer's or a model's say-so.
 */
import { getChain } from "@/chain";
import { METHODS } from "@/core/methods";
import type { AttributionLevel, CommitmentSpec, MethodId } from "@/core/types";
import { db, type Sql } from "@/db/client";
import { runExtraction, type Draft, type ExtractionResult, type ProjectContext } from "@/extraction/pipeline";
import { classifyByRules } from "@/extraction/rules";
import { buildSpec } from "@/extraction/spec";
import { addressesInText, checkGrounding, checksum, nearThirdParty } from "@/extraction/validate";
import { newId } from "@/lib/ids";
import { ExtractOut } from "@/serv/schemas";
import { ServError } from "@/serv/client";
import type { ProjectRow, SnapshotRow } from "./commitments";
import { assertBudget, meterFor, servClient } from "./serv";
import { Conflict, Invalid, NotFound } from "./sources";

export interface ExtractionRow {
  id: string;
  project_id: string | null;
  source_id: string | null;
  snapshot_id: string | null;
  preview_text: string | null;
  preview_url: string | null;
  content_sha256: string;
  preview: boolean;
  status: "running" | "done" | "failed";
  result: (ExtractionResult & { manual?: boolean; previews?: Record<number, unknown> }) | null;
  error: string | null;
  target_commitment_id: string | null;
  created_at: Date;
  expires_at: Date | null;
}

export async function getExtraction(id: string, sql: Sql = db()): Promise<ExtractionRow | null> {
  const [r] = await sql<ExtractionRow[]>`select * from extractions where id = ${id}`;
  return r ?? null;
}

export function projectContext(p: ProjectRow | null, chainId = 8453): ProjectContext {
  return { name: p?.name ?? null, chainId: p?.chain_id ?? chainId, tokenAddress: p?.token_address ?? null, tokenSymbol: p?.token_symbol ?? null };
}

export async function runAndStoreExtraction(
  input: {
    project: ProjectRow | null;
    sourceId: string | null;
    snapshot: SnapshotRow | null;
    preview?: { text: string; url: string | null; sha256: string; requesterHash: string };
    targetCommitmentId?: string | null;
  },
  sql: Sql = db(),
  opts: { defer?: (work: () => Promise<void>) => void } = {},
): Promise<ExtractionRow> {
  const client = servClient();
  if (!client) throw new ServError("SERV is not configured (SERV_API_KEY); new extractions are paused, monitoring is unaffected", "not_configured");
  await assertBudget(sql);
  const id = newId("kx");
  const text = input.preview?.text ?? input.snapshot?.text ?? "";
  await sql`insert into extractions (id, project_id, source_id, snapshot_id, preview_text, preview_url, content_sha256, preview, status, requester_hash, target_commitment_id, expires_at)
            values (${id}, ${input.project?.id ?? null}, ${input.sourceId}, ${input.snapshot?.id ?? null}, ${input.preview?.text ?? null}, ${input.preview?.url ?? null},
                    ${input.preview?.sha256 ?? input.snapshot!.content_sha256}, ${!!input.preview}, 'running', ${input.preview?.requesterHash ?? null},
                    ${input.targetCommitmentId ?? null}, ${input.preview ? new Date(Date.now() + 24 * 3600_000) : null})`;
  const work = async (): Promise<ExtractionRow> => {
    try {
      const result = await runExtraction(text, projectContext(input.project), { serv: client, meter: meterFor(id, sql) });
      const [row] = await sql<ExtractionRow[]>`update extractions set status = 'done', result = ${sql.json(result as never)} where id = ${id} returning *`;
      return row;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`update extractions set status = 'failed', error = ${msg.slice(0, 1000)} where id = ${id}`;
      throw e;
    }
  };
  if (opts.defer) {
    // Respond now; the extraction finishes in the background and the client polls the row.
    opts.defer(async () => {
      await work().catch(() => {});
    });
    const [row] = await sql<ExtractionRow[]>`select * from extractions where id = ${id}`;
    return row;
  }
  return work();
}

/**
 * A reviewer-written draft, for when SERV is unavailable or the reviewer wants to correct a
 * model's reading. The same grounding rules apply: every number, date and address must appear in
 * the snapshot excerpt or be declared as derived.
 */
export async function createManualDraft(
  input: { snapshotId: string; quote: string; fields: unknown; projectId: string; targetCommitmentId?: string | null },
  sql: Sql = db(),
): Promise<ExtractionRow> {
  const [snap] = await sql<SnapshotRow[]>`select * from source_snapshots where id = ${input.snapshotId}`;
  if (!snap) throw new NotFound("snapshot not found");
  const start = snap.text.indexOf(input.quote);
  if (start < 0) throw new Invalid("the quote must be an exact substring of the captured source");
  const parsed = ExtractOut.safeParse(input.fields);
  if (!parsed.success) throw new Invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const fields = parsed.data;
  const end = start + input.quote.length;
  const context = snap.text.slice(Math.max(0, start - 1000), Math.min(snap.text.length, end + 1000));
  const grounding = checkGrounding(fields, input.quote, context);
  const rules = classifyByRules(fields, input.quote);
  const draft: Draft = {
    index: 0,
    quote: input.quote,
    start,
    end,
    category_hint: fields.category,
    context,
    fields,
    classification: { verifiability: rules.verifiability, method_id: rules.method_id, agreed: true, rules: rules.rule, rule_ids: [rules.rule] },
    flags: [...new Set([...grounding.flags, ...fields.ambiguity_flags, "MANUAL_DRAFT"])],
    problems: grounding.problems,
    confidence: { grounding: !grounding.flags.some((f) => f.startsWith("UNGROUNDED")), classifier_agreement: true, rules_agreement: true },
    needs_review: true,
    error: null,
  };
  const result = { drafts: [draft], source_flags: [], injection: [], dropped_spans: [], serv_calls: 0, manual: true };
  const [row] = await sql<ExtractionRow[]>`
    insert into extractions (id, project_id, source_id, snapshot_id, content_sha256, preview, status, result, target_commitment_id)
    values (${newId("kx")}, ${input.projectId}, ${snap.source_id}, ${snap.id}, ${snap.content_sha256}, false, 'done', ${sql.json(result as never)}, ${input.targetCommitmentId ?? null})
    returning *`;
  return row;
}

export interface AttributionDecision {
  level: AttributionLevel;
  evidence: string | null;
  confirmed_by: string | null;
}

/**
 * Attribution is established by evidence, strongest first:
 *  onchain_proven       — code-readable link (beneficiary() of the named vesting contract, owner() of the token)
 *  declared_by_project  — the address appears verbatim in the project's own captured source
 *  confirmed_by_reviewer — a named reviewer linked public evidence
 *  unconfirmed          — nothing else; cannot produce Breached
 */
export async function decideAttribution(
  addresses: string[],
  ctx: { chainId: number; token: `0x${string}`; vestingContract: `0x${string}` | null; snapshot: SnapshotRow; sourceUrl: string | null; sourceIsProjects: boolean },
  reviewer: { name: string | null; evidence: Record<string, string> },
): Promise<Record<string, AttributionDecision>> {
  const chain = getChain(ctx.chainId).primary;
  const inSource = addressesInText(ctx.snapshot.text);
  const out: Record<string, AttributionDecision> = {};
  const [vesting, owner] = await Promise.all([
    ctx.vestingContract ? chain.readVesting(ctx.vestingContract, ctx.token).catch(() => null) : Promise.resolve(null),
    chain.tokenOwner(ctx.token).catch(() => null),
  ]);
  for (const raw of addresses) {
    const a = raw.toLowerCase();
    if (vesting?.beneficiary && vesting.beneficiary.toLowerCase() === a) {
      out[a] = { level: "onchain_proven", evidence: `beneficiary() of vesting contract ${ctx.vestingContract}`, confirmed_by: null };
    } else if (owner && owner.toLowerCase() === a) {
      out[a] = { level: "onchain_proven", evidence: `owner() of token ${ctx.token}`, confirmed_by: null };
    } else if (ctx.sourceIsProjects && inSource.has(a) && !nearThirdParty(ctx.snapshot.text, a, null)) {
      out[a] = {
        level: "declared_by_project",
        evidence: `listed in ${ctx.sourceUrl ?? "the project's source"} captured ${ctx.snapshot.captured_at.toISOString().slice(0, 10)} (sha256 ${ctx.snapshot.content_sha256.slice(0, 12)}…)`,
        confirmed_by: null,
      };
    } else if (reviewer.evidence[a] && reviewer.name) {
      out[a] = { level: "confirmed_by_reviewer", evidence: reviewer.evidence[a].slice(0, 2000), confirmed_by: reviewer.name };
    } else {
      out[a] = { level: "unconfirmed", evidence: null, confirmed_by: null };
    }
  }
  return out;
}

export interface ConfirmRequest {
  extractionId: string;
  draftIndex: number;
  edits?: Partial<Record<string, unknown>>;
  methodId?: MethodId;
  tokenAddress?: string | null;
  reviewerEvidence?: Record<string, string>;
  internalAddresses?: string[];
  reviewer: string;
}

export interface PreparedSpec {
  spec: CommitmentSpec;
  draft: Draft;
  extraction: ExtractionRow;
  snapshot: SnapshotRow | null;
  project: ProjectRow | null;
}

/** Turns a draft (plus grounded reviewer edits) into a spec. Shared by confirm and try-it previews. */
export async function prepareSpec(req: ConfirmRequest, sql: Sql = db(), opts: { previewAttribution?: boolean } = {}): Promise<PreparedSpec> {
  const extraction = await getExtraction(req.extractionId, sql);
  if (!extraction || extraction.status !== "done" || !extraction.result) throw new NotFound("extraction not found or not finished");
  const draft = extraction.result.drafts[req.draftIndex];
  if (!draft?.fields) throw new Invalid("that draft has no structured fields to confirm");
  const merged = ExtractOut.safeParse({ ...draft.fields, ...(req.edits ?? {}) });
  if (!merged.success) throw new Invalid(merged.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (req.edits && Object.keys(req.edits).length) {
    const before = new Set(checkGrounding(draft.fields, draft.quote, draft.context).flags.filter((f) => f.startsWith("UNGROUNDED")));
    const after = checkGrounding(merged.data, draft.quote, draft.context).flags.filter((f) => f.startsWith("UNGROUNDED") && !before.has(f));
    if (after.length) throw new Conflict(`edits must match the source text (${after.join(", ")}); publish a new source or declare the value as derived`);
  }
  const fields = merged.data;
  const method = req.methodId ?? (draft.classification?.method_id as MethodId | "none" | undefined);
  if (!method || method === "none" || !(method in METHODS)) throw new Invalid("this commitment has no registered verification method; it can be recorded but not monitored");

  const project = extraction.project_id ? (await sql<ProjectRow[]>`select * from projects where id = ${extraction.project_id}`)[0] ?? null : null;
  const chainId = project?.chain_id ?? 8453;
  const tokenAddr = checksum(req.tokenAddress ?? fields.token_address ?? project?.token_address ?? null);
  if (!tokenAddr) throw new Invalid("the token address is unknown: set it on the project or in the draft");
  const meta =
    project?.token_address?.toLowerCase() === tokenAddr.toLowerCase() && project.token_decimals !== null
      ? { symbol: project.token_symbol, decimals: project.token_decimals }
      : await getChain(chainId).primary.erc20Meta(tokenAddr).catch(() => {
          throw new Invalid("could not read decimals() from the token contract");
        });

  const snapshot = extraction.snapshot_id ? (await sql<SnapshotRow[]>`select * from source_snapshots where id = ${extraction.snapshot_id}`)[0] ?? null : null;
  const subjectAddrs = [...fields.subjects.map((s) => s.address), ...(fields.vesting_contract ? [fields.vesting_contract] : [])].filter((a) => checksum(a));
  let attribution: Record<string, AttributionDecision> = {};
  if (!opts.previewAttribution && snapshot) {
    const [src] = snapshot.source_id ? await sql<{ url: string | null; kind: string }[]>`select url, kind from sources where id = ${snapshot.source_id}` : [];
    attribution = await decideAttribution(
      subjectAddrs,
      { chainId, token: tokenAddr, vestingContract: checksum(fields.vesting_contract), snapshot, sourceUrl: src?.url ?? null, sourceIsProjects: !!src && src.kind !== "social" && src.kind !== "manual" },
      { name: req.reviewer, evidence: Object.fromEntries(Object.entries(req.reviewerEvidence ?? {}).map(([k, v]) => [k.toLowerCase(), v])) },
    );
  }
  const built = buildSpec({
    fields,
    method_id: method,
    chain_id: chainId,
    token: { address: tokenAddr, symbol: meta.symbol, decimals: meta.decimals },
    excerpt: draft.quote,
    attribution,
    internal_addresses: req.internalAddresses,
  });
  if (!built.spec) throw new Invalid(built.errors.join("; "));
  return { spec: built.spec, draft, extraction, snapshot, project };
}

export async function confirmDraft(req: ConfirmRequest, sql: Sql = db()): Promise<{ commitmentId: string; versionId: string }> {
  const prepared = await prepareSpec(req, sql);
  const { spec, extraction, snapshot, project } = prepared;
  if (extraction.preview || !snapshot || !project) throw new Invalid("previews cannot be confirmed; capture the source on a project first");
  if (extraction.target_commitment_id) throw new Invalid("this extraction proposes a new version; confirm it as a version instead");
  const commitmentId = newId("kc");
  const versionId = newId("kv");
  await sql.begin(async (tx) => {
    await tx`insert into commitments (id, project_id, current_version_id, status, status_reason) values (${commitmentId}, ${project.id}, ${versionId}, 'pending', 'confirmed; first check pending')`;
    await tx`insert into commitment_versions (id, commitment_id, version, snapshot_id, extraction_id, draft_index, spec, change_kind, confirmed_by, published_at)
             values (${versionId}, ${commitmentId}, 1, ${snapshot.id}, ${extraction.id}, ${req.draftIndex}, ${tx.json(spec as never)}, 'initial', ${req.reviewer}, ${snapshot.captured_at})`;
    await tx`insert into admin_log (action, target, detail) values ('confirm_draft', ${commitmentId}, ${tx.json({ extraction: extraction.id, draft: req.draftIndex, reviewer: req.reviewer })})`;
  });
  return { commitmentId, versionId };
}
