import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { TryIt } from "./tryit";

export const metadata = { title: "Try it" };

export default function TryPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Try it</h1>
      <p className="text-sm text-muted mb-6 max-w-3xl">
        Paste a project&apos;s docs URL or text. SERV Reasoning reads it; Kept&apos;s code checks every field against the quote and the chain. Everything here is an{" "}
        <span className="text-ink">Unconfirmed preview</span>: never published, never in the feed, gone after 24 hours. Every address stays{" "}
        <span className="mono">unconfirmed</span>, so the worst a preview can show is At risk.
      </p>
      <Suspense fallback={<Skeleton h={200} />}>
        <TryIt />
      </Suspense>
    </div>
  );
}
