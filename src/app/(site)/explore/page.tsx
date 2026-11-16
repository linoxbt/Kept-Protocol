import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { ago, Skeleton } from "@/components/ui";
import { listPublicPreviews, publicPreviewStats, type PreviewListItem } from "@/services/previews";

export const metadata = {
  title: "Explore",
  description: "Every public page checked with Kept's try-it mode: the promises SERV found, and what Kept's code made of them.",
  robots: { index: false, follow: true },
};

export default function ExplorePage() {
  return (
    <div>
      <p className="label mb-2">Explore</p>
      <h1 className="title mb-4">Every page Kept has read</h1>
      <p className="text-muted text-sm mb-8 max-w-3xl">
        Each row is a public page someone checked in <Link className="link" href="/try">Try it</Link>. Open one to see the promises SERV Reasoning found,
        what Kept&apos;s code verified against the page, and any chain checks. These are <span className="text-ink">unconfirmed previews</span>: not
        reviewed, not monitored, and never a verdict about a project. Monitored commitments are under <Link className="link" href="/projects">Projects</Link>.
      </p>
      <Suspense fallback={<Skeleton h={420} />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

const STATE: Record<PreviewListItem["status"], { label: string; tone: string }> = {
  running: { label: "Reading", tone: "text-atrisk" },
  done: { label: "Done", tone: "text-verified" },
  failed: { label: "Failed", tone: "text-breached" },
};

const KIND: Record<string, string> = {
  token_lock: "lock",
  vesting: "vesting",
  burn: "burn",
  treasury: "treasury",
  governance: "governance",
  fee_distribution: "fees",
  other: "other",
};

function split(url: string): { site: string; path: string } {
  try {
    const u = new URL(url);
    return { site: u.hostname.replace(/^www\./, ""), path: `${u.pathname}${u.search}`.replace(/\/$/, "") || "/" };
  } catch {
    return { site: url, path: "" };
  }
}

async function Dashboard() {
  await connection();
  const [items, stats] = await Promise.all([listPublicPreviews(200), publicPreviewStats()]);
  return (
    <>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line mb-10">
        {[
          [stats.previews, "pages read"],
          [stats.sites, "sites"],
          [stats.commitments, "promises found"],
          [stats.checks, "chain checks run"],
        ].map(([n, l]) => (
          <div key={String(l)} className="bg-bg p-5">
            <dd className="text-3xl tracking-tight">{n}</dd>
            <dt className="label mt-1">{l}</dt>
          </div>
        ))}
      </dl>

      {items.length === 0 ? (
        <div className="border border-line p-10 text-center">
          <p className="subtitle mb-2">No pages read yet</p>
          <p className="text-sm text-muted mb-6">Paste a project&apos;s tokenomics or vesting page to be the first.</p>
          <Link className="btn" href="/try">Check a project</Link>
        </div>
      ) : (
        <table className="data stack panel">
          <thead>
            <tr>
              <th>Page</th>
              <th>Promises</th>
              <th>Kinds</th>
              <th>Checkable</th>
              <th>Status</th>
              <th>Read</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const { site, path } = split(p.url);
              const st = STATE[p.status];
              return (
                <tr key={p.id}>
                  <td data-label="Page">
                    <Link className="link" href={`/previews/${p.id}`}>{site}</Link>
                    <span className="block mono text-[11px] text-muted break-all">{path}</span>
                  </td>
                  <td data-label="Promises">{p.status === "done" ? p.drafts : "—"}</td>
                  <td data-label="Kinds">
                    <span className="flex flex-wrap gap-1">
                      {p.categories.length
                        ? p.categories.map((c) => <span key={c} className="mono text-[10px] border border-line-strong px-1.5">{KIND[c] ?? c}</span>)
                        : <span className="text-muted">—</span>}
                    </span>
                  </td>
                  <td data-label="Checkable">
                    {p.status === "done" ? p.checkable : "—"}
                    {p.checks.length ? <span className="block text-[11px] text-muted">{p.checks.length} checked</span> : null}
                  </td>
                  <td data-label="Status" className={`mono text-xs ${st.tone}`}>{st.label}</td>
                  <td data-label="Read" className="text-muted text-xs whitespace-nowrap">{ago(p.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted mt-4">Pages stay listed for 30 days. Text pasted into Try it is never listed: it stays private to its own link and is deleted after 24 hours.</p>
    </>
  );
}
