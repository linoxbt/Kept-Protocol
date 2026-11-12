"use client";
import { useState } from "react";
import { recoverMessageAddress } from "viem";

/** Recomputes SHA-256 over the canonical JSON and recovers the EIP-191 signer, in the browser. */
export function VerifyInBrowser({ canonical, sha256, signature, signer }: { canonical: string; sha256: string; signature: `0x${string}`; signer: string }) {
  const [out, setOut] = useState<{ hash: boolean; sig: boolean; recovered: string; recomputed: string } | null>(null);
  return (
    <div>
      <button
        className="btn"
        onClick={async () => {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
          const recomputed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
          let recovered = "";
          try {
            recovered = await recoverMessageAddress({ message: { raw: `0x${recomputed}` }, signature });
          } catch {
            recovered = "(invalid signature)";
          }
          setOut({ hash: recomputed === sha256, sig: recovered.toLowerCase() === signer.toLowerCase(), recovered, recomputed });
        }}
      >
        Verify in this browser
      </button>
      {out ? (
        <ul className="mono text-xs mt-3 space-y-1">
          <li className={out.hash ? "text-verified" : "text-breached"}>{out.hash ? "✓" : "✗"} SHA-256 of canonical JSON = {out.recomputed}</li>
          <li className={out.sig ? "text-verified" : "text-breached"}>{out.sig ? "✓" : "✗"} EIP-191 signer recovered = {out.recovered}</li>
        </ul>
      ) : null}
    </div>
  );
}
