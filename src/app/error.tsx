"use client";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Fallback for any page that throws (for example while the database is unreachable). The header and
 * footer from the root layout stay; only the page body is replaced. Production hides the message
 * and shows the digest that matches the server log.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <div className="container-k pt-40 pb-32 text-center">
      <p className="mono text-atrisk mb-2">Temporarily unavailable</p>
      <h1 className="title mb-4">This page could not load</h1>
      <p className="text-muted mb-6 max-w-xl mx-auto">
        Kept could not reach its data just now. Monitoring runs separately and is not affected; records and receipts are unchanged. Try again in a moment.
      </p>
      <div className="flex justify-center gap-3">
        <button className="btn" onClick={() => retry()}>Try again</button>
        <Link className="btn-quiet" href="/">Home</Link>
      </div>
      {digest ? <p className="mono text-xs text-faint mt-8">reference {digest}</p> : null}
    </div>
  );
}
