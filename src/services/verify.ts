/**
 * System 02 + 03: run a deterministic check for one commitment and record the result.
 * SERV is never called here; if SERV is down, monitoring is unaffected.
 */
import type { ChainAdapter } from "@/chain/adapter";
import { getChain } from "@/chain";
import { METHOD_VERSIONS, runMethod } from "@/core/methods";
import { deriveStatus, type ProviderConfirmation, type StatusDecision } from "@/core/status";
import type { CommitmentSpec, MethodResult, Transfer } from "@/core/types";
import { db, type Q, type Sql } from "@/db/client";
import { codeCommit } from "@/lib/env";
import { newId } from "@/lib/ids";
import { isDevSigner, getSigner } from "@/receipts/signer";
import { canonicalJson, sha256Hex, type ReceiptBody } from "@/receipts/receipt";
import { loadCommitment } from "./commitments";
import { activeDispute } from "./disputes";
import { startJob, type Defer } from "./jobs";
import { NotFound } from "./sources";
import { collectEvidence, watchedAddresses, type CollectedEvidence } from "./evidence";
import { insertReceipt, type StoredReceipt } from "./receipts";

export const METHOD_LIMITATIONS: Record<string, string[]> = {
  erc20_outflow_v1: [
    "Counts ERC-20 Transfer logs only; tokens held by addresses not in the subject list are not covered.",
    "Bridged, wrapped or rebasing representations of the token are not covered.",
    "Moves between addresses the reviewer confirmed as the same entity are not counted.",
  ],
  vesting_schedule_v1: [
    "Releases are measured as Transfer logs out of the vesting contract.",
    "A contract schedule faster than stated is an early warning; it becomes a breach only when tokens actually leave early.",
  ],
  burn_v1: [
    "Only burns sent by the attributed executor to the zero or 0x…dEaD address count.",
    "A custom burn function that emits no Transfer log is not detected in this method version.",
  ],
};

/** Blocks the confirmation provider recounts per check; long periods resume on the next check. */
export const MAX_CONFIRM_BLOCKS_PER_CHECK = BigInt(process.env.KEPT_MAX_CONFIRM_BLOCKS ?? 3_000_000);

export interface Confirmation {
  confirmation: ProviderConfirmation;
  detail: string;
  /** True while a resumable recount is still running: check again soon. */
  inProgress?: boolean;
}

/**
 * Recounts a shortfall on the confirmation provider. The recount is stored per spec and resumes
 * where it stopped, so a period of any length is eventually recounted in full by an independent
 * provider before a breach can be declared.
 */
async function recountShortfall(spec: CommitmentSpec, result: MethodResult, collected: CollectedEvidence, confirm: ChainAdapter, sql: Sql | undefined, budget: bigint): Promise<Confirmation> {
  const executor = (spec.burn?.executor ?? "").toLowerCase();
  const burnSet = new Set((spec.burn?.burn_addresses ?? []).map((a) => a.toLowerCase()));
  if (!sql) {
    // No database (offline Grifter, unit tests): recount the whole period in one go.
    const recount = await confirm.getTransfers({ token: spec.token.address as `0x${string}`, from: executor ? [executor as `0x${string}`] : watchedAddresses(spec), fromBlock: collected.windowFromBlock, toBlock: collected.evidence.finalizedBlock });
    const again = runMethod(spec, { ...collected.evidence, transfers: recount });
    return again.computed_value === result.computed_value
      ? { confirmation: "confirmed", detail: "shortfall recounted independently" }
      : { confirmation: "disagreed", detail: `confirmation provider counted ${again.computed_value}, primary ${result.computed_value}` };
  }
  const key = sha256Hex(canonicalJson(spec));
  await sql`insert into confirm_recounts (spec_sha256, chain_id, from_block, to_block, scanned_to)
            values (${key}, ${spec.chain_id}, ${collected.windowFromBlock.toString()}, ${collected.evidence.finalizedBlock.toString()}, ${(collected.windowFromBlock - 1n).toString()})
            on conflict (spec_sha256) do nothing`;
  const [row] = await sql<{ from_block: string; to_block: string; scanned_to: string; transfers: Record<string, string | number>[] }[]>`
    select from_block::text, to_block::text, scanned_to::text, transfers from confirm_recounts where spec_sha256 = ${key}`;
  const from = BigInt(row.from_block);
  const to = BigInt(row.to_block);
  let scanned = BigInt(row.scanned_to);
  const found = [...row.transfers];
  let remaining = budget;
  while (scanned < to && remaining > 0n) {
    const end = scanned + remaining < to ? scanned + remaining : to;
    const chunk = await confirm.getTransfers({ token: spec.token.address as `0x${string}`, from: executor ? [executor as `0x${string}`] : watchedAddresses(spec), fromBlock: scanned + 1n, toBlock: end });
    for (const t of chunk) {
      if (!burnSet.size || burnSet.has(t.to.toLowerCase())) {
        found.push({ txHash: t.txHash, logIndex: t.logIndex, blockNumber: t.blockNumber.toString(), blockTime: t.blockTime, token: t.token, from: t.from, to: t.to, amount: t.amount.toString() });
      }
    }
    remaining -= end - scanned;
    await sql`update confirm_recounts set scanned_to = ${end.toString()}, transfers = ${sql.json(found as never)}, updated_at = now()
              where spec_sha256 = ${key} and scanned_to = ${scanned.toString()}`;
    scanned = end;
  }
  if (scanned < to) {
    const pct = Number(((scanned - from + 1n) * 100n) / (to - from + 1n));
    return { confirmation: "unavailable", detail: `independent recount on the confirmation provider in progress: ${Math.max(0, Math.min(99, pct))}% of the period`, inProgress: true };
  }
  const recount: Transfer[] = found.map((t) => ({
    txHash: t.txHash as `0x${string}`,
    logIndex: Number(t.logIndex),
    blockNumber: BigInt(t.blockNumber),
    blockTime: Number(t.blockTime),
    token: t.token as `0x${string}`,
    from: t.from as `0x${string}`,
    to: t.to as `0x${string}`,
    amount: BigInt(t.amount),
  }));
  const again = runMethod(spec, { ...collected.evidence, transfers: recount });
  return again.computed_value === result.computed_value
    ? { confirmation: "confirmed", detail: `shortfall recounted independently over blocks ${from}–${to}` }
    : { confirmation: "disagreed", detail: `confirmation provider counted ${again.computed_value}, primary ${result.computed_value}` };
}

