"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveJob } from "./poll-job";

async function post(endpoint: string, body: unknown, method = "POST") {
  const res = await fetch(endpoint, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail ?? json.title ?? res.statusText);
  return resolveJob<any>(json); // eslint-disable-line @typescript-eslint/no-explicit-any
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>, goto?: (r: unknown) => string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof r === "string" ? r : "done" });
      const to = goto?.(r);
      if (to) router.push(to);
      else router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <p className={`text-xs ${msg.ok ? "text-verified" : "text-breached"}`}>{msg.text}</p> : null;
}

export function NewProjectForm() {
  const a = useAction();
  const [f, setF] = useState({ name: "", chain_id: 8453, token_address: "", registration_level: "unregistered", is_demo: false, description: "" });
  return (
    <form
      className="panel p-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(async () => {
          const p = await post("/api/v1/projects", { ...f, token_address: f.token_address || null });
          return `created ${p.slug}`;
        });
      }}
    >
      <p className="label">New project</p>
      <input className="input" placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="flex gap-2">
        <select className="input" value={f.chain_id} onChange={(e) => setF({ ...f, chain_id: Number(e.target.value) })}>
          <option value={8453}>Base</option>
          <option value={84532}>Base Sepolia</option>
        </select>
        <select className="input" value={f.registration_level} onChange={(e) => setF({ ...f, registration_level: e.target.value })}>
          <option value="unregistered">unregistered</option>
          <option value="self">self-registered</option>
          <option value="launchpad">launchpad</option>
        </select>
      </div>
      <input className="input mono text-xs" placeholder="Token address (reads decimals on-chain)" value={f.token_address} onChange={(e) => setF({ ...f, token_address: e.target.value })} />
      <textarea className="input text-sm" placeholder="Description (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={f.is_demo} onChange={(e) => setF({ ...f, is_demo: e.target.checked })} /> clearly labelled demo project</label>
      <button className="btn" disabled={a.busy}>{a.busy ? "creating…" : "Create"}</button>
      <Msg msg={a.msg} />
    </form>
  );
}

export function NewSourceForm({ projects }: { projects: { id: string; name: string }[] }) {
  const a = useAction();
  const [f, setF] = useState({ project_id: projects[0]?.id ?? "", url: "", text: "", kind: "docs" });
  return (
    <form
      className="panel p-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          async () => {
            const r = await post("/api/v1/sources", { project_id: f.project_id, kind: f.kind, ...(f.url ? { url: f.url } : { text: f.text }) });
            return r.extraction ? `extracted ${r.extraction.result?.drafts?.length ?? 0} draft(s)` : `snapshot ${r.snapshot.id} stored${r.extraction_error ? ` · ${r.extraction_error}` : ""}`;
          },
        );
      }}
    >
      <p className="label">Capture a source</p>
      <select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="flex gap-2">
        <input className="input mono text-xs" type="url" placeholder="https://… (or paste text below)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <select className="input w-40" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {["docs", "blog", "governance", "social", "demo"].map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <textarea className="input mono text-xs h-24" placeholder="…or paste the source text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
      <button className="btn" disabled={a.busy || !f.project_id}>{a.busy ? "capturing + extracting…" : "Capture and extract"}</button>
      <Msg msg={a.msg} />
    </form>
  );
}

export function DemoPageForm({ slug, title, body }: { slug: string; title: string; body: string }) {
  const a = useAction();
  const [f, setF] = useState({ slug, title, body });
  return (
    <form className="panel p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await post(`/api/v1/demo-pages/${f.slug}`, { title: f.title, body: f.body }, "PUT"); return "saved; re-capture its source to detect the change"; }); }}>
      <p className="label">Demo page /demo/{f.slug || "…"}</p>
      {!slug ? <input className="input mono text-xs" placeholder="slug" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /> : null}
      <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" />
      <textarea className="input text-sm h-40" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <button className="btn" disabled={a.busy}>Save page</button>
      <Msg msg={a.msg} />
    </form>
  );
}

export function PostButton({ endpoint, body, label }: { endpoint: string; body?: unknown; label: string }) {
  const a = useAction();
  return (
    <span className="inline-flex flex-col">
      <button className="btn btn-quiet text-xs" disabled={a.busy} onClick={() => void a.run(async () => { const r = await post(endpoint, body ?? {}); return summarize(r); })}>{a.busy ? "…" : label}</button>
      <Msg msg={a.msg} />
    </span>
  );
}

function summarize(r: Record<string, unknown>): string {
  if (Array.isArray(r.actions)) return `changed: ${r.changed}; ${(r.actions as { action: string }[]).map((x) => x.action).join(", ") || "no commitments affected"}`;
  if (r.summary && typeof r.summary === "object") { const s = r.summary as { passed: number; total: number }; return `${s.passed}/${s.total} passed`; }
  if (r.status) return `${r.status}${r.reason ? `: ${r.reason}` : ""}`;
  return "done";
}

