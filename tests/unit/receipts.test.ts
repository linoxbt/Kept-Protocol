import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, checkReceipt, receiptHash, signReceipt, type ReceiptBody } from "@/receipts/receipt";
import { merkleProof, merkleRoot, verifyProof } from "@/receipts/merkle";
import { DEV_SIGNER_KEY } from "@/receipts/signer";
import { lockSpec } from "../fixtures";

const account = privateKeyToAccount(DEV_SIGNER_KEY);
const signer = { address: account.address, signHash: (h: string) => account.signMessage({ message: { raw: `0x${h}` } }) };

function body(): Omit<ReceiptBody, "signer"> {
  return {
    receipt_version: 1,
    receipt_id: "kr_TEST",
    kind: "verification",
    commitment_id: "kc_TEST",
    commitment_version: 1,
    issued_at: "2026-11-12T10:00:00.000Z",
    statement: { url: "https://example.com", excerpt: "x", content_sha256: "ab", captured_at: "2026-11-12T10:00:00.000Z" },
    spec: lockSpec(),
    method: { id: "erc20_outflow_v1", version: 1, code_commit: "abc" },
    chain: { chain_id: 8453, token: "0x1", subjects: ["0x2"], from_block: "1", to_block: "2", to_block_finalized: true, to_block_time: 1 },
    evidence: [],
    result: { status: "verified", final: false, outcome: "in_progress", computed_value: "0", threshold_base_units: "0", comparator: "lte", reason: "ok", warnings: [] },
    attribution: [],
    providers: [],
    limitations: [],
    replay: null,
    prev_sha256: null,
  };
}

describe("receipts", () => {
  it("canonicalizes key order (RFC 8785)", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("signs, recovers the signer, and detects tampering", async () => {
    const r = await signReceipt(body(), signer);
    expect(r.sha256).toBe(receiptHash(r.body));
    const ok = await checkReceipt(r);
    expect(ok).toMatchObject({ hashMatches: true, signatureValid: true });
    const tampered = { ...r, body: { ...r.body, result: { ...r.body.result, status: "breached" as const } } };
    const bad = await checkReceipt(tampered);
    expect(bad.hashMatches).toBe(false);
    expect(bad.signatureValid).toBe(false);
  });
});

describe("merkle", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  it("produces proofs that verify for every leaf, including the odd one", () => {
    const root = merkleRoot(leaves);
    leaves.forEach((leaf, i) => expect(verifyProof(leaf, merkleProof(leaves, i), root)).toBe(true));
    expect(verifyProof("ff".repeat(32), merkleProof(leaves, 0), root)).toBe(false);
  });
  it("handles a single leaf", () => {
    expect(merkleRoot([leaves[0]])).toBe(leaves[0]);
    expect(verifyProof(leaves[0], [], leaves[0])).toBe(true);
  });
});
