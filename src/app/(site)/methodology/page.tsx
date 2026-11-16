import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { STATUS_HELP } from "@/core/status";
import { Status } from "@/core/types";
import { StatusChip } from "@/components/status";
import { db } from "@/db/client";
import { METHOD_LIMITATIONS } from "@/services/verify";

export const metadata = {
  title: "How Kept works",
  description: "How Kept reads a promise, checks it against finalized Base blocks with code, decides a status, and proves it with a signed, anchored receipt.",
};

const STATUSES = Status.options;

const ATTRIBUTION: [string, string, boolean][] = [
  ["onchain_proven", "The chain itself ties the address to the promise (for example, the vesting contract's beneficiary is the stated team wallet).", true],
  ["declared_by_project", "The address appears on the project's own page, next to the promise.", true],
  ["confirmed_by_reviewer", "A Kept reviewer confirmed the address with cited evidence (an explorer label, a verified contract, a linked page).", true],
  ["unconfirmed", "Nobody has tied the address to the project. A record can reach At risk, never Breached.", false],
];

const METHODS: [string, string, string][] = [
  ["erc20_outflow_v1", "Token locks", "Adds up every ERC-20 transfer leaving the named wallets in the window and compares the total with the allowed amount (usually zero). Moves between the project's own confirmed wallets, and burns from a locked wallet, are not counted."],
  ["vesting_schedule_v1", "Vesting", "Compares every release from the vesting contract with what the stated schedule allows at that moment, and reads the contract's own schedule as an early warning."],
  ["burn_v1", "Burns", "Adds up tokens the named executor sends to the zero or 0x…dEaD address in the period and compares the total with the promised amount."],
];

