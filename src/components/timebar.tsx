import { fmtDate } from "./ui";

export interface TimeBarEvent {
  t: number;
  kind: "violating" | "counted" | "flag";
  href?: string;
  label: string;
}

/**
 * A commitment window drawn as a bar: today, the deadline and every evidence event as a tick.
 * With two windows (a version diff), both are drawn on the same axis.
 */
export function TimeBar({ windows, events, now }: { windows: { label: string; start: number; end: number }[]; events: TimeBarEvent[]; now: number }) {
  const lo = Math.min(...windows.map((w) => w.start), ...events.map((e) => e.t));
  const hi = Math.max(...windows.map((w) => w.end), now, ...events.map((e) => e.t));
  const W = 640;
  const pad = 12;
  const x = (t: number) => pad + ((t - lo) / Math.max(1, hi - lo)) * (W - pad * 2);
  const rowH = 26;
  const H = 30 + windows.length * rowH + 30;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Commitment window and evidence events">
      {windows.map((w, i) => (
        <g key={w.label}>
          <text x={pad} y={22 + i * rowH} fill="var(--color-muted)" fontSize="12" fontFamily="var(--font-mono)">{w.label}</text>
          <rect x={x(w.start)} y={26 + i * rowH} width={Math.max(2, x(w.end) - x(w.start))} height={10} fill="var(--color-panel-2)" stroke="var(--color-line)" />
          <line x1={x(w.end)} x2={x(w.end)} y1={22 + i * rowH} y2={38 + i * rowH} stroke="var(--color-ink)" strokeWidth={1.5} />
          <text x={x(w.end) > W - 90 ? x(w.end) - 4 : x(w.end) + 4} textAnchor={x(w.end) > W - 90 ? "end" : "start"} y={20 + i * rowH} fill="var(--color-ink)" fontSize="11" fontFamily="var(--font-mono)">{fmtDate(w.end)}</text>
        </g>
      ))}
      <line x1={x(now)} x2={x(now)} y1={14} y2={H - 18} stroke="var(--color-accent)" strokeDasharray="3 3" />
      <text x={x(now) > W - 60 ? x(now) - 3 : x(now) + 3} textAnchor={x(now) > W - 60 ? "end" : "start"} y={H - 6} fill="var(--color-accent)" fontSize="11" fontFamily="var(--font-mono)">today</text>
      {events.map((e, i) => {
        const color = e.kind === "violating" ? "var(--color-breached)" : e.kind === "flag" ? "var(--color-atrisk)" : "var(--color-verified)";
        const tick = <line x1={x(e.t)} x2={x(e.t)} y1={20} y2={H - 22} stroke={color} strokeWidth={2} />;
        return (
          <g key={i}>
            <title>{e.label}</title>
            {e.href ? <a href={e.href}>{tick}</a> : tick}
          </g>
        );
      })}
      <text x={pad} y={H - 6} fill="var(--color-faint)" fontSize="11" fontFamily="var(--font-mono)">{fmtDate(lo)}</text>
    </svg>
  );
}
