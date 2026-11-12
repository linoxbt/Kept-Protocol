/**
 * Fineprint receipts. A receipt is canonicalized with RFC 8785 (JCS), hashed with SHA-256,
 * chained to the previous receipt of the same commitment, and signed with EIP-191 by Kept's
 * published key. Anyone can recompute the hash and recover the signer without trusting Kept.
 */
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { recoverMessageAddress, type Hex } from "viem";
import type { CommitmentSpec, Comparator, Outcome, Status, Warning } from "@/core/types";

export const RECEIPT_VERSION = 1;

export interface ReceiptEvidence {
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_time: number;
  from: string;
  to: string;
  amount: string;
}

export interface ReceiptBody {
  receipt_version: number;
  receipt_id: string;
  kind: "verification" | "hindcast" | "extraction";
  commitment_id: string;
  commitment_version: number;
  issued_at: string;
  statement: { url: string | null; excerpt: string; content_sha256: string; captured_at: string };
  spec: CommitmentSpec;
  method: { id: string; version: number; code_commit: string };
  chain: {
    chain_id: number;
    token: string;
    subjects: string[];
    from_block: string;
    to_block: string;
    to_block_finalized: boolean;
    to_block_time: number;
  };
  evidence: ReceiptEvidence[];
  result: {
    status: Status;
    final: boolean;
    outcome: Outcome;
    computed_value: string;
    threshold_base_units: string;
    comparator: Comparator;
    reason: string;
    warnings: Warning[];
  };
  attribution: { address: string; level: string; evidence: string | null }[];
  providers: { name: string; role: "primary" | "confirmation"; result: string }[];
  limitations: string[];
  /** Hindcast receipts carry the replay; live checks leave it null. */
  replay: unknown | null;
  prev_sha256: string | null;
  signer: string;
}

export interface SignedReceipt {
  body: ReceiptBody;
  sha256: string;
  signature: Hex;
}

export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("value cannot be canonicalized");
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function receiptHash(body: ReceiptBody): string {
  return sha256Hex(canonicalJson(body));
}

export interface ReceiptSigner {
  address: `0x${string}`;
  signHash(hashHex: string): Promise<Hex>;
}

export async function signReceipt(body: Omit<ReceiptBody, "signer">, signer: ReceiptSigner): Promise<SignedReceipt> {
  const full: ReceiptBody = { ...body, signer: signer.address };
  const sha256 = receiptHash(full);
  const signature = await signer.signHash(sha256);
  return { body: full, sha256, signature };
}

export interface ReceiptCheck {
  hashMatches: boolean;
  recomputedSha256: string;
  signatureValid: boolean;
  recoveredSigner: string | null;
}

/** Recompute the hash and recover the signer. Used by kept-verify and the receipt page. */
export async function checkReceipt(receipt: SignedReceipt): Promise<ReceiptCheck> {
  const recomputed = receiptHash(receipt.body);
  let recovered: string | null = null;
  try {
    recovered = await recoverMessageAddress({ message: { raw: `0x${recomputed}` }, signature: receipt.signature });
  } catch {
    recovered = null;
  }
  return {
    hashMatches: recomputed === receipt.sha256,
    recomputedSha256: recomputed,
    signatureValid: recovered !== null && recovered.toLowerCase() === receipt.body.signer.toLowerCase(),
    recoveredSigner: recovered,
  };
}
