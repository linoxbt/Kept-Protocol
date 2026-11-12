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
  expired: "var(--color-unverifiable)",
};

export function statusColor(s: Status): string {
  return COLOR[s] ?? "var(--color-pending)";
}

/** Status colours carry meaning and nothing else. "Verified to date" and "Verified, final" never blur. */
export function StatusChip({ status, final, size = "sm" }: { status: Status; final?: boolean; size?: "sm" | "lg" }) {
  const c = statusColor(status);
  const label = status === "verified" ? (final ? "Verified, final" : "Verified to date") : status === "breached" ? "Breached" : STATUS_LABEL[status];
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 border whitespace-nowrap ${size === "lg" ? "text-base px-3 py-1.5" : "text-xs px-2 py-0.5"}`}
      style={{ color: c, borderColor: c, background: `color-mix(in srgb, ${c} 10%, transparent)` }}
    >
      <span className="inline-block rounded-full" style={{ width: size === "lg" ? 8 : 6, height: size === "lg" ? 8 : 6, background: c }} />
      {label}
      {final && status !== "verified" ? <span className="opacity-70">· final</span> : null}
    </span>
  );
}
