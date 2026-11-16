"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

type Status = { id: string; commitment_id: string | null; url: string; active: boolean; verified: boolean; deliveries: Record<string, number> };

/** Read or stop a follow with its manage token (sent in the request body, never in the URL). */
export function ManageFollow() {
  const { id } = useParams<{ id: string }>();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(action: "status" | "stop") {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/v1/follows/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail ?? j.title ?? "the request failed");
      if (action === "stop") setStatus(status ? { ...status, active: false } : null);
      else setStatus(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-xs text-muted">Follow <span className="mono">{id}</span></p>
      <form
        className="panel p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act("status");
        }}
      >
        <label className="block">
          <span className="label block mb-1">Manage token</span>
          <input className="input mono text-xs" required minLength={10} placeholder="kmt_…" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <button className="btn" disabled={busy}>{busy ? "Loading…" : "Show this follow"}</button>
      </form>
      {status ? (
        <div className="border border-line p-5 text-sm space-y-2">
          <p>
            Endpoint <span className="mono break-all">{status.url}</span>
          </p>
          <p>
            Commitment {status.commitment_id ? <Link className="link mono" href={`/commitments/${status.commitment_id}`}>{status.commitment_id}</Link> : "—"}
          </p>
          <p className={status.active ? "text-verified" : "text-muted"}>{status.active ? "Active" : status.verified ? "Stopped" : "Waiting for the verification code"}</p>
          <p className="text-xs text-muted">
            Deliveries: {Object.entries(status.deliveries).map(([k, n]) => `${n} ${k}`).join(" · ") || "none yet"}
          </p>
          {status.active ? (
            <button className="btn btn-quiet" disabled={busy} onClick={() => void act("stop")}>Stop following</button>
          ) : null}
        </div>
      ) : null}
      {err ? <p className="text-xs text-breached" role="alert">{err}</p> : null}
    </div>
  );
}
