"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Public dispute form. Disputes are reviewed by a person; the computed status stays visible. */
export function DisputeForm({ commitmentId }: { commitmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) {
    return (
      <button className="btn btn-quiet" onClick={() => setOpen(true)}>
        Dispute this record
      </button>
    );
  }
  return (
    <form
      className="panel p-4 space-y-3 max-w-2xl"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const res = await fetch(`/api/v1/commitments/${commitmentId}/disputes`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason, evidence_url: evidence || null, contact: contact || null }),
          });
          const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (!res.ok) setMsg({ ok: false, text: String(j.detail ?? j.title ?? res.statusText) });
          else {
            setMsg({ ok: true, text: "Dispute filed. A reviewer will look at it; its status is shown below." });
            setReason("");
            setEvidence("");
            router.refresh();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <span className="label">What is wrong with this record?</span>
        <textarea className="input mt-1" required minLength={20} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: 0x… is the vesting contract, not the team wallet; see the linked transaction." />
      </label>
      <label className="block">
        <span className="label">Evidence link (optional)</span>
        <input className="input mt-1" type="url" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://…" />
      </label>
      <label className="block">
        <span className="label">Contact for the reviewer (optional, never shown)</span>
        <input className="input mt-1" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder="email or handle" />
      </label>
      <div className="flex gap-2 items-center">
        <button className="btn" disabled={busy || reason.trim().length < 20}>{busy ? "filing…" : "File dispute"}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {msg ? <p className={`text-xs ${msg.ok ? "text-verified" : "text-breached"}`}>{msg.text}</p> : null}
    </form>
  );
}
