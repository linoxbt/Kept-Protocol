/**
 * A provider pair for reading history without paid keys: every call goes to the primary RPC, and
 * any call the primary refuses as an archive request is retried on an archive-capable fallback
 * (by default Tenderly's public Base gateway, which serves full history in 1,000-block log
 * ranges). Recent blocks stay on the fast primary; old windows still get checked, more slowly.
 * With a paid archive RPC as the primary, the fallback is never used.
 */
import type { Transfer, VestingReads } from "@/core/types";
import type { BlockRef, ChainAdapter, TransferQuery } from "./adapter";
import { ArchiveRequired } from "./evm";

export class ArchiveFallbackAdapter implements ChainAdapter {
  readonly chainId: number;
  readonly name: string;

  constructor(
    private readonly primary: ChainAdapter,
    private readonly archive: ChainAdapter,
  ) {
    this.chainId = primary.chainId;
    this.name = `${primary.name}, archive fallback ${archive.name}`;
  }

  private async run<T>(f: (a: ChainAdapter) => Promise<T>): Promise<T> {
    try {
      return await f(this.primary);
    } catch (e) {
      if (e instanceof ArchiveRequired) return f(this.archive);
      throw e;
    }
  }

  finalizedBlock(): Promise<BlockRef> {
    return this.primary.finalizedBlock();
  }
  latestBlock(): Promise<BlockRef> {
    return this.primary.latestBlock();
  }
  blockAtOrBefore(timestamp: number): Promise<bigint> {
    return this.run((a) => a.blockAtOrBefore(timestamp));
  }
  /** Used by evidence collection to show when it read history (blockTime is optional on adapters). */
  async blockTime(n: bigint): Promise<number> {
    return this.run(async (a) => {
      const bt = (a as ChainAdapter & { blockTime?: (n: bigint) => Promise<number> }).blockTime;
      if (!bt) return (await a.finalizedBlock()).timestamp;
      return bt.call(a, n);
    });
  }
  getTransfers(q: TransferQuery, onProgress?: (scannedTo: bigint) => void): Promise<Transfer[]> {
    return this.run((a) => a.getTransfers(q, onProgress));
  }
  erc20Meta(token: `0x${string}`): Promise<{ symbol: string | null; decimals: number }> {
    return this.run((a) => a.erc20Meta(token));
  }
  readVesting(contract: `0x${string}`, token: `0x${string}`, blockNumber?: bigint): Promise<VestingReads | null> {
    return this.run((a) => a.readVesting(contract, token, blockNumber));
  }
  confirmTransfer(t: Transfer): Promise<boolean> {
    return this.run((a) => a.confirmTransfer(t));
  }
  getCode(address: `0x${string}`): Promise<`0x${string}` | undefined> {
    return this.run((a) => a.getCode(address));
  }
  tokenOwner(token: `0x${string}`): Promise<`0x${string}` | null> {
    return this.run((a) => a.tokenOwner(token));
  }
}
