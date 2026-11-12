import { env } from "@/lib/env";
import type { ChainAdapter } from "./adapter";
import { EvmAdapter } from "./evm";

export const SUPPORTED_CHAINS: Record<number, { name: string; explorer: string }> = {
  8453: { name: "Base", explorer: "https://basescan.org" },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
};

export interface ChainProviders {
  primary: ChainAdapter;
  confirm: ChainAdapter;
}

const cache = new Map<number, ChainProviders>();

/** Tests inject fixture adapters here. */
export function setChainProviders(chainId: number, providers: ChainProviders | null): void {
  if (providers) cache.set(chainId, providers);
  else cache.delete(chainId);
}

/** Two independent providers per chain: the primary reads evidence, the second confirms breaches. */
export function getChain(chainId: number): ChainProviders {
  const hit = cache.get(chainId);
  if (hit) return hit;
  const e = env();
  let urls: [string, string];
  if (chainId === 8453) urls = [e.BASE_RPC_URL, e.BASE_RPC_URL_CONFIRM];
  else if (chainId === 84532) urls = [e.BASE_SEPOLIA_RPC_URL, e.BASE_SEPOLIA_RPC_URL_CONFIRM];
  else throw new Error(`unsupported chain ${chainId}`);
  const name = SUPPORTED_CHAINS[chainId].name;
  const providers = {
    primary: new EvmAdapter({ chainId, name: `${name} primary (${new URL(urls[0]).host})`, rpcUrl: urls[0], maxRange: BigInt(e.BASE_RPC_MAX_RANGE) }),
    confirm: new EvmAdapter({ chainId, name: `${name} confirmation (${new URL(urls[1]).host})`, rpcUrl: urls[1], maxRange: 10_000n }),
  };
  cache.set(chainId, providers);
  return providers;
}

export function explorerTx(chainId: number, tx: string): string {
  return `${SUPPORTED_CHAINS[chainId]?.explorer ?? "https://basescan.org"}/tx/${tx}`;
}

export function explorerAddress(chainId: number, address: string): string {
  return `${SUPPORTED_CHAINS[chainId]?.explorer ?? "https://basescan.org"}/address/${address}`;
}
