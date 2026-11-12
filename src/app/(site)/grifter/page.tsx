import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { Suspense } from "react";
import { CASES } from "@/grifter/cases";
import { runGrifter } from "@/grifter/runner";
import { db } from "@/db/client";
import { fmtDate, Section, Skeleton } from "@/components/ui";

export const metadata = { title: "Grifter — adversarial testing" };

export default function GrifterPage() {
  return (
    <div>
      <h1 className="title mb-4">Grifter</h1>
      <p className="text-sm text-muted mb-8 max-w-3xl">
        Grifter attacks Kept&apos;s own pipeline, never third parties. Each extraction case replays a <em>fooled model</em> — the worst plausible SERV output for
        the trap — to prove that Kept&apos;s code catches it even when the model does not. Chain cases run on an in-memory fixture chain. A prompt or method
        version cannot ship while any critical or high case fails.
      </p>
      <Suspense fallback={<Skeleton h={500} />}>
        <Report />
      </Suspense>
    </div>
  );
}

/** The offline suite is deterministic for a build: compute it once and cache it, not on every view. */
async function buildReport() {
  "use cache";
  cacheLife("max");
  return runGrifter();
}

async function Report() {
  const report = await buildReport();
  await connection();
  const history = await db()<{ id: string; mode: string; summary: { passed: number; total: number; blocking: number }; prompt_versions: Record<string, string>; created_at: Date }[]>`
    select id, mode, summary, prompt_versions, created_at from grifter_runs order by created_at desc limit 10`.catch(() => []);
  const byId = new Map(CASES.map((c) => [c.id, c]));
  return (
    <>
      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-px bg-line proof mb-8">
        <div className="bg-panel p-4"><p className="mono text-2xl text-verified">{report.summary.passed}/{report.summary.total}</p><p className="text-xs text-muted">cases passing (this build)</p></div>
        <div className="bg-panel p-4"><p className="mono text-2xl" style={{ color: report.summary.blocking ? "var(--color-breached)" : "var(--color-ink)" }}>{report.summary.blocking}</p><p className="text-xs text-muted">blocking failures</p></div>
        {Object.entries(report.prompt_versions).map(([k, v]) => (
          <div key={k} className="bg-panel p-4"><p className="mono text-sm">{v}</p><p className="text-xs text-muted">{k} prompt</p></div>
        ))}
      </div>
      <Section title="Families">
        <table className="data panel mb-2">
          <thead><tr><th>Family</th><th>Pass</th></tr></thead>
          <tbody>{Object.entries(report.summary.byFamily).map(([f, s]) => <tr key={f}><td className="mono text-xs">{f}</td><td className="mono">{s.passed}/{s.total}</td></tr>)}</tbody>
        </table>
      </Section>
      <Section title="Cases">
        <table className="data stack panel">
          <thead><tr><th>Case</th><th>Scenario</th><th>Severity / layer</th><th>Kept&apos;s behaviour</th><th>Result</th></tr></thead>
          <tbody>
            {report.results.map((r) => {
              const c = byId.get(r.id)!;
              const observed = r.observed as { status?: string; reason?: string; source_flags?: string[]; drafts?: { flags: string[] }[] };
              return (
                <tr key={r.id}>
                  <td className="mono text-xs">{r.id}</td>
                  <td className="text-sm max-w-sm">{r.title}</td>
                  <td className="mono text-xs">{r.severity} / {r.layer}</td>
                  <td className="text-xs text-muted max-w-md">
                    {c.kind === "chain" ? `${observed.status}: ${observed.reason}` : [...(observed.source_flags ?? []), ...(observed.drafts?.flatMap((d) => d.flags) ?? [])].filter((v, i, a) => a.indexOf(v) === i).join(", ") || `${observed.drafts?.length ?? 0} draft(s)`}
                  </td>
                  <td className={`mono text-xs ${r.passed ? "text-verified" : "text-breached"}`}>{r.passed ? "PASS" : `FAIL: ${r.failures.join("; ")}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
      <Section title="Run history (before and after prompt changes)">
        {history.length === 0 ? (
          <p className="text-sm text-muted">No stored runs yet. <span className="mono">npm run grifter -- --save</span> (or <span className="mono">--live --save</span> with a SERV key) records one.</p>
        ) : (
          <table className="data panel">
            <thead><tr><th>When</th><th>Mode</th><th>Prompts</th><th>Pass</th><th>Blocking</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="mono text-xs">{fmtDate(h.created_at, true)}</td>
                  <td className="mono text-xs">{h.mode}</td>
                  <td className="mono text-xs">{Object.values(h.prompt_versions).join(", ")}</td>
                  <td className="mono">{h.summary.passed}/{h.summary.total}</td>
                  <td className="mono">{h.summary.blocking}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
