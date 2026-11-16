"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { resolveJob } from "@/components/poll-job";

export interface Needs {
  start: boolean;
  end: boolean;
  address: boolean;
  amount: boolean;
}

/**
 * Runs the unconfirmed Base check for one draft of a preview, then refreshes the page to show it.
 * When the page leaves gaps (`needs`), the visitor can fill them; those values are sent as
 * visitor-supplied and labelled so on the result.
 */
export function PreviewCheckForm({ id, index, token, needs }: { id: string; index: number; token: string | null; needs?: Needs }) {
  const router = useRouter();
  const [address, setAddress] = useState(token ?? "");
  const [v, setV] = useState({ window_start: "", window_end: "", duration_months: "", subject_address: "", amount: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gaps = needs && (needs.start || needs.end || needs.address || needs.amount);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const supplied = gaps
          ? {
              window_start: v.window_start || null,
              window_end: v.window_end || null,
              duration_months: v.duration_months ? Number(v.duration_months) : null,
              subject_address: v.subject_address || null,
              amount: v.amount || null,
            }
          : undefined;
        try {
          const r = await fetch(`/api/v1/tryit/${id}/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft_index: index, token_address: address || null, supplied }) });
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
      {gaps ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {needs!.start ? (
            <label className="text-xs"><span className="label block mb-1">Start date</span><input className="input mono text-xs" type="date" required value={v.window_start} onChange={set("window_start")} /></label>
          ) : null}
          {needs!.end ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs"><span className="label block mb-1">End date</span><input className="input mono text-xs" type="date" value={v.window_end} onChange={set("window_end")} /></label>
              <label className="text-xs"><span className="label block mb-1">or months</span><input className="input mono text-xs" type="number" min={1} max={240} value={v.duration_months} onChange={set("duration_months")} /></label>
            </div>
          ) : null}
          {needs!.address ? (
            <label className="text-xs sm:col-span-2"><span className="label block mb-1">Wallet or contract address on Base</span><input className="input mono text-xs" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" value={v.subject_address} onChange={set("subject_address")} /></label>
          ) : null}
          {needs!.amount ? (
            <label className="text-xs"><span className="label block mb-1">Amount (tokens)</span><input className="input mono text-xs" inputMode="decimal" required pattern="\d+(\.\d+)?" placeholder="0" value={v.amount} onChange={set("amount")} /></label>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
        <label className="sr-only" htmlFor={`token-${index}`}>Token address on Base</label>
        <input id={`token-${index}`} className="input mono text-xs sm:max-w-md" placeholder="Token address on Base (0x…)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="btn whitespace-nowrap" disabled={busy}>{busy ? "Reading the chain…" : gaps ? "Check with these values" : "Check on Base"}</button>
      </div>
      {err ? <p className="text-xs text-breached" role="alert">{err}</p> : null}
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

/** Ask Kept to monitor this project. Shows a clear confirmation with the request id. */
export function RequestMonitoring({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; existing: boolean } | null>(null);
  if (done) {
    return (
      <div className="border border-verified/50 p-5" role="status">
        <p className="subtitle mb-1">{done.existing ? "Already requested" : "Request received"}</p>
        <p className="text-sm text-muted">
          Request <span className="mono text-ink">{done.id}</span>. A Kept reviewer will read the project&apos;s page, confirm which promises can be checked and whose wallets
          they cover, and add them to monitoring, or decline with a reason. Monitored projects appear under Projects.
        </p>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const r = await fetch(`/api/v1/previews/${id}/requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: note || null, contact: contact || null }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) setErr(j.detail ?? j.title ?? "the request could not be sent");
          else setDone({ id: j.id, existing: !!j.existing });
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm">
        <span className="label block mb-1">Anything the reviewer should know (optional)</span>
        <textarea className="input text-sm h-20" maxLength={2000} placeholder="For example: the team wallet is listed on their GitBook vesting page." value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="label block mb-1">How to reach you (optional, never shown)</span>
        <input className="input text-sm" maxLength={200} placeholder="Email, Telegram or X handle" value={contact} onChange={(e) => setContact(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy}>{busy ? "Sending…" : "Request monitoring"}</button>
        {err ? <p className="text-xs text-breached" role="alert">{err}</p> : null}
      </div>
    </form>
  );
}
