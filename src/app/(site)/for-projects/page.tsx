import Link from "next/link";
import { ContactForm, DeclareWalletForm } from "@/components/project-forms";

export const metadata = {
  title: "For projects",
  description: "How Kept treats your project's promises, how to declare your wallets, how to respond to a record, and pilot pricing for launchpads.",
};

export default function ForProjectsPage() {
  return (
    <div className="max-w-4xl">
      <p className="label mb-2">For projects and launchpads</p>
      <h1 className="title mb-4">Your promises, kept on the record</h1>
      <p className="text-muted mb-10 max-w-3xl">
        Kept tracks what projects publicly promise about their tokens (locks, vesting, burns) and checks it against finalized Base blocks. If your project is on Kept,
        here is how it works for you, how to make your records more precise, and how to respond when you think a record is wrong.
      </p>

      <nav aria-label="On this page" className="border border-line p-4 mb-12 text-sm grid sm:grid-cols-2 gap-1">
        <a className="link" href="#how">How Kept treats your project</a>
        <a className="link" href="#declare">Declare a wallet</a>
        <a className="link" href="#respond">Respond to a record</a>
        <a className="link" href="#pricing">Pricing and pilots</a>
      </nav>

      <section id="how" className="mb-14 scroll-mt-28">
        <h2 className="subtitle border-t border-line pt-4 mb-5">How Kept treats your project</h2>
        <ul className="text-sm space-y-3 list-disc pl-5">
          <li>Only promises you published are tracked, quoted word for word from your own page, and every version of that page Kept captured is kept.</li>
          <li>A transfer only counts against you if the wallet is attributed to you: proven onchain, declared on your page, declared by you below, or confirmed by a reviewer with cited evidence. Unattributed wallets can never produce a breach.</li>
          <li>Nothing becomes Breached before the block is final and a second, independent provider has reproduced the evidence.</li>
          <li>Kept states mechanical facts about stated conditions. It never calls a project a fraud, a scam or a rug, and it never scores or ranks projects.</li>
          <li>See <Link className="link" href="/methodology">How it works</Link> for every status and rule.</li>
        </ul>
      </section>

      <section id="declare" className="mb-14 scroll-mt-28">
        <h2 className="subtitle border-t border-line pt-4 mb-3">Declare a wallet</h2>
        <p className="text-sm text-muted mb-5 max-w-3xl">
          Tell Kept which addresses are yours (team, treasury, vesting or lock contracts, burn executors) by signing a message with each address. Kept verifies the
          signature immediately; a reviewer then checks it against your public pages and records it as evidence that the address is declared by your project.
        </p>
        <DeclareWalletForm />
      </section>

      <section id="respond" className="mb-14 scroll-mt-28">
        <h2 className="subtitle border-t border-line pt-4 mb-3">Respond to a record</h2>
        <p className="text-sm text-muted max-w-3xl">
          Every commitment page has a <span className="text-ink">Dispute this record</span> button. Explain what is wrong and link the evidence (for example a transaction showing an
          address is a vesting contract, not a team wallet). A reviewer decides; an accepted dispute shows the record as Disputed until it is resolved, and every
          decision is published on the record. Find your project with <Link className="link" href="/search">Search</Link>.
        </p>
      </section>

      <section id="pricing" className="mb-14 scroll-mt-28">
        <h2 className="subtitle border-t border-line pt-4 mb-5">Pricing and pilots</h2>
        <div className="grid md:grid-cols-2 gap-4 mb-6 text-sm">
          <div className="border border-accent/60 p-5">
            <p className="label mb-1">Agents · live</p>
            <p className="text-2xl mb-2">$0.01 <span className="text-sm text-muted">per query</span></p>
            <p className="text-muted">Paid per call in USDC on Base over x402. Signed responses with explicit coverage. <Link className="link" href="/docs">API docs</Link></p>
          </div>
          <div className="border border-line p-5">
            <p className="label mb-1">Launchpads · pilot</p>
            <p className="text-2xl mb-2">$1,200 <span className="text-sm text-muted">per launched project, per year</span></p>
            <p className="text-muted">Every project you launch gets public promise pages, monitoring, receipts and alerts.</p>
          </div>
          <div className="border border-line p-5">
            <p className="label mb-1">Pro · pilot</p>
            <p className="text-2xl mb-2">$49 <span className="text-sm text-muted">per month</span></p>
            <p className="text-muted">Watchlists, alerts, Hindcast and exports for researchers and funds.</p>
          </div>
          <div className="border border-line p-5">
            <p className="label mb-1">Data · pilot</p>
            <p className="text-2xl mb-2">From $2,000 <span className="text-sm text-muted">per month</span></p>
            <p className="text-muted">Bulk API and full history for analytics platforms.</p>
          </div>
        </div>
        <p className="text-xs text-muted mb-6">Pilot tiers are being set up with the first partners; billing for them is arranged directly.</p>
        <ContactForm kind="pilot" />
      </section>
    </div>
  );
}
