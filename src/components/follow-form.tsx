"use client";
import Link from "next/link";
import { useState } from "react";
import { CopyButton } from "@/components/copy";

type Started = { id: string; secret: string; manage_token: string; verification_sent: boolean; error: string | null };

/** Follow one commitment with a signed webhook: register, prove the endpoint with the code, done. */
export function FollowForm({ commitmentId }: { commitmentId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [active, setActive] = useState(false);

  async function call(path: string, body: unknown) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail ?? j.title ?? "the request failed");
    return j;
  }

  if (!open) return <button className="btn btn-quiet" onClick={() => setOpen(true)}>Follow with a webhook</button>;

  if (active && started) {
    return (
      <div className="border border-verified/50 p-5 max-w-2xl" role="status">
        <p className="subtitle mb-1">Following</p>
        <p className="text-sm text-muted">
          Your endpoint receives this commitment&apos;s events, signed with your secret (header <span className="mono">Kept-Webhook-Signature</span>). To stop, use{" "}
          <Link className="link" href={`/follows/${started.id}`}>manage this follow</Link> with your manage token.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-4 max-w-2xl">
      {!started ? (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              setStarted(await call(`/api/v1/commitments/${commitmentId}/follow`, { url }));
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted">
            Kept will POST every change to this commitment (status, breach, new version, dispute, deadline) to your HTTPS endpoint, signed. First it sends a
            one-time code there, so only the endpoint&apos;s owner can turn it on.
          </p>
          <label className="block">
            <span className="label block mb-1">Your HTTPS endpoint</span>
            <input className="input mono text-xs" type="url" required placeholder="https://example.com/hooks/kept" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button className="btn" disabled={busy}>{busy ? "Sending the code…" : "Send verification code"}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await call(`/api/v1/follows/${started.id}`, { action: "verify", token: started.manage_token, code });
              setActive(true);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="border border-atrisk/50 p-3 text-xs space-y-2">
            <p className="text-atrisk">Save these now. They are shown once.</p>
            <p>Signing secret: <span className="mono break-all">{started.secret}</span> <CopyButton value={started.secret} /></p>
            <p>Manage token: <span className="mono break-all">{started.manage_token}</span> <CopyButton value={started.manage_token} /></p>
            <p>Follow id: <span className="mono">{started.id}</span></p>
          </div>
          <p className="text-sm text-muted">
            {started.verification_sent
              ? "A kept.follow.verify event with a 6-digit code was sent to your endpoint. Enter it here."
              : `The code could not be delivered (${started.error ?? "unknown error"}). Fix the endpoint and start again.`}
          </p>
          <label className="block">
            <span className="label block mb-1">Code from your endpoint</span>
            <input className="input mono" inputMode="numeric" required pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn" disabled={busy || !started.verification_sent}>{busy ? "Checking…" : "Activate"}</button>
        </form>
      )}
      {err ? <p className="text-xs text-breached" role="alert">{err}</p> : null}
    </div>
  );
}
