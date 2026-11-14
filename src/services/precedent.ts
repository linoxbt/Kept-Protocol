/**
 * Precedent: source watching, change classification and version confirmation.
 *
 * On a new snapshot:
 *   - excerpt still present verbatim → editorial: attach the snapshot to the current version.
 *   - excerpt gone → re-extract (SERV) and propose a version for review; if SERV is unavailable,
 *     record "source text changed" and let a reviewer write a manual draft.
 * A policy change only becomes current after a reviewer confirms it. Old versions stay frozen.
 */
import { diffWords } from "diff";
import { classifyChange, fieldDiff, retroactiveRevisionFlags, type FieldChange, type RetroactiveFlag } from "@/core/precedent";
import type { CommitmentSpec } from "@/core/types";
import { db, type Sql } from "@/db/client";
import { newId } from "@/lib/ids";
import { listVersions, loadCommitment, type SnapshotRow, type VersionRow } from "./commitments";
import { cachedTransfers, collectEvidence, watchedAddresses } from "./evidence";
import { prepareSpec, runAndStoreExtraction, type ConfirmRequest } from "./extractions";
import { servAvailable } from "./serv";
import { captureForSource, Invalid, NotFound, storeSnapshot, type SourceRow } from "./sources";
import { enqueue } from "./verify";

export interface WatchResult {
  sourceId: string;
  changed: boolean;
  snapshotId: string | null;
  actions: { commitmentId: string; action: "editorial" | "proposal" | "needs_manual_draft" | "unchanged"; extractionId?: string }[];
  error?: string;
}

