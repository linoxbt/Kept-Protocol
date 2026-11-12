import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { HindcastLanes } from "@/components/lanes";
import { ActionButton } from "@/components/admin-actions";
import { StatusChip } from "@/components/status";
import { Empty, fmtDate, prettyReason, Section, Skeleton } from "@/components/ui";
import { isAdminSession } from "@/lib/session";
import { latestHindcast } from "@/services/hindcast";

export const metadata = { title: "Hindcast" };

export default function HindcastPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={400} />}>
      <Hindcast params={params} />
    </Suspense>
  );
}

async function Hindcast({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const [run, admin] = await Promise.all([latestHindcast(id), isAdminSession()]);
  return (
    <div>
      <Link href={`/commitments/${id}`} className="label u !text-muted hover:!text-ink">← commitment</Link>
      <h1 className="title mt-6 mb-4">Hindcast</h1>
      <p className="text-sm text-muted mb-6 max-w-3xl">
        Under each version of the promise, what would Kept have shown on each date, and what changed it? Same evidence, same code. A replay never implies the
        outcome was predictable, and a gap in evidence is shown as a gap.
      </p>
      {admin ? <div className="mb-6"><ActionButton endpoint="/api/v1/hindcast" body={{ commitment_id: id }} label="Run a new replay" /></div> : null}
      {!run ? (
        <Empty>No replay yet.{admin ? " Run one above." : " An admin can run one."}</Empty>
      ) : (
        <>
          <div className="proof mb-8">
            <p className="label mb-3">Run {run.id} · {fmtDate(run.result.from)} → {fmtDate(run.result.to)} · <Link className="link" href={`/receipts/${run.receipt_id}`}>replay receipt</Link></p>
            <HindcastLanes result={run.result} />
            <p className="text-xs text-muted mt-2">{run.result.divergences.length ? `The versions disagree on ${run.result.divergences.length} sampled date(s).` : "The versions agree on every sampled date."}</p>
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            {run.result.lanes.map((lane) => (
              <Section key={lane.version} title={`v${lane.version} status changes`}>
                <ul className="panel divide-y divide-line text-sm">
                  {lane.changes.map((c, i) => (
                    <li key={i} className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="mono text-xs text-muted w-24">{fmtDate(c.t)}</span>
                        <StatusChip status={c.to} />
                        {c.txHash ? <a className="link mono text-xs" href={`https://basescan.org/tx/${c.txHash}`} target="_blank" rel="noreferrer">trigger tx</a> : null}
                      </div>
                      <p className="text-xs text-muted mt-1">{prettyReason(c.reason)}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
