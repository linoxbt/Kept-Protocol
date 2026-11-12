import type { Q, Sql } from "@/db/client";
import { newId } from "@/lib/ids";
import { canonicalJson, signReceipt, type ReceiptBody, type SignedReceipt } from "@/receipts/receipt";
import { getSigner } from "@/receipts/signer";

export interface StoredReceipt extends SignedReceipt {
  id: string;
  anchor_id: string | null;
  leaf_index: number | null;
  created_at: Date;
}

/**
 * Signs and stores a receipt inside the caller's transaction. The caller must hold a row lock on
 * the commitment so the hash chain (prev_sha256) cannot fork under concurrent checks.
 */
export async function insertReceipt(tx: Q, body: Omit<ReceiptBody, "signer" | "prev_sha256" | "receipt_id">): Promise<StoredReceipt> {
  const id = newId("kr");
  const prev = body.commitment_id
    ? await tx<{ sha256: string }[]>`select sha256 from receipts where commitment_id = ${body.commitment_id} order by created_at desc, id desc limit 1`
    : [];
  const signed = await signReceipt({ ...body, receipt_id: id, prev_sha256: prev[0]?.sha256 ?? null }, getSigner());
  const canonical = canonicalJson(signed.body);
  const [row] = await tx<{ created_at: Date }[]>`
    insert into receipts (id, kind, commitment_id, version, body, canonical, sha256, prev_sha256, signature, signer)
    values (${id}, ${signed.body.kind}, ${signed.body.commitment_id}, ${signed.body.commitment_version},
            ${tx.json(JSON.parse(canonical))}, ${canonical}, ${signed.sha256}, ${signed.body.prev_sha256}, ${signed.signature}, ${signed.body.signer})
    returning created_at`;
  return { ...signed, id, anchor_id: null, leaf_index: null, created_at: row.created_at };
}

interface ReceiptRow {
  id: string;
  canonical: string;
  sha256: string;
  signature: string;
  anchor_id: string | null;
  leaf_index: number | null;
  created_at: Date;
}

/** The body is re-read from the stored canonical text, byte for byte what was hashed. */
export function rowToReceipt(r: ReceiptRow): StoredReceipt {
  return {
    id: r.id,
    body: JSON.parse(r.canonical) as ReceiptBody,
    sha256: r.sha256,
    signature: r.signature as `0x${string}`,
    anchor_id: r.anchor_id,
    leaf_index: r.leaf_index,
    created_at: r.created_at,
  };
}

export async function getReceipt(sql: Sql, id: string): Promise<StoredReceipt | null> {
  const rows = await sql<ReceiptRow[]>`select id, canonical, sha256, signature, anchor_id, leaf_index, created_at from receipts where id = ${id}`;
  return rows[0] ? rowToReceipt(rows[0]) : null;
}
