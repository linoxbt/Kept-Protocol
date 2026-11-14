import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BlockField } from "@/components/blockfield";
import { ChainBar } from "@/components/chainbar";
import { Corners } from "@/components/corners";
import { Reveal, Ticker } from "@/components/motion";
import { StatusChip } from "@/components/status";
import { ago, prettyReason } from "@/components/ui";
import { env } from "@/lib/env";
import { feed, globalStats } from "@/services/queries";

export default function Home() {
  return (
    <div>
      <Hero />
      <Split />
      <Steps />
      <Facts />
      <LiveRecord />
      <TheCatch />
      <Pricing />
      <Verify />
    </div>
  );
}

function Head({ n, name, title, sub }: { n: string; name: string; title: React.ReactNode; sub?: string }) {
  return (
    <Reveal className="text-center max-w-3xl mx-auto mb-14">
      <p className="section-index mb-5">
        <b>{n}</b> / {name}
      </p>
      <h2 className="title">{title}</h2>
      {sub ? <p className="text-muted text-lg mt-5 leading-relaxed">{sub}</p> : null}
    </Reveal>
  );
}

function Hero() {
  return (
    <section className="relative min-h-[100svh] flex flex-col overflow-hidden">
      <BlockField />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(60%_50%_at_50%_45%,transparent_0%,var(--color-bg)_85%)]" />
      <div className="relative flex-1 flex flex-col items-center justify-center text-center px-5 pt-32 pb-16">
        <Reveal>
          <p className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full border border-line-strong bg-panel/70 backdrop-blur text-[13px] text-muted">
            <span className="live-dot" /> Live on Base · built on SERV Reasoning
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="display max-w-[15ch] mx-auto mt-8">
            Every promise, <span className="serif italic font-normal">checked</span> on-chain.
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="text-muted text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mt-7">
            Projects rewrite their promises after breaking them. Kept reads the promise, checks it against finalized Base blocks with deterministic code,
            and signs a receipt anyone can verify.
          </p>
        </Reveal>
        <Reveal delay={240} className="w-full">
          <form action="/try" method="get" className="mt-10 mx-auto flex flex-col sm:flex-row gap-2 max-w-xl p-1.5 rounded-2xl border border-line-strong bg-panel/80 backdrop-blur">
            <input name="url" type="url" required placeholder="Paste a project's tokenomics or docs URL" className="flex-1 bg-transparent px-4 h-12 text-[15px] outline-none placeholder:text-faint" aria-label="Project URL" />
            <button className="h-12 px-6 rounded-xl bg-accent text-white font-medium hover:brightness-110 transition whitespace-nowrap" type="submit">
              Check promises
            </button>
          </form>
          <p className="text-xs text-faint mt-3">No login · results are an unconfirmed preview and never published</p>
        </Reveal>
        <Reveal delay={300}>
          <div className="flex items-center justify-center gap-6 mt-10 text-sm">
            <Link href="/projects" className="u text-ink">Browse the record →</Link>
            <Link href="/docs" className="u text-muted">API &amp; x402</Link>
          </div>
        </Reveal>
      </div>
      <div className="relative">
        <ChainBar />
      </div>
    </section>
  );
}

function Split() {
  return (
    <section className="container-k py-24">
      <div className="grid lg:grid-cols-2 border border-line">
        <Reveal className="relative bg-accent text-white p-10 md:p-14 min-h-[480px] flex flex-col justify-between">
          <Corners className="text-white/60" />
          <p className="text-center text-[15px] text-white/80">The commitment stack</p>
          <div className="text-center">
            <p className="text-[clamp(2.2rem,4vw,3.6rem)] font-medium tracking-[-0.04em] leading-[1.02]">
              Promise. Condition.
              <br />
              Evidence. Receipt.
            </p>
            <p className="text-white/80 mt-6 max-w-md mx-auto leading-relaxed">
              Four records, one chain of custody: what was said, exactly what is tested, what Base shows, and a signed, hash-chained result.
            </p>
          </div>
          <div className="flex justify-center gap-1.5">
            <span className="h-1 w-8 rounded-full bg-white" />
            <span className="h-1 w-1 rounded-full bg-white/50" />
            <span className="h-1 w-1 rounded-full bg-white/50" />
            <span className="h-1 w-1 rounded-full bg-white/50" />
          </div>
        </Reveal>
        <Reveal delay={120} className="relative dotgrid p-8 md:p-14 flex items-center justify-center min-h-[480px] border-t lg:border-t-0 lg:border-l border-line">
          <Corners />
          <div className="w-full max-w-md proof !bg-bg">
            <div className="flex items-center justify-between mb-5">
              <span className="label">Receipt · example</span>
              <StatusChip status="breached" final />
            </div>
            <p className="text-[15px] leading-relaxed">“Team tokens are locked for 12 months. No team tokens will be transferred before then.”</p>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <dt className="text-muted">Outflow</dt>
              <dd className="mono text-right">4,000,000 / 0</dd>
              <dt className="text-muted">Method</dt>
              <dd className="mono text-right">erc20_outflow_v1</dd>
              <dt className="text-muted">Providers</dt>
              <dd className="mono text-right">2 / 2 confirmed</dd>
              <dt className="text-muted">sha256</dt>
              <dd className="mono text-right">f4b77d…752fd</dd>
            </dl>
            <div className="mt-6 pt-4 border-t border-line flex items-center justify-between text-[12px]">
              <span className="mono text-faint">EIP-191 signed · hash-chained</span>
              <span className="mono text-verified">✓ verifies</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    t: "Read",
    d: "SERV Reasoning locates promises and extracts fields. Every number, date and address must appear in the quote, or the draft goes to a reviewer.",
    k: "Prompt guard · Kronos · Shadow Agent · Multipath",
  },
  {
    n: "02",
    t: "Check",
    d: "Pure, versioned functions test the condition on finalized blocks. A breach needs an attributed address and a second, independent provider.",
    k: "erc20_outflow · vesting_schedule · burn",
  },
  {
    n: "03",
    t: "Prove",
    d: "Every check emits a signed, hash-chained receipt, anchored on Base. Every version of the promise is kept, so a rewrite after the fact is flagged.",
    k: "RFC 8785 · EIP-191 · EAS",
  },
];

