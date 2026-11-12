/**
 * Merkle tree over receipt hashes for daily anchoring. Pairs are hashed in sorted order
 * (sha256(min(a,b) || max(a,b))), so a proof is a plain list of sibling hashes with no
 * left/right flags. An odd node is carried up unchanged.
 */
import { createHash } from "node:crypto";

const h = (a: Buffer, b: Buffer): Buffer =>
  createHash("sha256").update(Buffer.compare(a, b) <= 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a])).digest();

const toBuf = (hex: string): Buffer => Buffer.from(hex.replace(/^0x/, ""), "hex") as Buffer;

export function merkleRoot(leavesHex: string[]): string {
  if (leavesHex.length === 0) throw new Error("no leaves");
  let level: Buffer[] = leavesHex.map(toBuf);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? h(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0].toString("hex");
}

export function merkleProof(leavesHex: string[], index: number): string[] {
  if (index < 0 || index >= leavesHex.length) throw new Error("leaf index out of range");
  const proof: string[] = [];
  let level: Buffer[] = leavesHex.map(toBuf);
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling].toString("hex"));
    const next: Buffer[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(j + 1 < level.length ? h(level[j], level[j + 1]) : level[j]);
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leafHex: string, proof: string[], rootHex: string): boolean {
  let acc = toBuf(leafHex);
  for (const p of proof) acc = h(acc, toBuf(p));
  return acc.toString("hex") === rootHex.replace(/^0x/, "");
}
