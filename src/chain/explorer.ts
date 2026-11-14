/** Explorer links. Kept separate from the adapters so client and server UI can both import it. */
export const EXPLORERS: Record<number, string> = { 8453: "https://basescan.org", 84532: "https://sepolia.basescan.org" };
export const CHAIN_NAMES: Record<number, string> = { 8453: "Base", 84532: "Base Sepolia" };

export const explorerTx = (chainId: number, tx: string) => `${EXPLORERS[chainId] ?? EXPLORERS[8453]}/tx/${tx}`;
export const explorerAddress = (chainId: number, a: string) => `${EXPLORERS[chainId] ?? EXPLORERS[8453]}/address/${a}`;
