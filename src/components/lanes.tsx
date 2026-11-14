import type { HindcastResult } from "@/core/hindcast";
import { statusColor } from "./status";
import { fmtDate } from "./ui";

/** Hindcast: one lane per version over a shared time axis; status bands, change markers. */
export function HindcastLanes({ result }: { result: HindcastResult }) {
  const W = 760;
  const left = 70;
  const right = 12;
  const x = (t: number) => left + ((t - result.from) / Math.max(1, result.to - result.from)) * (W - left - right);
  const laneH = 34;
  const H = 24 + result.lanes.length * laneH + 24;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hindcast status lanes per version">
      {result.lanes.map((lane, li) => {
        const y = 18 + li * laneH;
        return (
          <g key={lane.version}>
            <text x={0} y={y + 15} fill="var(--color-ink)" fontSize="11" fontFamily="var(--font-mono)">v{lane.version}</text>
            {lane.points.map((p, i) => {
              const next = lane.points[i + 1]?.t ?? result.to;
              return <rect key={i} x={x(p.t)} y={y} width={Math.max(0.5, x(next) - x(p.t))} height={20} fill={statusColor(p.status)} opacity={0.75}><title>{`${fmtDate(p.t)} · ${p.status}${p.final ? " (final)" : ""} — ${p.reason}`}</title></rect>;
            })}
            {lane.changes.slice(1).map((c, i) => (
              <g key={i}>
                <line x1={x(c.t)} x2={x(c.t)} y1={y - 3} y2={y + 23} stroke="var(--color-ink)" strokeWidth={1} />
                <title>{`${fmtDate(c.t)}: ${c.from} → ${c.to}. ${c.reason}`}</title>
              </g>
            ))}
          </g>
        );
      })}
      <text x={left} y={H - 4} fill="var(--color-faint)" fontSize="9" fontFamily="var(--font-mono)">{fmtDate(result.from)}</text>
      <text x={W - right} y={H - 4} textAnchor="end" fill="var(--color-faint)" fontSize="9" fontFamily="var(--font-mono)">{fmtDate(result.to)}</text>
    </svg>
  );
}