export async function confirmViolation(
  spec: CommitmentSpec,
  result: MethodResult,
  collected: CollectedEvidence,
  confirm: ChainAdapter,
  sql?: Sql,
  budget: bigint = MAX_CONFIRM_BLOCKS_PER_CHECK,
): Promise<Confirmation> {
  if (result.outcome !== "violated") return { confirmation: "not_needed", detail: "no violation to confirm" };
  try {
    if (result.violating.length > 0) {
      const sample = result.violating.slice(0, 3);
      const ok = await Promise.all(sample.map((t) => confirm.confirmTransfer(t)));
      return ok.every(Boolean)
        ? { confirmation: "confirmed", detail: `${sample.length} violating transfer(s) independently confirmed at finalized blocks` }
        : { confirmation: "disagreed", detail: "the confirmation provider could not reproduce a violating transfer" };
    }
    // A shortfall (absence of burns) is confirmed by a full, resumable recount on the second provider.
    return await recountShortfall(spec, result, collected, confirm, sql, budget);
  } catch (e) {
    return { confirmation: "unavailable", detail: `confirmation provider error: ${e instanceof Error ? e.message : e}` };
  }
}

export interface Evaluation {
  result: MethodResult;
  decision: StatusDecision;
  collected: CollectedEvidence;
  confirmation: Confirmation;
}

/** Evidence + method + confirmation + status. No writes except the log cache. */
export async function evaluate(spec: CommitmentSpec, sql: Sql = db(), opts: { budgetBlocks?: bigint; confirm?: boolean } = {}): Promise<Evaluation> {
  const chain = getChain(spec.chain_id);
  const collected = await collectEvidence(spec, { sql, adapter: chain.primary, budgetBlocks: opts.budgetBlocks });
  let result = runMethod(spec, collected.evidence);
  if (!collected.complete) {
    // Outflows and releases only accumulate, so a violation in the scanned part is real.
    const partial = runMethod(spec, { ...collected.evidence, transfers: collected.partialTransfers });
    if (partial.outcome === "violated" && spec.method_id !== "burn_v1") {
      result = partial;
    } else {
      const pct = scanProgress(collected);
      return {
        result,
        collected,
        confirmation: { confirmation: "not_needed", detail: "backfill in progress", inProgress: true },
        decision: { status: "awaiting_evidence", final: false, reason: `Backfilling chain evidence: ${pct}% of the window scanned (to block ${collected.scannedTo}).` },
      };
    }
  }
  // Previews never confirm: their attribution is unconfirmed, so they can never be a breach anyway.
  const confirmation: Confirmation =
    opts.confirm === false
      ? { confirmation: "unavailable", detail: "previews are not independently confirmed" }
      : await confirmViolation(spec, result, collected, chain.confirm, sql, opts.budgetBlocks ?? MAX_CONFIRM_BLOCKS_PER_CHECK);
  const decision = deriveStatus(spec, result, confirmation.confirmation);
  return { result, decision, collected, confirmation };
}

function scanProgress(c: CollectedEvidence): number {
  const total = c.evidence.latestBlock - c.windowFromBlock;
  if (total <= 0n) return 100;
  const done = c.scannedTo - c.windowFromBlock;
  return Math.max(0, Math.min(99, Number((done * 100n) / total)));
}

