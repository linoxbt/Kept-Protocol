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
import type { ReceiptBody } from "@/receipts/receipt";
import { loadCommitment } from "./commitments";
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

const MAX_CONFIRM_RESCAN_BLOCKS = 500_000n;

export async function confirmViolation(spec: CommitmentSpec, result: MethodResult, collected: CollectedEvidence, confirm: ChainAdapter): Promise<{ confirmation: ProviderConfirmation; detail: string }> {
  if (result.outcome !== "violated") return { confirmation: "not_needed", detail: "no violation to confirm" };
  try {
    if (result.violating.length > 0) {
      const sample = result.violating.slice(0, 3);
      const ok = await Promise.all(sample.map((t) => confirm.confirmTransfer(t)));
      return ok.every(Boolean)
        ? { confirmation: "confirmed", detail: `${sample.length} violating transfer(s) independently confirmed at finalized blocks` }
        : { confirmation: "disagreed", detail: "the confirmation provider could not reproduce a violating transfer" };
    }
    // A shortfall (absence of burns) is confirmed by recounting on the second provider.
    const span = collected.evidence.finalizedBlock - collected.windowFromBlock;
    if (span > MAX_CONFIRM_RESCAN_BLOCKS) return { confirmation: "unavailable", detail: "period too long for an independent recount on the confirmation provider" };
    const recount = await confirm.getTransfers({
      token: spec.token.address as `0x${string}`,
      from: watchedAddresses(spec),
      fromBlock: collected.windowFromBlock,
      toBlock: collected.evidence.finalizedBlock,
    });
    const again = runMethod(spec, { ...collected.evidence, transfers: recount });
    return again.computed_value === result.computed_value
      ? { confirmation: "confirmed", detail: "shortfall recounted independently" }
      : { confirmation: "disagreed", detail: `confirmation provider counted ${again.computed_value}, primary ${result.computed_value}` };
  } catch (e) {
    return { confirmation: "unavailable", detail: `confirmation provider error: ${e instanceof Error ? e.message : e}` };
  }
}

export interface Evaluation {
  result: MethodResult;
  decision: StatusDecision;
  collected: CollectedEvidence;
  confirmation: { confirmation: ProviderConfirmation; detail: string };
}

/** Evidence + method + confirmation + status. No writes except the log cache. */
export async function evaluate(spec: CommitmentSpec, sql: Sql = db(), opts: { budgetBlocks?: bigint } = {}): Promise<Evaluation> {
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
        confirmation: { confirmation: "not_needed", detail: "backfill in progress" },
        decision: { status: "pending", final: false, reason: `Backfilling chain evidence: ${pct}% of the window scanned (to block ${collected.scannedTo}).` },
      };
    }
  }
  const confirmation = await confirmViolation(spec, result, collected, chain.confirm);
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
  const { commitment, version, snapshot, source } = bundle;
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
  const { result, decision, collected, confirmation } = evaluation;
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
    const nextIn = decision.final ? 86_400 * 365 : collected.complete ? bundle.commitment.check_interval_s : 60;
    await tx`update commitments set status = ${decision.status}, final = ${decision.final}, status_reason = ${decision.reason},
               last_checked_at = now(), next_check_at = now() + make_interval(secs => ${nextIn}), checking_since = null
             where id = ${commitmentId}`;
    return { checkId, receipt, decision, changed };
  });
}

export async function enqueue(tx: Q, type: string, commitmentId: string | null, dedupeKey: string, payload: object): Promise<void> {
  await tx`insert into outbox (event_type, commitment_id, payload, dedupe_key) values (${type}, ${commitmentId}, ${tx.json(payload as never)}, ${dedupeKey})
           on conflict (dedupe_key) do nothing`;
}
