import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Reveal, Ticker } from "@/components/motion";
import { StatusChip } from "@/components/status";
import { ago, prettyReason } from "@/components/ui";
import { env } from "@/lib/env";
import { feed, globalStats } from "@/services/queries";
import { servStats } from "@/services/serv";

export default function Home() {
  return (
    <div className="relative">
      <div className="aura" />
      <Hero />
      <Suspense fallback={<div className="h-14 border-y border-line" />}>
        <Marquee />
      </Suspense>
      <HowItWorks />
      <LiveRecord />
      <TheCatch />
      <Pricing />
      <VerifyYourself />
    </div>
  );
}

function SectionHead({ n, name, title, aside }: { n: string; name: string; title: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid md:grid-cols-12 gap-6 mb-12">
      <p className="section-index md:col-span-3 pt-3">
        <b>{n}</b> / {name}
      </p>
      <h2 className="title md:col-span-7">{title}</h2>
      {aside ? <div className="md:col-span-2 md:text-right self-end">{aside}</div> : null}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative container-k pt-20 md:pt-32 pb-20 md:pb-24">
      <div className="absolute inset-0 gridlines opacity-40 pointer-events-none" />
      <div className="relative grid lg:grid-cols-12 gap-10 lg:gap-6 items-end">
        <div className="lg:col-span-8">
          <Reveal>
            <p className="label mb-8 flex items-center gap-3">
              <span className="inline-block w-6 h-px bg-accent" /> Commitment verification on Base
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="display">
              Projects rewrite their promises after breaking them.{" "}
              <span className="serif italic text-accent tracking-[-0.02em]">Kept catches it.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="text-muted text-lg leading-relaxed max-w-xl mt-8">
              Public crypto promises become structured commitments, checked by deterministic code against finalized chain data. Every result is cited,
              versioned, replayable and signed.
            </p>
          </Reveal>
          <Reveal delay={220}>
            <form action="/try" method="get" className="mt-10 flex flex-col sm:flex-row gap-2 max-w-2xl p-1.5 rounded-full border border-line-strong bg-panel/70 backdrop-blur">
              <input name="url" type="url" required placeholder="Paste a project's docs or tokenomics URL" className="flex-1 bg-transparent px-4 h-11 text-[15px] outline-none placeholder:text-faint" aria-label="Project URL" />
              <button className="btn" type="submit">
                Check promises <span aria-hidden>→</span>
              </button>
            </form>
            <p className="text-xs text-faint mt-3 ml-5">No login. Results are an unconfirmed preview and are never published.</p>
          </Reveal>
        </div>
        <div className="lg:col-span-4">
          <Reveal delay={260}>
            <Suspense fallback={<div className="skeleton h-[380px]" />}>
              <Ledger />
            </Suspense>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

async function Ledger() {
  await connection();
  const [s, serv] = await Promise.all([globalStats(), servStats()]);
  return (
    <div className="proof !p-0">
      <div className="flex items-center justify-between px-5 h-11 border-b border-line">
        <span className="label">Live ledger</span>
        <span className="flex items-center gap-2 label">
          <span className="live-dot" /> finalized blocks
        </span>
      </div>
      <div className="px-5 pt-6 pb-5 border-b border-line">
        <p className="numeral text-[88px]">
          <Ticker value={s.commitments} />
        </p>
        <p className="text-sm text-muted mt-2">commitments under monitoring</p>
      </div>
      <dl className="grid grid-cols-2">
        {(
          [
            ["At risk", s.at_risk, "var(--color-atrisk)"],
            ["Breached", s.breached, "var(--color-breached)"],
            ["Signed receipts", s.receipts, undefined],
            ["SERV calls / commitment", serv.perCommitment, undefined],
          ] as [string, number, string | undefined][]
        ).map(([label, value, color], i) => (
          <div key={label} className={`px-5 py-4 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""} border-line`}>
            <dt className="text-xs text-muted flex items-center gap-2">
              {color ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} /> : null}
              {label}
            </dt>
            <dd className="numeral text-3xl mt-2">{label.startsWith("SERV") ? value || "—" : <Ticker value={value} />}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

async function Marquee() {
  await connection();
  const items = await feed(14);
  const fallback = [
    "Code decides facts",
    "SERV reads the promises",
    "Every check is signed",
    "Breach needs two providers",
    "Versions are never rewritten",
    "Finalized blocks only",
  ];
  const cells = items.length
    ? items.map((i) => (
        <span key={`${i.commitment_id}${i.at.toISOString()}`} className="inline-flex items-center gap-3 px-8">
          <StatusChip status={i.to_status} final={i.final} />
          <span className="text-sm text-muted max-w-[34ch] truncate whitespace-nowrap">{i.summary}</span>
          <span className="mono text-xs text-faint whitespace-nowrap">{ago(i.at)}</span>
        </span>
      ))
    : fallback.map((t) => (
        <span key={t} className="inline-flex items-center gap-8 px-8 label">
          {t} <span className="text-accent">✦</span>
        </span>
      ));
  return (
    <div className="marquee border-y border-line h-14 flex items-center overflow-hidden" aria-label="Latest results">
      <div className="marquee-track">
        {cells}
        {cells}
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    t: "Read",
    d: "SERV Reasoning locates the promises in a source and extracts structured fields. Every number, date and address must appear in the quote, or the draft goes to a reviewer.",
    k: "Prompt guard · Kronos · Shadow Agent · Multipath",
  },
  {
    n: "02",
    t: "Check",
    d: "Pure, versioned functions test the condition against finalized Base blocks. A breach needs an attributed address and a second, independent provider. No model output ever sets a status.",
    k: "erc20_outflow · vesting_schedule · burn",
  },
  {
    n: "03",
    t: "Prove",
    d: "Every check emits a receipt: canonical JSON, SHA-256, hash-chained, EIP-191 signed, anchored on Base. Every version of the promise is kept, so a rewrite after the fact is flagged.",
    k: "RFC 8785 · EIP-191 · EAS",
  },
];

function HowItWorks() {
  return (
    <section className="container-k py-28">
      <SectionHead n="01" name="How it works" title={<>Language in, <span className="serif italic">facts</span> out.</>} />
      <div className="grid md:grid-cols-3 border-t border-line">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90} className={`pt-8 pb-10 md:pr-10 ${i > 0 ? "md:border-l md:pl-10" : ""} border-line`}>
            <p className="numeral text-[64px] text-faint">{s.n}</p>
            <h3 className="text-2xl tracking-[-0.03em] mt-6 mb-3">{s.t}</h3>
            <p className="text-muted leading-relaxed">{s.d}</p>
            <p className="label mt-6 !normal-case !tracking-normal text-faint">{s.k}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function LiveRecord() {
  return (
    <section className="container-k py-20">
      <SectionHead
        n="02"
        name="Live record"
        title={<>Every status change, <span className="serif italic">with its receipt.</span></>}
        aside={<Link className="label u !text-ink" href="/projects">All projects →</Link>}
      />
      <Suspense fallback={<div className="skeleton h-72" />}>
        <FeedTable />
      </Suspense>
    </section>
  );
}

async function FeedTable() {
  await connection();
  const items = await feed(10);
  if (!items.length) {
    return (
      <div className="border border-line p-10 text-center">
        <p className="subtitle">No results yet.</p>
        <p className="text-muted mt-2">The first confirmed commitment appears here with its signed receipt.</p>
      </div>
    );
  }
  return (
    <table className="data stack">
      <thead>
        <tr>
          <th>Status</th>
          <th>Condition</th>
          <th>Project</th>
          <th className="text-right">When</th>
          <th className="text-right">Proof</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={`${i.commitment_id}-${i.at.toISOString()}`}>
            <td className="w-48">
              <StatusChip status={i.to_status} final={i.final} />
            </td>
            <td>
              <Link href={`/commitments/${i.commitment_id}`} className="u">{i.summary}</Link>
              <p className="text-xs text-faint mt-1">{prettyReason(i.reason)}</p>
            </td>
            <td className="text-sm text-muted whitespace-nowrap">
              <Link href={`/projects/${i.project_slug}`} className="u">{i.project_name}</Link>
              {i.is_demo ? <span className="label !text-disputed ml-2">demo</span> : null}
            </td>
            <td className="mono text-xs text-muted text-right whitespace-nowrap">{ago(i.at)}</td>
            <td className="text-right">{i.receipt_id ? <Link className="label u !text-accent" href={`/receipts/${i.receipt_id}`}>receipt</Link> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TheCatch() {
  return (
    <section className="container-k py-28">
      <SectionHead n="03" name="The catch" title={<>A promise changed <span className="serif italic">after</span> the tokens moved.</>} />
      <div className="grid lg:grid-cols-12 gap-6">
        <Reveal className="lg:col-span-7">
          <div className="proof">
            <p className="label mb-5">Example · version diff</p>
            <div className="grid sm:grid-cols-2 gap-px bg-line border border-line">
              <div className="bg-panel p-5">
                <p className="label mb-3">v1 · Mar 01</p>
                <p className="leading-relaxed">
                  Team tokens are locked for 12 months. <del className="diff">No team tokens will be transferred</del> before then.
                </p>
              </div>
              <div className="bg-panel p-5">
                <p className="label mb-3">v2 · Dec 20</p>
                <p className="leading-relaxed">
                  Team tokens are locked for 12 months. <ins className="diff">Up to 5,000,000 team tokens may be released</ins> before then.
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-3 border border-atrisk/40 bg-atrisk/[0.06] p-4">
              <span className="w-1.5 h-1.5 rounded-full bg-atrisk mt-2 shrink-0" />
              <p className="text-sm">
                <span className="mono text-atrisk text-xs tracking-[0.1em] uppercase mr-2">Retroactive revision</span>
                4,000,000 tokens left the team wallet on Dec 15. They fail v1 and pass v2, which was published five days later.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={120} className="lg:col-span-5 flex flex-col justify-between gap-10">
          <p className="text-lg text-muted leading-relaxed">
            Kept captures every source, hashes it and versions the promise. When a revision excuses a transfer that already happened, the record says so —
            neutrally, mechanically, with the transaction and both versions attached. Hindcast then replays both versions over the same evidence.
          </p>
          <div className="grid grid-cols-3 border-t border-line">
            {[
              ["5", "append-only evidence tables"],
              ["2", "independent RPC providers"],
              ["23", "adversarial Grifter cases"],
            ].map(([n, l]) => (
              <div key={l} className="pt-5 pr-3">
                <p className="numeral text-5xl">{n}</p>
                <p className="text-xs text-muted mt-3">{l}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Pricing() {
  const price = env().X402_PRICE;
  const tiers: [string, string, string, string][] = [
    ["Launchpads", "$1,200", "per launched project / year", "Bulk registration, public project pages, alerts, embeds"],
    ["Pro", "$49", "per month", "Watchlists, alerts, Hindcast and exports for researchers and funds"],
    ["Agents", price, "per query, USDC over x402", "Signed records with coverage — no record is never read as clean"],
    ["Data", "$2,000+", "per month", "Bulk API and historical exports for analytics platforms"],
  ];
  return (
    <section className="container-k py-20">
      <SectionHead n="04" name="Pricing" title={<>Priced for whoever <span className="serif italic">relies</span> on the promise.</>} aside={<p className="text-xs text-faint">Starting points to test with the first pilot.</p>} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 border-t border-l border-line">
        {tiers.map(([name, amount, unit, desc], i) => (
          <Reveal key={name} delay={i * 70} className="border-r border-b border-line p-7 group hover:bg-panel transition-colors">
            <p className="label">{name}</p>
            <p className="numeral text-5xl mt-10 group-hover:text-accent transition-colors">{amount}</p>
            <p className="text-xs text-muted mt-3">{unit}</p>
            <p className="text-sm text-muted mt-8 leading-relaxed">{desc}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function VerifyYourself() {
  return (
    <section className="container-k py-28">
      <div className="grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-5">
          <p className="section-index mb-6">
            <b>05</b> / Verify, don&apos;t trust
          </p>
          <h2 className="title">
            Every receipt checks out <span className="serif italic">without us.</span>
          </h2>
          <p className="text-muted mt-6 max-w-md leading-relaxed">
            Recompute the hash, recover the signer, re-fetch the logs from your own RPC and rerun the same method version. If anything differs, the receipt fails.
          </p>
          <div className="flex gap-3 mt-8">
            <Link href="/docs#verify" className="btn">Read the guide</Link>
            <Link href="/try" className="btn btn-quiet">Try a project</Link>
          </div>
        </div>
        <Reveal className="lg:col-span-7">
          <div className="proof !p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 h-10 border-b border-line">
              <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
              <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
              <span className="w-2.5 h-2.5 rounded-full bg-line-strong" />
              <span className="label ml-3">kept-verify</span>
            </div>
            <pre className="mono text-[13px] leading-7 p-6 overflow-x-auto">
              <span className="text-faint">$ </span>npm run verify-receipt -- receipt.json{"\n"}
              <span className="text-verified">✓</span> sha256 f4b77dd5…d0752fd{"\n"}
              <span className="text-verified">✓</span> signer matches the address in /.well-known/agent-card.json{"\n"}
              <span className="text-verified">✓</span> Merkle inclusion in anchored root{"\n"}
              <span className="text-faint">  re-fetching Transfer logs from your RPC…</span>{"\n"}
              <span className="text-verified">✓</span> rerun erc20_outflow_v1: same outcome, same value{"\n"}
              {"\n"}
              <span className="text-ink">receipt verified</span>
            </pre>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
