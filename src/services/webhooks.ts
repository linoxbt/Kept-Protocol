/**
 * Signed webhooks. Header: Kept-Webhook-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>.
 * Receivers reject timestamps older than 5 minutes. Delivery is driven from the transactional
 * outbox, so an event is never lost between a status change and its notification. Retries back
 * off for 24 hours. Webhook URLs go through the same SSRF guard as source capture.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, type Sql } from "@/db/client";
import { checkUrl } from "@/extraction/capture";
import { newId } from "@/lib/ids";

export const EVENT_TYPES = [
  "commitment.status_changed",
  "commitment.condition_failed",
  "commitment.satisfied",
  "commitment.deadline_approaching",
  "commitment.version_created",
  "source.changed",
  "transfer.detected",
] as const;

export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifyWebhook(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function registerWebhook(input: { url: string; events: string[]; projectId?: string | null }, sql: Sql = db()) {
  checkUrl(input.url);
  const events = input.events.filter((e) => (EVENT_TYPES as readonly string[]).includes(e));
  if (!events.length) throw new Error("no valid event types");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const id = newId("kw");
  await sql`insert into webhooks (id, url, secret, events, project_id) values (${id}, ${input.url}, ${secret}, ${events}, ${input.projectId ?? null})`;
  return { id, url: input.url, events, secret };
}

interface OutboxRow {
  id: string;
  event_type: string;
  commitment_id: string | null;
  payload: object;
  created_at: Date;
}

/** Fans pending outbox events out to webhook subscriptions, then delivers due attempts. */
export async function deliverOutbox(limit = 50, sql: Sql = db()): Promise<{ queued: number; delivered: number; failed: number }> {
  const events = await sql<OutboxRow[]>`select id::text, event_type, commitment_id, payload, created_at from outbox where delivered_at is null order by id limit ${limit}`;
  let queued = 0;
  for (const e of events) {
    const hooks = await sql<{ id: string }[]>`
      select w.id from webhooks w
      left join commitments c on c.id = ${e.commitment_id}
      where w.active and ${e.event_type} = any(w.events) and (w.project_id is null or w.project_id = c.project_id)`;
    for (const h of hooks) {
      await sql`insert into webhook_deliveries (webhook_id, outbox_id, status) values (${h.id}, ${e.id}, 'pending') on conflict do nothing`;
      queued++;
    }
    await sql`update outbox set delivered_at = now() where id = ${e.id}`;
  }

  const due = await sql<{ webhook_id: string; outbox_id: string; attempts: number; url: string; secret: string; event_type: string; payload: object; created_at: Date }[]>`
    select d.webhook_id, d.outbox_id::text, d.attempts, w.url, w.secret, o.event_type, o.payload, o.created_at
    from webhook_deliveries d join webhooks w on w.id = d.webhook_id join outbox o on o.id = d.outbox_id
    where d.status = 'pending' and d.next_attempt_at <= now()
    order by d.next_attempt_at limit ${limit}`;
  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    const body = JSON.stringify({ id: `evt_${d.outbox_id}`, type: d.event_type, created_at: d.created_at.toISOString(), data: d.payload });
    let code: number | null = null;
    let err: string | null = null;
    try {
      checkUrl(d.url);
      const res = await fetch(d.url, {
        method: "POST",
        headers: { "content-type": "application/json", "kept-webhook-signature": signWebhook(d.secret, body), "user-agent": "Kept-Webhooks/1.0" },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      code = res.status;
      if (!res.ok) err = `HTTP ${res.status}`;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const attempts = d.attempts + 1;
    if (!err) {
      delivered++;
      await sql`update webhook_deliveries set status = 'delivered', attempts = ${attempts}, response_code = ${code}, last_error = null where webhook_id = ${d.webhook_id} and outbox_id = ${d.outbox_id}`;
    } else {
      const giveUp = Date.now() - d.created_at.getTime() > 24 * 3600_000;
      if (giveUp) failed++;
      const backoff = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
      await sql`update webhook_deliveries set status = ${giveUp ? "failed" : "pending"}, attempts = ${attempts}, response_code = ${code}, last_error = ${err.slice(0, 500)},
                  next_attempt_at = now() + make_interval(secs => ${backoff})
                where webhook_id = ${d.webhook_id} and outbox_id = ${d.outbox_id}`;
    }
  }
  return { queued, delivered, failed };
}
