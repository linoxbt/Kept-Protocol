/**
 * Grifter runner: executes the golden suite against the real pipeline and verification code,
 * compares with expectations, and classifies failures by severity and layer. A prompt or method
 * version may not ship while any critical or high case fails.
 */
import { FixtureChain } from "@/chain/fixture";
import { METHOD_VERSIONS, runMethod } from "@/core/methods";
import { deriveStatus } from "@/core/status";
import type { Evidence } from "@/core/types";
import { runExtraction } from "@/extraction/pipeline";
import { buildSpec } from "@/extraction/spec";
import { FixtureServClient, type ServClient, type ServRequest } from "@/serv/client";
import { PROMPTS } from "@/serv/prompts";
import { confirmViolation } from "@/services/verify";
import { CASES, type ChainCase, type ExtractionCase, type Family, type GrifterCase, type Layer, type Severity } from "./cases";

export interface CaseResult {
  id: string;
  family: Family;
  title: string;
  severity: Severity;
  layer: Layer;
  passed: boolean;
  failures: string[];
  observed: Record<string, unknown>;
}

export interface GrifterReport {
  mode: "offline" | "live";
  prompt_versions: Record<string, string>;
  method_versions: Record<string, number>;
  summary: { total: number; passed: number; failed: number; blocking: number; byFamily: Record<string, { total: number; passed: number }> };
  results: CaseResult[];
}

/** Recorded "fooled model": answers each call with the case's adversarial output. */
export function fooledModel(c: ExtractionCase): ServClient {
  return new FixtureServClient((req: ServRequest) => {
    if (req.callSite === "locate") return c.model.locate;
    if (req.callSite === "extract") {
      const excerpt = /<<<EXCERPT\n([\s\S]*?)\nEXCERPT>>>/.exec(req.user)?.[1] ?? "";
      const hit = Object.entries(c.model.extract).find(([quote]) => excerpt.includes(quote) || quote.includes(excerpt));
      return hit ? hit[1] : Object.values(c.model.extract)[0];
    }
    const draft = JSON.parse(req.user) as { category: string; vesting_contract: string | null; subjects: { role: string }[] };
    return (
      c.model.classify ?? {
        verifiability: "direct",
        method_id: draft.category === "burn" ? "burn_v1" : draft.vesting_contract ? "vesting_schedule_v1" : "erc20_outflow_v1",
        ambiguity_flags: [],
        rule_ids: ["R5"],
      }
    );
  });
}

async function runExtractionCase(c: ExtractionCase, serv: ServClient): Promise<CaseResult> {
  const failures: string[] = [];
  const result = await runExtraction(c.source, { name: "Demo Labs", chainId: 8453, tokenAddress: "0x1111111111111111111111111111111111111111", tokenSymbol: "DEMO" }, { serv, meter: async () => {} });
  const e = c.expect;
  for (const f of e.sourceFlags ?? []) if (!result.source_flags.includes(f)) failures.push(`missing source flag ${f}`);
  if (e.drafts !== undefined && result.drafts.length !== e.drafts) failures.push(`expected ${e.drafts} draft(s), got ${result.drafts.length}`);
  for (const q of e.noDraftQuoting ?? []) if (result.drafts.some((d) => d.quote.includes(q))) failures.push(`a draft quotes forbidden text "${q}"`);
  for (const f of e.draftFlags ?? []) {
    if (!result.drafts.length) failures.push(`expected flag ${f} but there are no drafts`);
    for (const d of result.drafts) if (!d.flags.includes(f)) failures.push(`draft ${d.index} lacks flag ${f}`);
  }
  for (const f of e.anyDraftFlags ?? []) if (!result.drafts.some((d) => d.flags.includes(f))) failures.push(`no draft has flag ${f}`);
  let spec: unknown = null;
  if (e.unconfirmable !== undefined || e.thresholdBaseUnits !== undefined) {
    const d = result.drafts[0];
    const method = d?.classification?.method_id;
    const built =
      d?.fields && method && method !== "none"
        ? buildSpec({ fields: d.fields, method_id: method as never, chain_id: 8453, token: { address: "0x1111111111111111111111111111111111111111", symbol: "DEMO", decimals: 18 }, excerpt: d.quote, attribution: {} })
        : { spec: null, errors: ["no method"] };
    spec = built.spec;
    if (e.unconfirmable && built.spec) failures.push("a spec was built although required facts are missing");
    if (e.thresholdBaseUnits && built.spec?.threshold_base_units !== e.thresholdBaseUnits)
      failures.push(`threshold ${built.spec?.threshold_base_units ?? `(no spec: ${built.errors.join("; ")})`} ≠ ${e.thresholdBaseUnits}`);
  }
  return {
    id: c.id,
    family: c.family,
    title: c.title,
    severity: c.severity,
    layer: c.layer,
    passed: failures.length === 0,
    failures,
    observed: { source_flags: result.source_flags, drafts: result.drafts.map((d) => ({ quote: d.quote.slice(0, 120), flags: d.flags })), dropped: result.dropped_spans, spec_built: !!spec },
  };
}

