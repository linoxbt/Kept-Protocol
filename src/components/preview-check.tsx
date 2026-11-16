"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveJob } from "@/components/poll-job";

/** Runs the unconfirmed Base check for one draft of a preview, then refreshes the page to show it. */
export function PreviewCheckForm({ id, index, token }: { id: string; index: number; token: string | null }) {
  const router = useRouter();
  const [address, setAddress] = useState(token ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const r = await fetch(`/api/v1/tryit/${id}/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft_index: index, token_address: address || null }) });
          const j = await r.json();
          if (!r.ok) setErr(j.detail ?? j.title ?? "the check could not run");
          else {
            await resolveJob(j);
            router.refresh();
          }
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="sr-only" htmlFor={`token-${index}`}>Token address on Base</label>
      <input id={`token-${index}`} className="input mono text-xs sm:max-w-md" placeholder="Token address on Base (0x…)" value={address} onChange={(e) => setAddress(e.target.value)} />
      <button className="btn whitespace-nowrap" disabled={busy}>{busy ? "Reading the chain…" : "Check on Base"}</button>
      {err ? <p className="text-xs text-breached sm:self-center" role="alert">{err}</p> : null}
    </form>
  );
}

/** While SERV is still reading the page, refresh every few seconds until the preview is done. */
export function RefreshWhileRunning({ running }: { running: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);
  return null;
}
