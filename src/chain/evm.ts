/**
 * EVM chain adapter over viem. The RPC provider is the source of truth for logs and state.
 * Log queries are chunked adaptively: the adapter learns each provider's maximum block range
 * from its error message and retries smaller ranges on failure.
 */
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type PublicClient,
} from "viem";
import type { Transfer, VestingReads } from "@/core/types";
import type { BlockRef, ChainAdapter, TransferQuery } from "./adapter";

export const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const vestingAbi = parseAbi([
  "function start() view returns (uint256)",
  "function duration() view returns (uint256)",
  "function cliff() view returns (uint256)",
  "function owner() view returns (address)",
  "function beneficiary() view returns (address)",
  "function released(address token) view returns (uint256)",
]);

interface RawLog {
  address: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: `0x${string}`;
  blockTimestamp?: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: `0x${string}`;
  removed?: boolean;
}

export interface EvmAdapterOptions {
  chainId: number;
  name: string;
  rpcUrl: string;
  /** Upper bound on blocks per eth_getLogs call; lowered automatically when the provider refuses. */
  maxRange?: bigint;
  /** Pause between log chunks, to stay inside free-tier rate limits. */
  chunkDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EvmAdapter implements ChainAdapter {
  readonly chainId: number;
  readonly name: string;
  private client: PublicClient;
  private rpcUrl: string;
  private maxRange: bigint;
  private chunkDelayMs: number;
  private blockTimes = new Map<bigint, number>();

  constructor(opts: EvmAdapterOptions) {
    this.chainId = opts.chainId;
    this.name = opts.name;
    this.rpcUrl = opts.rpcUrl;
    this.maxRange = opts.maxRange ?? 10_000n;
    this.chunkDelayMs = opts.chunkDelayMs ?? 0;
    this.client = createPublicClient({ transport: http(opts.rpcUrl, { retryCount: 3, retryDelay: 400, timeout: 20_000 }) }) as PublicClient;
  }

  async finalizedBlock(): Promise<BlockRef> {
    const b = await this.client.getBlock({ blockTag: "finalized" });
    return { number: b.number!, timestamp: Number(b.timestamp) };
  }

  async latestBlock(): Promise<BlockRef> {
    const b = await this.client.getBlock({ blockTag: "latest" });
    return { number: b.number!, timestamp: Number(b.timestamp) };
  }

  async blockTime(n: bigint): Promise<number> {
    const hit = this.blockTimes.get(n);
    if (hit !== undefined) return hit;
    const b = await this.client.getBlock({ blockNumber: n });
    const t = Number(b.timestamp);
    if (this.blockTimes.size > 5000) this.blockTimes.clear();
    this.blockTimes.set(n, t);
    return t;
  }

  /** Highest block with timestamp <= ts. Interpolation search, then binary search. */
  async blockAtOrBefore(timestamp: number): Promise<bigint> {
    const latest = await this.latestBlock();
    if (timestamp >= latest.timestamp) return latest.number;
    let lo = 0n;
    let hi = latest.number;
    let loT = await this.blockTime(0n);
    let hiT = latest.timestamp;
    if (timestamp < loT) return 0n;
    for (let i = 0; i < 64 && hi - lo > 1n; i++) {
      let mid: bigint;
      if (i < 6 && hiT > loT) {
        const frac = (timestamp - loT) / (hiT - loT);
        mid = lo + BigInt(Math.floor(Number(hi - lo) * frac));
        if (mid <= lo) mid = lo + 1n;
        if (mid >= hi) mid = hi - 1n;
      } else {
        mid = (lo + hi) / 2n;
      }
      const t = await this.blockTime(mid);
      if (t <= timestamp) {
        lo = mid;
        loT = t;
      } else {
        hi = mid;
        hiT = t;
      }
    }
    return lo;
  }

  private async rawLogs(params: object): Promise<RawLog[]> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [params] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, res.status === 429);
    const json = (await res.json()) as { result?: RawLog[]; error?: { message: string; code: number } };
    if (json.error) throw new RpcError(json.error.message, /limit|rate|too many/i.test(json.error.message));
    return json.result ?? [];
  }

  async getTransfers(q: TransferQuery, onProgress?: (scannedTo: bigint) => void): Promise<Transfer[]> {
    if (q.from.length === 0 || q.toBlock < q.fromBlock) return [];
    const fromTopics = q.from.map((a) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`);
    const out: Transfer[] = [];
    let cursor = q.fromBlock;
    let range = this.maxRange;
    let failures = 0;
    while (cursor <= q.toBlock) {
      const end = cursor + range - 1n > q.toBlock ? q.toBlock : cursor + range - 1n;
      try {
        const logs = await this.rawLogs({
          address: q.token,
          topics: [TRANSFER_TOPIC, fromTopics],
          fromBlock: `0x${cursor.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
        });
        for (const log of logs) {
          if (log.removed) continue;
          out.push(await this.decode(log));
        }
        onProgress?.(end);
        cursor = end + 1n;
        failures = 0;
        if (this.chunkDelayMs) await sleep(this.chunkDelayMs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const cap = /maximum block range:?\s*(\d+)|over\s+(\d+)\s+blocks|range.*?(\d{4,})/i.exec(msg);
        if (cap) {
          const n = BigInt(cap[1] ?? cap[2] ?? cap[3]);
          if (n < range) {
            range = n;
            this.maxRange = n;
            continue;
          }
        }
        failures++;
        if (e instanceof RpcError && e.rateLimited) await sleep(Math.min(30_000, 1000 * 2 ** failures));
        else if (range > 100n) range = range / 2n;
        if (failures > 6) throw new Error(`eth_getLogs failed on ${this.name} at block ${cursor}: ${msg}`);
      }
    }
    return out;
  }

  private async decode(log: RawLog): Promise<Transfer> {
    const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
    const blockNumber = BigInt(log.blockNumber);
    const blockTime = log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : await this.blockTime(blockNumber);
    return {
      txHash: log.transactionHash,
      logIndex: Number(BigInt(log.logIndex)),
      blockNumber,
      blockTime,
      token: getAddress(log.address),
      from: getAddress(decoded.args.from),
      to: getAddress(decoded.args.to),
      amount: decoded.args.value,
    };
  }

  async erc20Meta(token: `0x${string}`): Promise<{ symbol: string | null; decimals: number }> {
    const [decimals, symbol] = await Promise.all([
      this.client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      this.client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
    ]);
    return { decimals: Number(decimals), symbol };
  }

  async readVesting(contract: `0x${string}`, token: `0x${string}`, blockNumber?: bigint): Promise<VestingReads | null> {
    const read = <T>(functionName: string, args: unknown[] = []) =>
      this.client
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .readContract({ address: contract, abi: vestingAbi, functionName: functionName as any, args: args as any, blockNumber })
        .then((v) => v as T)
        .catch(() => null);
    const [start, duration, cliff, owner, beneficiary, released, balance] = await Promise.all([
      read<bigint>("start"),
      read<bigint>("duration"),
      read<bigint>("cliff"),
      read<`0x${string}`>("owner"),
      read<`0x${string}`>("beneficiary"),
      read<bigint>("released", [token]),
      this.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [contract], blockNumber }).catch(() => null),
    ]);
    if (start === null || duration === null) return null;
    // VestingWalletCliff returns an absolute timestamp from cliff(); store it relative to start.
    const cliffRel = cliff === null ? null : cliff > start ? Number(cliff - start) : Number(cliff);
    return {
      start: Number(start),
      duration: Number(duration),
      cliff: cliffRel,
      beneficiary: beneficiary ?? owner ?? null,
      funded: (balance ?? 0n) + (released ?? 0n),
    };
  }

  async confirmTransfer(t: Transfer): Promise<boolean> {
    const [receipt, finalized] = await Promise.all([
      this.client.getTransactionReceipt({ hash: t.txHash }).catch(() => null),
      this.finalizedBlock(),
    ]);
    if (!receipt || receipt.status !== "success" || receipt.blockNumber > finalized.number) return false;
    const log = receipt.logs.find((l) => l.logIndex === t.logIndex);
    if (!log || log.address.toLowerCase() !== t.token.toLowerCase() || log.topics[0] !== TRANSFER_TOPIC) return false;
    try {
      const d = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics });
      return (
        d.args.from.toLowerCase() === t.from.toLowerCase() &&
        d.args.to.toLowerCase() === t.to.toLowerCase() &&
        d.args.value === t.amount &&
        receipt.blockNumber === t.blockNumber
      );
    } catch {
      return false;
    }
  }

  async tokenOwner(token: `0x${string}`): Promise<`0x${string}` | null> {
    return this.client
      .readContract({ address: token, abi: parseAbi(["function owner() view returns (address)"]), functionName: "owner" })
      .catch(() => null);
  }

  getCode(address: `0x${string}`) {
    return this.client.getCode({ address });
  }
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean,
  ) {
    super(message);
  }
}
