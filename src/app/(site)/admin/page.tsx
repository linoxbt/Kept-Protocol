import { connection } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { isAdminSession } from "@/lib/session";
import { adminSetupOpen } from "@/lib/auth";
import { getSigner, isDevSigner } from "@/receipts/signer";
import { anchorStatus } from "@/services/anchor";
import { openDisputeQueue } from "@/services/disputes";
import { demoStatus } from "@/services/demo";
import { servAvailable, servStats, spentTodayUsd } from "@/services/serv";
import { DeclarationDecision, DemoPageForm, ManualDraftForm, NewProjectForm, NewSourceForm, PostButton, PromoteRequestForm, WebhookForm } from "@/components/admin-forms";
import { openContacts, openDeclarations } from "@/services/declarations";
import { openRequests } from "@/services/monitoring";
import { listWebhooks } from "@/services/webhooks";
import { DisputeDecision } from "@/components/admin-actions";
import { ago, fmtDate, Section, Skeleton } from "@/components/ui";

export const metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <Suspense fallback={<Skeleton h={600} />}>
      <Admin />
    </Suspense>
  );
}

async function Admin() {
  await connection();
  if (!(await isAdminSession())) redirect((await adminSetupOpen()) ? "/admin/setup" : "/admin/login");
  const sql = db();
  const [projects, sources, extractions, pages, stats, spent, anchor, disputes, snapshots, commitments, demo, requests, hooks, declarations, contacts] = await Promise.all([
    sql<{ id: string; name: string; slug: string }[]>`select id, name, slug from projects order by created_at desc`,
    sql<{ id: string; url: string | null; kind: string; project: string; last_checked_at: Date | null; status: string }[]>`
      select s.id, s.url, s.kind, p.name as project, s.last_checked_at, s.status from sources s join projects p on p.id = s.project_id order by s.created_at desc limit 30`,
    sql<{ id: string; status: string; preview: boolean; created_at: Date; drafts: number | null; undecided: number; project: string | null; target_commitment_id: string | null; error: string | null }[]>`
      select e.id, e.status, e.preview, e.created_at, jsonb_array_length(e.result->'drafts') as drafts, p.name as project, e.target_commitment_id, e.error,
        greatest(coalesce(jsonb_array_length(e.result->'drafts'), 0)
          - (select count(*) from commitment_versions v where v.extraction_id = e.id and v.draft_index is not null)
          - (select count(*) from draft_rejections r where r.extraction_id = e.id), 0)::int as undecided
      from extractions e left join projects p on p.id = e.project_id where not e.preview
      order by (e.status = 'running') desc, (greatest(coalesce(jsonb_array_length(e.result->'drafts'), 0)
          - (select count(*) from commitment_versions v where v.extraction_id = e.id and v.draft_index is not null)
          - (select count(*) from draft_rejections r where r.extraction_id = e.id), 0) > 0) desc, e.created_at desc limit 30`,
    sql<{ slug: string; title: string; body: string }[]>`select slug, title, body from demo_pages order by slug`,
    servStats(),
    spentTodayUsd(),
    anchorStatus().catch(() => null),
    openDisputeQueue(),
    sql<{ id: string; project_id: string; label: string }[]>`
      select distinct on (s.id) n.id, s.project_id, p.name || ' · ' || coalesce(s.url, s.kind) || ' · ' || to_char(n.captured_at, 'YYYY-MM-DD HH24:MI') as label
      from sources s join projects p on p.id = s.project_id join source_snapshots n on n.source_id = s.id
      order by s.id, n.captured_at desc limit 50`,
    sql<{ id: string; label: string }[]>`
      select c.id, p.name || ' · ' || c.id as label from commitments c join projects p on p.id = c.project_id order by c.created_at desc limit 100`,
    demoStatus(),
    openRequests(),
    listWebhooks(),
    openDeclarations(),
    openContacts(),
  ]);
  const signer = getSigner().address;
  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="title">Admin console</h1>
        <form method="post" action="/api/admin/logout"><button className="btn btn-quiet text-xs">sign out</button></form>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line proof mb-10 text-sm">
        <div className="bg-panel p-4"><p className="label">SERV</p><p className={servAvailable() ? "text-verified" : "text-atrisk"}>{servAvailable() ? "configured" : "paused (no SERV_API_KEY)"}</p><p className="text-xs text-muted mono">${spent.toFixed(3)} of ${env().SERV_DAILY_BUDGET_USD} today · {stats.calls} calls total</p></div>
        <div className="bg-panel p-4"><p className="label">Signer</p><p className="mono text-xs break-all">{signer}</p>{isDevSigner(signer) ? <p className="text-xs text-atrisk">public development key</p> : null}</div>
        <div className="bg-panel p-4">
          <p className="label">Anchoring (EAS, chain {anchor?.chain_id ?? "?"})</p>
          <p className="mono text-xs">{anchor?.pending_receipts ?? "?"} receipt(s) pending</p>
          {anchor?.operator ? <p className="mono text-[10px] break-all text-muted">operator {anchor.operator}</p> : <p className="text-xs text-atrisk">no operator key</p>}
          <p className={`text-xs ${anchor?.funded ? "text-verified" : "text-atrisk"}`}>{anchor?.funded ? "funded: anchors automatically every 6 h" : "fund the operator with a little ETH to start anchoring"}</p>
          {anchor?.last_anchor ? <p className="mono text-[10px] text-muted">last {ago(new Date(anchor.last_anchor.anchored_at))} · {anchor.last_anchor.receipt_count} receipts</p> : null}
          <p className="text-xs text-muted mt-2">Live demo: <span className="mono">{demo?.stage ?? (anchor?.funded ? "starting" : "waits for funding")}</span>{demo?.commitment_id ? <> · <Link className="link mono" href={`/commitments/${demo.commitment_id}`}>record</Link></> : null}</p>
        </div>
        <div className="bg-panel p-4"><p className="label">Grifter</p><PostButton endpoint="/api/v1/grifter/runs" label="Run suite (offline)" />{servAvailable() ? <PostButton endpoint="/api/v1/grifter/runs?live=1" label="Run against SERV" /> : null}</div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8 mb-10">
        <NewProjectForm />
        {projects.length ? <NewSourceForm projects={projects} /> : <p className="panel p-4 text-sm text-muted">Create a project first.</p>}
      </div>

      <Section title={`Monitoring requests (${requests.length} open)`}>
        {requests.length ? (
          <ul className="panel divide-y divide-line text-sm">
            {requests.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <Link className="link mono text-xs" href={`/previews/${r.extraction_id}`}>preview</Link>
                  <a className="link mono text-xs break-all" href={r.url} target="_blank" rel="noreferrer nofollow">{r.url}</a>
                  <span className="mono text-xs text-muted">{r.drafts} promise(s), {r.checkable} checkable · {ago(r.created_at)}</span>
                  {r.contact ? <span className="text-xs text-muted">contact: {r.contact}</span> : null}
                </div>
                {r.note ? <p className="mt-1 whitespace-pre-wrap">{r.note}</p> : null}
                <PromoteRequestForm id={r.id} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))} suggestedName={(() => { try { return new URL(r.url).hostname.replace(/^(www|docs|whitepaper)\./, "").split(".")[0]; } catch { return ""; } })()} suggestedToken={null} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel p-4 text-sm text-muted">No monitoring requests waiting.</p>
        )}
      </Section>

      <Section title={`Wallet declarations (${declarations.length} open)`}>
        {declarations.length ? (
          <ul className="panel divide-y divide-line text-sm">
            {declarations.map((d) => (
              <li key={d.id} className="p-4 space-y-1">
                <p><span className="text-ink">{d.project}</span> · <span className="mono text-xs">{d.address}</span> · {d.role} · <span className="text-xs text-muted">{ago(d.created_at)}</span></p>
                <p className="text-xs text-verified">Signature verified when submitted.</p>
                {d.evidence_url ? <a className="link text-xs mono break-all" href={d.evidence_url} target="_blank" rel="noreferrer nofollow">{d.evidence_url}</a> : null}
                {d.contact ? <p className="text-xs text-muted">contact: {d.contact}</p> : null}
                <DeclarationDecision id={d.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel p-4 text-sm text-muted">No declarations waiting.</p>
        )}
      </Section>

      <Section title={`Pilot and contact requests (${contacts.length})`}>
        {contacts.length ? (
          <ul className="panel divide-y divide-line text-sm">
            {contacts.map((c) => (
              <li key={c.id} className="p-4 space-y-1">
                <p><span className="mono text-[10px] border border-line-strong px-1.5 mr-2">{c.kind}</span>{c.name}{c.organisation ? ` · ${c.organisation}` : ""} · <span className="text-xs text-muted">{ago(c.created_at)}</span></p>
                <p className="text-xs">contact: {c.contact}</p>
                <p className="whitespace-pre-wrap text-muted">{c.message}</p>
                <PostButton endpoint={`/api/v1/contact/${c.id}`} label="Mark handled" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel p-4 text-sm text-muted">No requests waiting.</p>
        )}
      </Section>

      <Section title={`Disputes (${disputes.length} open)`}>
        {disputes.length ? (
          <ul className="panel divide-y divide-line text-sm">
            {disputes.map((x) => (
              <li key={x.id} className="p-3">
                <div className="flex flex-wrap gap-3 items-center">
                  <Link className="link mono text-xs" href={`/commitments/${x.commitment_id}`}>{x.commitment_id}</Link>
                  <span className="mono text-xs">{x.status}</span>
                  <span className="mono text-xs text-muted">{ago(x.opened_at)}</span>
                  {x.contact ? <span className="text-xs text-muted">contact: {x.contact}</span> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap">{x.reason}</p>
                {x.evidence_url ? <a className="link text-xs mono break-all" href={x.evidence_url} target="_blank" rel="noreferrer nofollow">{x.evidence_url}</a> : null}
                <DisputeDecision id={x.id} status={x.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel p-4 text-sm text-muted">No disputes waiting.</p>
        )}
      </Section>

      <Section title="Manual draft">
        <ManualDraftForm snapshots={snapshots} commitments={commitments} />
      </Section>

      <Section title="Extractions awaiting review">
        <table className="data stack panel">
          <thead><tr><th>Extraction</th><th>Project</th><th>Drafts (undecided)</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {extractions.map((e) => (
              <tr key={e.id}>
                <td><Link className="link mono text-xs" href={`/admin/extractions/${e.id}`}>{e.id}</Link>{e.target_commitment_id ? <span className="mono text-[10px] text-atrisk ml-2">proposes a new version</span> : null}</td>
                <td className="text-sm">{e.project}</td>
                <td className={`mono ${e.undecided ? "text-atrisk" : "text-muted"}`}>{e.drafts ?? 0} ({e.undecided})</td>
                <td className="mono text-xs">{e.status}{e.error ? <span className="text-breached"> · {e.error.slice(0, 80)}</span> : null}</td>
                <td className="mono text-xs text-muted">{ago(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Sources">
        <table className="data stack panel">
          <thead><tr><th>Source</th><th>Project</th><th>Kind</th><th>Last capture</th><th></th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td className="text-xs max-w-xs truncate mono">{s.url ?? "pasted text"}</td>
                <td className="text-sm">{s.project}</td>
                <td className="mono text-xs">{s.kind} · {s.status}</td>
                <td className="mono text-xs">{fmtDate(s.last_checked_at, true)}</td>
                <td>{s.url ? <PostButton endpoint={`/api/v1/sources/${s.id}/recapture`} label="Re-capture" /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid lg:grid-cols-2 gap-8">
        <Section title="Demo pages">
          <div className="space-y-4">
            {pages.map((p) => <DemoPageForm key={p.slug} slug={p.slug} title={p.title} body={p.body} />)}
            <DemoPageForm slug="" title="" body="" />
          </div>
        </Section>
        <Section title={`Webhooks (${hooks.length})`}>
          <WebhookForm />
          {hooks.length ? (
            <ul className="panel divide-y divide-line text-xs mt-4">
              {hooks.map((h) => (
                <li key={h.id} className="p-3 space-y-1">
                  <p className="mono break-all">{h.url}</p>
                  <p className="text-muted">
                    {h.follower ? `follow of ${h.commitment_id}` : h.project_id ? `project ${h.project_id}` : "all projects"} · {h.active ? <span className="text-verified">active</span> : "inactive"} · {h.delivered} delivered,{" "}
                    {h.pending} pending, {h.failed} failed
                  </p>
                  {h.last_error ? <p className="text-atrisk">last error: {h.last_error}</p> : null}
                  <div className="flex gap-2">
                    <PostButton endpoint={`/api/v1/webhooks/${h.id}`} body={{ action: "test" }} label="Send test" />
                    <PostButton endpoint={`/api/v1/webhooks/${h.id}`} body={{ action: h.active ? "deactivate" : "activate" }} label={h.active ? "Deactivate" : "Activate"} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
