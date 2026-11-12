export function fmtDate(d: Date | string | number | null | undefined, withTime = false): string {
  if (d === null || d === undefined) return "—";
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return withTime ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : date.toISOString().slice(0, 10);
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3 gap-4">
        <h2 className="label">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton w-full" style={{ height: h }} />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="panel p-6 text-sm text-muted">{children}</div>;
}

export function DemoBadge() {
  return <span className="mono text-[10px] uppercase tracking-wider border border-disputed text-disputed px-1.5 py-0.5">demo project</span>;
}

export function Flag({ name }: { name: string }) {
  const severe = /UNGROUNDED|INJECTION|INSTRUCTIONS|LOOKALIKE|INVALID|MISMATCH|THIRD_PARTY|CONTRADICTION/.test(name);
  return (
    <span className={`mono text-[10px] px-1.5 py-0.5 border ${severe ? "border-atrisk text-atrisk" : "border-line text-muted"}`}>{name}</span>
  );
}

/** Current unix time, read once per request by the server page that renders a time bar. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Status reasons keep full addresses (they are exact in receipts); the UI shortens them for reading. */
export function prettyReason(reason: string | null | undefined): string {
  return (reason ?? "").replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);
}
