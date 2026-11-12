"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Admin-only buttons that POST to the API with the session cookie and refresh the page. */
export function ActionButton({ endpoint, body, label, confirmText, next }: { endpoint: string; body?: object; label: string; confirmText?: string; next?: (json: Record<string, unknown>) => string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          if (confirmText && !confirm(confirmText)) return;
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
            const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            if (!res.ok) setMsg(String(json.detail ?? json.title ?? res.statusText));
            else {
              const to = next?.(json);
              if (to) router.push(to);
              else router.refresh();
            }
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "working…" : label}
      </button>
      {msg ? <span className="text-xs text-breached max-w-xs">{msg}</span> : null}
    </span>
  );
}
