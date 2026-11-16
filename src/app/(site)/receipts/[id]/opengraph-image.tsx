import { connection } from "next/server";
import { ogCard, OG_SIZE } from "@/lib/og";
import { receiptShare, statusLabel } from "@/services/share";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Kept signed receipt";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const r = await receiptShare((await params).id).catch(() => null);
  if (!r) return ogCard({ eyebrow: "Receipt", title: "No record here" });
  return ogCard({
    eyebrow: r.anchored ? "Signed · anchored on Base" : "Signed receipt",
    title: r.project ?? r.id,
    status: r.status ? { key: r.status, label: statusLabel(r.status, !!r.final) } : null,
    detail: r.summary,
    footer: `${r.id} · verify it yourself at kept-protocol.netlify.app`,
  });
}
