/**
 * Follow a commitment: a signed webhook that receives that commitment's events only. To stop Kept
 * being used to send requests to endpoints the requester does not control, a follow starts
 * inactive and Kept POSTs a one-time code to the endpoint; the follower submits it back to
 * activate. A manage token (shown once; only its hash is stored) stops the follow.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { fetch as undiciFetch } from "undici";
import { db, type Sql } from "@/db/client";
import { checkUrl, safeDispatcher } from "@/extraction/capture";
import { newId } from "@/lib/ids";
import { sealValue } from "@/lib/secrets";
import { RateLimited } from "./preview";
import { hit } from "./ratelimit";
import { Invalid, NotFound } from "./sources";
import { signWebhook } from "./webhooks";

export const FOLLOW_EVENTS = [
  "commitment.status_changed",
  "commitment.condition_failed",
  "commitment.satisfied",
  "commitment.deadline_approaching",
  "commitment.version_created",
  "commitment.disputed",
];

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startFollow(input: { commitmentId: string; url: string; requester: string }, sql: Sql = db()) {
  const [c] = await sql<{ id: string }[]>`select id from commitments where id = ${input.commitmentId}`;
  if (!c) throw new NotFound("commitment not found");
  try {
    checkUrl(input.url);
  } catch (e) {
    throw new Invalid(e instanceof Error ? e.message : "that URL cannot receive webhooks");
  }
  if (!input.url.startsWith("https://")) throw new Invalid("the endpoint must use https");
  const limit = await hit(`follow:${input.requester}`, 5, 86_400, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  const id = newId("kw");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const manageToken = `kmt_${randomBytes(24).toString("hex")}`;
  const code = String(randomInt(100000, 999999));
  await sql`insert into webhooks (id, url, secret, events, commitment_id, follower, active, manage_token_hash, verify_code_hash)
            values (${id}, ${input.url}, ${sealValue(secret)}, ${FOLLOW_EVENTS}, ${input.commitmentId}, true, false, ${sha(manageToken)}, ${sha(code)})`;
  // Send the code to the endpoint itself: only someone who can read what it receives can activate.
  const body = JSON.stringify({ id: `evt_verify_${id}`, type: "kept.follow.verify", created_at: new Date().toISOString(), data: { follow_id: id, commitment_id: input.commitmentId, code } });
  let delivered = false;
  let error: string | null = null;
  try {
    const res = await undiciFetch(input.url, {
      method: "POST",
      headers: { "content-type": "application/json", "kept-webhook-signature": signWebhook(secret, body), "user-agent": "Kept-Webhooks/1.0" },
      body,
      redirect: "manual",
      dispatcher: safeDispatcher,
      signal: AbortSignal.timeout(10_000),
    });
    delivered = res.ok;
    if (!res.ok) error = `the endpoint answered HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { id, secret, manage_token: manageToken, verification_sent: delivered, error };
}

async function loadFollow(id: string, token: string, sql: Sql) {
  const [w] = await sql<{ id: string; manage_token_hash: string | null; verify_code_hash: string | null; active: boolean; follower: boolean; commitment_id: string | null; url: string; verified_at: Date | null; created_at: Date }[]>`
    select id, manage_token_hash, verify_code_hash, active, follower, commitment_id, url, verified_at, created_at from webhooks where id = ${id}`;
  if (!w?.follower || !w.manage_token_hash || !same(w.manage_token_hash, sha(token))) throw new NotFound("follow not found");
  return w;
}

export async function verifyFollow(input: { id: string; token: string; code: string }, sql: Sql = db()) {
  const w = await loadFollow(input.id, input.token, sql);
  const limit = await hit(`follow-verify:${input.id}`, 10, 3600, sql);
  if (!limit.allowed) throw new RateLimited(limit.resetAt);
  if (!w.verify_code_hash || !same(w.verify_code_hash, sha(input.code.trim()))) throw new Invalid("that code does not match the one sent to your endpoint");
  await sql`update webhooks set active = true, verified_at = now(), verify_code_hash = null where id = ${w.id}`;
  return { id: w.id, active: true, commitment_id: w.commitment_id };
}

export async function stopFollow(input: { id: string; token: string }, sql: Sql = db()) {
  const w = await loadFollow(input.id, input.token, sql);
  await sql`update webhooks set active = false where id = ${w.id}`;
  return { id: w.id, active: false };
}

export async function followStatus(input: { id: string; token: string }, sql: Sql = db()) {
  const w = await loadFollow(input.id, input.token, sql);
  const deliveries = await sql<{ status: string; n: number }[]>`select status, count(*)::int as n from webhook_deliveries where webhook_id = ${w.id} group by status`;
  return { id: w.id, commitment_id: w.commitment_id, url: w.url, active: w.active, verified: !!w.verified_at, created_at: w.created_at, deliveries: Object.fromEntries(deliveries.map((d) => [d.status, d.n])) };
}
