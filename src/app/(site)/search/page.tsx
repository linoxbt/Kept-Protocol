import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { StatusChip } from "@/components/status";
import { ago, DemoBadge, Skeleton } from "@/components/ui";
import { search } from "@/services/search";

export const metadata = { title: "Search", robots: { index: false, follow: true } };

export default function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <div className="max-w-5xl">
      <p className="label mb-2">Search</p>
      <h1 className="title mb-6">Does Kept track it?</h1>
      <Suspense fallback={<Skeleton h={320} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function SearchForm({ q }: { q: string }) {
  return (
    <form action="/search" method="get" role="search" className="flex flex-col sm:flex-row gap-2 mb-10">
      <label htmlFor="search-q" className="sr-only">Project, token or wallet address</label>
      <input id="search-q" name="q" defaultValue={q} className="input mono" placeholder="Project name, ticker, token or wallet address (0x…)" autoComplete="off" />
      <button className="btn whitespace-nowrap">Search</button>
    </form>
  );
}

async function Results({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const { q = "" } = await searchParams;
  if (q.trim().length < 2) {
    return (
      <>
        <SearchForm q={q} />
        <p className="text-sm text-muted">
          Search by project name, ticker, token contract or any wallet named in a monitored promise. Kept only shows what it has checked; to check a new
          project, use <Link className="link" href="/try">Check a page</Link>.
        </p>
      </>
    );
  }
  const r = await search(q);
  const total = r.projects.length + r.commitments.length + r.previews.length;
  return (
    <>
      <SearchForm q={q} />
      {total === 0 ? (
        <div className="border border-line p-8">
          <p className="subtitle mb-2">No record for &ldquo;{r.query}&rdquo;</p>
          <p className="text-sm text-muted mb-6 max-w-2xl">
            That does not mean it is clean: Kept has simply not checked it. If the project publishes its tokenomics or vesting terms, you can read them with Kept
            now, and request monitoring from the result.
          </p>
          <Link className="btn" href="/try">Check a page</Link>
        </div>
      ) : null}

      {r.projects.length ? (
        <section className="mb-12">
          <h2 className="label border-t border-line pt-4 mb-4">Monitored projects ({r.projects.length})</h2>
          <ul className="divide-y divide-line border border-line">
            {r.projects.map((p) => (
              <li key={p.slug} className="p-4 flex flex-wrap items-center gap-3">
                <Link className="link" href={`/projects/${p.slug}`}>{p.name}</Link>
                {p.token_symbol ? <span className="mono text-xs text-muted">{p.token_symbol}</span> : null}
                {p.is_demo ? <DemoBadge /> : null}
                <span className="text-xs text-muted ml-auto">{p.commitments} commitment{p.commitments === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.commitments.length ? (
        <section className="mb-12">
          <h2 className="label border-t border-line pt-4 mb-4">Monitored commitments ({r.commitments.length})</h2>
          <ul className="divide-y divide-line border border-line">
            {r.commitments.map((c) => (
              <li key={c.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  <StatusChip status={c.status} final={c.final} />
                  <Link className="link" href={`/commitments/${c.id}`}>{c.project_name}</Link>
                  {r.kind === "address" ? <span className="mono text-[10px] border border-line-strong px-1.5 text-muted">matched {c.matched}</span> : null}
                </div>
                <p className="text-sm text-muted">{c.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.previews.length ? (
        <section className="mb-12">
          <h2 className="label border-t border-line pt-4 mb-4">Previews ({r.previews.length})</h2>
          <p className="text-xs text-muted mb-3">Unconfirmed readings from Check a page: not reviewed and not monitored.</p>
          <ul className="divide-y divide-line border border-line">
            {r.previews.map((p) => (
              <li key={p.id} className="p-4 flex flex-wrap items-center gap-3">
                <Link className="link mono text-xs break-all" href={`/previews/${p.id}`}>{p.url}</Link>
                <span className="text-xs text-muted ml-auto">{p.drafts} promise{p.drafts === 1 ? "" : "s"} · {ago(p.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
