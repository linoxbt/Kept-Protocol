"use client";
import { useState } from "react";

export function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="mono text-[10px] text-faint hover:text-accent border border-line px-1 leading-4"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label={`Copy ${value}`}
    >
      {done ? "copied" : label}
    </button>
  );
}
