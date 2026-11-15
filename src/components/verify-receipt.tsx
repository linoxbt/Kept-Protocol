"use client";
import { useState } from "react";
import { recoverMessageAddress } from "viem";

interface Result {
  hash: boolean;
  recomputed: string;
  recovered: string;
  published: string | null;
  sig: boolean;
}

/**
 * Recomputes SHA-256 over the canonical JSON and recovers the EIP-191 signer, in the browser, then
 * compares the recovered address with the signer the deployment PUBLISHES in its agent card. The
 * receipt's own `signer` field is not used: a forged receipt would carry its forger's address there.
 */
export function VerifyInBrowser({ canonical, sha256, signature }: { canonical: string; sha256: string; signature: `0x${string}` }) {
  const [out, setOut] = useState<Result | null>(null);
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
          let published: string | null = null;
          try {
            const card = (await (await fetch("/.well-known/agent-card.json", { cache: "no-store" })).json()) as { signer?: { address?: string } };
            published = card.signer?.address ?? null;
          } catch {
            published = null;
          }
          setOut({ hash: recomputed === sha256, recomputed, recovered, published, sig: !!published && recovered.toLowerCase() === published.toLowerCase() });
        }}
      >
        Verify in this browser
      </button>
      {out ? (
        <ul className="mono text-xs mt-3 space-y-1">
          <li className={out.hash ? "text-verified" : "text-breached"}>{out.hash ? "✓" : "✗"} SHA-256 of canonical JSON = {out.recomputed}</li>
          <li className={out.sig ? "text-verified" : "text-breached"}>
            {out.sig ? "✓" : "✗"} EIP-191 signer recovered = {out.recovered}
            {out.published ? `, published signer (agent card) = ${out.published}` : ", published signer could not be loaded"}
          </li>
          <li className="text-muted">For a check that does not rely on this site at all, run kept-verify with --signer set to an address you trust.</li>
        </ul>
      ) : null}
    </div>
  );
}
