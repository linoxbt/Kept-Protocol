/**
 * Onchain anchoring. All receipts not yet anchored are hashed into a Merkle root, which is
 * attested on Base through EAS (predeploy 0x4200…0021). Each receipt then records its anchor and
 * leaf index, so anyone can check inclusion. Receipts are only marked anchored after the
 * attestation transaction succeeds.
 */
import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, encodeFunctionData, encodePacked, http, keccak256, parseAbi, parseAbiParameters, zeroAddress, zeroHash, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { db, type Sql } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { merkleProof, merkleRoot } from "@/receipts/merkle";

export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;
export const ANCHOR_SCHEMA = "bytes32 merkleRoot,uint32 receiptCount,string anchorId";

const easAbi = parseAbi([
  "struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }",
  "struct AttestationRequest { bytes32 schema; AttestationRequestData data; }",
  "function attest(AttestationRequest request) payable returns (bytes32)",
  "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)",
]);
const registryAbi = parseAbi([
  "function register(string schema, address resolver, bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))",
]);

/** EAS schema UIDs are deterministic: keccak256(abi.encodePacked(schema, resolver, revocable)). */
export function schemaUid(schema = ANCHOR_SCHEMA): Hex {
  return keccak256(encodePacked(["string", "address", "bool"], [schema, zeroAddress, false]));
}

function chainFor(chainId: number): { chain: Chain; rpc: string } {
  if (chainId === 8453) return { chain: base, rpc: env().BASE_RPC_URL };
  if (chainId === 84532) return { chain: baseSepolia, rpc: env().BASE_SEPOLIA_RPC_URL };
  throw new Error(`anchoring not supported on chain ${chainId}`);
}

export async function registerAnchorSchema(chainId: number): Promise<{ uid: Hex; tx: Hex | null }> {
  const key = env().ANCHOR_PRIVATE_KEY;
  if (!key) throw new Error("ANCHOR_PRIVATE_KEY is not set");
  const { chain, rpc } = chainFor(chainId);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const uid = schemaUid();
  const existing = await pub.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: registryAbi, functionName: "getSchema", args: [uid] });
  if (existing.uid !== zeroHash) return { uid, tx: null };
  const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(key as Hex) });
  const tx = await wallet.writeContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: registryAbi, functionName: "register", args: [ANCHOR_SCHEMA, zeroAddress, false] });
  await pub.waitForTransactionReceipt({ hash: tx });
  return { uid, tx };
}

export interface PendingRoot {
  root: string | null;
  count: number;
  receiptIds: string[];
  leaves: string[];
}

export async function pendingRoot(sql: Sql = db(), limit = 10_000): Promise<PendingRoot> {
  // Receipts already in an attempt that may still land onchain are not offered again.
  const rows = await sql<{ id: string; sha256: string }[]>`
    select id, sha256 from receipts
    where anchor_id is null and not exists (select 1 from anchor_attempts a where receipts.id = any(a.receipt_ids))
    order by created_at, id limit ${limit}`;
  if (!rows.length) return { root: null, count: 0, receiptIds: [], leaves: [] };
  const leaves = rows.map((r) => r.sha256);
  return { root: merkleRoot(leaves), count: rows.length, receiptIds: rows.map((r) => r.id), leaves };
}

/**
 * Runs `fn` only if this process gets the advisory lock. The lock is a session lock, so it is taken
 * and released on one reserved connection (on a pool, the unlock could otherwise land on another
 * connection and silently fail, leaving the lock held).
 */
export async function withSessionLock<T>(sql: Sql, lockId: number, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const conn = await sql.reserve();
  try {
    const [lock] = await conn<{ ok: boolean }[]>`select pg_try_advisory_lock(${lockId}) as ok`;
    if (!lock.ok) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await conn`select pg_advisory_unlock(${lockId})`.catch(() => {});
    }
  } finally {
    conn.release();
  }
}

interface AttemptRow {
  id: string;
  chain_id: number;
  merkle_root: string;
  receipt_ids: string[];
  tx_hash: string;
  created_at: Date;
}

type AnchorResult = { anchorId: string; root: string; count: number; tx: Hex; uid: Hex };

