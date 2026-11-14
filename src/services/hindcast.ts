/**
 * Hindcast service: replays commitment versions over cached chain evidence and issues one signed
 * hindcast receipt per run. Hindcast receipts are marked as replays, never as live checks.
 */
import { getChain } from "@/chain";
import { runHindcast, type HindcastResult } from "@/core/hindcast";
import { METHOD_VERSIONS } from "@/core/methods";
import { db, type Sql } from "@/db/client";
import { codeCommit } from "@/lib/env";
import { newId } from "@/lib/ids";
import { listVersions, loadCommitment } from "./commitments";
import { evidenceFor } from "./precedent";
import { insertReceipt } from "./receipts";
import { Invalid, NotFound } from "./sources";

export const MAX_HINDCAST_DAYS = 3 * 366;

export interface HindcastRun {
  id: string;
  commitmentId: string;
  result: HindcastResult;
  receiptId: string;
  versions: number[];
}

export async function runHindcastFor(
  commitmentId: string,
  opts: { versions?: number[]; from?: string; to?: string; refresh?: boolean } = {},
  sql: Sql = db(),
): Promise<HindcastRun> {
  const bundle = await loadCommitment(commitmentId, sql);
  if (!bundle) throw new NotFound("commitment not found");
  const all = await listVersions(commitmentId, sql);
  const chosen = opts.versions?.length ? all.filter((v) => opts.versions!.includes(v.version)) : all;
  if (!chosen.length) throw new Invalid("no matching versions");
  const specs = chosen.map((v) => v.spec);
  const starts = specs.map((s) => Date.parse(s.window.start));
  const ends = specs.map((s) => Date.parse(s.window.end));
  const from = Math.floor((opts.from ? Date.parse(opts.from) : Math.min(...starts)) / 1000);
  const toCap = Math.floor(Date.now() / 1000);
  const to = Math.min(Math.floor((opts.to ? Date.parse(opts.to) : Math.max(...ends) + 86_400 * 3) / 1000), toCap);
  if (!(to > from)) throw new Invalid("the range is empty");
  if ((to - from) / 86_400 > MAX_HINDCAST_DAYS) throw new Invalid(`ranges over ${MAX_HINDCAST_DAYS} days are not supported; pick a shorter range`);

  const transfers = await evidenceFor(specs, sql, opts.refresh ?? true);
  const vestingSpec = specs.find((s) => s.vesting);
  const vesting = vestingSpec ? await getChain(vestingSpec.chain_id).primary.readVesting(vestingSpec.vesting!.contract as `0x${string}`, vestingSpec.token.address as `0x${string}`).catch(() => null) : null;
  const result = runHindcast(
    chosen.map((v) => ({ version: v.version, spec: v.spec, publishedAt: Math.floor(v.published_at.getTime() / 1000) })),
    transfers.filter((t) => t.blockTime <= to),
    { from, to, vesting, confirmation: "confirmed", blockAt: () => 0n },
  );

  const latest = chosen[chosen.length - 1];
  const id = newId("kh");
  const summary = {
    run_id: id,
    range: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
    lanes: result.lanes.map((l) => ({ version: l.version, changes: l.changes, first_breached_at: l.firstBreachedAt, first_verified_final_at: l.firstVerifiedFinalAt })),
    divergences: result.divergences.length,
  };
  return sql.begin(async (tx) => {
    await tx`select 1 from commitments where id = ${commitmentId} for update`;
    const receipt = await insertReceipt(tx, {
      receipt_version: 1,
      kind: "hindcast",
      commitment_id: commitmentId,
      commitment_version: latest.version,
      issued_at: new Date().toISOString(),
      statement: { url: bundle.source?.url ?? null, excerpt: latest.spec.excerpt, content_sha256: bundle.snapshot.content_sha256, captured_at: bundle.snapshot.captured_at.toISOString() },
      spec: latest.spec,
      method: { id: latest.spec.method_id, version: METHOD_VERSIONS[latest.spec.method_id], code_commit: codeCommit() },
      chain: {
        chain_id: latest.spec.chain_id,
        token: latest.spec.token.address,
        subjects: latest.spec.subjects.map((s) => s.address),
        from_block: transfers[0]?.blockNumber.toString() ?? "0",
        to_block: transfers.at(-1)?.blockNumber.toString() ?? "0",
        to_block_finalized: true,
        to_block_time: to,
      },
      evidence: transfers.slice(0, 500).map((t) => ({ tx_hash: t.txHash, log_index: t.logIndex, block_number: t.blockNumber.toString(), block_time: t.blockTime, from: t.from, to: t.to, amount: t.amount.toString() })),
      result: {
        status: result.lanes.at(-1)!.points.at(-1)!.status,
        final: result.lanes.at(-1)!.points.at(-1)!.final,
        outcome: "in_progress",
        computed_value: result.lanes.at(-1)!.points.at(-1)!.computed_value,
        threshold_base_units: latest.spec.threshold_base_units,
        comparator: latest.spec.comparator,
        reason: "Replay: under the stated condition, the evidence shows the statuses in `replay`. A replay never implies an outcome was predictable.",
        warnings: [],
      },
      attribution: latest.spec.subjects.map((s) => ({ address: s.address, level: s.attribution.level, evidence: s.attribution.evidence })),
      providers: [{ name: getChain(latest.spec.chain_id).primary.name, role: "primary", result: "replayed from cached finalized logs" }],
      limitations: [
        "Replay of historical evidence; not a live check.",
        "Attribution is time-bound: an address declared now says nothing certain about who controlled it earlier.",
        "Source history only includes versions Kept captured.",
      ],
      replay: summary,
    });
    await tx`insert into hindcast_runs (id, commitment_id, params, result, receipt_id)
             values (${id}, ${commitmentId}, ${tx.json({ versions: chosen.map((v) => v.version), from, to })}, ${tx.json(JSON.parse(JSON.stringify(result)) as never)}, ${receipt.id})`;
    return { id, commitmentId, result, receiptId: receipt.id, versions: chosen.map((v) => v.version) };
  });
}

export async function getHindcast(id: string, sql: Sql = db()) {
  const [r] = await sql<{ id: string; commitment_id: string; params: { versions: number[]; from: number; to: number }; result: HindcastResult; receipt_id: string; created_at: Date }[]>`
    select * from hindcast_runs where id = ${id}`;
  return r ?? null;
}

export async function latestHindcast(commitmentId: string, sql: Sql = db()) {
  const [r] = await sql<{ id: string }[]>`select id from hindcast_runs where commitment_id = ${commitmentId} order by created_at desc limit 1`;
  return r ? getHindcast(r.id, sql) : null;
}
