import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { StatusChip } from "@/components/status";
import { ago, DemoBadge, Empty, Section, Skeleton } from "@/components/ui";
import { feed, globalStats } from "@/services/queries";
import { servStats } from "@/services/serv";
import { env } from "@/lib/env";

export default function Home() {
  return (
    <div>
      <section className="grid lg:grid-cols-[1.3fr_1fr] gap-10 mb-14 items-start">
        <div>
          <p className="label mb-4">Commitment verification · Base</p>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight tracking-tight mb-5">
            Projects quietly rewrite their promises after breaking them.
            <span className="text-accent"> Kept catches it.</span>
          </h1>
          <p className="text-muted text-lg max-w-2xl mb-8">
            Kept turns public crypto promises into structured commitments, checks them with deterministic code against chain data, and keeps a cited,
            versioned, replayable record of every result. Every answer comes with a receipt anyone can verify.
          </p>
          <form action="/try" method="get" className="flex flex-col sm:flex-row gap-2 max-w-2xl">
            <input name="url" type="url" required placeholder="Paste a project's docs or tokenomics URL" className="input mono" aria-label="Project URL" />
            <button className="btn whitespace-nowrap" type="submit">Check promises →</button>
          </form>
          <p className="text-xs text-faint mt-2">No login. Results are labelled “Unconfirmed preview” and never published.</p>
        </div>
        <Suspense fallback={<Skeleton h={220} />}>
          <Stats />
        </Suspense>
      </section>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-10">
        <Section title="Latest status changes" aside={<Link className="link text-xs mono" href="/projects">all projects →</Link>}>
          <Suspense fallback={<Skeleton h={300} />}>
            <Feed />
          </Suspense>
        </Section>
        <div>
          <Section title="How it works">
            <ol className="space-y-4 text-sm">
              <li className="panel p-4">
                <p className="mono text-accent text-xs mb-1">01 · READ</p>
                SERV Reasoning locates promises in a source and extracts structured fields. Every number, date and address must appear in the quote, or
                the draft goes to review.
              </li>
              <li className="panel p-4">
                <p className="mono text-accent text-xs mb-1">02 · CHECK</p>
                Pure, versioned functions check the condition against finalized Base blocks. A breach needs an attributed address and a second, independent
                provider. No AI output ever sets a status.
              </li>
              <li className="panel p-4">
                <p className="mono text-accent text-xs mb-1">03 · PROVE</p>
                Every check produces a signed, hash-chained receipt. Versions of the promise are kept, so a rewrite after the fact is visible — and flagged.
              </li>
            </ol>
          </Section>
          <Section title="Pricing (starting points)">
            <div className="proof text-sm space-y-2">
              <p className="flex justify-between"><span>Launchpads</span><span className="mono">$1,200 / launched project / yr</span></p>
              <p className="flex justify-between"><span>Pro (researchers, funds)</span><span className="mono">$49 / mo</span></p>
              <p className="flex justify-between"><span>Agents (x402, per query)</span><span className="mono">{env().X402_PRICE} USDC</span></p>
              <p className="flex justify-between"><span>Data licensing</span><span className="mono">from $2,000 / mo</span></p>
              <p className="text-xs text-faint pt-2">Hypotheses to test with the first pilot, not market data.</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

async function Stats() {
  await connection();
  const [s, serv] = await Promise.all([globalStats(), servStats()]);
  const cells: [string, string | number, string?][] = [
    ["commitments monitored", s.commitments],
    ["at risk", s.at_risk, "var(--color-atrisk)"],
    ["breached", s.breached, "var(--color-breached)"],
    ["deadlines in 7 days", s.deadlines],
    ["signed receipts", s.receipts],
    ["SERV calls per commitment", serv.perCommitment || "—"],
  ];
  return (
    <div className="proof grid grid-cols-2 gap-px bg-line">
      {cells.map(([label, value, color]) => (
        <div key={label} className="bg-panel p-4">
          <p className="mono text-2xl" style={{ color: color ?? "var(--color-ink)" }}>{value}</p>
          <p className="text-xs text-muted mt-1">{label}</p>
        </div>
      ))}
    </div>
  );
}

async function Feed() {
  await connection();
  const items = await feed(12);
  if (!items.length) return <Empty>No status changes yet. Confirm a commitment from the admin console, or try a URL above.</Empty>;
  return (
    <ul className="divide-y divide-line panel">
      {items.map((i) => (
        <li key={`${i.commitment_id}-${i.at.toISOString()}`} className="p-4 flex gap-4 items-start">
          <div className="pt-0.5"><StatusChip status={i.to_status} final={i.final} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <Link href={`/commitments/${i.commitment_id}`} className="hover:text-accent">{i.summary}</Link>
            </p>
            <p className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 items-center">
              <Link href={`/projects/${i.project_slug}`} className="hover:text-ink">{i.project_name}</Link>
              {i.is_demo ? <DemoBadge /> : null}
              <span className="mono">{ago(i.at)}</span>
              {i.receipt_id ? <Link className="link mono" href={`/receipts/${i.receipt_id}`}>receipt</Link> : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
