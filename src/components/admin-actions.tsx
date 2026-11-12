"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveJob } from "./poll-job";

/** Admin-only buttons that POST to the API with the session cookie and refresh the page. */
export function ActionButton({ endpoint, body, label, confirmText, next }: { endpoint: string; body?: object; label: string; confirmText?: string; next?: (json: Record<string, unknown>) => string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
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
            const first = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            if (!res.ok) setMsg(String(first.detail ?? first.title ?? res.statusText));
            else {
              // Long actions return 202 with a job; wait for it so the page shows the result.
              const json = await resolveJob(first, (ms) => setElapsed(ms));
              const to = next?.(json);
              if (to) router.push(to);
              else router.refresh();
            }
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
            setElapsed(null);
          }
        }}
      >
        {busy ? (elapsed !== null ? `running… ${Math.round(elapsed / 1000)}s` : "working…") : label}
      </button>
      {msg ? <span className="text-xs text-breached max-w-xs">{msg}</span> : null}
    </span>
  );
}

/** Admin decision on a dispute, with the required note. */
export function DisputeDecision({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const actions = status === "open" ? (["accept", "reject"] as const) : (["resolve", "reject"] as const);
  const act = async (action: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/disputes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note }) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setMsg(String(j.detail ?? j.title ?? res.statusText));
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-col sm:flex-row gap-2 items-start">
      <input className="input text-xs sm:max-w-sm" aria-label="Decision note" placeholder="note for the record (required)" value={note} onChange={(e) => setNote(e.target.value)} />
      {actions.map((a) => (
        <button key={a} className="btn btn-quiet" disabled={busy || note.trim().length < 5} onClick={() => act(a)}>{a}</button>
      ))}
      {msg ? <span className="text-xs text-breached">{msg}</span> : null}
    </div>
  );
}
