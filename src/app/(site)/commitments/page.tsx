import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { StatusChip } from "@/components/status";
import { ago, DemoBadge, FilterChips, Pager, Skeleton, withParams } from "@/components/ui";
import { cleanFilters, listCommitments } from "@/services/listing";

export const metadata = { title: "Commitments", description: "Every promise Kept monitors, with its current status and the last time it changed." };

type SP = Promise<{ status?: string; kind?: string; project?: string; page?: string }>;

export default function CommitmentsPage({ searchParams }: { searchParams: SP }) {
  return (
    <div>
      <p className="label mb-2">Commitments</p>
      <h1 className="title mb-4">Every promise Kept monitors</h1>
      <p className="text-sm text-muted mb-8 max-w-3xl">
        Each row is a reviewed commitment checked against finalized Base blocks on a schedule. Statuses are explained in{" "}
        <Link className="link" href="/methodology#statuses">How it works</Link>; unreviewed readings are under <Link className="link" href="/previews">Previews</Link>.
      </p>
      <Suspense fallback={<Skeleton h={420} />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { token_lock: "Lock", vesting: "Vesting", burn: "Burn" };

async function List({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const f = cleanFilters({ status: sp.status, kind: sp.kind, project: sp.project, page: Number(sp.page) || 1 });
  const { rows, total, page, pages } = await listCommitments(f);
  const link = (over: Record<string, string | number | null>) => withParams("/commitments", { status: f.status, kind: f.kind, project: f.project, page: 1, ...over });
  return (
    <>
      <div className="space-y-3 mb-6">
        <FilterChips
          label="Status"
          active={f.status}
          options={[[null, "all"], ["verified", "verified"], ["at_risk", "at risk"], ["breached", "breached"], ["pending", "pending"], ["awaiting_evidence", "awaiting evidence"], ["disputed", "disputed"]]}
          href={(v) => link({ status: v })}
        />
        <FilterChips label="Kind" active={f.kind} options={[[null, "all"], ["token_lock", "locks"], ["vesting", "vesting"], ["burn", "burns"]]} href={(v) => link({ kind: v })} />
        {f.project ? <p className="text-xs text-muted">Project: <span className="mono">{f.project}</span> · <a className="link" href={link({ project: null })}>clear</a></p> : null}
      </div>
      {rows.length === 0 ? (
        <div className="border border-line p-8 text-sm text-muted">
          No commitments match these filters. <Link className="link" href="/commitments">Show all</Link>
        </div>
      ) : (
        <table className="data stack panel">
          <thead>
            <tr><th>Project</th><th>Promise</th><th>Kind</th><th>Status</th><th>Window</th><th>Last change</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td data-label="Project">
                  <Link className="link" href={`/projects/${c.project_slug}`}>{c.project_name}</Link>
                  {c.is_demo ? <span className="block mt-1"><DemoBadge /></span> : null}
                </td>
                <td data-label="Promise" className="text-sm max-w-md">
                  <Link className="hover:text-ink" href={`/commitments/${c.id}`}>{c.summary}</Link>
                  {c.version > 1 ? <span className="block mono text-[10px] text-atrisk mt-1">v{c.version}: rewritten</span> : null}
                </td>
                <td data-label="Kind" className="mono text-xs">{KIND_LABEL[c.category] ?? c.category}</td>
                <td data-label="Status"><Link href={`/commitments/${c.id}`}><StatusChip status={c.status} final={c.final} /></Link></td>
                <td data-label="Window" className="mono text-xs text-muted whitespace-nowrap">{c.window_start.slice(0, 10)} → {c.window_end.slice(0, 10)}</td>
                <td data-label="Last change" className="text-xs text-muted whitespace-nowrap">{c.last_change_at ? ago(c.last_change_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} pages={pages} total={total} href={(p) => link({ page: p })} />
    </>
  );
}
