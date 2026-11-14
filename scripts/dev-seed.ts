/**
 * LOCAL DEVELOPMENT ONLY. Fills a dev database with a clearly labelled demo project driven by the
 * in-memory fixture chain and recorded SERV outputs, so every page can be viewed without keys or
 * gas. Refuses to run against anything but localhost.
 */
import { setChainProviders } from "../src/chain";
import { FixtureChain } from "../src/chain/fixture";
import { closeDb, db } from "../src/db/client";
import { FixtureServClient, type ServRequest } from "../src/serv/client";
import { confirmDraft, runAndStoreExtraction } from "../src/services/extractions";
import { runHindcastFor } from "../src/services/hindcast";
import { confirmVersion, recaptureSource } from "../src/services/precedent";
import { setServClient } from "../src/services/serv";
import { addSource, captureForSource, createProject, storeSnapshot } from "../src/services/sources";
import { runCheck } from "../src/services/verify";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("dev-seed only runs against a local database");

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const TEAM = "0x2222222222222222222222222222222222222222" as const;
const BUYER = "0x4444444444444444444444444444444444444444" as const;
const body = (allow: string | null) => `Team allocation. The team wallet ${TEAM} holds 15,000,000 XYZ.
${allow ? `Team tokens are locked for 12 months from March 1, 2025. Up to ${allow} team tokens may be released for market making before then.` : "Team tokens are locked for 12 months from March 1, 2025. No team tokens will be transferred out of the team wallet before then."}

Community. We will always put the community first.`;

function serv(allow: string | null) {
  const quote = allow
    ? `Team tokens are locked for 12 months from March 1, 2025. Up to ${allow} team tokens may be released for market making before then.`
    : "Team tokens are locked for 12 months from March 1, 2025. No team tokens will be transferred out of the team wallet before then.";
  return new FixtureServClient((req: ServRequest) => {
    if (req.callSite === "locate") return { spans: [{ quote, category_hint: "token_lock" }, { quote: "We will always put the community first.", category_hint: "other" }], instructions_detected: false, injection_quotes: [] };
    if (req.callSite === "extract") {
      const lock = req.user.split("<<<CONTEXT")[0].includes("locked for");
      return lock
        ? { category: "token_lock", responsible_entity: "XYZ Labs", token_symbol: "XYZ", token_address: null, subjects: [{ address: TEAM, role: "holder", label: "team wallet" }], comparator: "lte", amount: allow ? allow.replaceAll(",", "") : "0", amount_unit: "tokens", window_start: "2025-03-01", window_end: null, duration_months: 12, cliff_months: null, vesting_contract: null, derived: [], ambiguity_flags: [], condition_summary: allow ? `At most ${allow} XYZ leaves the team wallet for 12 months from 1 March 2025.` : "No XYZ leaves the team wallet for 12 months from 1 March 2025." }
        : { category: "other", responsible_entity: null, token_symbol: null, token_address: null, subjects: [], comparator: null, amount: null, amount_unit: null, window_start: null, window_end: null, duration_months: null, cliff_months: null, vesting_contract: null, derived: [], ambiguity_flags: ["NOT_A_COMMITMENT"], condition_summary: "Not a checkable commitment." };
    }
    return req.user.includes("token_lock") ? { verifiability: "direct", method_id: "erc20_outflow_v1", ambiguity_flags: [], rule_ids: ["R5"] } : { verifiability: "not_verifiable", method_id: "none", ambiguity_flags: [], rule_ids: ["R1"] };
  });
}

async function main() {
  const sql = db();
  const primary = new FixtureChain(8453, 1_735_689_600, 600, "fixture primary (dev seed)");
  const confirm = new FixtureChain(8453, 1_735_689_600, 600, "fixture confirmation (dev seed)");
  setChainProviders(8453, { primary, confirm });
  for (const c of [primary, confirm]) c.setNow("2025-06-01T00:00:00Z");
  await sql`insert into demo_pages (slug, title, body) values ('xyz-labs', 'XYZ Labs tokenomics (dev fixture)', ${body(null)}) on conflict (slug) do update set body = excluded.body`;
  const project = await createProject({ name: "XYZ Labs (dev fixture)", slug: "xyz-labs-dev", chainId: 8453, isDemo: true, registrationLevel: "self", description: "Local development data on an in-memory chain. Never deployed." }, sql);
  await sql`update projects set token_address = ${TOKEN.toLowerCase()}, token_symbol = 'XYZ', token_decimals = 18 where id = ${project.id}`;
  const source = await addSource({ projectId: project.id, url: "http://localhost:3000/demo/xyz-labs", kind: "demo" }, sql);
  const { snapshot } = await storeSnapshot(source.id, await captureForSource(source, sql), sql);
  setServClient(serv(null));
  const ex = await runAndStoreExtraction({ project: { ...project, token_address: TOKEN.toLowerCase(), token_symbol: "XYZ", token_decimals: 18 }, sourceId: source.id, snapshot }, sql);
  const { commitmentId } = await confirmDraft({ extractionId: ex.id, draftIndex: 0, reviewer: "dev-seed" }, sql);
  console.log("verified:", (await runCheck(commitmentId, { sql })).decision.status);
  for (const c of [primary, confirm]) c.add({ txHash: `0x${"ab".repeat(32)}`, token: TOKEN, from: TEAM, to: BUYER, amount: 4_000_000n * 10n ** 18n, at: "2025-12-15T00:00:00Z" });
  for (const c of [primary, confirm]) c.setNow("2025-12-15T00:20:00Z", 1500);
  console.log("unfinalized:", (await runCheck(commitmentId, { sql })).decision.status);
  for (const c of [primary, confirm]) c.setNow("2025-12-20T00:00:00Z", 1500);
  console.log("finalized:", (await runCheck(commitmentId, { sql })).decision.status);
  await sql`update demo_pages set body = ${body("5,000,000")}, updated_at = now() where slug = 'xyz-labs'`;
  setServClient(serv("5,000,000"));
  const w = await recaptureSource(source.id, sql);
  const v = await confirmVersion(commitmentId, { extractionId: w.actions[0].extractionId!, draftIndex: 0, reviewer: "dev-seed", changeReason: "allowance raised for market making" }, sql);
  console.log("version", v.version, v.changeKind, "→", (await runCheck(commitmentId, { sql })).decision.status);
  const h = await runHindcastFor(commitmentId, {}, sql);
  console.log("hindcast", h.id, "\nopen http://localhost:3000/commitments/" + commitmentId);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
