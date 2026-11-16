"use client";
import { useState } from "react";
import { CopyButton } from "@/components/copy";

const ROLES = ["team", "treasury", "vesting", "lock", "burn executor", "other"] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Same text as declarationMessage() on the server (a unit test keeps them identical). */
export function declarationText(project: string, address: string, role: string, date: string): string {
  return [
    "Kept wallet declaration",
    `Project: ${project.trim()}`,
    `Address: ${address}`,
    `Role: ${role}`,
    `Date: ${date}`,
    "I control this address and declare it as the project's for the role above.",
  ].join("\n");
}

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Declare a wallet: sign Kept's message with the address itself; a reviewer then checks it. */
export function DeclareWalletForm() {
  const [f, setF] = useState({ project: "", address: "", role: "team", signature: "", contact: "", evidence_url: "" });
  // Captured when the visitor starts typing (never during prerender): the date they sign is today's.
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const valid = !!date && /^0x[0-9a-fA-F]{40}$/.test(f.address) && f.project.trim().length >= 2;
  const msg = valid ? declarationText(f.project, f.address, f.role, date) : null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (!date) setDate(today());
    setF({ ...f, [k]: e.target.value });
  };

  if (done) {
    return (
      <div className="border border-verified/50 p-5" role="status">
        <p className="subtitle mb-1">Declaration received</p>
        <p className="text-sm text-muted">
          Reference <span className="mono text-ink">{done}</span>. The signature was verified. A Kept reviewer will check it against the project&apos;s public pages; once
          accepted, it is cited as evidence that the address is declared by the project.
        </p>
      </div>
    );
  }

  return (
    <form
      className="panel p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const r = await fetch("/api/v1/declarations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project: f.project, address: f.address, role: f.role, date, signature: f.signature.trim(), contact: f.contact || null, evidence_url: f.evidence_url || null }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.detail ?? j.title ?? "the declaration could not be sent");
          setDone(j.id);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm"><span className="label block mb-1">Project</span><input className="input" required minLength={2} maxLength={100} value={f.project} onChange={set("project")} /></label>
        <label className="text-sm">
          <span className="label block mb-1">Role of the address</span>
          <select className="input" value={f.role} onChange={set("role")}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        </label>
        <label className="text-sm sm:col-span-2"><span className="label block mb-1">Address on Base</span><input className="input mono text-xs" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" value={f.address} onChange={set("address")} /></label>
      </div>
      {msg ? (
        <div className="space-y-2">
          <p className="label">1 · Sign this exact message with that address</p>
          <pre className="bg-bg border border-line p-3 text-xs mono whitespace-pre-wrap">{msg}</pre>
          <div className="flex flex-wrap gap-2 items-center">
            <CopyButton value={msg} label="copy message" />
            <button
              type="button"
              className="btn btn-quiet text-xs"
              onClick={async () => {
                setErr(null);
                const eth = (window as unknown as { ethereum?: Eth }).ethereum;
                if (!eth) return setErr("No browser wallet found. Sign the message in your wallet, Safe or signing tool, and paste the signature below.");
                try {
                  const [account] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
                  if (account?.toLowerCase() !== f.address.toLowerCase()) return setErr(`Your wallet is connected as ${account}; switch to ${f.address} to sign.`);
                  const sig = (await eth.request({ method: "personal_sign", params: [msg, account] })) as string;
                  setF((x) => ({ ...x, signature: sig }));
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "signing was cancelled");
                }
              }}
            >
              Sign with browser wallet
            </button>
          </div>
          <p className="text-xs text-muted">Smart accounts (for example a Safe) can sign through their own message-signing flow; Kept checks ERC-1271 signatures too.</p>
        </div>
      ) : (
        <p className="text-xs text-muted">Enter the project and a valid address to see the message to sign.</p>
      )}
      <label className="block text-sm"><span className="label block mb-1">2 · Signature</span><textarea className="input mono text-xs h-20" required placeholder="0x…" value={f.signature} onChange={set("signature")} /></label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm"><span className="label block mb-1">Public page listing this address (optional)</span><input className="input text-xs" type="url" placeholder="https://docs.example.xyz/tokenomics" value={f.evidence_url} onChange={set("evidence_url")} /></label>
        <label className="text-sm"><span className="label block mb-1">Contact (optional, never shown)</span><input className="input text-xs" maxLength={200} value={f.contact} onChange={set("contact")} /></label>
      </div>
      <button className="btn" disabled={busy || !msg}>{busy ? "Verifying signature…" : "Submit declaration"}</button>
      {err ? <p className="text-xs text-breached" role="alert">{err}</p> : null}
    </form>
  );
}

/** Pilot or contact request. */
export function ContactForm({ kind }: { kind: "pilot" | "contact" }) {
  const [f, setF] = useState({ name: "", organisation: "", contact: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (done) {
    return (
      <div className="border border-verified/50 p-5" role="status">
        <p className="subtitle mb-1">Thanks, we&apos;ll be in touch</p>
        <p className="text-sm text-muted">Reference <span className="mono text-ink">{done}</span>. The Kept team reads every request and replies at the contact you gave.</p>
      </div>
    );
  }
  return (
    <form
      className="panel p-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const r = await fetch("/api/v1/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ...f, organisation: f.organisation || null }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.detail ?? j.title ?? "the request could not be sent");
          setDone(j.id);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm"><span className="label block mb-1">Name</span><input className="input" required minLength={2} maxLength={100} value={f.name} onChange={set("name")} /></label>
        <label className="text-sm"><span className="label block mb-1">{kind === "pilot" ? "Launchpad or project" : "Organisation (optional)"}</span><input className="input" required={kind === "pilot"} maxLength={150} value={f.organisation} onChange={set("organisation")} /></label>
        <label className="text-sm sm:col-span-2"><span className="label block mb-1">How to reach you</span><input className="input" required minLength={3} maxLength={200} placeholder="Email, Telegram or X handle" value={f.contact} onChange={set("contact")} /></label>
      </div>
      <label className="block text-sm"><span className="label block mb-1">{kind === "pilot" ? "What would you like Kept to monitor?" : "Message"}</span><textarea className="input text-sm h-28" required minLength={10} maxLength={4000} value={f.message} onChange={set("message")} /></label>
      <button className="btn" disabled={busy}>{busy ? "Sending…" : kind === "pilot" ? "Request a pilot" : "Send"}</button>
      {err ? <p className="text-xs text-breached" role="alert">{err}</p> : null}
    </form>
  );
}
