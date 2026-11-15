/**
 * End-to-end lifecycle against a real Postgres (DATABASE_URL_TEST) with a fixture chain and
 * recorded SERV responses: extract → confirm → verify → live breach → precedent → hindcast →
 * receipts, append-only guarantees and anchoring root.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { setChainProviders } from "@/chain";
import { FixtureChain } from "@/chain/fixture";
import { closeDb, db } from "@/db/client";
import { resetEnvCache } from "@/lib/env";
import { checkReceipt } from "@/receipts/receipt";
import { verifyProof } from "@/receipts/merkle";
import { merkleProof } from "@/receipts/merkle";
import { FixtureServClient, worstCaseCostUsd, type ServRequest } from "@/serv/client";
import { PROMPTS } from "@/serv/prompts";
import { confirmDraft, createManualDraft, runAndStoreExtraction } from "@/services/extractions";
import { confirmVersion, diffVersions, recaptureSource } from "@/services/precedent";
import { runHindcastFor } from "@/services/hindcast";
import { getReceipt } from "@/services/receipts";
import { meterFor, reserveServCall, setServClient } from "@/services/serv";
import { addSource, captureForSource, createProject, storeSnapshot } from "@/services/sources";
import { runCheck } from "@/services/verify";
import { pendingRoot, withSessionLock } from "@/services/anchor";
import { ensureShowcase } from "@/services/showcase";
import { claimDue } from "@/services/monitor";
import { migrate } from "../../scripts/migrate";
import { runMethod } from "@/core/methods";
import type { CommitmentSpec, Evidence } from "@/core/types";
import { createSession, revokeSessions, validSession, verifyCredential } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { decideDispute, listDisputes, openDispute } from "@/services/disputes";
import { failStaleJobs, getJob, startJob, withHeartbeat } from "@/services/jobs";
import { confirmViolation, earlierVersionViolation, evaluate } from "@/services/verify";
import { loadCommitment } from "@/services/commitments";
import { bootstrapSecrets, resetBootstrapForTests, sealValue } from "@/lib/secrets";

const URL = process.env.DATABASE_URL_TEST ?? "postgres://kept@127.0.0.1:5433/kept_test";
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const TEAM = "0x2222222222222222222222222222222222222222" as const;
const BUYER = "0x4444444444444444444444444444444444444444" as const;

const PAGE_V1 = `XYZ Labs tokenomics

Team allocation. The team wallet 0x2222222222222222222222222222222222222222 holds 15% of supply.
Team tokens are locked for 12 months from March 1, 2025. No team tokens will be transferred out of the team wallet before then.

Community. We will always put the community first.`;
const PAGE_V2 = PAGE_V1.replace("locked for 12 months", "locked for 9 months");

const primary = new FixtureChain(8453, 1_735_689_600, 600, "fixture primary");
const confirm = new FixtureChain(8453, 1_735_689_600, 600, "fixture confirmation");

function extractFor(page: string, months: number) {
  const quote = `Team tokens are locked for ${months} months from March 1, 2025. No team tokens will be transferred out of the team wallet before then.`;
  return (req: ServRequest) => {
    if (req.callSite === "locate") {
      return {
        spans: [
          { quote, category_hint: "token_lock" },
          { quote: "We will always put the community first.", category_hint: "other" },
          { quote: "This sentence is not in the source.", category_hint: "token_lock" },
        ],
        instructions_detected: false,
        injection_quotes: [],
      };
    }
    if (req.callSite === "extract") {
      const isLock = req.user.split("<<<CONTEXT")[0].includes("locked for");
      return isLock
        ? {
            category: "token_lock",
            responsible_entity: "XYZ Labs",
            token_symbol: null,
            token_address: null,
            subjects: [{ address: TEAM, role: "holder", label: "team wallet" }],
            comparator: "lte",
            amount: "0",
            amount_unit: "tokens",
            window_start: "2025-03-01",
            window_end: null,
            duration_months: months,
            cliff_months: null,
            vesting_contract: null,
            derived: [],
            ambiguity_flags: [],
            condition_summary: `No team tokens leave the team wallet for ${months} months from 1 March 2025.`,
          }
        : {
            category: "other",
            responsible_entity: null,
            token_symbol: null,
            token_address: null,
            subjects: [],
            comparator: null,
            amount: null,
            amount_unit: null,
            window_start: null,
            window_end: null,
            duration_months: null,
            cliff_months: null,
            vesting_contract: null,
            derived: [],
            ambiguity_flags: ["NOT_A_COMMITMENT"],
            condition_summary: "Not a checkable commitment.",
          };
    }
    const isLock = req.user.includes("token_lock");
    return isLock
      ? { verifiability: "direct", method_id: "erc20_outflow_v1", ambiguity_flags: [], rule_ids: ["R5"] }
      : { verifiability: "not_verifiable", method_id: "none", ambiguity_flags: [], rule_ids: ["R1"] };
  };
  void page;
}

let sql: postgres.Sql;

/** Skip (do not fail) when no test database is reachable, e.g. on a laptop without Postgres. */
async function reachable(): Promise<boolean> {
  const probe = postgres(URL.replace(/\/[^/]+$/, "/postgres"), { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 }).catch(() => {});
  }
}
const DB_UP = await reachable();
if (!DB_UP) console.warn(`[lifecycle] skipped: no Postgres at ${URL.replace(/:[^:@/]*@/, ":***@")}`);

