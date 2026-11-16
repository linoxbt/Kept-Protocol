import { connection } from "next/server";
import { ogCard, OG_SIZE } from "@/lib/og";
import { commitmentShare, statusLabel } from "@/services/share";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Kept commitment status";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const c = await commitmentShare((await params).id).catch(() => null);
  if (!c) return ogCard({ eyebrow: "Commitment", title: "No record here" });
  return ogCard({ eyebrow: c.is_demo ? "Demo commitment" : "Commitment", title: c.project, status: { key: c.status, label: statusLabel(c.status, c.final) }, detail: c.summary });
}