const ev = (t: Transfer) => ({
  tx_hash: t.txHash,
  log_index: t.logIndex,
  block_number: t.blockNumber.toString(),
  block_time: t.blockTime,
  from: t.from,
  to: t.to,
  amount: t.amount.toString(),
});

export interface CheckOutcome {
  checkId: string;
  receipt: StoredReceipt;
  decision: StatusDecision;
  changed: boolean;
}

export async function runCheck(commitmentId: string, opts: { sql?: Sql; trigger?: string } = {}): Promise<CheckOutcome> {
  const sql = opts.sql ?? db();
  const bundle = await loadCommitment(commitmentId, sql);
  if (!bundle) throw new Error(`commitment ${commitmentId} not found`);
  const { version, snapshot, source } = bundle;
  const spec = version.spec;
  const checkId = newId("kk");
  let evaluation: Evaluation;
  try {
    evaluation = await evaluate(spec, sql);
  } catch (e) {
    // The chain read failed: keep the last good status, record the failure, retry soon.
    const msg = e instanceof Error ? e.message : String(e);
    await sql`insert into checks (id, commitment_id, commitment_version_id, method_id, method_version, error, finished_at)
              values (${checkId}, ${commitmentId}, ${version.id}, ${spec.method_id}, ${METHOD_VERSIONS[spec.method_id]}, ${msg.slice(0, 1000)}, now())`;
    await sql`update commitments set checking_since = null, next_check_at = now() + interval '5 minutes' where id = ${commitmentId}`;
    throw e;
  }
  const { result, collected, confirmation } = evaluation;
  // An accepted dispute overlays the status until it is resolved; the mechanical result stays in the reason.
  const dispute = await activeDispute(commitmentId, sql);
  const decision: StatusDecision = dispute
    ? { status: "disputed", final: false, reason: `Under review after a dispute (${dispute.id}). Mechanical result: ${evaluation.decision.reason}` }
    : evaluation.decision;
  const signer = getSigner();
  const limitations = [...(METHOD_LIMITATIONS[spec.method_id] ?? []), ...result.notes];
  if (!collected.complete) limitations.push(`Evidence backfill incomplete: scanned to block ${collected.scannedTo}.`);
  if (isDevSigner(signer.address)) limitations.push("Signed with the public development key: this receipt proves nothing until re-issued with Kept's production key.");

  const evidenceList = [...result.violating, ...result.counted.filter((t) => !result.violating.includes(t))].slice(0, 500);
  const receiptBody: Omit<ReceiptBody, "signer" | "prev_sha256" | "receipt_id"> = {
    receipt_version: 1,
    kind: "verification",
    commitment_id: commitmentId,
    commitment_version: version.version,
    issued_at: new Date().toISOString(),
    statement: { url: source?.url ?? null, excerpt: spec.excerpt, content_sha256: snapshot.content_sha256, captured_at: snapshot.captured_at.toISOString() },
    spec,
    method: { id: spec.method_id, version: METHOD_VERSIONS[spec.method_id], code_commit: codeCommit() },
    chain: {
      chain_id: spec.chain_id,
      token: spec.token.address,
      subjects: spec.subjects.map((s) => s.address),
      from_block: collected.windowFromBlock.toString(),
      to_block: collected.evidence.finalizedBlock.toString(),
      to_block_finalized: true,
      to_block_time: collected.evidence.finalizedTime,
    },
    evidence: evidenceList.map(ev),
    result: {
      status: decision.status,
      final: decision.final,
      outcome: result.outcome,
      computed_value: result.computed_value,
      threshold_base_units: result.threshold_base_units,
      comparator: result.comparator,
      reason: decision.reason,
      warnings: result.warnings,
    },
    attribution: spec.subjects.map((s) => ({ address: s.address, level: s.attribution.level, evidence: s.attribution.evidence })),
    providers: [
      { name: collected.providerName, role: "primary", result: collected.complete ? "complete" : "partial" },
      ...(confirmation.confirmation === "not_needed" ? [] : [{ name: getChain(spec.chain_id).confirm.name, role: "confirmation" as const, result: `${confirmation.confirmation}: ${confirmation.detail}` }]),
    ],
    limitations,
    replay: null,
  };

  return sql.begin(async (tx) => {
    const [locked] = await tx<{ status: string; final: boolean }[]>`select status, final from commitments where id = ${commitmentId} for update`;
    const receipt = await insertReceipt(tx, receiptBody);
    await tx`insert into checks (id, commitment_id, commitment_version_id, method_id, method_version, from_block, to_block, outcome, status, final, computed_value, providers, receipt_id, finished_at)
             values (${checkId}, ${commitmentId}, ${version.id}, ${spec.method_id}, ${result.method_version}, ${collected.windowFromBlock.toString()}, ${collected.evidence.finalizedBlock.toString()},
                     ${result.outcome}, ${decision.status}, ${decision.final}, ${result.computed_value}, ${tx.json(receiptBody.providers)}, ${receipt.id}, now())`;
    if (evidenceList.length) {
      const violatingKeys = new Set(result.violating.map((t) => `${t.txHash}:${t.logIndex}`));
      const rows = evidenceList.map((t) => ({
        id: newId("ke"),
        check_id: checkId,
        chain_id: spec.chain_id,
        tx_hash: t.txHash.toLowerCase(),
        log_index: t.logIndex,
        block_number: t.blockNumber.toString(),
        block_time: new Date(t.blockTime * 1000),
        from_addr: t.from.toLowerCase(),
        to_addr: t.to.toLowerCase(),
        amount: t.amount.toString(),
        kind: violatingKeys.has(`${t.txHash}:${t.logIndex}`) ? "violating" : "counted",
      }));
      await tx`insert into evidence_events ${tx(rows)}`;
    }
    const changed = locked.status !== decision.status || locked.final !== decision.final;
    if (changed) {
      await tx`insert into status_changes (id, commitment_id, from_status, to_status, final, receipt_id, reason)
               values (${newId("ksc")}, ${commitmentId}, ${locked.status}, ${decision.status}, ${decision.final}, ${receipt.id}, ${decision.reason})`;
      const type =
        decision.status === "breached" ? "commitment.condition_failed" : decision.status === "verified" && decision.final ? "commitment.satisfied" : "commitment.status_changed";
      await enqueue(tx, type, commitmentId, `${commitmentId}:${type}:${decision.status}:${decision.final}:${collected.evidence.finalizedBlock}`, {
        commitment_id: commitmentId,
        from: locked.status,
        to: decision.status,
        final: decision.final,
        reason: decision.reason,
        receipt_id: receipt.id,
      });
      if (type !== "commitment.status_changed") {
        await enqueue(tx, "commitment.status_changed", commitmentId, `${commitmentId}:status:${decision.status}:${decision.final}:${collected.evidence.finalizedBlock}`, {
          commitment_id: commitmentId,
          from: locked.status,
          to: decision.status,
          final: decision.final,
          reason: decision.reason,
          receipt_id: receipt.id,
        });
      }
    }
    for (const w of result.warnings.filter((x) => x.code === "UNFINALIZED_OUTFLOW")) {
      await enqueue(tx, "transfer.detected", commitmentId, `${commitmentId}:transfer:${w.txHash}`, { commitment_id: commitmentId, tx_hash: w.txHash, detail: w.detail });
    }
    const nextIn = decision.final ? 86_400 * 365 : collected.complete && !confirmation.inProgress ? bundle.commitment.check_interval_s : 60;
    await tx`update commitments set status = ${decision.status}, final = ${decision.final}, status_reason = ${decision.reason},
               last_checked_at = now(), next_check_at = now() + make_interval(secs => ${nextIn}), checking_since = null
             where id = ${commitmentId}`;
    return { checkId, receipt, decision, changed };
  });
}

