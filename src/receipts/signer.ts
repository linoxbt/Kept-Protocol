import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { env } from "@/lib/env";
import type { ReceiptSigner } from "./receipt";

/**
 * Well-known development key (Foundry/Anvil account #0). It is public, so receipts signed with
 * it prove nothing; the UI marks them as development receipts. Production refuses to start
 * without KEPT_SIGNER_PRIVATE_KEY.
 */
export const DEV_SIGNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

let cached: ReceiptSigner | null = null;

export function getSigner(): ReceiptSigner {
  if (cached) return cached;
  const key = env().KEPT_SIGNER_PRIVATE_KEY ?? DEV_SIGNER_KEY;
  const account = privateKeyToAccount(key as Hex);
  cached = {
    address: account.address,
    signHash: (hashHex: string) => account.signMessage({ message: { raw: `0x${hashHex.replace(/^0x/, "")}` } }),
  };
  return cached;
}

export function isDevSigner(address: string): boolean {
  return address.toLowerCase() === privateKeyToAccount(DEV_SIGNER_KEY).address.toLowerCase();
}

/** Sign an arbitrary response body hash (Kept-Signature header). */
export async function signBody(body: string): Promise<{ signature: Hex; signer: string }> {
  const { createHash } = await import("node:crypto");
  const s = getSigner();
  const digest = createHash("sha256").update(body).digest("hex");
  return { signature: await s.signHash(digest), signer: s.address };
}