function Steps() {
  return (
    <section className="container-k py-24">
      <Head n="01" name="How it works" title={<>Language in, <span className="serif italic font-normal">facts</span> out.</>} sub="The model reads. Code decides. No AI output is ever the final word on what happened on-chain." />
      <div className="grid md:grid-cols-3 gap-4">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90} className="relative border border-line bg-panel p-8 pt-12 min-h-[320px] flex flex-col group hover:border-line-strong transition-colors">
            <Corners />
            <p className="numeral text-[72px] text-line-strong group-hover:text-accent transition-colors">{s.n}</p>
            <h3 className="text-2xl tracking-[-0.03em] mt-8 mb-3">{s.t}</h3>
            <p className="text-muted leading-relaxed flex-1">{s.d}</p>
            <p className="mono text-[11px] text-faint mt-6">{s.k}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

async function FactsInner() {
  await connection();
  const s = await globalStats();
  const live: [string, string][] = [
    [String(s.commitments), "commitments monitored"],
    [String(s.receipts), "signed receipts"],
    [String(s.at_risk), "at risk"],
    [String(s.breached), "breached"],
  ];
  const system: [string, string][] = [
    ["23 / 23", "adversarial Grifter cases passing against live SERV"],
    ["2", "independent RPC providers before any breach"],
    ["0.2 s", "Base block time, finalized blocks only"],
    ["5", "append-only evidence tables, enforced in Postgres"],
  ];
  const hasData = s.commitments > 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-line">
      {(hasData ? live : system).map(([v, l], i) => (
        <div key={l} className={`px-6 py-10 text-center border-line ${i % 2 === 1 ? "border-l" : ""} ${i === 2 ? "lg:border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""}`}>
          <p className="numeral text-[clamp(2.5rem,5vw,4.5rem)]">{hasData ? <Ticker value={Number(v)} /> : v}</p>
          <p className="text-sm text-muted mt-4 max-w-[22ch] mx-auto">{l}</p>
        </div>
      ))}
    </div>
  );
}

function Facts() {
  return (
    <section className="py-10">
      <Suspense fallback={<div className="h-[180px] border-y border-line" />}>
        <FactsInner />
      </Suspense>
    </section>
  );
}

function LiveRecord() {
  return (
    <section className="container-k py-24">
      <Head n="02" name="Live record" title={<>Every status change, <span className="serif italic font-normal">with its receipt.</span></>} />
      <Suspense fallback={<div className="skeleton h-72" />}>
        <FeedTable />
      </Suspense>
      <p className="text-center mt-8">
        <Link className="u text-sm" href="/projects">All projects →</Link>
      </p>
    </section>
  );
}

async function FeedTable() {
  await connection();
  const items = await feed(8);
  if (!items.length) {
    return (
      <div className="relative border border-line p-14 text-center dotgrid">
        <Corners />
        <p className="subtitle">The record starts with the first confirmed commitment.</p>
        <p className="text-muted mt-3 max-w-lg mx-auto">Each status change lands here with its signed receipt. Until then, try any project&apos;s docs as an unconfirmed preview.</p>
        <Link href="/try" className="inline-flex mt-8 h-11 px-5 items-center rounded-xl bg-accent text-white font-medium hover:brightness-110 transition">Check a project</Link>
      </div>
    );
  }
  return (
    <div className="border border-line">
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
              <td className="w-48"><StatusChip status={i.to_status} final={i.final} /></td>
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
    </div>
  );
}