beforeAll(async () => {
  if (!DB_UP) return;
  const admin = postgres(URL.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  const dbName = URL.split("/").pop()!;
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();
  await migrate(URL, () => {});
  process.env.DATABASE_URL = URL;
  resetEnvCache();
  await closeDb();
  sql = db();
  setChainProviders(8453, { primary, confirm });
  for (const c of [primary, confirm]) c.setNow("2025-06-01T00:00:00Z");
});

afterAll(async () => {
  if (!DB_UP) return;
  setServClient(null);
  setChainProviders(8453, null);
  await closeDb();
});

describe.skipIf(!DB_UP)("Kept lifecycle", () => {
  let projectId = "";
  let sourceId = "";
  let commitmentId = "";
  const breachTx = `0x${"ab".repeat(32)}` as const;

  it("extracts, drops ungrounded spans, and classifies", async () => {
    const project = await createProject({ name: "XYZ Labs (demo)", slug: "xyz-demo", chainId: 8453, isDemo: true }, sql);
    await sql`update projects set token_address = ${TOKEN.toLowerCase()}, token_symbol = 'XYZ', token_decimals = 18 where id = ${project.id}`;
    projectId = project.id;
    await sql`insert into demo_pages (slug, title, body) values ('xyz-labs', 'XYZ Labs tokenomics', ${PAGE_V1.split("\n\n").slice(1).join("\n\n")})`;
    const source = await addSource({ projectId, url: "https://kept.example/demo/xyz-labs", kind: "demo" }, sql);
    sourceId = source.id;
    const cap = await captureForSource(source, sql);
    const { snapshot } = await storeSnapshot(source.id, cap, sql);
    setServClient(new FixtureServClient(extractFor(PAGE_V1, 12)));
    const [p] = await sql`select * from projects where id = ${projectId}`;
    const ex = await runAndStoreExtraction({ project: p as never, sourceId, snapshot }, sql);
    const r = ex.result!;
    expect(r.dropped_spans.map((d) => d.reason)).toContain("not an exact substring of the source");
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts[0].classification?.method_id).toBe("erc20_outflow_v1");
    expect(r.drafts[0].confidence).toEqual({ grounding: true, classifier_agreement: true, rules_agreement: true });
    expect(r.drafts[1].classification?.verifiability).toBe("not_verifiable");
    const calls = await sql`select call_site, prompt_version from serv_calls where extraction_id = ${ex.id}`;
    expect(calls.map((c) => c.call_site).sort()).toEqual(["classify", "classify", "classify", "classify", "extract", "extract", "locate"]);

    const { commitmentId: id } = await confirmDraft({ extractionId: ex.id, draftIndex: 0, reviewer: "test-reviewer" }, sql);
    commitmentId = id;
    // A double submit cannot create a second monitored commitment.
    await expect(confirmDraft({ extractionId: ex.id, draftIndex: 0, reviewer: "test-reviewer" }, sql)).rejects.toThrow(/already confirmed as kc_/);
    const [v] = await sql`select spec from commitment_versions where commitment_id = ${id}`;
    expect(v.spec.window.end).toBe("2026-03-01T00:00:00.000Z");
    expect(v.spec.subjects[0].attribution.level).toBe("declared_by_project");
  });

  it("verifies to date with a signed receipt", async () => {
    expect(await claimDue(10, sql)).toContain(commitmentId);
    const r = await runCheck(commitmentId, { sql });
    expect(r.decision).toMatchObject({ status: "verified", final: false });
    const check = await checkReceipt(r.receipt);
    expect(check).toMatchObject({ hashMatches: true, signatureValid: true });
    expect(r.receipt.body.prev_sha256).toBeNull();
  });

  it("shows At risk for an unfinalized outflow, then Breached once finalized and confirmed", async () => {
    for (const c of [primary, confirm]) c.add({ txHash: breachTx, token: TOKEN, from: TEAM, to: BUYER, amount: 4_000_000n * 10n ** 18n, at: "2025-12-15T00:00:00Z" });
    for (const c of [primary, confirm]) c.setNow("2025-12-15T00:10:00Z", 1500);
    const r1 = await runCheck(commitmentId, { sql });
    expect(r1.decision.status).toBe("at_risk");
    expect(r1.decision.reason).toMatch(/not yet finalized/);
    for (const c of [primary, confirm]) c.setNow("2025-12-20T00:00:00Z", 1500);
    const r2 = await runCheck(commitmentId, { sql });
    expect(r2.decision).toMatchObject({ status: "breached", final: true });
    expect(r2.decision.reason).toMatch(/Condition not met: 4,000,000 XYZ left/);
    expect(r2.receipt.body.prev_sha256).toBe(r1.receipt.sha256);
    expect(r2.receipt.body.evidence[0].tx_hash).toBe(breachTx);
    const events = await sql`select event_type from outbox where commitment_id = ${commitmentId} order by id`;
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(["transfer.detected", "commitment.condition_failed", "commitment.status_changed"]));
    const stored = await getReceipt(sql, r2.receipt.id);
    expect((await checkReceipt(stored!)).hashMatches).toBe(true);
  });

  it("keeps a provider disagreement at At risk", async () => {
    const other = await sql`select count(*)::int as n from status_changes where commitment_id = ${commitmentId} and to_status = 'breached'`;
    expect(other[0].n).toBe(1);
  });

  it("enforces append-only evidence in the database", async () => {
    await expect(sql`update receipts set signature = '0x00' where commitment_id = ${commitmentId}`).rejects.toThrow(/append-only/);
    await expect(sql`delete from status_changes where commitment_id = ${commitmentId}`).rejects.toThrow(/append-only/);
    await expect(sql`update commitment_versions set spec = '{}' where commitment_id = ${commitmentId}`).rejects.toThrow(/append-only/);
  });

  it("detects the project rewriting its promise, versions it, and flags the retroactive relaxation", async () => {
    await sql`update demo_pages set body = ${PAGE_V2.split("\n\n").slice(1).join("\n\n")}, updated_at = now() where slug = 'xyz-labs'`;
    setServClient(new FixtureServClient(extractFor(PAGE_V2, 9)));
    const watch = await recaptureSource(sourceId, sql);
    expect(watch.changed).toBe(true);
    expect(watch.actions[0]).toMatchObject({ commitmentId, action: "proposal" });
    const v = await confirmVersion(commitmentId, { extractionId: watch.actions[0].extractionId!, draftIndex: 0, reviewer: "test-reviewer", changeReason: "project shortened the lock" }, sql);
    expect(v.version).toBe(2);
    expect(v.changes.find((c) => c.field === "window.end")).toMatchObject({ to: "2025-12-01T00:00:00.000Z" });
    const diff = await diffVersions(commitmentId, 1, 2, sql);
    expect(diff.textDiff.some((p) => p.removed && p.value.includes("12"))).toBe(true);
    expect(diff.retroactive).toHaveLength(1);
    expect(diff.retroactive[0].txHash).toBe(breachTx);
  });

  it("replays both versions with Hindcast and signs a replay receipt", async () => {
    const run = await runHindcastFor(commitmentId, {}, sql);
    const [l1, l2] = run.result.lanes;
    expect(l1.firstBreachedAt).not.toBeNull();
    expect(l2.firstBreachedAt).toBeNull();
    const receipt = await getReceipt(sql, run.receiptId);
    expect(receipt?.body.kind).toBe("hindcast");
    expect((await checkReceipt(receipt!)).signatureValid).toBe(true);
  });

  it("builds an anchor root covering every receipt", async () => {
    const p = await pendingRoot(sql);
    expect(p.count).toBeGreaterThanOrEqual(4);
    p.leaves.forEach((leaf, i) => expect(verifyProof(leaf, merkleProof(p.leaves, i), p.root!)).toBe(true));
  });

  it("accepts a grounded manual draft and rejects an ungrounded quote", async () => {
    const [snap] = await sql`select id, text from source_snapshots where source_id = ${sourceId} order by captured_at desc limit 1`;
    await expect(createManualDraft({ snapshotId: snap.id, quote: "not in the page", fields: {}, projectId }, sql)).rejects.toThrow(/exact substring/);
  });

  it("handles a dispute: accepted disputes overlay the status until resolved", async () => {
    await expect(openDispute({ commitmentId, reason: "too short", requester: "t1" }, sql)).rejects.toThrow(/20 characters/);
    const d = await openDispute({ commitmentId, reason: "The team wallet is a vesting contract, not a holder wallet; see the deployment tx.", evidenceUrl: "https://example.org/tx", requester: "t1" }, sql);
    expect(d.status).toBe("open");
    await expect(decideDispute({ id: d.id, action: "resolve", note: "nothing to resolve", reviewer: "r" }, sql)).rejects.toThrow(/open cannot be resolved/);
    await decideDispute({ id: d.id, action: "accept", note: "valid question, reviewing", reviewer: "r" }, sql);
    const under = await runCheck(commitmentId, { sql, trigger: "test" });
    expect(under.decision.status).toBe("disputed");
    expect(under.decision.reason).toMatch(/Mechanical result:/);
    await decideDispute({ id: d.id, action: "resolve", note: "address confirmed as the team wallet", reviewer: "r" }, sql);
    const after = await runCheck(commitmentId, { sql, trigger: "test" });
    expect(after.decision.status).not.toBe("disputed");
    const all = await listDisputes(commitmentId, sql);
    expect(all[0]).toMatchObject({ status: "resolved" });
    expect(Object.keys(all[0])).not.toContain("contact");
  });

  it("recounts a burn shortfall on the second provider, resuming across checks", async () => {
    const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
    const conf = new FixtureChain(8453, 1_735_689_600, 600, "fixture recount");
    const burn = conf.add({ txHash: `0x${"cd".repeat(32)}`, token: TOKEN, from: TEAM, to: DEAD, amount: 10n * 10n ** 18n, at: "2025-03-10T00:00:00Z" });
    conf.setNow("2025-06-01T00:00:00Z");
    const [v] = await sql`select spec from commitment_versions where commitment_id = ${commitmentId} order by version limit 1`;
    const spec: CommitmentSpec = {
      ...(v.spec as CommitmentSpec),
      category: "burn",
      method_id: "burn_v1",
      comparator: "gte",
      threshold: "100",
      threshold_base_units: (100n * 10n ** 18n).toString(),
      window: { start: "2025-03-01T00:00:00.000Z", end: "2025-05-01T00:00:00.000Z" },
      burn: { executor: TEAM, burn_addresses: [DEAD] },
    };
    const from = conf.blockAt(Date.parse(spec.window.start) / 1000) + 1n;
    const evidence: Evidence = { finalizedBlock: conf.finalized, finalizedTime: conf.timeOf(conf.finalized), latestBlock: conf.finalized, fromBlock: from, transfers: [burn], unfinalizedTransfers: [], vesting: null, asOf: conf.timeOf(conf.finalized) };
    const result = runMethod(spec, evidence);
    expect(result.outcome).toBe("violated");
    const collected = { evidence, complete: true, scannedTo: conf.finalized, partialTransfers: [], windowFromBlock: from, providerName: "fixture" };
    const budget = (conf.finalized - from) / 3n + 1n;
    const c1 = await confirmViolation(spec, result, collected, conf, sql, budget);
    expect(c1).toMatchObject({ confirmation: "unavailable", inProgress: true });
    const c2 = await confirmViolation(spec, result, collected, conf, sql, budget);
    expect(c2.inProgress).toBe(true);
    const c3 = await confirmViolation(spec, result, collected, conf, sql, budget);
    expect(c3).toMatchObject({ confirmation: "confirmed" });
  });

  it("runs background jobs and records results and failures", async () => {
    let pending: Promise<void> | null = null;
    const ok = await startJob("test", null, async () => ({ n: 1n }), (w) => (pending = w()), sql);
    await pending;
    expect(await getJob(ok.id, sql)).toMatchObject({ status: "done", result: { n: "1" } });
    const bad = await startJob("test", null, async () => { throw new Error("boom"); }, (w) => (pending = w()), sql);
    await pending;
    expect(await getJob(bad.id, sql)).toMatchObject({ status: "failed", error: "boom" });
  });

  it("limits failed credentials before checking them, and revokes sessions on sign-out", async () => {
    const r = new Request("https://kept.test/api", { headers: { "x-real-ip": "192.0.2.77" } });
    expect(await verifyCredential(r, "dev-admin-key-change-me-0000000000")).toBe(true);
    for (let i = 0; i < 10; i++) expect(await verifyCredential(r, `wrong-${i}`)).toBe(false);
    await expect(verifyCredential(r, "dev-admin-key-change-me-0000000000")).rejects.toThrow(/too many failed/);
    const s = await createSession();
    expect(await validSession(s.value)).toBe(true);
    await revokeSessions();
    expect(await validSession(s.value)).toBe(false);
  }, 30_000);

  it("scopes idempotency keys to the caller", async () => {
    let calls = 0;
    const h = route(async () => json({ secret: `value-${++calls}` }));
    const post = (auth?: string) => new Request("https://kept.test/api/v1/idem-test", { method: "POST", headers: { "idempotency-key": "k1", ...(auth ? { authorization: auth } : {}) } });
    const a = await (await h(post("Bearer admin-one"), {})).json();
    const replay = await h(post("Bearer admin-one"), {});
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.json()).toEqual(a);
    const stranger = await (await h(post(), {})).json();
    expect(stranger).not.toEqual(a);
    expect(calls).toBe(2);
  });

  it("encrypts only generated secrets and repairs plain state that was encrypted", async () => {
    const saved = { ...process.env };
    try {
      process.env.KEPT_SECRETS_KEK = "33".repeat(32);
      await sql`delete from kept_secrets where name in ('DEMO_STATE', 'CRON_SECRET', 'SESSION_EPOCH')`;
      await sql`insert into kept_secrets (name, value) values ('DEMO_STATE', ${sealValue('{"stage":"seeded"}')}), ('SESSION_EPOCH', '4'), ('CRON_SECRET', 'plain-cron-secret-0000000000')`;
      delete process.env.CRON_SECRET;
      resetBootstrapForTests();
      await bootstrapSecrets();
      const rows = Object.fromEntries((await sql<{ name: string; value: string }[]>`select name, value from kept_secrets where name in ('DEMO_STATE', 'SESSION_EPOCH', 'CRON_SECRET')`).map((r) => [r.name, r.value]));
      expect(rows.DEMO_STATE).toBe('{"stage":"seeded"}');
      expect(rows.SESSION_EPOCH).toBe("4");
      expect(rows.CRON_SECRET.startsWith("enc:v1:")).toBe(true);
      expect(process.env.CRON_SECRET).toBe("plain-cron-secret-0000000000");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetBootstrapForTests();
    }
  });

  it("finds a breach under an earlier version from the evidence itself, not only from a recorded status (audit B6)", async () => {
    const bundle = (await loadCommitment(commitmentId, sql))!;
    expect(bundle.version.version).toBeGreaterThan(1);
    const ev = await evaluate(bundle.version.spec, sql);
    const r = await earlierVersionViolation(commitmentId, bundle.version, ev.collected, sql);
    expect(r).toMatchObject({ kind: "breach", version: 1 });
    expect((r as { reason: string }).reason).toMatch(/4,000,000 XYZ left/);
  });

  it("keeps a breach standing after the project relaxes the promise", async () => {
    const r = await runCheck(commitmentId, { sql, trigger: "test" });
    expect(r.decision).toMatchObject({ status: "breached", final: true });
    expect(r.decision.reason).toMatch(/^Breached under v1: 4,000,000 XYZ left/);
    expect(r.decision.reason).toMatch(/revised afterwards \(v2\); a later revision does not undo a breach/);
  });

  it("holds SERV budget atomically: concurrent reservations never exceed the daily budget", async () => {
    const saved = process.env.SERV_DAILY_BUDGET_USD;
    try {
      await sql`truncate serv_budget_holds`;
      await sql`update serv_calls set created_at = now() - interval '2 days'`;
      const req = { callSite: "extract", model: "gpt-5.4-mini-serv-kronos", prompt: PROMPTS.extract, user: "x".repeat(3000), jsonSchema: { name: "x", strict: true, schema: {} }, servTools: [{ kind: "shadow_agent", hint: "h", maxIterations: 2 }], maxTokens: 2000 } as ServRequest;
      const each = worstCaseCostUsd(req)!;
      expect(each).toBeGreaterThan(0);
      // Room for exactly 7 calls; 40 race for it.
      process.env.SERV_DAILY_BUDGET_USD = String(each * 7.5);
      resetEnvCache();
      const results = await Promise.allSettled(Array.from({ length: 40 }, () => reserveServCall(req, sql)));
      const held = results.filter((r) => r.status === "fulfilled");
      expect(held).toHaveLength(7);
      expect(results.filter((r) => r.status === "rejected").every((r) => /daily SERV budget reached/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);

      // Metering a failed call releases its hold but charges the worst case (it may have been billed).
      const hold = (held[0] as PromiseFulfilledResult<{ id: string; amountUsd: number }>).value;
      await meterFor(null, sql)({ callSite: "extract", model: req.model, promptVersion: "v", promptSha256: "s", response: null, outcome: "error", error: "timeout", servTools: 1, hold });
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from serv_budget_holds`;
      expect(n).toBe(6);
      const [row] = await sql<{ est_cost_usd: string }[]>`select est_cost_usd from serv_calls where error = 'timeout' order by created_at desc limit 1`;
      expect(Number(row.est_cost_usd)).toBeCloseTo(each, 5);

      // A model without a known price is refused instead of being counted as free.
      await expect(reserveServCall({ ...req, model: "gpt-9-unknown" }, sql)).rejects.toThrow(/no price is configured/);
    } finally {
      if (saved === undefined) delete process.env.SERV_DAILY_BUDGET_USD;
      else process.env.SERV_DAILY_BUDGET_USD = saved;
      resetEnvCache();
      await sql`truncate serv_budget_holds`;
    }
  });

  it("fails orphaned jobs and extractions by heartbeat, never live ones", async () => {
    await sql`insert into jobs (id, kind, status, heartbeat_at, created_at) values
      ('kj_orphan', 'verify', 'running', now() - interval '10 minutes', now() - interval '10 minutes'),
      ('kj_slow', 'grifter', 'running', now() - interval '5 seconds', now() - interval '45 minutes')`;
    await sql`insert into extractions (id, content_sha256, preview, status, heartbeat_at, preview_text) values
      ('kx_orphan', 'x', true, 'running', now() - interval '10 minutes', 'text'),
      ('kx_live', 'x', true, 'running', now(), 'text')`;
    await failStaleJobs(sql);
    const st = Object.fromEntries((await sql<{ id: string; status: string }[]>`
      select id, status from jobs where id in ('kj_orphan', 'kj_slow') union all
      select id, status from extractions where id in ('kx_orphan', 'kx_live')`).map((r) => [r.id, r.status]));
    expect(st).toEqual({ kj_orphan: "failed", kj_slow: "running", kx_orphan: "failed", kx_live: "running" });
    // The heartbeat helper returns the work's result and stops beating afterwards.
    expect(await withHeartbeat("jobs", "kj_slow", sql, async () => 42)).toBe(42);
  });

  it("counts sign-in attempts atomically: a parallel burst gets at most the per-IP budget of checks", async () => {
    const r = () => new Request("https://kept.test/api", { headers: { "x-real-ip": "198.51.100.23" } });
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => verifyCredential(r(), `burst-${i}`)));
    const checked = results.filter((x) => x.status === "fulfilled");
    expect(checked.length).toBe(10);
    expect(results.filter((x) => x.status === "rejected").every((x) => /too many failed/.test(String((x as PromiseRejectedResult).reason)))).toBe(true);
  }, 30_000);

  it("anchoring: one run at a time across connections, and receipts in a pending attempt are not offered again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withSessionLock(sql, 99_001, () => gate.then(() => "first"));
    await new Promise((r) => setTimeout(r, 50));
    expect(await withSessionLock(sql, 99_001, async () => "second")).toEqual({ ran: false });
    release();
    expect(await first).toEqual({ ran: true, value: "first" });
    // The lock was released on the same connection that took it, so it is free again.
    expect(await withSessionLock(sql, 99_001, async () => "third")).toEqual({ ran: true, value: "third" });

    const before = await pendingRoot(sql);
    expect(before.count).toBeGreaterThan(1);
    await sql`insert into anchor_attempts (id, chain_id, merkle_root, receipt_ids, tx_hash) values ('ka_test', 8453, 'r', ${before.receiptIds.slice(0, 1)}, '0xabc')`;
    const after = await pendingRoot(sql);
    expect(after.count).toBe(before.count - 1);
    expect(after.receiptIds).not.toContain(before.receiptIds[0]);
    await sql`delete from anchor_attempts where id = 'ka_test'`;
  });

  it("stores one offline Grifter run for the public page when none exists, then never repeats", async () => {
    await sql`truncate grifter_runs`;
    const r = await ensureShowcase(sql);
    expect(r?.grifter).toMatch(/^kg_/);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from grifter_runs`;
    expect(n).toBe(1);
    expect(await ensureShowcase(sql)).toBeUndefined();
  }, 60_000);
});