export default function MethodologyPage() {
  return (
    <div className="max-w-4xl">
      <p className="label mb-2">How Kept works</p>
      <h1 className="title mb-4">Code decides facts. SERV reads the promises.</h1>
      <p className="text-muted mb-10 max-w-3xl">
        Kept turns a project&apos;s public promise into a structured commitment, checks it against finalized Base blocks with deterministic code, and
        proves every result with a signed receipt anchored on Base. This page explains every status you will see, and what Kept will and will not say.
      </p>

      <nav aria-label="On this page" className="border border-line p-4 mb-12 text-sm grid sm:grid-cols-2 gap-1">
        {[
          ["#pipeline", "1. From a sentence to a verdict"],
          ["#statuses", "2. What each status means"],
          ["#attribution", "3. Whose wallet is it?"],
          ["#finality", "4. Finality and confirmation"],
          ["#methods", "5. What Kept can check"],
          ["#versions", "6. When a promise is rewritten"],
          ["#receipts", "7. Receipts: don't trust Kept"],
          ["#language", "8. What Kept never says"],
        ].map(([href, label]) => (
          <a key={href} className="link" href={href}>{label}</a>
        ))}
      </nav>

      <Section id="pipeline" title="1. From a sentence to a verdict">
        <ol className="grid md:grid-cols-3 gap-4 text-sm">
          <li className="border border-line p-4">
            <p className="label mb-2">Read</p>
            SERV Reasoning finds each promise on the project&apos;s page as a word-for-word quote, extracts its fields (token, wallets, amount, dates) with Kronos
            and Shadow Agent, and decides twice, with Multipath, how it could be checked.
          </li>
          <li className="border border-line p-4">
            <p className="label mb-2">Check</p>
            Code verifies every quote, number, date and address against the page. A reviewer confirms the commitment. From then on the worker checks it against
            finalized Base blocks on a schedule, with no model involved.
          </li>
          <li className="border border-line p-4">
            <p className="label mb-2">Prove</p>
            Every result becomes a signed, hash-chained receipt. Receipts are anchored on Base through EAS, and anyone can re-run the check from their own RPC.
          </li>
        </ol>
      </Section>

      <Section id="statuses" title="2. What each status means">
        <dl className="space-y-4">
          {STATUSES.map((s) => (
            <div key={s} id={`status-${s}`} className="border border-line p-4 scroll-mt-28 target:border-accent">
              <dt className="mb-2 flex flex-wrap items-center gap-3">
                <StatusChip status={s} />
                {s === "verified" ? <StatusChip status={s} final /> : null}
                <Suspense fallback={null}>
                  <Example status={s} />
                </Suspense>
              </dt>
              <dd className="text-sm text-muted">{STATUS_HELP[s]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted mt-4">
          <span className="text-ink">Status and finality are separate.</span> &ldquo;Verified to date&rdquo; means the condition holds so far while the window is
          still open; &ldquo;Verified, final&rdquo; means the window has closed and it held throughout. A breach is always final.
        </p>
      </Section>

      <Section id="attribution" title="3. Whose wallet is it?">
        <p className="text-sm text-muted mb-4">A transfer only counts against a project if Kept knows the wallet is theirs. Every address carries one of four levels:</p>
        <table className="data stack panel">
          <thead><tr><th>Level</th><th>Meaning</th><th>Can lead to Breached</th></tr></thead>
          <tbody>
            {ATTRIBUTION.map(([level, meaning, can]) => (
              <tr key={level}>
                <td data-label="Level" className="mono text-xs">{level}</td>
                <td data-label="Meaning" className="text-sm">{meaning}</td>
                <td data-label="Can lead to Breached" className={can ? "text-verified" : "text-muted"}>{can ? "Yes" : "No, At risk at most"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-muted mt-4">
          For several wallets, a breach needs the wallets with confirmed attribution to exceed the limit on their own. Try-it previews treat every address as
          unconfirmed, so a preview can never show Breached.
        </p>
      </Section>

      <Section id="finality" title="4. Finality and confirmation">
        <ul className="text-sm space-y-3 list-disc pl-5">
          <li>Kept only counts <span className="text-ink">finalized</span> Base blocks, which follow Ethereum&apos;s finality about 20 to 25 minutes behind the latest block. A transfer in a newer block shows At risk until it is final.</li>
          <li>Before anything becomes Breached, a <span className="text-ink">second, independent provider</span> must reproduce every transfer the violation rests on (or recount the whole period). If the providers disagree, the record stays At risk and an incident is opened.</li>
          <li>While Kept is still reading the history a promise covers, the status is <span className="text-ink">Awaiting evidence</span>, never a guess. A burn shortfall is only decided once the period has closed and the full period has been recounted.</li>
        </ul>
      </Section>

      <Section id="methods" title="5. What Kept can check">
        <div className="space-y-4">
          {METHODS.map(([id, title, how]) => (
            <div key={id} className="border border-line p-4">
              <p className="mb-1"><span className="text-ink">{title}</span> <span className="mono text-xs text-muted">{id}</span></p>
              <p className="text-sm text-muted mb-3">{how}</p>
              <ul className="text-xs text-muted list-disc pl-5 space-y-1">{(METHOD_LIMITATIONS[id] ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted mt-4">
          Treasury, governance and fee-distribution promises are recognised and shown in previews, but have no verification method yet, so they cannot be monitored.
          Kept checks Base mainnet only in this release.
        </p>
      </Section>

      <Section id="versions" title="6. When a promise is rewritten">
        <ul className="text-sm space-y-3 list-disc pl-5">
          <li>Kept keeps every version of a promise with the snapshot of the page it came from. Pages are re-captured on a schedule, and a changed promise becomes a new version only after review.</li>
          <li>If a later version relaxes the condition after tokens already moved, Kept flags it as a <span className="text-ink">retroactive revision</span> and shows the transfer it excuses.</li>
          <li>A breach under an earlier version <span className="text-ink">stands</span>: a later rewrite cannot undo it. Only a version marked as a correction of a mistake can.</li>
          <li><span className="text-ink">Hindcast</span> replays every version over the same chain history, so you can see what each would have shown on each date.</li>
        </ul>
      </Section>

      <Section id="receipts" title="7. Receipts: don't trust Kept">
        <ul className="text-sm space-y-3 list-disc pl-5">
          <li>Every check writes a receipt: the promise, the method version, the block range, the evidence and the result, as canonical JSON (RFC 8785), hashed with SHA-256 and signed with EIP-191.</li>
          <li>Receipts form a hash chain per commitment, and their Merkle root is attested on Base through EAS every few hours.</li>
          <li>Anyone can check a receipt: the browser button on each receipt page, or <span className="mono">kept-verify</span>, which pins the published signer, reads the attestation from your own RPC, re-fetches the logs and re-runs the method. See <Link className="link" href="/docs">API &amp; verification</Link> and <Link className="link" href="/status">Status &amp; integrity</Link>.</li>
        </ul>
      </Section>

      <Section id="language" title="8. What Kept never says">
        <ul className="text-sm space-y-3 list-disc pl-5">
          <li>A breach is a mechanical fact about a stated condition, never a judgment of intent. Kept never calls anyone a fraud, a scam or a rug.</li>
          <li>No record is not a clean record: a token Kept does not track has simply not been checked.</li>
          <li>The AI never states what happened onchain. It reads the words; code decides the facts.</li>
          <li>Anyone can dispute a record from its page. A reviewer decides, and every decision is public. See also <Link className="link" href="/for-projects">For projects</Link>.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-14 scroll-mt-28">
      <h2 className="subtitle border-t border-line pt-4 mb-5">{title}</h2>
      {children}
    </section>
  );
}

/** A live record currently in this status, when one exists. */
async function Example({ status }: { status: string }) {
  await connection();
  const [c] = await db()<{ id: string }[]>`select id from commitments where status = ${status} order by last_checked_at desc nulls last limit 1`.catch(() => []);
  return c ? <Link className="link text-xs" href={`/commitments/${c.id}`}>see a live example →</Link> : null;
}