/** Takes the commitment's check lease (the same one the worker uses), so a manual check never runs alongside a scheduled one. */
export async function claimForCheck(commitmentId: string, sql: Sql = db()): Promise<"claimed" | "busy" | "missing"> {
  const rows = await sql<{ id: string }[]>`
    update commitments set checking_since = now()
    where id = ${commitmentId} and (checking_since is null or checking_since < now() - interval '10 minutes')
    returning id`;
  if (rows.length) return "claimed";
  const [c] = await sql<{ id: string }[]>`select id from commitments where id = ${commitmentId}`;
  return c ? "busy" : "missing";
}

/** Starts a check as a background job. */
export async function startCheckJob(commitmentId: string, trigger: string, defer: Defer, sql: Sql = db()): Promise<{ id: string; poll: string } | null> {
  const claim = await claimForCheck(commitmentId, sql);
  if (claim === "missing") throw new NotFound("commitment not found");
  if (claim === "busy") return null;
  return startJob("check", commitmentId, async () => {
    const r = await runCheck(commitmentId, { sql, trigger });
    return { check_id: r.checkId, status: r.decision.status, final: r.decision.final, reason: r.decision.reason, changed: r.changed, receipt_id: r.receipt.id, receipt_sha256: r.receipt.sha256 };
  }, defer, sql);
}

export async function enqueue(tx: Q, type: string, commitmentId: string | null, dedupeKey: string, payload: object): Promise<void> {
  await tx`insert into outbox (event_type, commitment_id, payload, dedupe_key) values (${type}, ${commitmentId}, ${tx.json(payload as never)}, ${dedupeKey})
           on conflict (dedupe_key) do nothing`;
}
