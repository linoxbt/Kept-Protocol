/**
 * Share cards (Open Graph / X) for records. One layout: Kept mark, an eyebrow, a title, an optional
 * status pill and a line of detail, in Kept's colours. Rendered by next/og at request time.
 */
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const STATUS_COLOR: Record<string, string> = {
  verified: "#3ddc97",
  at_risk: "#f5b82e",
  breached: "#ff5a4e",
  disputed: "#b69cff",
  pending: "#8b929c",
  awaiting_evidence: "#8b929c",
  unverifiable: "#6b7280",
};

export function ogCard(input: { eyebrow: string; title: string; detail?: string | null; status?: { key: string; label: string } | null; footer?: string }) {
  const color = input.status ? (STATUS_COLOR[input.status.key] ?? "#8b929c") : null;
  const title = input.title.length > 110 ? `${input.title.slice(0, 107)}…` : input.title;
  const detail = input.detail && input.detail.length > 170 ? `${input.detail.slice(0, 167)}…` : input.detail;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#0a0b0d", color: "#eceef1", fontFamily: "sans-serif", backgroundImage: "radial-gradient(700px 420px at 85% 0%, rgba(47,107,255,0.30), transparent 70%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="52" height="52" viewBox="-1 -1 24 24">
            <rect x="0.5" y="0.5" width="21" height="21" fill="none" stroke="#3a3f48" strokeWidth="0.9" />
            <path d="M0.5 7V0.5H7M21.5 15v6.5H15" fill="none" stroke="#2f6bff" strokeWidth="1.6" />
            <path d="M6.5 11.2l3 3 6-6.4" fill="none" stroke="#eceef1" strokeWidth="1.8" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1.5 }}>Kept</div>
          <div style={{ marginLeft: "auto", fontSize: 22, color: "#8b929c", letterSpacing: 3, textTransform: "uppercase" }}>{input.eyebrow}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {input.status && color ? (
            <div style={{ display: "flex" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, border: `2px solid ${color}`, borderRadius: 999, padding: "10px 24px", fontSize: 30, color: "#eceef1" }}>
                <div style={{ width: 14, height: 14, borderRadius: 999, background: color }} />
                {input.status.label}
              </div>
            </div>
          ) : null}
          <div style={{ fontSize: title.length > 60 ? 50 : 62, fontWeight: 600, letterSpacing: -2, lineHeight: 1.08 }}>{title}</div>
          {detail ? <div style={{ fontSize: 28, color: "#a3a9b2", lineHeight: 1.35 }}>{detail}</div> : null}
        </div>
        <div style={{ fontSize: 22, color: "#6b7280" }}>{input.footer ?? "Every promise, checked onchain · kept-protocol.netlify.app"}</div>
      </div>
    ),
    OG_SIZE,
  );
}
