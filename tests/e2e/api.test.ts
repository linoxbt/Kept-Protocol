/**
 * HTTP-level checks against a running Kept server. Skipped unless KEPT_E2E_URL is set. Tests that
 * write need KEPT_E2E_ADMIN_KEY (a real admin credential) and are skipped without it, so the suite
 * can run read-only against production:
 *   KEPT_E2E_URL=https://kept-protocol.netlify.app npx vitest run tests/e2e
 *   KEPT_E2E_URL=http://localhost:3100 KEPT_E2E_ADMIN_KEY=… npx vitest run tests/e2e
 */
import { createHash } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { describe, expect, it } from "vitest";

const BASE = process.env.KEPT_E2E_URL;
const KEY = process.env.KEPT_E2E_ADMIN_KEY;
const d = BASE ? describe : describe.skip;

d("Kept HTTP API", () => {
  it("reports health and publishes the signer in the agent card", async () => {
    const h = await (await fetch(`${BASE}/api/v1/health`)).json();
    expect(h.database).toBe("ok");
    const card = await (await fetch(`${BASE}/.well-known/agent-card.json`)).json();
    expect(card.signer.address).toBe(h.signer);
  });

  it("signs public responses over the exact body", async () => {
    const res = await fetch(`${BASE}/api/v1/projects`);
    const body = await res.text();
    const digest = createHash("sha256").update(body).digest("hex");
    const signer = await recoverMessageAddress({ message: { raw: `0x${digest}` }, signature: res.headers.get("kept-signature") as `0x${string}` });
    expect(signer).toBe(res.headers.get("kept-signer"));
  });

  it("refuses writes without the admin key, as RFC 9457 problems", async () => {
    const res = await fetch(`${BASE}/api/v1/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect((await res.json()).title).toBe("Unauthorized");
  });

  it.skipIf(!KEY)("validates bodies and replays idempotent POSTs", async () => {
    const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
    const bad = await fetch(`${BASE}/api/v1/projects`, { method: "POST", headers: auth, body: JSON.stringify({ name: "" }) });
    expect(bad.status).toBe(422);
    const key = `e2e-${Date.now()}`;
    const body = JSON.stringify({ name: `E2E ${key}`, chain_id: 8453 });
    const a = await fetch(`${BASE}/api/v1/projects`, { method: "POST", headers: { ...auth, "idempotency-key": key }, body });
    const b = await fetch(`${BASE}/api/v1/projects`, { method: "POST", headers: { ...auth, "idempotency-key": key }, body });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect((await a.json()).id).toBe((await b.json()).id);
  });

  it("blocks SSRF in try-it and pauses extraction without SERV", async () => {
    const ssrf = await fetch(`${BASE}/api/v1/tryit`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Date.now() % 250}.1` }, body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }) });
    expect([400, 503]).toContain(ssrf.status);
    const health = await (await fetch(`${BASE}/api/v1/health`)).json();
    if (health.serv === "paused") {
      const r = await fetch(`${BASE}/api/v1/tryit`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.8.${Date.now() % 250}.1` }, body: JSON.stringify({ text: "Team tokens are locked for 12 months from March 1, 2026." }) });
      expect(r.status).toBe(503);
      expect((await r.json()).detail).toMatch(/monitoring is unaffected/);
    }
  });

  it("answers an unknown token honestly and fails closed without a pay-to address", async () => {
    const r = await fetch(`${BASE}/api/v1/agent/commitments?chain_id=8453&token=0x0000000000000000000000000000000000000001`);
    expect([402, 503]).toContain(r.status);
  });

  it("serves receipts that verify", async () => {
    const feed = await (await fetch(`${BASE}/api/v1/feed`)).json();
    const id = feed.data.find((x: { receipt_id: string | null }) => x.receipt_id)?.receipt_id;
    if (!id) return;
    const r = await (await fetch(`${BASE}/api/v1/receipts/${id}`)).json();
    const { canonicalJson, receiptHash } = await import("@/receipts/receipt");
    expect(receiptHash(r.receipt)).toBe(r.sha256);
    expect(canonicalJson(r.receipt).length).toBeGreaterThan(100);
    const signer = await recoverMessageAddress({ message: { raw: `0x${r.sha256}` }, signature: r.signature });
    expect(signer).toBe(r.receipt.signer);
  });

  it("protects the cron endpoint", async () => {
    expect((await fetch(`${BASE}/api/cron/tick`)).status).toBe(401);
  });
});
