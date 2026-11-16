import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { StatusChip } from "@/components/status";
import { ago, DemoBadge, FilterChips, fmtDate, Pager, prettyReason, Skeleton, withParams } from "@/components/ui";
import { ACTIVITY_KINDS, listActivity } from "@/services/listing";

export const metadata = { title: "Activity", description: "Every status change on every monitored commitment, each with its signed receipt." };

type SP = Promise<{ kind?: string; page?: string }>;

export default function ActivityPage({ searchParams }: { searchParams: SP }) {
  return (
    <div>
      <p className="label mb-2">Activity</p>
      <h1 className="title mb-4">Every status change</h1>
      <p className="text-sm text-muted mb-8 max-w-3xl">
        Each entry is a change in a monitored commitment&apos;s status, with the signed receipt that recorded it. Machines can follow the same feed at{" "}
        <a className="link mono" href="/api/v1/feed">/api/v1/feed</a>.
      </p>
      <Suspense fallback={<Skeleton h={420} />}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Feed({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const { rows, total, page, pages, kind } = await listActivity({ kind: sp.kind, page: Number(sp.page) || 1 });
  const link = (over: Record<string, string | number | null>) => withParams("/activity", { kind, page: 1, ...over });
  return (
    <>
      <div className="mb-6">
        <FilterChips label="Show" active={kind} options={[[null, "everything"], ...Object.entries(ACTIVITY_KINDS).map(([k, v]) => [k, v.label.toLowerCase()] as [string, string])]} href={(v) => link({ kind: v })} />
      </div>
      {rows.length === 0 ? (
        <div className="border border-line p-8 text-sm text-muted">Nothing here yet. <Link className="link" href="/activity">Show everything</Link></div>
      ) : (
        <ol className="border border-line divide-y divide-line">
          {rows.map((r, i) => (
            <li key={`${r.commitment_id}-${i}`} className="p-4 grid md:grid-cols-[160px_1fr_auto] gap-3 items-start">
              <div className="text-xs text-muted">
                <span title={fmtDate(r.at, true)}>{ago(r.at)}</span>
                <span className="block mono text-[10px]">{fmtDate(r.at, true)}</span>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Link className="link" href={`/commitments/${r.commitment_id}`}>{r.project_name}</Link>
                  {r.is_demo ? <DemoBadge /> : null}
                  {r.from_status ? <span className="mono text-[11px] text-muted">{r.from_status.replace("_", " ")} →</span> : null}
                  <StatusChip status={r.to_status} final={r.final} />
                  {r.version && r.version > 1 ? <span className="mono text-[10px] text-atrisk">under v{r.version}</span> : null}
                </div>
                <p className="text-sm text-muted">{prettyReason(r.reason)}</p>
              </div>
              {r.receipt_id ? <Link className="link mono text-xs whitespace-nowrap" href={`/receipts/${r.receipt_id}`}>receipt →</Link> : <span />}
            </li>
          ))}
        </ol>
      )}
      <Pager page={page} pages={pages} total={total} href={(p) => link({ page: p })} />
    </>
  );
}