async function runChainCase(c: ChainCase): Promise<CaseResult> {
  const primary = new FixtureChain(8453, 1_767_225_600, 60, "grifter primary");
  const confirm = new FixtureChain(8453, 1_767_225_600, 60, "grifter confirmation");
  const nowTs = Math.floor(Date.parse(c.now) / 1000);
  for (const ch of [primary, confirm]) ch.setNow(c.now, 0);
  const finalized: Evidence["transfers"] = [];
  const unfinalized: Evidence["transfers"] = [];
  for (const [i, t] of c.transfers.entries()) {
    const tx = `0x${t.tx.replace(/^0x/, "").padStart(64, "0")}` as `0x${string}`;
    const tr = primary.add({ txHash: tx, token: c.spec.token.address as `0x${string}`, from: t.from as `0x${string}`, to: t.to as `0x${string}`, amount: BigInt(t.amount), at: t.at, logIndex: i });
    if (!t.hiddenFromConfirmation) confirm.add({ txHash: tx, token: tr.token, from: tr.from, to: tr.to, amount: tr.amount, at: t.at, logIndex: i });
    (t.finalized === false ? unfinalized : finalized).push(tr);
  }
  const vesting = c.vesting
    ? { start: Math.floor(Date.parse(c.vesting.start) / 1000), duration: c.vesting.durationDays * 86400, cliff: c.vesting.cliffDays * 86400, beneficiary: null, funded: BigInt(c.vesting.funded) }
    : null;
  const evidence: Evidence = {
    finalizedBlock: primary.finalized,
    finalizedTime: nowTs,
    latestBlock: primary.latest,
    fromBlock: 0n,
    transfers: finalized,
    unfinalizedTransfers: unfinalized,
    vesting,
    asOf: nowTs,
  };
  const result = runMethod(c.spec, evidence);
  const confirmation = await confirmViolation(c.spec, result, { evidence, complete: true, scannedTo: primary.finalized, partialTransfers: [], windowFromBlock: 0n, providerName: primary.name }, confirm);
  const decision = deriveStatus(c.spec, result, confirmation.confirmation);
  const failures: string[] = [];
  if (decision.status !== c.expect.status) failures.push(`status ${decision.status}, expected ${c.expect.status}`);
  if (c.expect.final !== undefined && decision.final !== c.expect.final) failures.push(`final ${decision.final}, expected ${c.expect.final}`);
  if (c.expect.reasonMatches && !decision.reason.includes(c.expect.reasonMatches)) failures.push(`reason "${decision.reason}" lacks "${c.expect.reasonMatches}"`);
  return {
    id: c.id,
    family: c.family,
    title: c.title,
    severity: c.severity,
    layer: c.layer,
    passed: failures.length === 0,
    failures,
    observed: { status: decision.status, final: decision.final, reason: decision.reason, confirmation: confirmation.confirmation },
  };
}

export async function runGrifter(opts: { live?: ServClient; cases?: GrifterCase[] } = {}): Promise<GrifterReport> {
  const cases = opts.cases ?? CASES;
  const results: CaseResult[] = [];
  for (const c of cases) {
    try {
      results.push(c.kind === "extraction" ? await runExtractionCase(c, opts.live ?? fooledModel(c)) : await runChainCase(c));
    } catch (e) {
      results.push({ id: c.id, family: c.family, title: c.title, severity: c.severity, layer: c.layer, passed: false, failures: [`runner error: ${e instanceof Error ? e.message : e}`], observed: {} });
    }
  }
  const byFamily: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    byFamily[r.family] ??= { total: 0, passed: 0 };
    byFamily[r.family].total++;
    if (r.passed) byFamily[r.family].passed++;
  }
  const failed = results.filter((r) => !r.passed);
  return {
    mode: opts.live ? "live" : "offline",
    prompt_versions: Object.fromEntries(Object.values(PROMPTS).map((p) => [p.id, p.version])),
    method_versions: METHOD_VERSIONS,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      blocking: failed.filter((r) => r.severity === "critical" || r.severity === "high").length,
      byFamily,
    },
    results,
  };
}
