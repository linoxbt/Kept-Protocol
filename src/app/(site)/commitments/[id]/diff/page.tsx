import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Tx } from "@/components/addr";
import { TimeBar } from "@/components/timebar";
import { fmtDate, nowSeconds, Section, Skeleton } from "@/components/ui";
import { diffVersions } from "@/services/precedent";
import { NotFound } from "@/services/sources";

export const metadata = { title: "Version diff" };

export default function DiffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={500} />}>
      <Diff params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Diff({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await connection();
  const { id } = await params;
  const q = await searchParams;
  const from = Number(q.from ?? 1);
  const to = Number(q.to ?? 2);
  let d;
  try {
    d = await diffVersions(id, from, to);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const w = (s: typeof d.from.spec) => ({ start: Date.parse(s.window.start) / 1000, end: Date.parse(s.window.end) / 1000 });
  return (
    <div>
      <Link href={`/commitments/${id}`} className="label u !text-muted hover:!text-ink">← commitment</Link>
      <h1 className="title mt-6 mb-4">How the promise changed: v{from} → v{to}</h1>
      <p className="text-sm text-muted mb-8">
        Change classified as <span className="mono text-ink">{d.changeKind}</span>. v{to} was published {fmtDate(d.to.published_at, true)}. v{from} stays frozen; its record is never rewritten.
      </p>

      {d.retroactive.length ? (
        <div className="border border-atrisk p-4 mb-8" style={{ background: "color-mix(in srgb, var(--color-atrisk) 8%, transparent)" }}>
          <p className="mono text-xs text-atrisk mb-2">RETROACTIVE REVISION</p>
          {d.retroactive.map((r) => (
            <p key={r.txHash + r.logIndex} className="text-sm mb-1">
              {r.message} <Tx hash={r.txHash} chainId={d.to.spec.chain_id} />
            </p>
          ))}
          <p className="text-xs text-muted mt-2">A neutral, mechanical fact: the transfer happened before the condition was relaxed. It says nothing about intent.</p>
        </div>
      ) : null}

      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {[d.from, d.to].map((v, i) => (
          <div key={v.id} className="panel p-4">
            <p className="label mb-2">v{v.version} · {fmtDate(v.published_at)}</p>
            <p className="leading-relaxed">
              {d.textDiff.map((p, j) =>
                p.added ? (i === 1 ? <ins key={j} className="diff">{p.value}</ins> : null) : p.removed ? (i === 0 ? <del key={j} className="diff">{p.value}</del> : null) : <span key={j}>{p.value}</span>,
              )}
            </p>
          </div>
        ))}
      </div>

      <Section title="Field changes">
        <table className="data panel">
          <thead><tr><th>Field</th><th>v{from}</th><th>v{to}</th><th>Kind</th></tr></thead>
          <tbody>
            {d.changes.map((c) => (
              <tr key={c.field}>
                <td className="mono text-xs">{c.field}</td>
                <td className="mono text-xs text-breached break-all">{c.from ?? "—"}</td>
                <td className="mono text-xs text-verified break-all">{c.to ?? "—"}</td>
                <td className="mono text-xs">{c.policy ? "policy" : "editorial"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Both windows, same evidence">
        <div className="panel p-4">
          <TimeBar
            now={nowSeconds()}
            windows={[{ label: `v${from}`, ...w(d.from.spec) }, { label: `v${to}`, ...w(d.to.spec) }]}
            events={d.retroactive.map((r) => ({ t: r.blockTime, kind: "flag" as const, label: r.message }))}
          />
        </div>
        <p className="text-xs text-muted mt-2">
          {d.evidenceAvailable ? "" : "Chain evidence for this diff is not cached yet; run a check or Hindcast to load it. "}
          <Link className="link" href={`/commitments/${id}/hindcast`}>Replay both versions with Hindcast →</Link>
        </p>
      </Section>
    </div>
  );
}
