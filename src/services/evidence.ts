/**
 * Evidence collection for a commitment spec. Logs are cached content-addressed in
 * transfer_cache; scan_cursors remember which block ranges have been scanned for each
 * (token, from-address), so each check only reads new blocks. A long initial backfill is spread
 * over several checks; until it completes the check is "as of" the highest scanned block.
 */
import type { ChainAdapter } from "@/chain/adapter";
import { getChain } from "@/chain";
import type { CommitmentSpec, Evidence, Transfer } from "@/core/types";
import { db, type Sql } from "@/db/client";

export const MAX_SCAN_BLOCKS_PER_CHECK = BigInt(process.env.KEPT_MAX_SCAN_BLOCKS ?? 3_000_000);
/** Each scan step covers at most this many blocks, and the cursor is saved after every step. */
const SCAN_STEP = BigInt(process.env.KEPT_SCAN_STEP_BLOCKS ?? 250_000);
/** Wall-clock budget per check for scanning; the rest resumes on the next check. */
export const SCAN_TIME_BUDGET_MS = Number(process.env.KEPT_SCAN_TIME_BUDGET_MS ?? 45_000);

export { watchedAddresses } from "@/core/methods";
import { watchedAddresses } from "@/core/methods";

export interface CollectedEvidence {
  evidence: Evidence;
  complete: boolean;
  scannedTo: bigint;
  /** When incomplete: every cached transfer in the window so far (any range). Outflow sums only grow, so a violation here is real. */
  partialTransfers: Transfer[];
  windowFromBlock: bigint;
  providerName: string;
}

interface Cursor {
  scanned_from: bigint;
  scanned_to: bigint;
}

async function cursorFor(sql: Sql, chainId: number, token: string, addr: string): Promise<Cursor | null> {
  const rows = await sql<Cursor[]>`
    select scanned_from, scanned_to from scan_cursors
    where chain_id = ${chainId} and token = ${token.toLowerCase()} and from_addr = ${addr.toLowerCase()}`;
  return rows[0] ?? null;
}

async function storeTransfers(sql: Sql, chainId: number, transfers: Transfer[]): Promise<void> {
  if (!transfers.length) return;
  const rows = transfers.map((t) => ({
    chain_id: chainId,
    tx_hash: t.txHash.toLowerCase(),
    log_index: t.logIndex,
    token: t.token.toLowerCase(),
    from_addr: t.from.toLowerCase(),
    to_addr: t.to.toLowerCase(),
    amount: t.amount.toString(),
    block_number: t.blockNumber.toString(),
    block_time: t.blockTime,
  }));
  await sql`insert into transfer_cache ${sql(rows)} on conflict do nothing`;
}

async function saveCursor(sql: Sql, chainId: number, token: string, addr: string, from: bigint, to: bigint) {
  await sql`
    insert into scan_cursors (chain_id, token, from_addr, scanned_from, scanned_to)
    values (${chainId}, ${token.toLowerCase()}, ${addr.toLowerCase()}, ${from.toString()}, ${to.toString()})
    on conflict (chain_id, token, from_addr) do update
      set scanned_from = least(scan_cursors.scanned_from, excluded.scanned_from),
          scanned_to = greatest(scan_cursors.scanned_to, excluded.scanned_to),
          updated_at = now()`;
}

/**
 * Brings the cache for one address up to `target`, scanning at most `budget` blocks, and returns
 * the highest block covered contiguously from `fromBlock` (or fromBlock - 1 if not yet).
 * The cursor is always one contiguous range: history is backfilled backwards from its start,
 * new blocks are appended forwards from its end.
 */
async function scanAddress(
  sql: Sql,
  adapter: ChainAdapter,
  token: `0x${string}`,
  addr: `0x${string}`,
  fromBlock: bigint,
  target: bigint,
  budget: { remaining: bigint; deadline: number },
): Promise<bigint> {
  const chainId = adapter.chainId;
  const scan = async (a: bigint, b: bigint) => {
    const found = await adapter.getTransfers({ token, from: [addr], fromBlock: a, toBlock: b });
    await storeTransfers(sql, chainId, found);
    budget.remaining -= b - a + 1n;
  };
  // A step is the smaller of the block budget and SCAN_STEP; stop between steps once out of time.
  const step = () => (budget.remaining < SCAN_STEP ? budget.remaining : SCAN_STEP);
  const canScan = () => budget.remaining > 0n && Date.now() < budget.deadline;
  const cur = await cursorFor(sql, chainId, token, addr);
  let from: bigint;
  let to: bigint;
  if (!cur) {
    if (!canScan()) return fromBlock - 1n;
    const b = fromBlock + step() - 1n < target ? fromBlock + step() - 1n : target;
    await scan(fromBlock, b);
    await saveCursor(sql, chainId, token, addr, fromBlock, b);
    from = fromBlock;
    to = b;
  } else {
    from = BigInt(cur.scanned_from);
    to = BigInt(cur.scanned_to);
  }
  while (from > fromBlock && canScan()) {
    const a = from - step() > fromBlock ? from - step() : fromBlock;
    await scan(a, from - 1n);
    await saveCursor(sql, chainId, token, addr, a, to);
    from = a;
  }
  while (from <= fromBlock && to < target && canScan()) {
    const b = to + step() < target ? to + step() : target;
    await scan(to + 1n, b);
    await saveCursor(sql, chainId, token, addr, from, b);
    to = b;
  }
  return from <= fromBlock ? (to < target ? to : target) : fromBlock - 1n;
}

