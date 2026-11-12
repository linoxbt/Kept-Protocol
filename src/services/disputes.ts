/**
 * Disputes. Anyone can challenge a commitment's record (wrong address, wrong reading of the
 * statement, wrong attribution). The admin then:
 *   accept  → the commitment shows Disputed (with the mechanical result still in the reason) until
 *             the dispute is resolved;
 *   reject  → nothing changes; the decision and its reason are kept;
 *   resolve → the overlay is lifted and a fresh check runs at once.
 * Every dispute and decision is stored and shown on the commitment page.
 */
import { db, type Sql } from "@/db/client";
import { newId } from "@/lib/ids";
import { Invalid, NotFound } from "./sources";
import { hit } from "./ratelimit";
import { RateLimited } from "./preview";
import { enqueue } from "./verify";

export interface DisputeRow {
  id: string;
  commitment_id: string;
  reason: string;
  evidence_url: string | null;
  status: "open" | "accepted" | "rejected" | "resolved";
  resolution: string | null;
  opened_at: Date;
  decided_at: Date | null;
  resolved_at: Date | null;
}

const PUBLIC_COLS = "id, commitment_id, reason, evidence_url, status, resolution, opened_at, decided_at, resolved_at";

export async function openDispute(
  input: { commitmentId: string; reason: string; evidenceUrl?: string | null; contact?: string | null; requester: string },
  sql: Sql = db(),
): Promise<DisputeRow> {
  const limit = await hit(`dispute:${input.requester}`, 3, 86_400, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const [c] = await sql<{ id: string }[]>`select id from commitments where id = ${input.commitmentId}`;
  if (!c) throw new NotFound("no such commitment");
  const reason = input.reason.trim();
  if (reason.length < 20) throw new Invalid("describe the problem in at least 20 characters");
  const [open] = await sql<{ n: number }[]>`select count(*)::int as n from disputes where commitment_id = ${input.commitmentId} and status in ('open', 'accepted')`;
  if (open.n >= 20) throw new Invalid("this commitment already has many open disputes under review");
  const id = newId("kd");
  const [row] = await sql<DisputeRow[]>`
    insert into disputes (id, commitment_id, reason, evidence_url, contact, requester_hash)
    values (${id}, ${input.commitmentId}, ${reason.slice(0, 4000)}, ${input.evidenceUrl ?? null}, ${input.contact?.slice(0, 200) ?? null}, ${input.requester})
    returning ${sql.unsafe(PUBLIC_COLS)}`;
  await enqueue(sql, "commitment.disputed", input.commitmentId, `${id}:opened`, { commitment_id: input.commitmentId, dispute_id: id, status: "open" });
  return row;
}

export async function listDisputes(commitmentId: string, sql: Sql = db()): Promise<DisputeRow[]> {
  return sql<DisputeRow[]>`select ${sql.unsafe(PUBLIC_COLS)} from disputes where commitment_id = ${commitmentId} order by opened_at desc`;
}

export async function openDisputeQueue(sql: Sql = db()): Promise<(DisputeRow & { contact: string | null })[]> {
  return sql<(DisputeRow & { contact: string | null })[]>`
    select ${sql.unsafe(PUBLIC_COLS)}, contact from disputes where status in ('open', 'accepted') order by opened_at`;
}

/** The accepted dispute that currently overlays a commitment's status, if any. */
export async function activeDispute(commitmentId: string, sql: Sql = db()): Promise<DisputeRow | null> {
  const [r] = await sql<DisputeRow[]>`
    select ${sql.unsafe(PUBLIC_COLS)} from disputes where commitment_id = ${commitmentId} and status = 'accepted' order by decided_at limit 1`;
  return r ?? null;
}

export async function decideDispute(
  input: { id: string; action: "accept" | "reject" | "resolve"; note: string; reviewer: string },
  sql: Sql = db(),
): Promise<DisputeRow> {
  const note = input.note.trim();
  if (note.length < 5) throw new Invalid("add a short note explaining the decision");
  return sql.begin(async (tx) => {
    const [d] = await tx<DisputeRow[]>`select ${tx.unsafe(PUBLIC_COLS)} from disputes where id = ${input.id} for update`;
    if (!d) throw new NotFound("no such dispute");
    const allowed: Record<string, DisputeRow["status"][]> = { accept: ["open"], reject: ["open", "accepted"], resolve: ["accepted"] };
    if (!allowed[input.action].includes(d.status)) throw new Invalid(`a dispute that is ${d.status} cannot be ${input.action}ed`);
    const next = input.action === "accept" ? "accepted" : input.action === "reject" ? "rejected" : "resolved";
    const [row] = await tx<DisputeRow[]>`
      update disputes set status = ${next}, resolution = ${`${note} (${input.reviewer})`.slice(0, 4000)},
        decided_at = coalesce(decided_at, now()), resolved_at = ${next === "resolved" || next === "rejected" ? tx`now()` : null}
      where id = ${input.id} returning ${tx.unsafe(PUBLIC_COLS)}`;
    await tx`insert into admin_log (action, target, detail) values (${`dispute_${input.action}`}, ${input.id}, ${tx.json({ note, reviewer: input.reviewer })})`;
    // Re-check now so the overlay is applied (accept) or lifted (reject/resolve) with a fresh receipt.
    await tx`update commitments set next_check_at = now(), final = false where id = ${d.commitment_id}`;
    await enqueue(tx, "commitment.disputed", d.commitment_id, `${input.id}:${next}`, { commitment_id: d.commitment_id, dispute_id: input.id, status: next });
    return row;
  });
}
