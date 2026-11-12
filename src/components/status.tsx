import type { Status } from "@/core/types";
import { STATUS_LABEL } from "@/core/status";

const COLOR: Record<Status, string> = {
  verified: "var(--color-verified)",
  at_risk: "var(--color-atrisk)",
  breached: "var(--color-breached)",
  unverifiable: "var(--color-unverifiable)",
  disputed: "var(--color-disputed)",
  pending: "var(--color-pending)",
  awaiting_evidence: "var(--color-pending)",
};

export function statusColor(s: Status): string {
  return COLOR[s] ?? "var(--color-pending)";
}

/** Status is a dot plus words. "Verified to date" and "Verified, final" never blur. */
export function StatusChip({ status, final, size = "sm" }: { status: Status; final?: boolean; size?: "sm" | "lg" }) {
  const c = statusColor(status);
  const label = status === "verified" ? (final ? "Verified, final" : "Verified to date") : STATUS_LABEL[status];
  const lg = size === "lg";
  return (
    <span
      className={`mono inline-flex items-center gap-2 whitespace-nowrap rounded-full border ${lg ? "text-[15px] px-4 h-10" : "text-[12px] px-2.5 h-6"}`}
      style={{ borderColor: `color-mix(in srgb, ${c} 35%, transparent)`, color: "var(--color-ink)" }}
    >
      <span className="rounded-full shrink-0" style={{ width: lg ? 8 : 6, height: lg ? 8 : 6, background: c, boxShadow: `0 0 12px ${c}` }} />
      {label}
      {final && status !== "verified" ? <span className="text-muted">· final</span> : null}
    </span>
  );
}
