import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatUnits } from "@/core/amounts";
import { METHOD_LIMITATIONS } from "@/services/verify";
import { Addr, Hash, Tx } from "@/components/addr";
import { ActionButton } from "@/components/admin-actions";
import { StatusChip } from "@/components/status";
import { TimeBar } from "@/components/timebar";
import { ago, DemoBadge, fmtDate, nowSeconds, prettyReason, Section, Skeleton } from "@/components/ui";
import { diffVersions } from "@/services/precedent";
import { isAdminSession } from "@/lib/session";
import { commitmentDetail } from "@/services/queries";

export default function CommitmentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={600} />}>
      <Commitment params={params} />
    </Suspense>
  );
}

const ATTR_LABEL: Record<string, string> = {
  onchain_proven: "on-chain proven",
  declared_by_project: "declared by project",
  confirmed_by_reviewer: "confirmed by reviewer",
  unconfirmed: "unconfirmed",
};

async function Commitment({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const [d, admin] = await Promise.all([commitmentDetail(id), isAdminSession()]);
  if (!d) notFound();
  const s = d.version.spec;
  const sym = s.token.symbol ?? "tokens";
  const lastCheck = d.checks.find((c) => c.status);
  const lastError = d.checks[0]?.error;
  const computed = lastCheck?.computed_value ? formatUnits(BigInt(lastCheck.computed_value), s.token.decimals) : "0";
  const threshold = formatUnits(BigInt(s.threshold_base_units), s.token.decimals);
  const highlight = d.snapshot.text.indexOf(s.excerpt);
  const retro = d.versions.length > 1 ? (await diffVersions(d.commitment.id, d.versions.length - 1, d.versions.length).catch(() => null))?.retroactive ?? [] : [];
  const events = d.events.map((e) => ({
    t: Math.floor(new Date(e.block_time).getTime() / 1000),
    kind: e.kind as "violating" | "counted",
    label: `${formatUnits(BigInt(e.amount), s.token.decimals)} ${sym} · ${e.from_addr} → ${e.to_addr} · ${e.tx_hash}`,
    href: `https://basescan.org/tx/${e.tx_hash}`,
  }));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
        <Link href={`/projects/${d.project.slug}`} className="text-muted hover:text-ink">← {d.project.name}</Link>
        {d.project.is_demo ? <DemoBadge /> : null}
        <span className="flex-1" />
        <span className="mono text-xs border border-line px-2 py-0.5">v{d.version.version} of {d.versions.length}</span>
      </div>

      {retro.length ? (
        <div className="border border-atrisk p-4 mb-8" style={{ background: "color-mix(in srgb, var(--color-atrisk) 8%, transparent)" }}>
          <p className="mono text-xs text-atrisk mb-1">RETROACTIVE REVISION · v{d.versions.length - 1} → v{d.versions.length}</p>
          {retro.map((r) => (
            <p key={r.txHash + r.logIndex} className="text-sm">{r.message}</p>
          ))}
          <Link className="link text-xs mono" href={`/commitments/${d.commitment.id}/diff?from=${d.versions.length - 1}&to=${d.versions.length}`}>see how the promise changed →</Link>
        </div>
      ) : null}

      {/* Promise band */}
      <section className="mb-8">
        <p className="label mb-2">What was promised</p>
        <blockquote className="text-xl md:text-2xl leading-relaxed border-l-2 border-accent pl-5 mb-3">“{s.excerpt}”</blockquote>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted items-center">
          {d.source?.url ? <a className="link" href={d.source.url} target="_blank" rel="noreferrer">{new URL(d.source.url).host}</a> : <span>pasted source</span>}
          <span className="mono">captured {fmtDate(d.snapshot.captured_at, true)}</span>
          <Hash value={d.snapshot.content_sha256} />
          {highlight >= 0 ? <a className="link mono" href="#snapshot">view in source</a> : null}
        </div>
      </section>

      {/* Condition band */}
      <section className="panel p-5 mb-8">
        <p className="label mb-2">What exactly is checked</p>
        <p className="text-lg mb-4">{s.condition_summary}</p>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="label mb-1">Subjects</p>
            <ul className="space-y-1.5">
              {s.subjects.map((x) => (
                <li key={x.address} className="flex flex-wrap items-center gap-2">
                  <Addr address={x.address} chainId={s.chain_id} />
                  <span className={`mono text-[10px] border px-1 ${x.attribution.level === "unconfirmed" ? "border-atrisk text-atrisk" : "border-verified text-verified"}`} title={x.attribution.evidence ?? ""}>
                    {ATTR_LABEL[x.attribution.level]}
                  </span>
                  <span className="text-xs text-muted">{x.role}{x.label ? ` · ${x.label}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label mb-1">Token</p>
            <Addr address={s.token.address} chainId={s.chain_id} /> <span className="mono text-xs text-muted">{s.token.symbol} · {s.token.decimals} dp</span>
            <p className="label mt-3 mb-1">Window</p>
            <p className="mono text-xs">{fmtDate(s.window.start)} → {fmtDate(s.window.end)}</p>
          </div>
          <div>
            <p className="label mb-1">Method</p>
            <p className="mono text-xs">{s.method_id} · comparator {s.comparator} {threshold} {sym}</p>
            <p className="label mt-3 mb-1">Check interval</p>
            <p className="mono text-xs">every {Math.round(d.commitment.check_interval_s / 60)} min · finalized blocks only</p>
            {s.derived.length ? (
              <>
                <p className="label mt-3 mb-1">Derived by code</p>
                <ul className="text-xs text-muted">{s.derived.map((x) => <li key={x.field}><span className="mono">{x.field}</span>: {x.rule}</li>)}</ul>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* Status and evidence band */}
      <section className="proof mb-8">
        <div className="grid lg:grid-cols-[auto_1fr_auto] gap-6 items-start">
          <div>
            <StatusChip status={d.commitment.status} final={d.commitment.final} size="lg" />
            <p className="text-xs text-muted mt-3 mono">
              {lastCheck?.to_block ? <>as of block {Number(lastCheck.to_block).toLocaleString("en-US")} (finalized), </> : null}
              {ago(d.commitment.last_checked_at)}
            </p>
            {lastError ? <p className="text-xs text-atrisk mt-2">Latest check failed, retrying. The status above is the last good one.</p> : null}
          </div>
          <div>
            <TimeBar now={nowSeconds()} windows={[{ label: `v${d.version.version}`, start: Date.parse(s.window.start) / 1000, end: Date.parse(s.window.end) / 1000 }]} events={events} />
            <p className="text-sm mt-2">{prettyReason(d.commitment.status_reason)}</p>
          </div>
          <div className="text-right">
            <p className="label mb-1">{s.method_id === "burn_v1" ? "burned / required" : s.method_id === "vesting_schedule_v1" ? "released / allocation" : "outflow / allowed"}</p>
            <p className="mono text-2xl">{computed} <span className="text-muted">/ {threshold}</span></p>
            <p className="mono text-xs text-muted">{sym}</p>
          </div>
        </div>
        {admin ? (
          <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-line">
            <ActionButton endpoint={`/api/v1/commitments/${d.commitment.id}/verify`} label="Verify now" />
            <ActionButton endpoint="/api/v1/hindcast" body={{ commitment_id: d.commitment.id }} label="Run Hindcast" next={() => `/commitments/${d.commitment.id}/hindcast`} />
          </div>
        ) : null}
      </section>

      {d.events.length ? (
        <Section title="Evidence">
          <table className="data stack panel">
            <thead><tr><th>Block time</th><th>Transaction</th><th>From → To</th><th>Amount</th><th>Counted as</th></tr></thead>
            <tbody>
              {d.events.map((e) => (
                <tr key={e.tx_hash + e.from_addr}>
                  <td className="mono text-xs">{fmtDate(e.block_time, true)}</td>
                  <td><Tx hash={e.tx_hash} chainId={s.chain_id} /></td>
                  <td className="text-xs"><Addr address={e.from_addr} chainId={s.chain_id} /> → <Addr address={e.to_addr} chainId={s.chain_id} /></td>
                  <td className="mono text-xs">{formatUnits(BigInt(e.amount), s.token.decimals)} {sym}</td>
                  <td className={`mono text-xs ${e.kind === "violating" ? "text-breached" : "text-muted"}`}>{e.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* History band */}
      <div className="grid lg:grid-cols-2 gap-8">
        <Section title="Status history">
          <ul className="panel divide-y divide-line text-sm">
            {d.changes.length === 0 ? <li className="p-3 text-muted">No checks yet.</li> : null}
            {d.changes.map((c) => (
              <li key={c.id} className="p-3 flex gap-3 items-start">
                <span className="mono text-xs text-muted w-36 shrink-0">{fmtDate(c.at, true)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.from_status ? <span className="mono text-xs text-muted">{c.from_status} →</span> : null}
                    <StatusChip status={c.to_status} final={c.final} />
                    {c.receipt_id ? <Link className="link mono text-xs" href={`/receipts/${c.receipt_id}`}>receipt</Link> : null}
                  </div>
                  <p className="text-xs text-muted mt-1">{prettyReason(c.reason)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Versions" aside={d.versions.length > 1 ? <Link className="link text-xs mono" href={`/commitments/${d.commitment.id}/diff?from=${d.versions.length - 1}&to=${d.versions.length}`}>compare latest →</Link> : null}>
          <ul className="panel divide-y divide-line text-sm">
            {[...d.versions].reverse().map((v) => (
              <li key={v.id} className="p-3">
                <div className="flex items-center gap-3">
                  <span className="mono">v{v.version}</span>
                  <span className="mono text-xs text-muted">{v.change_kind}</span>
                  <span className="mono text-xs text-muted">published {fmtDate(v.published_at)}</span>
                  {v.version > 1 ? <Link className="link mono text-xs" href={`/commitments/${d.commitment.id}/diff?from=${v.version - 1}&to=${v.version}`}>diff</Link> : null}
                </div>
                <p className="text-xs text-muted mt-1">{v.spec.condition_summary}{v.change_reason ? ` — ${v.change_reason}` : ""}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-4 text-xs mono">
            <Link className="link" href={`/commitments/${d.commitment.id}/hindcast`}>Hindcast →</Link>
            {d.receipts[0] ? <Link className="link" href={`/receipts/${d.receipts[0].id}`}>latest receipt →</Link> : null}
          </div>
        </Section>
      </div>

      <Section title="Source snapshot">
        <div id="snapshot" className="panel p-4 text-sm whitespace-pre-wrap max-h-80 overflow-auto leading-relaxed">
          {highlight >= 0 ? (
            <>
              {d.snapshot.text.slice(Math.max(0, highlight - 600), highlight)}
              <mark className="hl">{s.excerpt}</mark>
              {d.snapshot.text.slice(highlight + s.excerpt.length, highlight + s.excerpt.length + 600)}
            </>
          ) : (
            d.snapshot.text.slice(0, 2000)
          )}
        </div>
      </Section>

      <footer className="text-xs text-muted space-y-2 border-t border-line pt-6">
        <p className="label">Limitations</p>
        <ul className="list-disc pl-5 space-y-1">{(METHOD_LIMITATIONS[s.method_id] ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
        <p>
          Breaches are mechanical facts about the stated condition, never judgments of intent. A project that believes a result is wrong can file a dispute
          with evidence; the computed status stays visible beside it until a reviewer resolves it.
        </p>
      </footer>
    </div>
  );
}
