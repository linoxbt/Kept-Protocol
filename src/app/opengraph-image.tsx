import { ogCard, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Kept: every promise, checked onchain";

export default function Image() {
  return ogCard({ eyebrow: "Live on Base", title: "Every promise, checked onchain.", detail: "Kept reads crypto promises with SERV Reasoning, checks them against finalized Base blocks with code, and signs a receipt for every result." });
}
