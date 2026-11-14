import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { CHAIN_NAMES } from "@/chain/explorer";
import type { Status } from "@/core/types";
import { StatusChip } from "@/components/status";
import { ago, DemoBadge, Empty, Skeleton } from "@/components/ui";
import { listProjects } from "@/services/queries";

export const metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <div>
      <h1 className="title mb-4">Projects</h1>
      <p className="text-muted text-sm mb-6">Every project Kept monitors, with the status of each commitment.</p>
      <Suspense fallback={<Skeleton h={320} />}>
        <Directory />
      </Suspense>
    </div>
  );
}

async function Directory() {
  await connection();
  const projects = await listProjects();
  if (!projects.length) return <Empty>No projects yet. An admin adds one from the console.</Empty>;
  return (
    <table className="data stack panel">
      <thead>
        <tr>
          <th>Project</th>
          <th>Chain</th>
          <th>Commitments</th>
          <th>Status</th>
          <th>Last check</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.id}>
            <td>
              <Link href={`/projects/${p.slug}`} className="hover:text-accent font-medium">{p.name}</Link>{" "}
              {p.is_demo ? <DemoBadge /> : null}
              {p.token_symbol ? <span className="mono text-xs text-muted ml-2">${p.token_symbol}</span> : null}
            </td>
            <td className="mono text-xs hide-sm">{CHAIN_NAMES[p.chain_id] ?? p.chain_id}</td>
            <td className="mono">{p.commitments}</td>
            <td>
              <div className="flex flex-wrap gap-1">
                {(Object.entries(p.counts) as [Status, number][]).map(([s, n]) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <StatusChip status={s} />
                    <span className="mono text-xs text-muted">×{n}</span>
                  </span>
                ))}
              </div>
            </td>
            <td className="mono text-xs text-muted hide-sm">{ago(p.last_checked_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
