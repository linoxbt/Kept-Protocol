import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CHAIN_NAMES } from "@/chain/explorer";
import { Addr, Hash } from "@/components/addr";
import { StatusChip } from "@/components/status";
import { ago, DemoBadge, Empty, fmtDate, Section, Skeleton } from "@/components/ui";
import { projectCommitments, projectSources } from "@/services/queries";
import { getProjectBySlugOrId } from "@/services/sources";

export default function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={400} />}>
      <Project params={params} />
    </Suspense>
  );
}

async function Project({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const project = await getProjectBySlugOrId(slug);
  if (!project) notFound();
  const [commitments, sources] = await Promise.all([projectCommitments(project.id), projectSources(project.id)]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        {project.is_demo ? <DemoBadge /> : null}
        <span className="mono text-xs text-muted border border-line px-1.5 py-0.5">registration: {project.registration_level}</span>
      </div>
      <div className="text-sm text-muted flex flex-wrap gap-x-6 gap-y-1 mb-8">
        <span>{CHAIN_NAMES[project.chain_id]} · chain {project.chain_id}</span>
        {project.token_address ? (
          <span className="flex items-center gap-2">token {project.token_symbol ? <span className="mono">${project.token_symbol}</span> : null} <Addr address={project.token_address} chainId={project.chain_id} /></span>
        ) : null}
      </div>
      {project.is_demo ? (
        <p className="panel p-3 text-xs text-disputed mb-8">
          Demo project: its token, team wallet and promise page are Kept&apos;s own, clearly labelled, and exist to show a live breach. Kept never stages a breach against a real team.
        </p>
      ) : null}
      {project.description ? <p className="mb-8 max-w-3xl text-sm">{project.description}</p> : null}

      <Section title={`Commitments (${commitments.length})`}>
        {commitments.length === 0 ? (
          <Empty>No commitments yet. Add a source from the admin console.</Empty>
        ) : (
          <table className="data stack panel">
            <thead>
              <tr>
                <th>Condition</th>
                <th>Status</th>
                <th>Method</th>
                <th>Window</th>
                <th>Version</th>
                <th>Last check</th>
              </tr>
            </thead>
            <tbody>
              {commitments.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-md">
                    <Link href={`/commitments/${c.id}`} className="hover:text-accent">{c.spec.condition_summary}</Link>
                  </td>
                  <td><StatusChip status={c.status} final={c.final} /></td>
                  <td className="mono text-xs hide-sm">{c.spec.method_id}</td>
                  <td className="mono text-xs hide-sm">{fmtDate(c.spec.window.start)} → {fmtDate(c.spec.window.end)}</td>
                  <td className="mono text-xs hide-sm">v{c.version}</td>
                  <td className="mono text-xs text-muted hide-sm">{ago(c.last_checked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Sources">
        {sources.length === 0 ? (
          <Empty>No sources captured.</Empty>
        ) : (
          <table className="data stack panel">
            <thead>
              <tr>
                <th>Source</th>
                <th>Kind</th>
                <th>Snapshots</th>
                <th>Latest capture</th>
                <th>Content hash</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td className="max-w-xs truncate">{s.url ? <a className="link" href={s.url} target="_blank" rel="noreferrer">{s.url}</a> : <span className="text-muted">pasted text</span>}{s.status !== "active" ? <span className="text-atrisk text-xs ml-2">source {s.status}</span> : null}</td>
                  <td className="mono text-xs">{s.kind}</td>
                  <td className="mono text-xs">{s.snapshots}</td>
                  <td className="mono text-xs">{fmtDate(s.latest_at, true)}</td>
                  <td>{s.latest_sha ? <Hash value={s.latest_sha} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
