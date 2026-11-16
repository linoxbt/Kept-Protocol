"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Try it: submit a URL or text, then open the preview's own page, which follows the extraction
 * live and shows the full result. Old /try?preview=<id> links go straight to that page.
 */
export function TryIt() {
  const router = useRouter();
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"url" | "text">("url");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run(u = url, t = text, m = mode) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/tryit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m === "url" ? { url: u } : { text: t }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.detail ?? j.title ?? "the page could not be read");
        setBusy(false);
        return;
      }
      // The preview page follows the extraction live; reloading or sharing it never starts another.
      router.push(`/previews/${encodeURIComponent(j.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  useEffect(() => {
    // Start after mount (not synchronously in the effect); the ref keeps a remount from starting twice.
    const t = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const preview = params.get("preview");
      const u = params.get("url");
      if (preview) router.replace(`/previews/${encodeURIComponent(preview)}`);
      else if (u) void run(u, "", "url");
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form
        className="panel p-4 mb-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="source-kind" checked={mode === "url"} onChange={() => setMode("url")} /> URL</label>
          <label className="flex items-center gap-2"><input type="radio" name="source-kind" checked={mode === "text"} onChange={() => setMode("text")} /> Paste text</label>
        </div>
        {mode === "url" ? (
          <>
            <label className="sr-only" htmlFor="try-url">Page URL</label>
            <input id="try-url" className="input mono" type="url" required placeholder="https://docs.example.xyz/tokenomics" value={url} onChange={(e) => setUrl(e.target.value)} />
          </>
        ) : (
          <>
            <label className="sr-only" htmlFor="try-text">Text to check</label>
            <textarea id="try-text" className="input mono h-40" required minLength={20} placeholder="Team tokens held at 0x… are locked for 12 months from March 1, 2026." value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        <button className="btn" disabled={busy}>{busy ? "Starting…" : "Extract commitments"}</button>
        {busy ? <p className="text-xs text-muted">Opening the preview page. SERV usually needs 1 to 5 minutes to read a page; you can watch it there.</p> : null}
      </form>
      {error ? <p className="border border-breached text-breached p-3 text-sm mb-6" role="alert">{error}</p> : null}
    </div>
  );
}
