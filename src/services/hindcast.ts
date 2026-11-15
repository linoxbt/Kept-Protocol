/**
 * Hindcast service: replays commitment versions over cached chain evidence and issues one signed
 * hindcast receipt per run. Hindcast receipts are marked as replays, never as live checks.
 */
import { getChain } from "@/chain";
import { runHindcast, type HindcastResult } from "@/core/hindcast";
import { METHOD_VERSIONS, watchedAddresses } from "@/core/methods";
import type { CommitmentSpec } from "@/core/types";
import { db, type Sql } from "@/db/client";
import { codeCommit } from "@/lib/env";
import { newId } from "@/lib/ids";
import { listVersions, loadCommitment } from "./commitments";
import { evidenceFor } from "./precedent";
import { insertReceipt } from "./receipts";
import { Invalid, NotFound } from "./sources";

export const MAX_HINDCAST_DAYS = 3 * 366;

/**
 * A replay may only use history Kept has actually scanned. Returns the latest time covered by the
 * transfer cache for every watched address of every version; the replay stops there. Throws when
 * the scan does not even reach back to the start of the range. Without this, an unscanned stretch
 * would replay as "no transfers" (a lock looking Verified, final; a burn looking short) in a
 * signed receipt.
 */
async function coveredUntil(specs: CommitmentSpec[], from: number, sql: Sql): Promise<number> {
  let until = Number.POSITIVE_INFINITY;
  for (const spec of specs) {
    const chain = getChain(spec.chain_id).primary as ReturnType<typeof getChain>["primary"] & { blockTime?: (n: bigint) => Promise<number> };
    const needFrom = await chain.blockAtOrBefore(from);
    for (const addr of watchedAddresses(spec)) {
      const [c] = await sql<{ scanned_from: string; scanned_to: string }[]>`
        select scanned_from::text, scanned_to::text from scan_cursors
        where chain_id = ${spec.chain_id} and token = ${spec.token.address.toLowerCase()} and from_addr = ${addr.toLowerCase()}`;
      if (!c || BigInt(c.scanned_from) > needFrom + 1n) {
        throw new Invalid(`chain evidence for ${addr} does not reach back to the start of the replay yet (${c ? `scanned from block ${c.scanned_from}` : "not scanned yet"}); run it once the backfill completes`);
      }
      const t = chain.blockTime ? await chain.blockTime(BigInt(c.scanned_to)) : (await chain.finalizedBlock()).timestamp;
      until = Math.min(until, t);
    }
  }
  return until;
}

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
  let to = Math.min(Math.floor((opts.to ? Date.parse(opts.to) : Math.max(...ends) + 86_400 * 3) / 1000), toCap);
  if (!(to > from)) throw new Invalid("the range is empty");
  if ((to - from) / 86_400 > MAX_HINDCAST_DAYS) throw new Invalid(`ranges over ${MAX_HINDCAST_DAYS} days are not supported; pick a shorter range`);

  const transfers = await evidenceFor(specs, sql, opts.refresh ?? true);
  // Stop where the scanned evidence stops (never replay unscanned blocks as "nothing happened").
  const covered = await coveredUntil(specs, from, sql);
  if (covered < to) to = Math.floor(covered);
  if (!(to > from)) throw new Invalid("chain evidence for this commitment has not been scanned past the start of the replay yet");
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
        "Replayed statuses come from the primary provider's finalized logs; they were not re-confirmed on a second provider.",
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
