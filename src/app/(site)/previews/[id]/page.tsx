import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatUnits } from "@/core/amounts";
import type { Status } from "@/core/types";
import type { Draft } from "@/extraction/pipeline";
import { Addr, Hash } from "@/components/addr";
import { Corners } from "@/components/corners";
import { PreviewCheckForm, RefreshWhileRunning } from "@/components/preview-check";
import { StatusChip } from "@/components/status";
import { ago, fmtDate, prettyReason, Skeleton } from "@/components/ui";
import type { PreviewCheck } from "@/services/preview";
import { FLAG_HELP, getPublicPreview } from "@/services/previews";

// Unreviewed AI readings of real projects' pages: never offered to search engines as facts.
export const metadata = { title: "Preview", robots: { index: false, follow: false } };

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={480} />}>
      <Preview params={params} />
    </Suspense>
  );
}

const KIND: Record<string, string> = {
  token_lock: "Token lock",
  vesting: "Vesting",
  burn: "Burn",
  treasury: "Treasury",
  governance: "Governance",
  fee_distribution: "Fee distribution",
  other: "Other",
};

const METHOD: Record<string, string> = {
  erc20_outflow_v1: "Yes: Kept counts tokens leaving the named wallets",
  vesting_schedule_v1: "Yes: Kept compares releases with the vesting schedule",
  burn_v1: "Yes: Kept counts burns by the named address",
};

const COMPARATOR: Record<string, string> = { lte: "At most", gte: "At least", eq: "Exactly" };

/** Flags that stop a check from running even when a method applies. */
const BLOCKING = ["MISSING_START_DATE", "MISSING_ADDRESS", "INVALID_ADDRESS", "UNGROUNDED_ADDRESS", "SERV_OUTPUT_INVALID"];