export async function cachedTransfers(sql: Sql, chainId: number, token: string, addrs: string[], fromBlock: bigint, toBlock: bigint): Promise<Transfer[]> {
  const rows = await sql<{ tx_hash: string; log_index: number; token: string; from_addr: string; to_addr: string; amount: string; block_number: string; block_time: string }[]>`
    select tx_hash, log_index, token, from_addr, to_addr, amount::text, block_number::text, block_time::text
    from transfer_cache
    where chain_id = ${chainId} and token = ${token.toLowerCase()}
      and from_addr in ${sql(addrs.map((a) => a.toLowerCase()))}
      and block_number between ${fromBlock.toString()} and ${toBlock.toString()}
    order by block_number, log_index`;
  return rows.map((r) => ({
    txHash: r.tx_hash as `0x${string}`,
    logIndex: r.log_index,
    blockNumber: BigInt(r.block_number),
    blockTime: Number(r.block_time),
    token: r.token as `0x${string}`,
    from: r.from_addr as `0x${string}`,
    to: r.to_addr as `0x${string}`,
    amount: BigInt(r.amount),
  }));
}

/** Window start block, cached in-process (block times never change). */
const startBlockCache = new Map<string, bigint>();
async function windowBlock(adapter: ChainAdapter, iso: string): Promise<bigint> {
  const key = `${adapter.chainId}:${iso}`;
  const hit = startBlockCache.get(key);
  if (hit !== undefined) return hit;
  const ts = Math.floor(Date.parse(iso) / 1000);
  const n = (await adapter.blockAtOrBefore(ts)) + 1n;
  startBlockCache.set(key, n);
  return n;
}

export async function collectEvidence(spec: CommitmentSpec, opts: { sql?: Sql; adapter?: ChainAdapter; includeUnfinalized?: boolean; budgetBlocks?: bigint; timeBudgetMs?: number } = {}): Promise<CollectedEvidence> {
  const sql = opts.sql ?? db();
  const adapter = opts.adapter ?? getChain(spec.chain_id).primary;
  const token = spec.token.address as `0x${string}`;
  const [fin, latest] = await Promise.all([adapter.finalizedBlock(), adapter.latestBlock()]);
  const windowStartTs = Math.floor(Date.parse(spec.window.start) / 1000);
  const windowEndTs = Math.floor(Date.parse(spec.window.end) / 1000);

  if (fin.timestamp < windowStartTs) {
    return {
      evidence: { finalizedBlock: fin.number, finalizedTime: fin.timestamp, latestBlock: latest.number, fromBlock: fin.number, transfers: [], unfinalizedTransfers: [], vesting: null, asOf: fin.timestamp },
      complete: true,
      scannedTo: fin.number,
      partialTransfers: [],
      windowFromBlock: fin.number,
      providerName: adapter.name,
    };
  }

  const fromBlock = await windowBlock(adapter, spec.window.start);
  // Burns and locks never count transfers after the window; vesting releases can be checked to the end too.
  const endBlock = fin.timestamp > windowEndTs ? await windowBlock(adapter, spec.window.end) : fin.number;
  const target = endBlock < fin.number ? endBlock : fin.number;
  const addrs = watchedAddresses(spec);
  const budget = { remaining: opts.budgetBlocks ?? MAX_SCAN_BLOCKS_PER_CHECK, deadline: Date.now() + (opts.timeBudgetMs ?? SCAN_TIME_BUDGET_MS) };
  let covered = target;
  for (const a of addrs) {
    const c = await scanAddress(sql, adapter, token, a, fromBlock, target, budget);
    if (c < covered) covered = c;
  }
  const complete = covered >= target;
  const asOfBlock = complete ? fin.number : covered;
  const asOfTime = complete ? fin.timestamp : covered >= fromBlock ? await blockTimeOf(adapter, covered) : windowStartTs;
  const transfers = covered >= fromBlock ? await cachedTransfers(sql, adapter.chainId, token, addrs, fromBlock, covered) : [];
  const partialTransfers = complete ? [] : await cachedTransfers(sql, adapter.chainId, token, addrs, fromBlock, target);

  let unfinalized: Transfer[] = [];
  if (complete && opts.includeUnfinalized !== false && spec.method_id === "erc20_outflow_v1" && latest.number > fin.number && latest.timestamp < windowEndTs) {
    unfinalized = await adapter.getTransfers({ token, from: addrs, fromBlock: fin.number + 1n, toBlock: latest.number }).catch(() => []);
  }
  const vesting = spec.vesting ? await adapter.readVesting(spec.vesting.contract as `0x${string}`, token, asOfBlock).catch(() => null) : null;

  return {
    evidence: {
      finalizedBlock: asOfBlock,
      finalizedTime: asOfTime,
      latestBlock: latest.number,
      fromBlock,
      transfers,
      unfinalizedTransfers: unfinalized,
      vesting,
      asOf: asOfTime,
    },
    complete,
    scannedTo: covered,
    partialTransfers,
    windowFromBlock: fromBlock,
    providerName: adapter.name,
  };
}

async function blockTimeOf(adapter: ChainAdapter, n: bigint): Promise<number> {
  const a = adapter as ChainAdapter & { blockTime?: (n: bigint) => Promise<number> };
  if (a.blockTime) return a.blockTime(n);
  return (await adapter.finalizedBlock()).timestamp;
}
