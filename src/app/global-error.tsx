"use client";

/**
 * Last-resort fallback when the root layout itself fails. It renders its own document (no global
 * styles load here), so it is styled inline in Kept's colours.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0b0d", color: "#eceef1", fontFamily: "system-ui, sans-serif" }}>
        <title>Kept — temporarily unavailable</title>
        <main style={{ maxWidth: 520, padding: 24, textAlign: "center" }}>
          <p style={{ color: "#f5b82e", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>Temporarily unavailable</p>
          <h1 style={{ fontSize: 32, margin: "8px 0 12px", letterSpacing: "-0.02em" }}>Kept could not load</h1>
          <p style={{ color: "#8b929c", lineHeight: 1.6 }}>Monitoring runs separately and is not affected; records and receipts are unchanged. Try again in a moment.</p>
          <button onClick={() => retry()} style={{ marginTop: 20, height: 44, padding: "0 20px", borderRadius: 12, border: 0, background: "#2f6bff", color: "white", fontSize: 15, cursor: "pointer" }}>
            Try again
          </button>
          {digest ? <p style={{ marginTop: 24, color: "#5a616b", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>reference {digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
