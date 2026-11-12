import type { Transfer, VestingReads } from "@/core/types";

export interface BlockRef {
  number: bigint;
  timestamp: number;
}

export interface TransferQuery {
  token: `0x${string}`;
  /** Only transfers whose `from` is one of these addresses. */
  from: `0x${string}`[];
  fromBlock: bigint;
  toBlock: bigint;
}

/** New networks plug in by implementing this. Verification methods never see a provider. */
export interface ChainAdapter {
  readonly chainId: number;
  readonly name: string;
  finalizedBlock(): Promise<BlockRef>;
  latestBlock(): Promise<BlockRef>;
  blockAtOrBefore(timestamp: number): Promise<bigint>;
  getTransfers(q: TransferQuery, onProgress?: (scannedTo: bigint) => void): Promise<Transfer[]>;
  erc20Meta(token: `0x${string}`): Promise<{ symbol: string | null; decimals: number }>;
  readVesting(contract: `0x${string}`, token: `0x${string}`, blockNumber?: bigint): Promise<VestingReads | null>;
  /** Confirms one transfer independently: the log exists with identical fields at a finalized block. */
  confirmTransfer(t: Transfer): Promise<boolean>;
  getCode(address: `0x${string}`): Promise<`0x${string}` | undefined>;
  /** owner() of an Ownable token, or null. */
  tokenOwner(token: `0x${string}`): Promise<`0x${string}` | null>;
}
