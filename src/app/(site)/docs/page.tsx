import Link from "next/link";
import { env } from "@/lib/env";
import { Section } from "@/components/ui";

export const metadata = { title: "API and verification guide" };

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/v1/agent/commitments?chain_id=8453&token=0x…", "Agent lookup, paid per query (x402). coverage = none | partial | full"],
  ["GET", "/api/v1/commitments/{id}", "A commitment with its current status (signed)"],
  ["GET", "/api/v1/commitments/{id}/versions", "Every version of the promise"],
  ["GET", "/api/v1/commitments/{id}/diff?from=1&to=2", "Field diff, word diff and retroactive-revision flags"],
  ["GET", "/api/v1/receipts/{id}", "Receipt JSON as hashed and signed, plus inclusion proof"],
  ["GET", "/api/v1/projects", "Projects with status counts"],
  ["GET", "/api/v1/feed", "Recent status changes"],
  ["POST", "/api/v1/tryit", "Preview extraction for a URL or text (public, rate-limited)"],
  ["POST", "/api/v1/commitments", "Confirm a draft (admin)"],
  ["POST", "/api/v1/hindcast", "Replay versions over history (admin)"],
  ["POST", "/api/v1/webhooks", "Register a signed webhook (admin)"],
];

export default function Docs() {
  const e = env();
  return (
    <div className="max-w-4xl">
      <h1 className="title mb-4">API</h1>
      <p className="text-sm text-muted mb-8">
        REST over HTTPS, JSON, versioned under <span className="mono">/v1</span>. Machine-readable spec: <a className="link mono" href="/api/v1/openapi.json">/api/v1/openapi.json</a>. Agent
        identity: <a className="link mono" href="/.well-known/agent-card.json">/.well-known/agent-card.json</a>.
      </p>
      <Section title="Conventions">
        <ul className="text-sm space-y-2 list-disc pl-5">
          <li>Public reads are signed: <span className="mono">Kept-Signature</span> is an EIP-191 signature over the SHA-256 of the exact response body, by <span className="mono">Kept-Signer</span>.</li>
          <li>Errors are RFC 9457 problem details (<span className="mono">application/problem+json</span>).</li>
          <li>Every POST accepts <span className="mono">Idempotency-Key</span>; the first response for a key is replayed.</li>
          <li>Admin writes take <span className="mono">Authorization: Bearer &lt;admin key&gt;</span>.</li>
          <li>Webhooks carry <span className="mono">Kept-Webhook-Signature: t=&lt;unix&gt;,v1=&lt;hmac_sha256(secret, t + &quot;.&quot; + body)&gt;</span>; reject timestamps older than 5 minutes.</li>
        </ul>
      </Section>
      <Section title="Endpoints">
        <table className="data panel">
          <tbody>{ENDPOINTS.map(([m, p, d]) => <tr key={p}><td className="mono text-xs w-14">{m}</td><td className="mono text-xs">{p}</td><td className="text-sm text-muted">{d}</td></tr>)}</tbody>
        </table>
      </Section>
      <Section title="Agents: pay per query with x402">
        <pre className="panel p-4 text-xs mono overflow-auto">{`# 1. Ask. Without payment the API answers 402 with payment requirements.
curl -i "$KEPT/api/v1/agent/commitments?chain_id=8453&token=0x…"
#    → 402 Payment Required  (scheme "exact", ${e.X402_PRICE} USDC on ${e.X402_NETWORK})

# 2. Pay and retry with any x402 client, e.g. @x402/fetch:
import { wrapFetchWithPayment } from "@x402/fetch";
const res = await wrapFetchWithPayment(fetch, client)(url);
#    → 200, signed JSON: { coverage, commitments: [{ status, final, attribution, receipt, receipt_sha256 }] }

# coverage "none" means Kept has no record. It is never evidence that a token is clean.`}</pre>
      </Section>
      <Section title="Verify a receipt yourself" aside={<span id="verify" />}>
        <ol className="text-sm space-y-2 list-decimal pl-5 mb-4">
          <li>Canonicalize the receipt body with RFC 8785 (JCS) and hash it with SHA-256. It must equal <span className="mono">sha256</span>.</li>
          <li>Recover the EIP-191 signer of that 32-byte hash. It must equal the published signer in the agent card.</li>
          <li>Re-fetch every Transfer log for the receipt&apos;s token and subjects in <span className="mono">from_block…to_block</span> from any Base RPC, rerun the named method version, and compare the result.</li>
          <li>Once anchored, check the Merkle proof against the root attested on Base through EAS.</li>
        </ol>
        <pre className="panel p-4 text-xs mono overflow-auto">{`git clone <this repository> && cd kept && npm ci
curl -s $KEPT/api/v1/receipts/kr_… > receipt.json
npx tsx scripts/kept-verify.ts receipt.json --rpc https://base-rpc.publicnode.com`}</pre>
        <p className="text-sm text-muted mt-3">Every receipt page also has a <span className="text-ink">Verify in this browser</span> button that recomputes the hash and recovers the signer locally.</p>
      </Section>
      <p className="text-sm"><Link className="link" href="/try">Try it on a real project →</Link></p>
    </div>
  );
}