export function WebhookForm() {
  const a = useAction();
  const [url, setUrl] = useState("");
  return (
    <form className="panel p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { const r = await post("/api/v1/webhooks", { url, events: ["commitment.status_changed", "commitment.condition_failed", "commitment.satisfied", "commitment.deadline_approaching", "commitment.version_created", "commitment.disputed", "source.changed", "transfer.detected"] }); return `secret (shown once): ${r.secret}`; }); }}>
      <p className="label">Webhook</p>
      <input className="input mono text-xs" type="url" required placeholder="https://hooks.example.com/kept" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn" disabled={a.busy}>Register</button>
      <Msg msg={a.msg} />
    </form>
  );
}

/**
 * Manual draft: when extraction is unavailable or a changed source needs a person to restate the
 * promise. The quote must be an exact substring of the captured snapshot; the fields go through the
 * same grounding checks as a model draft, then to the normal review page.
 */
export function ManualDraftForm({ snapshots, commitments }: { snapshots: { id: string; label: string; project_id: string }[]; commitments: { id: string; label: string }[] }) {
  const a = useAction();
  const [f, setF] = useState({
    snapshot: snapshots[0]?.id ?? "",
    target: "",
    quote: "",
    category: "token_lock",
    token_symbol: "",
    token_address: "",
    subjects: "",
    comparator: "lte",
    amount: "",
    amount_unit: "tokens",
    window_start: "",
    window_end: "",
    duration_months: "",
    cliff_months: "",
    vesting_contract: "",
    responsible_entity: "",
    condition_summary: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  const num = (v: string) => (v.trim() ? Number(v) : null);
  if (!snapshots.length) return <p className="panel p-4 text-sm text-muted">Capture a source first; a manual draft quotes its snapshot.</p>;
  return (
    <form
      className="panel p-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const snap = snapshots.find((s) => s.id === f.snapshot)!;
        // Subjects: one per line, "address role label…" (role: holder, vesting, treasury, executor, collector).
        const subjects = f.subjects
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [address, role = "holder", ...label] = l.split(/\s+/);
            return { address, role, label: label.join(" ") || null };
          });
        void a.run(
          async () => {
            const r = await post("/api/v1/extractions/manual", {
              snapshot_id: f.snapshot,
              project_id: snap.project_id,
              quote: f.quote,
              target_commitment_id: nul(f.target),
              fields: {
                category: f.category,
                responsible_entity: nul(f.responsible_entity),
                token_symbol: nul(f.token_symbol),
                token_address: nul(f.token_address),
                subjects,
                comparator: f.comparator,
                amount: nul(f.amount),
                amount_unit: f.amount_unit,
                window_start: nul(f.window_start),
                window_end: nul(f.window_end),
                duration_months: num(f.duration_months),
                cliff_months: num(f.cliff_months),
                vesting_contract: nul(f.vesting_contract),
                derived: [],
                ambiguity_flags: [],
                condition_summary: f.condition_summary || "manual draft",
              },
            });
            return r.id as string;
          },
          (id) => (typeof id === "string" ? `/admin/extractions/${id}` : null),
        );
      }}
    >
      <p className="label">Manual draft</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <select className="input" aria-label="Snapshot" value={f.snapshot} onChange={set("snapshot")}>
          {snapshots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="input" aria-label="Proposes a new version of" value={f.target} onChange={set("target")}>
          <option value="">new commitment</option>
          {commitments.map((c) => <option key={c.id} value={c.id}>new version of {c.label}</option>)}
        </select>
      </div>
      <textarea className="input text-sm" required placeholder="Exact quote from the snapshot" value={f.quote} onChange={set("quote")} />
      <div className="grid sm:grid-cols-3 gap-2">
        <select className="input" aria-label="Category" value={f.category} onChange={set("category")}>
          {["token_lock", "vesting", "burn", "treasury", "governance", "fee_distribution", "other"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className="input mono text-xs" placeholder="token symbol" value={f.token_symbol} onChange={set("token_symbol")} />
        <input className="input mono text-xs" placeholder="token address 0x…" value={f.token_address} onChange={set("token_address")} />
      </div>
      <textarea className="input mono text-xs" placeholder={"subjects, one per line: 0xADDRESS role label\n(role: holder, vesting, treasury, executor, collector)"} value={f.subjects} onChange={set("subjects")} />
      <div className="grid sm:grid-cols-3 gap-2">
        <select className="input" aria-label="Comparator" value={f.comparator} onChange={set("comparator")}>
          <option value="lte">at most (lte)</option>
          <option value="gte">at least (gte)</option>
          <option value="eq">exactly (eq)</option>
        </select>
        <input className="input mono text-xs" placeholder="amount" value={f.amount} onChange={set("amount")} />
        <select className="input" aria-label="Amount unit" value={f.amount_unit} onChange={set("amount_unit")}>
          {["tokens", "percent_of_supply", "percent_of_allocation", "usd"].map((u) => <option key={u}>{u}</option>)}
        </select>
      </div>
      <div className="grid sm:grid-cols-4 gap-2">
        <input className="input mono text-xs" placeholder="start YYYY-MM-DD" value={f.window_start} onChange={set("window_start")} />
        <input className="input mono text-xs" placeholder="end YYYY-MM-DD" value={f.window_end} onChange={set("window_end")} />
        <input className="input mono text-xs" placeholder="duration months" value={f.duration_months} onChange={set("duration_months")} />
        <input className="input mono text-xs" placeholder="cliff months" value={f.cliff_months} onChange={set("cliff_months")} />
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <input className="input mono text-xs" placeholder="vesting contract (vesting only)" value={f.vesting_contract} onChange={set("vesting_contract")} />
        <input className="input text-xs" placeholder="responsible entity" value={f.responsible_entity} onChange={set("responsible_entity")} />
      </div>
      <button className="btn" disabled={a.busy || !f.quote.trim()}>{a.busy ? "checking…" : "Create draft for review"}</button>
      <Msg msg={a.msg} />
    </form>
  );
}

interface DraftLite {
  index: number;
  quote: string;
  flags: string[];
  problems: string[];
  method: string;
  tokenAddress: string | null;
  subjects: string[];
  fields: unknown;
}

export function ConfirmDraftForm({ extractionId, draft, targetCommitmentId }: { extractionId: string; draft: DraftLite; targetCommitmentId: string | null }) {
  const a = useAction();
  const [token, setToken] = useState(draft.tokenAddress ?? "");
  const [method, setMethod] = useState(draft.method === "none" ? "erc20_outflow_v1" : draft.method);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [internal, setInternal] = useState("");
  const [edits, setEdits] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-2 border-t border-line pt-3 mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          async () => {
            const body = {
              extraction_id: extractionId,
              draft_index: draft.index,
              method_id: method,
              token_address: token || null,
              reviewer_evidence: Object.fromEntries(Object.entries(evidence).filter(([, v]) => v.trim())),
              internal_addresses: internal.split(/[\s,]+/).filter(Boolean),
              ...(edits.trim() ? { edits: JSON.parse(edits) } : {}),
            };
            const r = targetCommitmentId
              ? await post(`/api/v1/commitments/${targetCommitmentId}/versions`, { ...body, change_reason: reason || null })
              : await post("/api/v1/commitments", body);
            return JSON.stringify(r);
          },
          (r) => {
            const j = JSON.parse(String(r ?? "{}")) as { commitment_id?: string };
            return j.commitment_id ? `/commitments/${j.commitment_id}` : targetCommitmentId ? `/commitments/${targetCommitmentId}` : null;
          },
        );
      }}
    >
      <div className="grid sm:grid-cols-2 gap-2">
        <select className="input mono text-xs" value={method} onChange={(e) => setMethod(e.target.value)}>
          {["erc20_outflow_v1", "vesting_schedule_v1", "burn_v1"].map((m) => <option key={m}>{m}</option>)}
        </select>
        <input className="input mono text-xs" placeholder="token address" value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      {draft.subjects.map((s) => (
        <input key={s} className="input text-xs" placeholder={`reviewer evidence for ${s.slice(0, 10)}… (optional; a public link proving who controls it)`} value={evidence[s] ?? ""} onChange={(e) => setEvidence({ ...evidence, [s]: e.target.value })} />
      ))}
      <input className="input mono text-xs" placeholder="internal addresses of the same entity (comma separated, optional)" value={internal} onChange={(e) => setInternal(e.target.value)} />
      <textarea className="input mono text-xs h-16" placeholder='grounded edits as JSON, e.g. {"window_start":"2026-03-01"} (must appear in the source)' value={edits} onChange={(e) => setEdits(e.target.value)} />
      {targetCommitmentId ? <input className="input text-xs" placeholder="stated change reason (if the project gave one)" value={reason} onChange={(e) => setReason(e.target.value)} /> : null}
      <button className="btn" disabled={a.busy}>{a.busy ? "confirming + first check…" : targetCommitmentId ? "Confirm as new version" : "Confirm and start monitoring"}</button>
      <Msg msg={a.msg} />
    </form>
  );
}