/** Writes the immutable anchors row and assigns the receipts, once the attestation is onchain. */
async function finalizeAttempt(sql: Sql, a: AttemptRow, logs: readonly { data: Hex; topics: readonly Hex[] }[]): Promise<AnchorResult> {
  let uid: Hex = zeroHash;
  for (const log of logs) {
    try {
      const d = decodeEventLog({ abi: easAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (d.eventName === "Attested") uid = d.args.uid;
    } catch {
      /* other logs */
    }
  }
  await sql.begin(async (tx) => {
    await tx`insert into anchors (id, merkle_root, receipt_count, chain_id, eas_uid, tx_hash) values (${a.id}, ${a.merkle_root}, ${a.receipt_ids.length}, ${a.chain_id}, ${uid}, ${a.tx_hash})`;
    for (const [i, id] of a.receipt_ids.entries()) {
      await tx`update receipts set anchor_id = ${a.id}, leaf_index = ${i} where id = ${id} and anchor_id is null`;
    }
    await tx`delete from anchor_attempts where id = ${a.id}`;
  });
  return { anchorId: a.id, root: a.merkle_root, count: a.receipt_ids.length, tx: a.tx_hash as Hex, uid };
}

/** True only for viem's definite "no such transaction" answers, never for an RPC outage. */
function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  return name === "TransactionReceiptNotFoundError" || name === "TransactionNotFoundError";
}

/** An attempt whose transaction has not appeared after this long was dropped; its receipts are offered again. */
const ATTEMPT_DROPPED_AFTER_MS = 30 * 60_000;

/**
 * Settles attempts left by an earlier run (a crash or RPC timeout after broadcasting): finalize the
 * ones that landed, drop the ones that reverted or never appeared. Nothing is attested twice.
 */
async function reconcileAttempts(sql: Sql, pub: { getTransactionReceipt: (a: { hash: Hex }) => Promise<{ status: string; logs: readonly { data: Hex; topics: readonly Hex[] }[] }> }, chainId: number): Promise<AnchorResult[]> {
  const done: AnchorResult[] = [];
  const attempts = await sql<AttemptRow[]>`select * from anchor_attempts where chain_id = ${chainId} order by created_at`;
  for (const a of attempts) {
    let receipt: Awaited<ReturnType<typeof pub.getTransactionReceipt>> | null = null;
    try {
      receipt = await pub.getTransactionReceipt({ hash: a.tx_hash as Hex });
    } catch (e) {
      if (!isNotFound(e)) continue; // RPC trouble: decide on a later run, never drop on an outage
    }
    if (receipt?.status === "success") done.push(await finalizeAttempt(sql, a, receipt.logs));
    else if (receipt || Date.now() - a.created_at.getTime() > ATTEMPT_DROPPED_AFTER_MS) await sql`delete from anchor_attempts where id = ${a.id}`;
  }
  return done;
}

/**
 * Attests the Merkle root of every unanchored receipt on EAS. Exactly one run at a time across
 * every process (worker, cron route, CLI). The signed transaction's hash is recorded with its
 * receipt set BEFORE it is broadcast, so a crash or timeout at any point is reconciled by hash on
 * the next run instead of attesting the same receipts again.
 */
export async function anchorPending(sql: Sql = db(), chainId = anchorChainId()): Promise<AnchorResult | null> {
  const key = env().ANCHOR_PRIVATE_KEY;
  if (!key) throw new Error("ANCHOR_PRIVATE_KEY is not set; anchoring is disabled");
  const r = await withSessionLock(sql, ANCHOR_LOCK, async () => {
    const { chain, rpc } = chainFor(chainId);
    const pub = createPublicClient({ chain, transport: http(rpc) });
    // Schema registration shares the lock (and so the operator's nonce) with attestations.
    if (!env().EAS_SCHEMA_UID) await registerAnchorSchema(chainId);
    const reconciled = await reconcileAttempts(sql, pub, chainId);
    const pending = await pendingRoot(sql);
    if (!pending.root) return reconciled.at(-1) ?? null;
    const anchorId = newId("ka");
    const account = privateKeyToAccount(key as Hex);
    const wallet = createWalletClient({ chain, transport: http(rpc), account });
    const schema = (env().EAS_SCHEMA_UID as Hex | undefined) ?? schemaUid();
    const data = encodeAbiParameters(parseAbiParameters("bytes32, uint32, string"), [`0x${pending.root}`, pending.count, anchorId]);
    const request = await wallet.prepareTransactionRequest({
      account,
      chain,
      to: EAS_ADDRESS,
      data: encodeFunctionData({ abi: easAbi, functionName: "attest", args: [{ schema, data: { recipient: zeroAddress, expirationTime: 0n, revocable: false, refUID: zeroHash, data, value: 0n } }] }),
    });
    const serialized = await wallet.signTransaction(request);
    const txHash = keccak256(serialized);
    await sql`insert into anchor_attempts (id, chain_id, merkle_root, receipt_ids, tx_hash) values (${anchorId}, ${chainId}, ${pending.root}, ${pending.receiptIds}, ${txHash})`;
    try {
      await wallet.sendRawTransaction({ serializedTransaction: serialized });
    } catch (e) {
      // Not broadcast (or rejected outright): release the receipts now rather than in 30 minutes.
      // Release now only if the node definitely does not know the transaction; otherwise the next
      // run reconciles it by hash (it may still land).
      const known = await pub.getTransaction({ hash: txHash }).then(() => true, (err) => !isNotFound(err));
      if (!known) await sql`delete from anchor_attempts where id = ${anchorId}`;
      throw e;
    }
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    const attempt: AttemptRow = { id: anchorId, chain_id: chainId, merkle_root: pending.root, receipt_ids: pending.receiptIds, tx_hash: txHash, created_at: new Date() };
    if (receipt.status !== "success") {
      await sql`delete from anchor_attempts where id = ${anchorId}`;
      throw new Error(`attestation transaction ${txHash} failed`);
    }
    return finalizeAttempt(sql, attempt, receipt.logs);
  });
  if (!r.ran) throw new AnchorBusy();
  return r.value;
}

export class AnchorBusy extends Error {
  constructor() {
    super("another process is anchoring");
  }
}

const MIN_ANCHOR_BALANCE_WEI = 5_000_000_000_000n; // 0.000005 ETH: several Base attestations
const ANCHOR_LOCK = 7_310_001; // pg advisory lock id: one anchoring run at a time across processes

export function anchorChainId(): number {
  return Number(process.env.ANCHOR_CHAIN_ID ?? 8453);
}

export function operatorAddress(): Hex | null {
  const key = env().ANCHOR_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex).address : null;
}

