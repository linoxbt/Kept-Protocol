import { connection } from "next/server";
import { ogCard, OG_SIZE } from "@/lib/og";
import { hostOf, previewShare } from "@/services/share";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Kept preview of a project page";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const p = await previewShare((await params).id).catch(() => null);
  if (!p) return ogCard({ eyebrow: "Preview", title: "No record here" });
  return ogCard({
    eyebrow: "Unconfirmed preview",
    title: hostOf(p.url),
    detail: p.status === "done" ? `${p.drafts} promise${p.drafts === 1 ? "" : "s"} found by SERV Reasoning, every quote and number checked by Kept's code.` : "SERV is reading this page.",
  });
}
