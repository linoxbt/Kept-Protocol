"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Draft, ExtractionResult } from "@/extraction/pipeline";
import { resolveJob } from "@/components/poll-job";

interface PreviewCheck {
  status: string;
  final: boolean;
  reason: string;
  computed_value: string;
  threshold_base_units: string;
  decimals: number;
  symbol: string | null;
  evidence_count: number;
  as_of_block: string;
  complete: boolean;
}

const COLORS: Record<string, string> = { verified: "#22c55e", at_risk: "#f59e0b", breached: "#ef4444", pending: "#94a3b8", unverifiable: "#6b7280" };

function fmt(v: string, d: number) {
  const b = BigInt(v);
  const base = 10n ** BigInt(d);
  return `${(b / base).toLocaleString("en-US")}${b % base ? "." + (b % base).toString().padStart(d, "0").slice(0, 4).replace(/0+$/, "") : ""}`;
}

export function TryIt() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"url" | "text">("url");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ id: string; result: ExtractionResult } | null>(null);
  const started = useRef(false);

  async function run(u = url, t = text, m = mode) {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await fetch("/api/v1/tryit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m === "url" ? { url: u } : { text: t }) });
      let j = await r.json();
      if (!r.ok) {
        setError(j.detail ?? j.title ?? "failed");
        return;
      }
      // Extraction runs in the background; poll until it finishes (up to ~4 minutes).
      for (let i = 0; j.status === "running" && i < 120; i++) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const p = await fetch(`/api/v1/extractions/${j.id}`);
        if (p.ok) j = await p.json();
      }
      if (j.status === "failed") setError(j.error ?? "extraction failed");
      else if (j.status === "running") setError("SERV is taking longer than usual; try again in a minute.");
      else setRes({ id: j.id, result: j.result });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const u = params.get("url");
    if (u && !started.current) {
      started.current = true;
      void run(u, "", "url");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form
        className="panel p-4 mb-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "url"} onChange={() => setMode("url")} /> URL</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "text"} onChange={() => setMode("text")} /> Paste text</label>
        </div>
        {mode === "url" ? (
          <input className="input mono" type="url" required placeholder="https://docs.example.xyz/tokenomics" value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <textarea className="input mono h-40" required minLength={20} placeholder="Team tokens held at 0x… are locked for 12 months from March 1, 2026." value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <button className="btn" disabled={busy}>{busy ? "reading…" : "Extract commitments"}</button>
        {busy ? <p className="text-xs text-muted">SERV is locating promises, extracting fields with Shadow Agent validation, and classifying each one twice with Multipath. This takes 10–60 s.</p> : null}
      </form>
      {error ? <p className="border border-breached text-breached p-3 text-sm mb-6">{error}</p> : null}
      {res ? <Results id={res.id} result={res.result} /> : null}
    </div>
  );
}

function Results({ id, result }: { id: string; result: ExtractionResult }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="mono text-xs border border-disputed text-disputed px-2 py-0.5">UNCONFIRMED PREVIEW</span>
        <span className="text-sm text-muted">{result.drafts.length} commitment(s) found · {result.serv_calls} SERV calls</span>
        {result.source_flags.map((f) => <span key={f} className="mono text-[10px] border border-atrisk text-atrisk px-1.5">{f}</span>)}
      </div>
      {result.drafts.length === 0 ? <p className="panel p-6 text-sm text-muted">No checkable commitments found. Try a tokenomics or vesting page, e.g. one that names a lock period and a wallet.</p> : null}
      <div className="space-y-6">
        {result.drafts.map((d) => <DraftCard key={d.index} id={id} d={d} />)}
      </div>
      {result.dropped_spans.length ? (
        <details className="mt-6 text-xs text-muted">
          <summary className="cursor-pointer">{result.dropped_spans.length} span(s) dropped by Kept&apos;s checks</summary>
          <ul className="mt-2 space-y-1">{result.dropped_spans.map((s, i) => <li key={i}>“{s.quote}” — {s.reason}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function DraftCard({ id, d }: { id: string; d: Draft }) {
  const [token, setToken] = useState(d.fields?.token_address ?? "");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<PreviewCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const method = d.classification?.method_id ?? "none";
  const f = d.fields;
  return (
    <div className="proof">
      <p className="text-lg mb-3">“{d.quote}”</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {d.flags.map((x) => <span key={x} className="mono text-[10px] border border-line text-muted px-1.5">{x}</span>)}
      </div>
      {f ? (
        <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm mb-4">
          <div><dt className="label">category</dt><dd className="mono">{f.category}</dd></div>
          <div><dt className="label">condition</dt><dd>{f.comparator ?? "?"} {f.amount ?? "?"} {f.amount_unit ?? ""}</dd></div>
          <div><dt className="label">window</dt><dd className="mono text-xs">{f.window_start ?? "?"} → {f.window_end ?? (f.duration_months ? `+${f.duration_months} mo` : "?")}</dd></div>
          <div><dt className="label">method</dt><dd className="mono text-xs">{method} ({d.classification?.verifiability})</dd></div>
          <div className="sm:col-span-2 lg:col-span-4"><dt className="label">subjects</dt><dd className="mono text-xs break-all">{f.subjects.map((s) => `${s.address} (${s.role}${s.label ? `, ${s.label}` : ""})`).join(" · ") || "none found"}</dd></div>
          <div className="sm:col-span-2 lg:col-span-4"><dt className="label">summary</dt><dd>{f.condition_summary}</dd></div>
        </dl>
      ) : <p className="text-sm text-breached mb-3">{d.error}</p>}
      {d.problems.length ? <ul className="text-xs text-atrisk mb-4 list-disc pl-5">{d.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      <p className="text-xs text-muted mb-4">
        Confidence is computed, not asked for: grounding {d.confidence.grounding ? "passed" : "failed"} · two classifier runs {d.confidence.classifier_agreement ? "agree" : "disagree"} · policy rules {d.confidence.rules_agreement ? "agree" : "disagree"}.
      </p>
      {method !== "none" ? (
        <form
          className="flex flex-col sm:flex-row gap-2 items-start"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              const r = await fetch(`/api/v1/tryit/${id}/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft_index: d.index, token_address: token || null }) });
              const j = await r.json();
              if (!r.ok) setErr(j.detail ?? j.title);
              else setCheck(await resolveJob(j));
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className="input mono text-xs sm:max-w-md" placeholder="Token address on Base (0x…)" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn whitespace-nowrap" disabled={busy}>{busy ? "reading chain…" : "Check on Base (preview)"}</button>
        </form>
      ) : <p className="text-xs text-muted">No registered verification method for this commitment, so it is recorded but not checked.</p>}
      {err ? <p className="text-xs text-breached mt-2">{err}</p> : null}
      {check ? (
        <div className="mt-4 border-t border-line pt-4">
          <span className="mono text-sm px-2 py-1 border" style={{ color: COLORS[check.status], borderColor: COLORS[check.status] }}>{check.status.replace("_", " ")} · unconfirmed preview</span>
          <p className="text-sm mt-2">{check.reason}</p>
          <p className="mono text-xs text-muted mt-1">
            {fmt(check.computed_value, check.decimals)} / {fmt(check.threshold_base_units, check.decimals)} {check.symbol ?? ""} · {check.evidence_count} transfer(s) · as of block {check.as_of_block}
          </p>
        </div>
      ) : null}
    </div>
  );
}
