/**
 * kept-verify — check a Kept receipt without trusting Kept.
 *
 *   npx tsx scripts/kept-verify.ts receipt.json --signer 0x… [--rpc https://base-rpc.publicnode.com]
 *   npx tsx scripts/kept-verify.ts https://kept.example/api/v1/receipts/kr_…  [--signer 0x…]
 *
 * 1. Recomputes SHA-256 over the RFC 8785 canonical JSON and compares it with the receipt hash.
 * 2. Recovers the EIP-191 signer and requires it to equal the EXPECTED signer: --signer (a value you
 *    trust), else the deployment's published agent card. Matching the receipt's own `signer` field
 *    proves nothing (a forger writes that too), and the public development key is always rejected.
 * 3. Anchoring: the Merkle leaf must equal the recomputed hash, the proof must reach the root, and
 *    that root must be the one attested ON BASE: the EAS attestation is read from YOUR RPC, not
 *    taken from Kept's API.
 * 4. For verification receipts: re-fetches every Transfer log for the token and subjects in the
 *    receipt's block range from YOUR RPC, reruns the named method version and compares the result.
 * Exit code 0 only if all checks pass.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, decodeAbiParameters, decodeEventLog, http, parseAbi, parseAbiParameters, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EvmAdapter } from "../src/chain/evm";
import { METHOD_VERSIONS, runMethod, watchedAddresses } from "../src/core/methods";
import { CommitmentSpec } from "../src/core/types";
import { checkReceipt, type ReceiptBody } from "../src/receipts/receipt";
import { verifyProof } from "../src/receipts/merkle";
import { DEV_SIGNER_KEY } from "../src/receipts/signer";

const EAS_ADDRESS = "0x4200000000000000000000000000000000000021";
const easAbi = parseAbi([
  "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)",
  "struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }",
  "function getAttestation(bytes32 uid) view returns (Attestation)",
]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface AnchorInfo {
  leaf: string;
  proof: string[];
  anchor: { id: string; merkle_root: string; tx_hash: string; chain_id: number };
}

async function load(src: string): Promise<{ receipt: ReceiptBody; sha256: string; signature: `0x${string}`; anchor?: AnchorInfo | null }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
    return res.json() as never;
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

/** --signer wins; otherwise the signer published in the deployment's agent card (fetched now). */
async function expectedSigner(src: string): Promise<{ address: string; source: string } | null> {
  const pinned = arg("--signer");
  if (pinned) return { address: pinned, source: "--signer" };
  if (!/^https?:\/\//.test(src)) return null;
  const card = new URL("/.well-known/agent-card.json", src).toString();
  const res = await fetch(card).catch(() => null);
  const body = res?.ok ? ((await res.json()) as { signer?: { address?: string } }) : null;
  return body?.signer?.address ? { address: body.signer.address, source: `${card} (fetched now; compare it with a copy you trust)` } : null;
}

const ok = (b: boolean) => (b ? "✓" : "✗");

async function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: kept-verify <receipt.json | receipt URL> [--signer 0x…] [--rpc URL]");
    process.exit(2);
  }
  const data = await load(src);
  const r = data.receipt;
  let pass = true;

  const integrity = await checkReceipt({ body: r, sha256: data.sha256, signature: data.signature });
  console.log(`${ok(integrity.hashMatches)} sha256 ${integrity.recomputedSha256}${integrity.hashMatches ? "" : ` (receipt says ${data.sha256})`}`);
  pass &&= integrity.hashMatches && integrity.signatureValid;

  const recovered = (integrity.recoveredSigner ?? "").toLowerCase();
  const devSigner = privateKeyToAccount(DEV_SIGNER_KEY).address.toLowerCase();
  const expected = await expectedSigner(src);
  if (recovered === devSigner) {
    console.log(`✗ signer ${integrity.recoveredSigner} is the PUBLIC development key: anyone can sign with it`);
    pass = false;
  } else if (!expected) {
    console.log(`✗ signer ${integrity.recoveredSigner}: no expected signer to compare with; pass --signer 0x… with the address you trust`);
    pass = false;
  } else {
    const same = integrity.signatureValid && recovered === expected.address.toLowerCase();
    console.log(`${ok(same)} signer ${integrity.recoveredSigner} = expected ${expected.address} (from ${expected.source})`);
    pass &&= same;
  }

  const rpc = arg("--rpc") ?? (r.chain.chain_id === 84532 ? "https://base-sepolia-rpc.publicnode.com" : "https://base-rpc.publicnode.com");

  if (data.anchor) {
    const a = data.anchor;
    const leafIsThisReceipt = a.leaf === integrity.recomputedSha256;
    console.log(`${ok(leafIsThisReceipt)} Merkle leaf is this receipt's recomputed hash`);
    const inc = verifyProof(a.leaf, a.proof, a.anchor.merkle_root);
    console.log(`${ok(inc)} Merkle proof reaches root ${a.anchor.merkle_root}`);
    pass &&= leafIsThisReceipt && inc;
    // The root must be the one attested on Base, read from the user's RPC.
    try {
      const pub = createPublicClient({ transport: http(arg("--anchor-rpc") ?? rpc) });
      const txr = await pub.getTransactionReceipt({ hash: a.anchor.tx_hash as Hex });
      let uid: Hex | null = null;
      for (const log of txr.logs) {
        if (log.address.toLowerCase() !== EAS_ADDRESS) continue;
        try {
          const d = decodeEventLog({ abi: easAbi, data: log.data, topics: log.topics });
          if (d.eventName === "Attested") uid = d.args.uid;
        } catch {
          /* other EAS events */
        }
      }
      if (txr.status !== "success" || !uid) throw new Error(`transaction ${a.anchor.tx_hash} has no successful EAS attestation`);
      const att = await pub.readContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "getAttestation", args: [uid] });
      const [root, , anchorId] = decodeAbiParameters(parseAbiParameters("bytes32, uint32, string"), att.data);
      const onchain = root.toLowerCase() === `0x${a.anchor.merkle_root}`.toLowerCase() && anchorId === a.anchor.id && att.revocationTime === 0n;
      console.log(`${ok(onchain)} EAS attestation ${uid} on chain ${a.anchor.chain_id} (read from ${arg("--anchor-rpc") ?? rpc}) attests root ${root.slice(2)} for ${anchorId}, attester ${att.attester}`);
      pass &&= onchain;
    } catch (e) {
      console.log(`✗ could not confirm the anchor on chain: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      pass = false;
    }
  } else {
    console.log("- not anchored yet");
  }

  if (r.kind !== "verification") {
    console.log(`- ${r.kind} receipt: chain re-check applies to verification receipts only`);
    console.log(pass ? "\nreceipt verified" : "\nreceipt did NOT verify");
    process.exit(pass ? 0 : 1);
  }
  const spec = CommitmentSpec.parse(r.spec);
  if (METHOD_VERSIONS[spec.method_id] !== r.method.version) {
    console.log(`! this checkout implements ${spec.method_id} v${METHOD_VERSIONS[spec.method_id]}; the receipt used v${r.method.version}. Check out code ${r.method.code_commit}.`);
  }
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
