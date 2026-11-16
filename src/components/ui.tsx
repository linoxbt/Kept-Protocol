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
    <section className="mb-14">
      <div className="flex items-baseline justify-between mb-5 gap-4 border-t border-line pt-4">
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
  return <div className="border border-line p-8 text-sm text-muted">{children}</div>;
}

export function DemoBadge() {
  return <span className="mono text-[10px] uppercase tracking-[0.12em] rounded-full border border-disputed/50 text-disputed px-2 py-0.5">demo project</span>;
}

export function Flag({ name }: { name: string }) {
  const severe = /UNGROUNDED|INJECTION|INSTRUCTIONS|LOOKALIKE|INVALID|MISMATCH|THIRD_PARTY|CONTRADICTION/.test(name);
  return (
    <span className={`mono text-[10px] px-2 py-0.5 rounded-full border ${severe ? "border-atrisk/50 text-atrisk" : "border-line-strong text-muted"}`}>{name}</span>
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

/** Builds a link that keeps the current filters and changes one of them. */
export function withParams(base: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "" && !(k === "page" && v === 1)) q.set(k, String(v));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** A row of filter links; the active one is highlighted. */
export function FilterChips({ label, options, active, href }: { label: string; options: [string | null, string][]; active: string | null; href: (value: string | null) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="label mr-1">{label}</span>
      {options.map(([value, text]) => (
        <a
          key={value ?? "all"}
          href={href(value)}
          aria-current={value === active ? "true" : undefined}
          className={`mono text-[11px] px-2.5 h-7 inline-flex items-center rounded-full border transition-colors ${value === active ? "border-accent text-ink" : "border-line-strong text-muted hover:text-ink"}`}
        >
          {text}
        </a>
      ))}
    </div>
  );
}

/** Previous / next pagination with a position label. */
export function Pager({ page, pages, total, href }: { page: number; pages: number; total: number; href: (page: number) => string }) {
  if (pages <= 1) return <p className="text-xs text-muted mt-4">{total} result{total === 1 ? "" : "s"}</p>;
  return (
    <nav className="flex items-center gap-3 mt-6 text-sm" aria-label="Pagination">
      {page > 1 ? <a className="btn-quiet" href={href(page - 1)}>← Newer</a> : null}
      <span className="text-xs text-muted">Page {page} of {pages} · {total} results</span>
      {page < pages ? <a className="btn-quiet" href={href(page + 1)}>Older →</a> : null}
    </nav>
  );
}