export async function recaptureSource(sourceId: string, sql: Sql = db()): Promise<WatchResult> {
  const [source] = await sql<SourceRow[]>`select * from sources where id = ${sourceId}`;
  if (!source) throw new NotFound("source not found");
  let snapshot: SnapshotRow;
  let changed: boolean;
  try {
    const cap = await captureForSource(source, sql);
    ({ snapshot, changed } = await storeSnapshot(source.id, cap, sql));
    await sql`update sources set last_checked_at = now(), consecutive_failures = 0, status = 'active' where id = ${source.id}`;
  } catch (e) {
    const failures = source.consecutive_failures + 1;
    await sql`update sources set last_checked_at = now(), consecutive_failures = ${failures}, status = ${failures >= 3 ? "unavailable" : source.status} where id = ${source.id}`;
    return { sourceId, changed: false, snapshotId: null, actions: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (!changed) return { sourceId, changed: false, snapshotId: snapshot.id, actions: [] };

  const affected = await sql<{ commitment_id: string; version_id: string; spec: CommitmentSpec }[]>`
    select c.id as commitment_id, v.id as version_id, v.spec
    from commitments c
    join commitment_versions v on v.id = c.current_version_id
    join source_snapshots s on s.id = v.snapshot_id
    where s.source_id = ${source.id}`;
  const actions: WatchResult["actions"] = [];
  let extractionId: string | null = null;
  for (const a of affected) {
    if (snapshot.text.includes(a.spec.excerpt)) {
      await sql`insert into version_snapshots (commitment_version_id, snapshot_id, note) values (${a.version_id}, ${snapshot.id}, 'excerpt unchanged; editorial change elsewhere on the page') on conflict do nothing`;
      actions.push({ commitmentId: a.commitment_id, action: "editorial" });
      continue;
    }
    await enqueue(sql, "source.changed", a.commitment_id, `${a.commitment_id}:source:${snapshot.id}`, {
      commitment_id: a.commitment_id,
      source_id: source.id,
      snapshot_id: snapshot.id,
      excerpt_removed: true,
    });
    if (servAvailable()) {
      try {
        const project = (await sql`select * from projects where id = ${source.project_id}`)[0] as never;
        if (!extractionId) {
          const ex = await runAndStoreExtraction({ project, sourceId: source.id, snapshot, targetCommitmentId: a.commitment_id }, sql);
          extractionId = ex.id;
        }
        actions.push({ commitmentId: a.commitment_id, action: "proposal", extractionId });
        continue;
      } catch {
        // fall through to manual
      }
    }
    actions.push({ commitmentId: a.commitment_id, action: "needs_manual_draft" });
  }
  return { sourceId, changed: true, snapshotId: snapshot.id, actions };
}

/**
 * Confirms a draft from a newer snapshot as the next version of an existing commitment.
 * The field diff decides the change kind; a draft identical in every policy field is refused
 * (that is an editorial change, not a version).
 */
export async function confirmVersion(
  commitmentId: string,
  req: ConfirmRequest & { changeReason?: string | null; changeKind?: "correction" | "supersede" | null },
  sql: Sql = db(),
): Promise<{ versionId: string; version: number; changeKind: string; changes: FieldChange[] }> {
  const bundle = await loadCommitment(commitmentId, sql);
  if (!bundle) throw new NotFound("commitment not found");
  const prepared = await prepareSpec(req, sql);
  if (!prepared.snapshot) throw new Invalid("versions need a captured snapshot");
  const kind = classifyChange(bundle.version.spec, prepared.spec);
  if (kind === "none" || kind === "editorial") throw new Invalid("no policy field changed; this is an editorial change and does not create a version");
  const changeKind = req.changeKind ?? "policy_change";
  const versionId = newId("kv");
  const next = bundle.version.version + 1;
  await sql.begin(async (tx) => {
    await tx`select 1 from commitments where id = ${commitmentId} for update`;
    await tx`insert into commitment_versions (id, commitment_id, version, parent_version_id, snapshot_id, extraction_id, draft_index, spec, change_kind, change_reason, confirmed_by, published_at)
             values (${versionId}, ${commitmentId}, ${next}, ${bundle.version.id}, ${prepared.snapshot!.id}, ${prepared.extraction.id}, ${req.draftIndex},
                     ${tx.json(prepared.spec as never)}, ${changeKind}, ${req.changeReason ?? null}, ${req.reviewer}, ${prepared.snapshot!.captured_at})`;
    await tx`update commitments set current_version_id = ${versionId}, final = false, next_check_at = now() where id = ${commitmentId}`;
    await enqueue(tx, "commitment.version_created", commitmentId, `${commitmentId}:version:${next}`, { commitment_id: commitmentId, version: next, change_kind: changeKind });
    await tx`insert into admin_log (action, target, detail) values ('confirm_version', ${commitmentId}, ${tx.json({ version: next, reviewer: req.reviewer })})`;
  });
  return { versionId, version: next, changeKind, changes: fieldDiff(bundle.version.spec, prepared.spec) };
}

export interface VersionDiff {
  from: VersionRow;
  to: VersionRow;
  changes: FieldChange[];
  changeKind: string;
  textDiff: { value: string; added?: boolean; removed?: boolean }[];
  retroactive: RetroactiveFlag[];
  evidenceAvailable: boolean;
}

export async function diffVersions(commitmentId: string, fromV: number, toV: number, sql: Sql = db(), opts: { fetchEvidence?: boolean } = {}): Promise<VersionDiff> {
  const versions = await listVersions(commitmentId, sql);
  const from = versions.find((v) => v.version === fromV);
  const to = versions.find((v) => v.version === toV);
  if (!from || !to) throw new NotFound("version not found");
  const changes = fieldDiff(from.spec, to.spec);
  const textDiff = diffWords(from.spec.excerpt, to.spec.excerpt).map((p) => ({ value: p.value, added: p.added || undefined, removed: p.removed || undefined }));
  let retroactive: RetroactiveFlag[] = [];
  let evidenceAvailable = false;
  try {
    const transfers = await evidenceFor([from.spec, to.spec], sql, opts.fetchEvidence ?? false);
    evidenceAvailable = true;
    retroactive = retroactiveRevisionFlags(from.spec, to.spec, Math.floor(to.published_at.getTime() / 1000), transfers, {
      finalizedBlock: 0n,
      finalizedTime: 0,
      latestBlock: 0n,
      fromBlock: 0n,
      vesting: null,
    });
  } catch {
    evidenceAvailable = false;
  }
  return { from, to, changes, changeKind: to.change_kind, textDiff, retroactive, evidenceAvailable };
}

/** Transfers for every version's watched addresses, from the cache (optionally refreshing it first). */
export async function evidenceFor(specs: CommitmentSpec[], sql: Sql, refresh: boolean) {
  if (refresh) for (const s of specs) await collectEvidence(s, { sql, includeUnfinalized: false });
  const all = new Map<string, Awaited<ReturnType<typeof cachedTransfers>>[number]>();
  for (const s of specs) {
    const rows = await cachedTransfers(sql, s.chain_id, s.token.address, watchedAddresses(s), 0n, 2n ** 63n);
    for (const t of rows) all.set(`${t.txHash}:${t.logIndex}`, t);
  }
  return [...all.values()].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}