export interface AnchorStatus {
  chain_id: number;
  operator: string | null;
  schema_uid: string;
  balance_wei: string | null;
  funded: boolean;
  pending_receipts: number;
  last_anchor: { id: string; tx_hash: string; anchored_at: string; receipt_count: number } | null;
}

let statusCache: { at: number; value: AnchorStatus } | null = null;

/** Operator address, balance and anchoring progress. Balance is cached for a minute. */
export async function anchorStatus(sql: Sql = db()): Promise<AnchorStatus> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  const chainId = anchorChainId();
  const operator = operatorAddress();
  let balance: bigint | null = null;
  if (operator) {
    const { chain, rpc } = chainFor(chainId);
    balance = await createPublicClient({ chain, transport: http(rpc) }).getBalance({ address: operator }).catch(() => null);
  }
  const [p] = await sql<{ n: number }[]>`select count(*)::int as n from receipts where anchor_id is null`;
  const [last] = await sql<{ id: string; tx_hash: string; anchored_at: Date; receipt_count: number }[]>`select id, tx_hash, anchored_at, receipt_count from anchors order by anchored_at desc limit 1`;
  const value: AnchorStatus = {
    chain_id: chainId,
    operator,
    schema_uid: (env().EAS_SCHEMA_UID as string | undefined) ?? schemaUid(),
    balance_wei: balance === null ? null : balance.toString(),
    funded: balance !== null && balance >= MIN_ANCHOR_BALANCE_WEI,
    pending_receipts: p.n,
    last_anchor: last ? { id: last.id, tx_hash: last.tx_hash, anchored_at: last.anchored_at.toISOString(), receipt_count: last.receipt_count } : null,
  };
  statusCache = { at: Date.now(), value };
  return value;
}

/**
 * Called from every monitor tick. Anchors pending receipts when the operator key is funded and
 * either ANCHOR_INTERVAL_S (default 6 h) has passed since the last anchor or 500 receipts wait.
 * Registers the EAS schema on first use. Never throws: anchoring must not stop monitoring.
 */
export async function autoAnchor(sql: Sql = db()): Promise<{ anchored: number; skipped?: string; tx?: string }> {
  try {
    if (!operatorAddress()) return { anchored: 0, skipped: "no operator key" };
    statusCache = null;
    const st = await anchorStatus(sql);
    if (!st.pending_receipts) return { anchored: 0, skipped: "nothing pending" };
    if (!st.funded) return { anchored: 0, skipped: `operator ${st.operator} is not funded on chain ${st.chain_id}` };
    const interval = Number(process.env.ANCHOR_INTERVAL_S ?? 6 * 3600) * 1000;
    const due = !st.last_anchor || Date.now() - Date.parse(st.last_anchor.anchored_at) >= interval || st.pending_receipts >= 500;
    if (!due) return { anchored: 0, skipped: "not due" };
    const r = await anchorPending(sql, st.chain_id);
    statusCache = null;
    return r ? { anchored: r.count, tx: r.tx } : { anchored: 0, skipped: "nothing pending" };
  } catch (e) {
    if (e instanceof AnchorBusy) return { anchored: 0, skipped: "another process is anchoring" };
    return { anchored: 0, skipped: `anchoring failed: ${e instanceof Error ? e.message.slice(0, 200) : e}` };
  }
}

export async function inclusionProof(receiptId: string, sql: Sql = db()) {
  const [r] = await sql<{ anchor_id: string | null; leaf_index: number | null; sha256: string }[]>`select anchor_id, leaf_index, sha256 from receipts where id = ${receiptId}`;
  if (!r?.anchor_id || r.leaf_index === null) return null;
  const [a] = await sql<{ id: string; merkle_root: string; chain_id: number; eas_uid: string; tx_hash: string; anchored_at: Date }[]>`select * from anchors where id = ${r.anchor_id}`;
  const leaves = (await sql<{ sha256: string }[]>`select sha256 from receipts where anchor_id = ${r.anchor_id} order by leaf_index`).map((x) => x.sha256);
  return { anchor: a, leaf: r.sha256, leaf_index: r.leaf_index, proof: merkleProof(leaves, r.leaf_index) };
}
