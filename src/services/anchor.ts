/**
 * On-chain anchoring. All receipts not yet anchored are hashed into a Merkle root, which is
 * attested on Base through EAS (predeploy 0x4200…0021). Each receipt then records its anchor and
 * leaf index, so anyone can check inclusion. Receipts are only marked anchored after the
 * attestation transaction succeeds.
 */
import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, encodePacked, http, keccak256, parseAbi, parseAbiParameters, zeroAddress, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { db, type Sql } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { merkleProof, merkleRoot } from "@/receipts/merkle";

export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;
export const ANCHOR_SCHEMA = "bytes32 merkleRoot,uint32 receiptCount,string anchorId";

const easAbi = parseAbi([
  "struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }",
  "struct AttestationRequest { bytes32 schema; AttestationRequestData data; }",
  "function attest(AttestationRequest request) payable returns (bytes32)",
  "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)",
]);
const registryAbi = parseAbi([
  "function register(string schema, address resolver, bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))",
]);

/** EAS schema UIDs are deterministic: keccak256(abi.encodePacked(schema, resolver, revocable)). */
export function schemaUid(schema = ANCHOR_SCHEMA): Hex {
  return keccak256(encodePacked(["string", "address", "bool"], [schema, zeroAddress, false]));
}

function chainFor(chainId: number) {
  if (chainId === 8453) return { chain: base, rpc: env().BASE_RPC_URL };
  if (chainId === 84532) return { chain: baseSepolia, rpc: env().BASE_SEPOLIA_RPC_URL };
  throw new Error(`anchoring not supported on chain ${chainId}`);
}

export async function registerAnchorSchema(chainId: number): Promise<{ uid: Hex; tx: Hex | null }> {
  const key = env().ANCHOR_PRIVATE_KEY;
  if (!key) throw new Error("ANCHOR_PRIVATE_KEY is not set");
  const { chain, rpc } = chainFor(chainId);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const uid = schemaUid();
  const existing = await pub.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: registryAbi, functionName: "getSchema", args: [uid] });
  if (existing.uid !== zeroHash) return { uid, tx: null };
  const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(key as Hex) });
  const tx = await wallet.writeContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: registryAbi, functionName: "register", args: [ANCHOR_SCHEMA, zeroAddress, false] });
  await pub.waitForTransactionReceipt({ hash: tx });
  return { uid, tx };
}

export interface PendingRoot {
  root: string | null;
  count: number;
  receiptIds: string[];
  leaves: string[];
}

export async function pendingRoot(sql: Sql = db(), limit = 10_000): Promise<PendingRoot> {
  const rows = await sql<{ id: string; sha256: string }[]>`select id, sha256 from receipts where anchor_id is null order by created_at, id limit ${limit}`;
  if (!rows.length) return { root: null, count: 0, receiptIds: [], leaves: [] };
  const leaves = rows.map((r) => r.sha256);
  return { root: merkleRoot(leaves), count: rows.length, receiptIds: rows.map((r) => r.id), leaves };
}

export async function anchorPending(sql: Sql = db(), chainId = Number(process.env.ANCHOR_CHAIN_ID ?? 8453)): Promise<{ anchorId: string; root: string; count: number; tx: Hex; uid: Hex } | null> {
  const key = env().ANCHOR_PRIVATE_KEY;
  if (!key) throw new Error("ANCHOR_PRIVATE_KEY is not set; anchoring is disabled");
  const pending = await pendingRoot(sql);
  if (!pending.root) return null;
  const anchorId = newId("ka");
  const { chain, rpc } = chainFor(chainId);
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(key as Hex) });
  const schema = (env().EAS_SCHEMA_UID as Hex | undefined) ?? schemaUid();
  const data = encodeAbiParameters(parseAbiParameters("bytes32, uint32, string"), [`0x${pending.root}`, pending.count, anchorId]);
  const tx = await wallet.writeContract({
    address: EAS_ADDRESS,
    abi: easAbi,
    functionName: "attest",
    args: [{ schema, data: { recipient: zeroAddress, expirationTime: 0n, revocable: false, refUID: zeroHash, data, value: 0n } }],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`attestation transaction ${tx} failed`);
  let uid: Hex = zeroHash;
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: easAbi, data: log.data, topics: log.topics });
      if (d.eventName === "Attested") uid = d.args.uid;
    } catch {
      /* other logs */
    }
  }
  await sql.begin(async (tx2) => {
    await tx2`insert into anchors (id, merkle_root, receipt_count, chain_id, eas_uid, tx_hash) values (${anchorId}, ${pending.root}, ${pending.count}, ${chainId}, ${uid}, ${tx})`;
    for (const [i, id] of pending.receiptIds.entries()) {
      await tx2`update receipts set anchor_id = ${anchorId}, leaf_index = ${i} where id = ${id} and anchor_id is null`;
    }
  });
  return { anchorId, root: pending.root, count: pending.count, tx, uid };
}

export async function inclusionProof(receiptId: string, sql: Sql = db()) {
  const [r] = await sql<{ anchor_id: string | null; leaf_index: number | null; sha256: string }[]>`select anchor_id, leaf_index, sha256 from receipts where id = ${receiptId}`;
  if (!r?.anchor_id || r.leaf_index === null) return null;
  const [a] = await sql<{ id: string; merkle_root: string; chain_id: number; eas_uid: string; tx_hash: string; anchored_at: Date }[]>`select * from anchors where id = ${r.anchor_id}`;
  const leaves = (await sql<{ sha256: string }[]>`select sha256 from receipts where anchor_id = ${r.anchor_id} order by leaf_index`).map((x) => x.sha256);
  return { anchor: a, leaf: r.sha256, leaf_index: r.leaf_index, proof: merkleProof(leaves, r.leaf_index) };
}