function host(url: string | null): string {
  if (!url) return "Pasted text";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function amountText(d: Draft): string {
  const f = d.fields;
  if (!f) return "Not stated";
  const n = f.amount && /^\d+(\.\d+)?$/.test(f.amount) ? Number(f.amount).toLocaleString("en-US") : f.amount;
  const unit =
    f.amount_unit === "percent_of_supply" ? "% of supply" : f.amount_unit === "percent_of_allocation" ? "% of the allocation" : f.amount_unit === "usd" ? " USD" : ` ${f.token_symbol ?? "tokens"}`;
  if (!n) return "Not stated";
  return `${f.comparator ? `${COMPARATOR[f.comparator] ?? f.comparator} ` : ""}${n}${unit}`;
}

function windowText(d: Draft): string {
  const f = d.fields;
  if (!f) return "Not stated";
  const end = f.window_end ?? (f.duration_months ? `${f.duration_months} months later` : null);
  if (!f.window_start && !end) return "Not stated";
  return `${f.window_start ?? "Start not stated"} → ${end ?? "end not stated"}`;
}

/** What still stops a chain check from running, in plain words (empty when it can run). */
function missing(d: Draft): string[] {
  const f = d.fields;
  if (!f) return ["the model's answer for this passage could not be used"];
  const out: string[] = [];
  const method = d.classification?.method_id ?? "none";
  const named = method === "vesting_schedule_v1" ? !!f.vesting_contract && isAddress(f.vesting_contract) : f.subjects.some((s) => isAddress(s.address));
  if (!named) out.push(method === "vesting_schedule_v1" ? "the vesting contract's address" : "a wallet or contract address");
  if (!f.window_start) out.push("a start date");
  if (!f.window_end && !f.duration_months) out.push("an end date or a duration");
  if (f.amount === null || f.amount === undefined || f.amount === "") out.push("an amount");
  if (named && f.subjects.some((s) => !isAddress(s.address))) out.push("a valid address (one given is incomplete)");
  return out;
}

function verdict(d: Draft): { label: string; tone: string } {
  const method = d.classification?.method_id ?? "none";
  if (method === "none" || !METHOD[method]) return { label: "Not checkable onchain", tone: "border-line-strong text-muted" };
  if (missing(d).length || d.flags.some((f) => BLOCKING.includes(f)) || !d.confidence.grounding) return { label: "Needs more detail", tone: "border-atrisk/60 text-atrisk" };
  return { label: "Ready to check", tone: "border-verified/60 text-verified" };
}

/** Why a promise can or cannot be checked onchain, without blaming the wrong thing. */
function checkability(d: Draft): string {
  const method = d.classification?.method_id ?? "none";
  if (METHOD[method]) {
    const gaps = missing(d);
    return gaps.length ? `${METHOD[method]}, once the page gives ${gaps.join(", ")}.` : `${METHOD[method]}.`;
  }
  const v = d.classification?.verifiability;
  const cat = d.fields?.category;
  if (cat && ["treasury", "governance", "fee_distribution"].includes(cat)) return "Not in this release: treasury, governance and fee promises are recognised but have no verification method yet.";
  if (v === "partial") return "Not as written: the page does not give enough to check it (for example no wallet address or amount).";
  if (v === "not_verifiable") return "No: token transfers cannot show whether this holds.";
  return "Not in this release: there is no verification method for this kind of promise.";
}

const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

async function Preview({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ex = await getPublicPreview(id);
  if (!ex) notFound();
  const result = ex.result;
  const drafts = result?.drafts ?? [];
  const checks = (result?.previews ?? {}) as Record<string, PreviewCheck>;
  const checkable = drafts.filter((d) => METHOD[d.classification?.method_id ?? "none"]);
  const ready = drafts.filter((d) => verdict(d).label === "Ready to check");
  const site = host(ex.preview_url);

  return (
    <div className="max-w-5xl">
      <RefreshWhileRunning running={ex.status === "running"} />
      <Link href="/explore" className="label u !text-muted hover:!text-ink">← Explore</Link>

      <header className="mt-6 mb-8">
        <p className="label mb-2">Commitment preview</p>
        <h1 className="title mb-3 break-words">{site}</h1>
        {ex.preview_url ? (
          <a className="link mono text-xs break-all" href={ex.preview_url} target="_blank" rel="noreferrer nofollow">{ex.preview_url}</a>
        ) : (
          <p className="text-sm text-muted">Text pasted by a visitor. Only people with this link can see it.</p>
        )}
        <p className="mono text-xs text-muted mt-3">
          Read {ago(ex.created_at)} ({fmtDate(ex.created_at, true)}) · {result?.serv_calls ?? 0} SERV calls · content <Hash value={ex.content_sha256} />
          {ex.expires_at ? ` · listed until ${fmtDate(ex.expires_at)}` : ""}
        </p>
      </header>

      <div className="relative border border-line-strong p-5 mb-10">
        <Corners />
        <p className="text-sm">
          <span className="mono text-xs px-2 py-0.5 border border-disputed/60 text-disputed mr-2">UNCONFIRMED PREVIEW</span>
          SERV Reasoning read this page and Kept&apos;s code checked every quote, number, date and address against it. No person has reviewed it,
          it is not monitored, and nothing here is a verdict about the project.
        </p>
      </div>

      {ex.status === "running" ? (
        <section className="panel p-8 mb-10" aria-live="polite">
          <p className="subtitle mb-2">Reading the page…</p>
          <p className="text-sm text-muted mb-6">This usually takes 1 to 5 minutes. The page updates on its own.</p>
          <ol className="grid sm:grid-cols-3 gap-4 text-sm">
            <li className="border border-line p-4"><p className="label mb-1">1 · Locate</p>SERV finds every promise and quotes it word for word.</li>
            <li className="border border-line p-4"><p className="label mb-1">2 · Extract</p>Kronos and Shadow Agent turn each quote into fields.</li>
            <li className="border border-line p-4"><p className="label mb-1">3 · Classify</p>Multipath decides, twice, how each one could be checked.</li>
          </ol>
        </section>
      ) : ex.status === "failed" ? (
        <section className="border border-breached/60 p-6 mb-10">
          <p className="subtitle mb-2">This preview could not be completed</p>
          <p className="text-sm text-muted mb-4">{ex.error ?? "The page could not be read."}</p>
          <Link className="btn" href="/try">Try another page</Link>
        </section>
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line mb-10">
            {[
              [drafts.length, "commitments found"],
              [checkable.length, "checkable onchain"],
              [ready.length, "ready to check"],
              [Object.keys(checks).length, "chain checks run"],
            ].map(([n, l]) => (
              <div key={String(l)} className="bg-bg p-5">
                <dd className="text-3xl tracking-tight">{n}</dd>
                <dt className="label mt-1">{l}</dt>
              </div>
            ))}
          </dl>

          {result?.injection?.length ? (
            <p className="border border-atrisk/50 text-sm p-4 mb-10">
              <span className="text-atrisk">This page contains text addressed to AI systems</span> ({result.injection.length} passage
              {result.injection.length === 1 ? "" : "s"}). Kept ignored it, and no commitment below is taken from it.
            </p>
          ) : null}

          <section className="mb-14">
            <h2 className="label border-t border-line pt-4 mb-6">Commitments</h2>
            {drafts.length === 0 ? (
              <div className="border border-line p-8 text-sm text-muted">
                No promises were found on this page. Kept looks for statements such as &ldquo;team tokens are locked for 12 months&rdquo; or &ldquo;we burn 1% of
                supply every quarter&rdquo;. Tokenomics, vesting and token pages work best.
              </div>
            ) : (
              <div className="space-y-6">
                {drafts.map((d) => (
                  <CommitmentCard key={d.index} id={ex.id} d={d} check={checks[String(d.index)]} />
                ))}
              </div>
            )}
          </section>

          {result?.dropped_spans?.length ? (
            <section className="mb-14">
              <h2 className="label border-t border-line pt-4 mb-4">Passages Kept set aside ({result.dropped_spans.length})</h2>
              <ul className="text-sm space-y-2">
                {result.dropped_spans.map((s, i) => (
                  <li key={i} className="border border-line p-3">
                    {s.quote ? <span>&ldquo;{s.quote}&rdquo;</span> : <span className="text-muted">(no quote)</span>}
                    <span className="block text-xs text-muted mt-1">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <section className="mb-10">
        <h2 className="label border-t border-line pt-4 mb-4">How this preview was made</h2>
        <ol className="grid md:grid-cols-3 gap-4 text-sm">
          <li className="border border-line p-4"><p className="label mb-1">Read</p>SERV Reasoning locates each promise, extracts its fields with Kronos and Shadow Agent, and classifies it twice with Multipath.</li>
          <li className="border border-line p-4"><p className="label mb-1">Checked by code</p>Every quote must appear on the page word for word; every number, date and address must be in the text. Anything else is flagged.</li>
          <li className="border border-line p-4"><p className="label mb-1">Onchain, on request</p>A chain check reads finalized Base blocks. In a preview no wallet is confirmed as the project&apos;s, so the worst it can show is At risk.</li>
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link className="btn" href="/try">Check another page</Link>
        <Link className="btn-quiet" href="/explore">See all previews</Link>
      </div>
    </div>
  );
}

function CommitmentCard({ id, d, check }: { id: string; d: Draft; check?: PreviewCheck }) {
  const f = d.fields;
  const method = d.classification?.method_id ?? "none";
  const v = verdict(d);
  const flags = [...new Set(d.flags)];
  return (
    <article className="proof">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="mono text-[10px] uppercase tracking-[0.12em] border border-line-strong px-2 py-0.5">{f ? KIND[f.category] ?? f.category : "Unreadable"}</span>
        <span className={`mono text-[10px] uppercase tracking-[0.12em] border px-2 py-0.5 ${v.tone}`}>{v.label}</span>
        {check ? <StatusChip status={check.status as Status} final={check.final} /> : null}
      </div>
      <blockquote className="text-lg md:text-xl leading-snug mb-3">&ldquo;{d.quote}&rdquo;</blockquote>
      {f?.condition_summary ? <p className="text-sm text-muted mb-5">In plain words: {f.condition_summary}</p> : null}

      {f ? (
        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 text-sm mb-5">
          <div><dt className="label mb-1">Amount</dt><dd>{amountText(d)}</dd></div>
          <div><dt className="label mb-1">When</dt><dd className="mono text-xs">{windowText(d)}</dd></div>
          <div>
            <dt className="label mb-1">Token</dt>
            <dd>{f.token_symbol ?? "Not stated"}{f.token_address && isAddress(f.token_address) ? <span className="block text-xs"><Addr address={f.token_address} /></span> : null}</dd>
          </div>
          <div><dt className="label mb-1">Who</dt><dd>{f.responsible_entity ?? "Not stated"}</dd></div>
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="label mb-1">Wallets and contracts</dt>
            <dd className="text-xs space-y-1">
              {f.subjects.length === 0 ? <span className="text-muted">None named on the page</span> : null}
              {f.subjects.map((s, i) => (
                <span key={i} className="block">
                  {isAddress(s.address) ? <Addr address={s.address} /> : <span className="mono text-atrisk">{s.address} (not a valid address)</span>}
                  <span className="text-muted"> · {s.role}{s.label ? `, ${s.label}` : ""}</span>
                </span>
              ))}
            </dd>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <dt className="label mb-1">Can Kept check it onchain?</dt>
            <dd>{checkability(d)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-breached mb-5">{d.error ?? "The model's answer for this passage could not be used."}</p>
      )}

      {flags.length ? (
        <div className="mb-5">
          <p className="label mb-2">What to know</p>
          <ul className="text-sm space-y-1">
            {flags.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mono text-[10px] border border-line-strong text-muted px-1.5 h-fit mt-0.5 shrink-0">{x}</span>
                <span className="text-muted">{FLAG_HELP[x] ?? x}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted mb-5">
        <li>{d.confidence.grounding ? "✓" : "✗"} Grounded in the page</li>
        <li>{d.confidence.classifier_agreement ? "✓" : "✗"} Two independent readings agree</li>
        <li>{d.confidence.rules_agreement ? "✓" : "✗"} Kept&apos;s coded rules agree</li>
      </ul>

      {d.problems.length ? (
        <details className="text-xs text-muted mb-5">
          <summary className="cursor-pointer">Technical notes ({d.problems.length})</summary>
          <ul className="list-disc pl-5 mt-2 space-y-1">{d.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      ) : null}

      {check ? (
        <div className="border-t border-line pt-4">
          <p className="label mb-2">Chain check · {fmtDate(check.checked_at, true)}</p>
          <p className="text-sm">{prettyReason(check.reason)}</p>
          <p className="mono text-xs text-muted mt-1">
            {formatUnits(BigInt(check.computed_value), check.decimals)} of {formatUnits(BigInt(check.threshold_base_units), check.decimals)} {check.symbol ?? ""} · {check.evidence_count}{" "}
            transfer(s) · as of Base block {check.as_of_block}
            {check.complete ? "" : " · partial scan"}
          </p>
        </div>
      ) : METHOD[method] && missing(d).length ? (
        <p className="border-t border-line pt-4 text-xs text-muted">A chain check needs {missing(d).join(", ")} first, so none can run from this page.</p>
      ) : METHOD[method] ? (
        <div className="border-t border-line pt-4">
          <p className="text-xs text-muted mb-3">Run an unconfirmed check against finalized Base blocks. It needs the token&apos;s address on Base.</p>
          <PreviewCheckForm id={id} index={d.index} token={f?.token_address && isAddress(f.token_address) ? f.token_address : null} />
        </div>
      ) : null}
    </article>
  );
}