function TheCatch() {
  return (
    <section className="container-k py-24">
      <Head
        n="03"
        name="The catch"
        title={<>A promise changed <span className="serif italic font-normal">after</span> the tokens moved.</>}
        sub="Kept versions every promise. When a revision excuses a transfer that already happened, the record says so — neutrally, with the transaction and both versions attached."
      />
      <Reveal className="max-w-4xl mx-auto">
        <div className="relative border border-line bg-panel p-6 md:p-10">
          <Corners />
          <div className="grid md:grid-cols-2 gap-px bg-line border border-line">
            <div className="bg-bg p-6">
              <p className="label mb-3">v1 · Mar 01</p>
              <p className="leading-relaxed">Team tokens are locked for 12 months. <del className="diff">No team tokens will be transferred</del> before then.</p>
            </div>
            <div className="bg-bg p-6">
              <p className="label mb-3">v2 · Dec 20</p>
              <p className="leading-relaxed">Team tokens are locked for 12 months. <ins className="diff">Up to 5,000,000 team tokens may be released</ins> before then.</p>
            </div>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-atrisk/40 bg-atrisk/[0.07] p-4">
            <span className="w-1.5 h-1.5 rounded-full bg-atrisk mt-2 shrink-0" />
            <p className="text-sm">
              <span className="mono text-atrisk text-[11px] tracking-[0.12em] uppercase mr-2">Retroactive revision</span>
              4,000,000 tokens left the team wallet on Dec 15. They fail v1 and pass v2, which was published five days later.
            </p>
          </div>
          <p className="label text-center mt-6 !text-faint">Example</p>
        </div>
      </Reveal>
    </section>
  );
}

function Pricing() {
  const price = env().X402_PRICE;
  const tiers: [string, string, string, string, boolean][] = [
    ["Launchpads", "$1,200", "per launched project / year", "Public pages and alerts for every project you launch", true],
    ["Pro", "$49", "per month", "Watchlists, alerts, Hindcast and exports", false],
    ["Agents", price, "per query · USDC over x402", "Signed records with coverage, machine-readable", false],
    ["Data", "$2,000+", "per month", "Bulk API and historical exports", false],
  ];
  return (
    <section className="container-k py-24">
      <Head n="04" name="Pricing" title={<>Priced for whoever <span className="serif italic font-normal">relies</span> on the promise.</>} sub="Starting points to test with the first launchpad pilot." />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiers.map(([name, amount, unit, desc, featured], i) => (
          <Reveal key={name} delay={i * 70} className={`relative rounded-2xl p-7 min-h-[280px] flex flex-col ${featured ? "bg-accent text-white" : "border border-line bg-panel"}`}>
            <p className={`label ${featured ? "!text-white/80" : ""}`}>{name}</p>
            <p className="numeral text-5xl mt-10">{amount}</p>
            <p className={`text-xs mt-3 ${featured ? "text-white/80" : "text-muted"}`}>{unit}</p>
            <p className={`text-sm mt-auto pt-8 leading-relaxed ${featured ? "text-white/90" : "text-muted"}`}>{desc}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Verify() {
  return (
    <section className="container-k py-24">
      <Head n="05" name="Verify, don't trust" title={<>Every receipt checks out <span className="serif italic font-normal">without us.</span></>} sub="Recompute the hash, recover the signer, re-fetch the logs from your own RPC and rerun the same method version." />
      <Reveal className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-line-strong overflow-hidden bg-panel">
          <div className="flex items-center gap-2 px-4 h-11 border-b border-line">
            <span className="w-3 h-3 rounded-full bg-line-strong" />
            <span className="w-3 h-3 rounded-full bg-line-strong" />
            <span className="w-3 h-3 rounded-full bg-line-strong" />
            <span className="mono text-xs text-muted mx-auto pr-12">kept-verify</span>
          </div>
          <pre className="mono text-[13px] leading-7 p-6 md:p-8 overflow-x-auto">
            <span className="text-faint">$ </span>npm run verify-receipt -- receipt.json{"\n"}
            <span className="text-verified">✓</span> sha256 of RFC 8785 canonical JSON matches{"\n"}
            <span className="text-verified">✓</span> EIP-191 signer matches /.well-known/agent-card.json{"\n"}
            <span className="text-verified">✓</span> Merkle inclusion in the root attested on Base{"\n"}
            <span className="text-faint">  re-fetching Transfer logs from your RPC…</span>{"\n"}
            <span className="text-verified">✓</span> rerun erc20_outflow_v1: same outcome, same value{"\n"}
            {"\n"}
            receipt verified
          </pre>
        </div>
        <div className="flex justify-center gap-3 mt-10">
          <Link href="/docs#verify" className="h-11 px-5 inline-flex items-center rounded-xl bg-ink text-bg font-medium hover:bg-accent hover:text-white transition">Read the guide</Link>
          <Link href="/try" className="h-11 px-5 inline-flex items-center rounded-xl border border-line-strong hover:border-ink transition">Try a project</Link>
        </div>
      </Reveal>
    </section>
  );
}
