/**
 * kept-verify — check a Kept receipt without trusting Kept.
 *
 *   npx tsx scripts/kept-verify.ts receipt.json [--rpc https://base-rpc.publicnode.com]
 *   npx tsx scripts/kept-verify.ts https://kept.example/api/v1/receipts/kr_…
 *
 * 1. Recomputes SHA-256 over the RFC 8785 canonical JSON and compares it with the receipt hash.
 * 2. Recovers the EIP-191 signer and compares it with the receipt's signer.
 * 3. For verification receipts: re-fetches every Transfer log for the token and subjects in the
 *    receipt's block range from YOUR RPC, reruns the named method version and compares the result.
 * Exit code 0 only if all checks pass.
 */
import { readFileSync } from "node:fs";
import { EvmAdapter } from "../src/chain/evm";
import { METHOD_VERSIONS, runMethod, watchedAddresses } from "../src/core/methods";
import { CommitmentSpec } from "../src/core/types";
import { checkReceipt, type ReceiptBody } from "../src/receipts/receipt";
import { verifyProof } from "../src/receipts/merkle";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function load(src: string): Promise<{ receipt: ReceiptBody; sha256: string; signature: `0x${string}`; anchor?: { leaf: string; proof: string[]; anchor: { merkle_root: string; tx_hash: string } } | null }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
    return res.json() as never;
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

const ok = (b: boolean) => (b ? "✓" : "✗");

async function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: kept-verify <receipt.json | receipt URL> [--rpc URL]");
    process.exit(2);
  }
  const data = await load(src);
  const r = data.receipt;
  let pass = true;

  const integrity = await checkReceipt({ body: r, sha256: data.sha256, signature: data.signature });
  console.log(`${ok(integrity.hashMatches)} sha256 ${integrity.recomputedSha256}${integrity.hashMatches ? "" : ` (receipt says ${data.sha256})`}`);
  console.log(`${ok(integrity.signatureValid)} signer ${integrity.recoveredSigner} (receipt says ${r.signer})`);
  pass &&= integrity.hashMatches && integrity.signatureValid;

  if (data.anchor) {
    const inc = verifyProof(data.anchor.leaf, data.anchor.proof, data.anchor.anchor.merkle_root);
    console.log(`${ok(inc)} Merkle inclusion in anchored root ${data.anchor.anchor.merkle_root} (tx ${data.anchor.anchor.tx_hash})`);
    pass &&= inc;
  } else {
    console.log("- not anchored yet");
  }

  if (r.kind !== "verification") {
    console.log(`- ${r.kind} receipt: chain re-check applies to verification receipts only`);
    process.exit(pass ? 0 : 1);
  }
  const spec = CommitmentSpec.parse(r.spec);
  if (METHOD_VERSIONS[spec.method_id] !== r.method.version) {
    console.log(`! this checkout implements ${spec.method_id} v${METHOD_VERSIONS[spec.method_id]}; the receipt used v${r.method.version}. Check out code ${r.method.code_commit}.`);
  }
  const rpc = arg("--rpc") ?? (r.chain.chain_id === 84532 ? "https://base-sepolia-rpc.publicnode.com" : "https://base-rpc.publicnode.com");
  const chain = new EvmAdapter({ chainId: r.chain.chain_id, name: rpc, rpcUrl: rpc, maxRange: BigInt(arg("--max-range") ?? 10_000) });
  const fromBlock = BigInt(r.chain.from_block);
  const toBlock = BigInt(r.chain.to_block);
  console.log(`  re-fetching Transfer logs for ${watchedAddresses(spec).length} address(es), blocks ${fromBlock}–${toBlock} from ${rpc}…`);
  const transfers = await chain.getTransfers({ token: spec.token.address as `0x${string}`, from: watchedAddresses(spec), fromBlock, toBlock });
  const vesting = spec.vesting ? await chain.readVesting(spec.vesting.contract as `0x${string}`, spec.token.address as `0x${string}`, toBlock) : null;
  const result = runMethod(spec, {
    finalizedBlock: toBlock,
    finalizedTime: r.chain.to_block_time,
    latestBlock: toBlock,
    fromBlock,
    transfers,
    unfinalizedTransfers: [],
    vesting,
    asOf: r.chain.to_block_time,
  });
  const same = result.outcome === r.result.outcome && result.computed_value === r.result.computed_value;
  console.log(`${ok(same)} rerun ${spec.method_id}: outcome ${result.outcome}, computed ${result.computed_value} (receipt: ${r.result.outcome}, ${r.result.computed_value})`);
  pass &&= same;
  console.log(pass ? "\nreceipt verified" : "\nreceipt did NOT verify");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
