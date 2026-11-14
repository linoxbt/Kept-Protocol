"use client";
import { useEffect, useState } from "react";

interface Head {
  latest: string;
  finalized: string;
  finality_lag_s: number;
}

/** Instrument bar: live Base head, finality lag and UTC clock. Real data, refreshed every 15 s. */
export function ChainBar() {
  const [head, setHead] = useState<Head | null>(null);
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/v1/chain/head")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && setHead(j))
        .catch(() => {});
    load();
    const a = setInterval(load, 15_000);
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    const b = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
      clearTimeout(first);
    };
  }, []);
  const n = (s?: string) => (s ? Number(s).toLocaleString("en-US") : "—");
  const cells: [string, string][] = [
    ["Network", "Base · 8453"],
    ["Latest block", n(head?.latest)],
    ["Finalized", n(head?.finalized)],
    ["Finality lag", head ? `${Math.round(head.finality_lag_s / 60)} min` : "—"],
    ["UTC", now || "—"],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-t border-line bg-bg/60 backdrop-blur">
      {cells.map(([k, v], i) => (
        <div key={k} className={`px-5 py-3.5 border-line ${i > 0 ? "lg:border-l" : ""} ${i % 2 === 1 ? "border-l sm:border-l-0" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""}`}>
          <p className="label !text-[10px]">{k}</p>
          <p className="mono text-sm mt-1 flex items-center gap-2">
            {i === 0 ? <span className="live-dot" /> : null}
            {v}
          </p>
        </div>
      ))}
    </div>
  );
}
