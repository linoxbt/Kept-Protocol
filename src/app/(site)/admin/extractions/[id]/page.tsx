import { connection } from "next/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { isAdminSession } from "@/lib/session";
import { getExtraction } from "@/services/extractions";
import { ConfirmDraftForm } from "@/components/admin-forms";
import { Flag, Skeleton } from "@/components/ui";

export const metadata = { title: "Review extraction" };

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={600} />}>
      <Review params={params} />
    </Suspense>
  );
}

async function Review({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!(await isAdminSession())) redirect("/admin/login");
  const { id } = await params;
  const ex = await getExtraction(id);
  if (!ex || !ex.result) notFound();
  const [snap] = ex.snapshot_id ? await db()<{ text: string; captured_at: Date }[]>`select text, captured_at from source_snapshots where id = ${ex.snapshot_id}` : [];
  const [project] = ex.project_id ? await db()<{ token_address: string | null }[]>`select token_address from projects where id = ${ex.project_id}` : [];
  const text = snap?.text ?? ex.preview_text ?? "";
  const spans = [...ex.result.drafts].sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  let at = 0;
  for (const d of spans) {
    if (d.start < at) continue;
    pieces.push(text.slice(at, d.start));
    pieces.push(<mark key={d.index} className="hl" id={`span-${d.index}`}>{text.slice(d.start, d.end)}<sup className="mono text-accent">[{d.index + 1}]</sup></mark>);
    at = d.end;
  }
  pieces.push(text.slice(at));
  return (
    <div>
      <Link href="/admin" className="label u !text-muted hover:!text-ink">← admin</Link>
      <h1 className="title mt-6 mb-4">Review extraction</h1>
      <p className="text-sm text-muted mb-2 mono">{ex.id} · {ex.result.serv_calls} SERV calls{ex.result.manual ? " · manual draft" : ""}</p>
      {ex.target_commitment_id ? <p className="text-sm text-atrisk mb-4">This extraction comes from a changed source and proposes a new version of <Link className="link" href={`/commitments/${ex.target_commitment_id}`}>{ex.target_commitment_id}</Link>. A policy change becomes current only when you confirm it.</p> : null}
      <div className="flex flex-wrap gap-1.5 mb-6">{ex.result.source_flags.map((f) => <Flag key={f} name={f} />)}</div>
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="panel p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-[80vh] overflow-auto lg:sticky lg:top-4">{pieces}</div>
        <div className="space-y-6">
          {ex.result.drafts.map((d) => (
            <div key={d.index} className="proof">
              <p className="mono text-xs text-accent mb-1">[{d.index + 1}] {d.classification?.method_id} · {d.classification?.verifiability} · rule {d.classification?.rules}</p>
              <p className="mb-2">“{d.quote}”</p>
              <div className="flex flex-wrap gap-1.5 mb-2">{d.flags.map((f) => <Flag key={f} name={f} />)}</div>
              {d.problems.length ? <ul className="text-xs text-atrisk list-disc pl-5 mb-2">{d.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
              {d.fields ? <pre className="mono text-[11px] text-muted bg-bg p-2 overflow-auto max-h-48">{JSON.stringify(d.fields, null, 2)}</pre> : <p className="text-xs text-breached">{d.error}</p>}
              {d.fields && d.classification?.method_id !== "none" ? (
                <ConfirmDraftForm
                  extractionId={ex.id}
                  targetCommitmentId={ex.target_commitment_id}
                  draft={{
                    index: d.index,
                    quote: d.quote,
                    flags: d.flags,
                    problems: d.problems,
                    method: d.classification?.method_id ?? "none",
                    tokenAddress: d.fields.token_address ?? project?.token_address ?? null,
                    subjects: [...d.fields.subjects.map((s) => s.address), ...(d.fields.vesting_contract ? [d.fields.vesting_contract] : [])],
                    fields: d.fields,
                  }}
                />
              ) : (
                <p className="text-xs text-muted mt-2">No registered method: recorded and versioned for change tracking, not monitored.</p>
              )}
            </div>
          ))}
          {ex.result.dropped_spans.length ? (
            <div className="panel p-4 text-xs text-muted">
              <p className="label mb-2">Dropped by Kept&apos;s checks</p>
              <ul className="space-y-1">{ex.result.dropped_spans.map((s, i) => <li key={i}>“{s.quote}” — {s.reason}</li>)}</ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
