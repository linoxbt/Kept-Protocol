import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatUnits } from "@/core/amounts";
import { Addr, Hash, Tx } from "@/components/addr";
import { CopyButton } from "@/components/copy";
import { StatusChip } from "@/components/status";
import { fmtDate, prettyReason, Section, Skeleton } from "@/components/ui";
import { VerifyInBrowser } from "@/components/verify-receipt";
import { db } from "@/db/client";
import { isDevSigner } from "@/receipts/signer";
import { canonicalJson } from "@/receipts/receipt";
import { inclusionProof } from "@/services/anchor";
import { getReceipt } from "@/services/receipts";

export const metadata = { title: "Receipt" };

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton h={600} />}>
      <Receipt params={params} />
    </Suspense>
  );
}

async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const r = await getReceipt(db(), id);
  if (!r) notFound();
  const anchor = await inclusionProof(id);
  const b = r.body;
  const s = b.spec;
  const sym = s.token.symbol ?? "tokens";
  const canonical = canonicalJson(b);
  const dev = isDevSigner(b.signer);
  return (
    <div className="max-w-4xl">
      {b.commitment_id ? <Link href={`/commitments/${b.commitment_id}`} className="label u !text-muted hover:!text-ink">← commitment</Link> : null}
      <div className="flex flex-wrap items-center gap-3 mt-3 mb-6">
        <h1 className="title">Receipt</h1>
        <span className="mono text-xs border border-line px-2 py-0.5">{b.kind}{b.kind === "hindcast" ? " · replay, not a live check" : ""}</span>
        {dev ? <span className="mono text-xs border border-atrisk text-atrisk px-2 py-0.5">development key — proves nothing</span> : null}
      </div>

      <div className="proof mb-8 space-y-5">
        <div>
          <p className="label mb-1">The promise</p>
          <p className="text-lg">“{b.statement.excerpt}”</p>
          <p className="text-xs text-muted mt-1 flex flex-wrap gap-3 items-center">
            {b.statement.url ? <a className="link" href={b.statement.url} target="_blank" rel="noreferrer">{b.statement.url}</a> : <span>pasted source</span>}
            <span className="mono">captured {fmtDate(b.statement.captured_at, true)}</span>
            <Hash value={b.statement.content_sha256} />
          </p>
        </div>
        <div>
          <p className="label mb-1">The condition, in plain words</p>
          <p>{s.condition_summary}</p>
          <p className="mono text-xs text-muted mt-1">
            {b.method.id} v{b.method.version} · code {b.method.code_commit.slice(0, 12)} · chain {b.chain.chain_id} · blocks {b.chain.from_block}–{b.chain.to_block} (finalized)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <StatusChip status={b.result.status} final={b.result.final} size="lg" />
          <span className="mono">
            {formatUnits(BigInt(b.result.computed_value), s.token.decimals)} / {formatUnits(BigInt(b.result.threshold_base_units), s.token.decimals)} {sym}
          </span>
        </div>
        <p className="text-sm">{prettyReason(b.result.reason)}</p>
        {b.evidence.length ? (
          <table className="data stack">
            <thead><tr><th>Transaction</th><th>Block</th><th>From → To</th><th>Amount</th></tr></thead>
            <tbody>
              {b.evidence.slice(0, 50).map((e) => (
                <tr key={e.tx_hash + e.log_index}>
                  <td><Tx hash={e.tx_hash} chainId={b.chain.chain_id} /></td>
                  <td className="mono text-xs">{e.block_number}</td>
                  <td className="text-xs"><Addr address={e.from} chainId={b.chain.chain_id} /> → <Addr address={e.to} chainId={b.chain.chain_id} /></td>
                  <td className="mono text-xs">{formatUnits(BigInt(e.amount), s.token.decimals)} {sym}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted">No transfers counted in this check.</p>
        )}
        <div>
          <p className="label mb-1">Attribution</p>
          <ul className="text-xs space-y-1">
            {b.attribution.map((a) => (
              <li key={a.address} className="flex flex-wrap gap-2 items-center"><Addr address={a.address} chainId={b.chain.chain_id} /> <span className="mono">{a.level}</span> <span className="text-muted">{a.evidence}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label mb-1">Providers</p>
          <ul className="text-xs text-muted space-y-1">{b.providers.map((p) => <li key={p.name}><span className="mono text-ink">{p.role}</span> {p.name}: {p.result}</li>)}</ul>
        </div>
        <div>
          <p className="label mb-1">Limitations</p>
          <ul className="text-xs text-muted list-disc pl-5 space-y-0.5">{b.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      </div>

      <Section title="Integrity">
        <div className="panel p-4 space-y-3 text-sm">
          <p className="flex flex-wrap gap-2 items-center"><span className="label w-28">sha256</span><Hash value={r.sha256} head={16} /></p>
          <p className="flex flex-wrap gap-2 items-center"><span className="label w-28">previous</span>{b.prev_sha256 ? <Hash value={b.prev_sha256} head={16} /> : <span className="mono text-xs text-muted">first receipt of this commitment</span>}</p>
          <p className="flex flex-wrap gap-2 items-center"><span className="label w-28">signer</span><Addr address={b.signer} full /></p>
          <p className="flex flex-wrap gap-2 items-center"><span className="label w-28">anchor</span>{anchor ? <span className="mono text-xs">root {anchor.anchor.merkle_root.slice(0, 16)}… · leaf {anchor.leaf_index} · <a className="link" href={`https://basescan.org/tx/${anchor.anchor.tx_hash}`} target="_blank" rel="noreferrer">EAS attestation</a></span> : <span className="mono text-xs text-muted">anchoring pending (not an error): included in the next daily root</span>}</p>
          <VerifyInBrowser canonical={canonical} sha256={r.sha256} signature={r.signature} signer={b.signer} />
        </div>
      </Section>

      <Section title="Verify it yourself" aside={<CopyButton value={canonical} label="copy canonical JSON" />}>
        <pre className="panel p-4 text-xs mono overflow-auto">{`curl -s ${process.env.PUBLIC_BASE_URL ?? ""}/api/v1/receipts/${id} > receipt.json
npx tsx scripts/kept-verify.ts receipt.json --rpc https://base-rpc.publicnode.com
# re-fetches every log in the receipt's block range, reruns ${b.method.id} v${b.method.version},
# and checks: same result, matching sha256, valid signature`}</pre>
      </Section>

      <Section title="Raw JSON (canonical, RFC 8785)">
        <pre className="panel p-4 text-xs mono overflow-auto max-h-96">{JSON.stringify(JSON.parse(canonical), null, 2)}</pre>
      </Section>
    </div>
  );
}
