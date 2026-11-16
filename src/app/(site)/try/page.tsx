import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { TryIt } from "./tryit";

export const metadata = { title: "Try it" };

export default function TryPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="title mb-4">Try it</h1>
      <p className="text-sm text-muted mb-6 max-w-3xl">
        Paste a project&apos;s docs URL or text. SERV Reasoning reads it; Kept&apos;s code checks every field against the quote and the chain. Every result is an{" "}
        <span className="text-ink">Unconfirmed preview</span>: not reviewed, not monitored, and never in the commitments feed. Every address stays{" "}
        <span className="mono">unconfirmed</span>, so the worst a preview can show is At risk. Previews of public URLs are listed on{" "}
        <Link className="link" href="/explore">Explore</Link> for 30 days; pasted text stays private to its own link and is deleted after 24 hours.
      </p>
      <Suspense fallback={<Skeleton h={200} />}>
        <TryIt />
      </Suspense>
    </div>
  );
}
