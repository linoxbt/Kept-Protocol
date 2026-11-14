/**
 * Deterministic in-memory chain for tests and Grifter's chain-side scenarios. Block n has
 * timestamp genesis + n * secondsPerBlock. Nothing is sent to any network.
 */
import type { Transfer, VestingReads } from "@/core/types";
import type { BlockRef, ChainAdapter, TransferQuery } from "./adapter";

export class FixtureChain implements ChainAdapter {
  readonly name: string;
  transfers: Transfer[] = [];
  vesting = new Map<string, VestingReads>();
  owners = new Map<string, `0x${string}`>();
  /** Transfers this provider pretends not to know (to simulate provider disagreement). */
  hidden = new Set<string>();
  latest: bigint;
  finalized: bigint;

  constructor(
    readonly chainId = 8453,
    readonly genesis = 1_767_225_600, // 2026-01-01T00:00:00Z
    readonly secondsPerBlock = 2,
    name = "fixture",
  ) {
    this.name = name;
    this.latest = 0n;
    this.finalized = 0n;
  }

  blockAt(ts: number): bigint {
    return BigInt(Math.max(0, Math.floor((ts - this.genesis) / this.secondsPerBlock)));
  }

  timeOf(n: bigint): number {
    return this.genesis + Number(n) * this.secondsPerBlock;
  }

  /** Moves the chain head to `iso`; blocks older than `finalityLagSeconds` are finalized. */
  setNow(iso: string, finalityLagSeconds = 0): void {
    const ts = Math.floor(Date.parse(iso) / 1000);
    this.latest = this.blockAt(ts);
    this.finalized = this.blockAt(ts - finalityLagSeconds);
  }

  add(t: Omit<Transfer, "blockNumber" | "blockTime" | "logIndex"> & { at: string; logIndex?: number }): Transfer {
    const ts = Math.floor(Date.parse(t.at) / 1000);
    const tr: Transfer = {
      txHash: t.txHash,
      logIndex: t.logIndex ?? 0,
      blockNumber: this.blockAt(ts),
      blockTime: this.timeOf(this.blockAt(ts)),
      token: t.token,
      from: t.from,
      to: t.to,
      amount: t.amount,
    };
    this.transfers.push(tr);
    return tr;
  }

  async finalizedBlock(): Promise<BlockRef> {
    return { number: this.finalized, timestamp: this.timeOf(this.finalized) };
  }
  async latestBlock(): Promise<BlockRef> {
    return { number: this.latest, timestamp: this.timeOf(this.latest) };
  }
  async blockAtOrBefore(ts: number): Promise<bigint> {
    return this.blockAt(ts);
  }
  async blockTime(n: bigint): Promise<number> {
    return this.timeOf(n);
  }
  async getTransfers(q: TransferQuery): Promise<Transfer[]> {
    const from = new Set(q.from.map((a) => a.toLowerCase()));
    return this.transfers.filter(
      (t) =>
        t.token.toLowerCase() === q.token.toLowerCase() &&
        from.has(t.from.toLowerCase()) &&
        t.blockNumber >= q.fromBlock &&
        t.blockNumber <= q.toBlock &&
        t.blockNumber <= this.latest &&
        !this.hidden.has(`${t.txHash}:${t.logIndex}`),
    );
  }
  async erc20Meta(): Promise<{ symbol: string | null; decimals: number }> {
    return { symbol: "KDEMO", decimals: 18 };
  }
  async readVesting(contract: `0x${string}`): Promise<VestingReads | null> {
    return this.vesting.get(contract.toLowerCase()) ?? null;
  }
  async confirmTransfer(t: Transfer): Promise<boolean> {
    return this.transfers.some(
      (x) =>
        x.txHash === t.txHash &&
        x.logIndex === t.logIndex &&
        x.amount === t.amount &&
        x.from.toLowerCase() === t.from.toLowerCase() &&
        x.blockNumber <= this.finalized &&
        !this.hidden.has(`${t.txHash}:${t.logIndex}`),
    );
  }
  async getCode(): Promise<`0x${string}` | undefined> {
    return "0x";
  }
  async tokenOwner(token: `0x${string}`): Promise<`0x${string}` | null> {
    return this.owners.get(token.toLowerCase()) ?? null;
  }
}
