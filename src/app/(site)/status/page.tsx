import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { getChain } from "@/chain";
import { CHAIN_NAMES } from "@/chain/explorer";
import { Addr, Hash, Tx } from "@/components/addr";
import { ago, fmtDate, nowSeconds, Skeleton } from "@/components/ui";
import { db } from "@/db/client";
import { codeCommit } from "@/lib/env";
import { secretsEncrypted } from "@/lib/secrets";
import { getSigner, isDevSigner } from "@/receipts/signer";
import { anchorStatus } from "@/services/anchor";
import { servAvailable } from "@/services/serv";

export const metadata = { title: "Status & integrity", description: "Live health of Kept, the key that signs every receipt, and every anchor of those receipts on Base." };

export default function StatusPage() {
  return (
    <div className="max-w-5xl">
      <p className="label mb-2">Status &amp; integrity</p>
      <h1 className="title mb-4">Is Kept working, and can you check it?</h1>
      <p className="text-sm text-muted mb-10 max-w-3xl">
        Live health of the service, the key that signs every receipt, and every Merkle root of those receipts attested on Base. Machines can read the same at{" "}
        <a className="link mono" href="/api/v1/health">/api/v1/health</a>.
      </p>
      <Suspense fallback={<Skeleton h={520} />}>
        <Status />
      </Suspense>
    </div>
  );
}

type Tone = "ok" | "warn" | "bad";
const TONE: Record<Tone, string> = { ok: "text-verified", warn: "text-atrisk", bad: "text-breached" };

function Tile({ label, value, tone, detail }: { label: string; value: string; tone: Tone; detail?: React.ReactNode }) {
  return (
    <div className="bg-bg p-5">
      <p className="label mb-2">{label}</p>
      <p className={`text-lg ${TONE[tone]}`}>{value}</p>
      {detail ? <div className="text-xs text-muted mt-1">{detail}</div> : null}
    </div>
  );
}

async function Status() {
  await connection();
  const sql = db();
  let database: Tone = "ok";
  try {
    await sql`select 1`;
  } catch {
    database = "bad";
  }
  const signer = getSigner().address;
  const [anchor, lastCheck, counts, anchors, head] = await Promise.all([
    anchorStatus(sql).catch(() => null),
    sql<{ at: Date | null }[]>`select max(finished_at) as at from checks`.then((r) => r[0]?.at ?? null).catch(() => null),
    sql<{ commitments: number; receipts: number; anchored: number }[]>`
      select (select count(*)::int from commitments) as commitments, (select count(*)::int from receipts) as receipts, (select count(*)::int from receipts where anchor_id is not null) as anchored`
      .then((r) => r[0])
      .catch(() => null),
    sql<{ id: string; merkle_root: string; receipt_count: number; chain_id: number; eas_uid: string | null; tx_hash: string | null; anchored_at: Date }[]>`
      select id, merkle_root, receipt_count, chain_id, eas_uid, tx_hash, anchored_at from anchors order by anchored_at desc limit 30`.catch(() => []),
    Promise.race([getChain(8453).primary.finalizedBlock(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]).catch(() => null),
  ]);
  const now = nowSeconds();
  const checkAge = lastCheck ? (now - new Date(lastCheck).getTime() / 1000) / 60 : null;
  const checks: Tone = checkAge === null ? "warn" : checkAge < 30 ? "ok" : checkAge < 120 ? "warn" : "bad";
  const headAge = head ? now - head.timestamp : null;

  return (
    <>
      <section className="mb-12">
        <h2 className="label border-t border-line pt-4 mb-4">Service</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line">
          <Tile label="Database" value={database === "ok" ? "Operational" : "Unavailable"} tone={database} />
          <Tile label="Monitoring" value={checkAge === null ? "No checks yet" : checks === "ok" ? "Running" : "Delayed"} tone={checks} detail={lastCheck ? `last check ${ago(lastCheck)}` : null} />
          <Tile
            label="Base (finalized)"
            value={head ? `#${Number(head.number).toLocaleString("en-US")}` : "Unreachable"}
            tone={head ? (headAge !== null && headAge < 3600 ? "ok" : "warn") : "warn"}
            detail={headAge !== null ? `${Math.round(headAge / 60)} min behind now (finality lags by design)` : "the public RPC did not answer in time"}
          />
          <Tile label="New readings (SERV)" value={servAvailable() ? "Available" : "Paused"} tone={servAvailable() ? "ok" : "warn"} detail="monitoring never depends on SERV" />
        </div>
      </section>

      <section className="mb-12">
        <h2 className="label border-t border-line pt-4 mb-4">Signing key</h2>
        <div className="border border-line p-5 text-sm space-y-2">
          <p>Every receipt is signed (EIP-191) by <span className="mono break-all">{signer}</span>{isDevSigner(signer) ? <span className="text-breached"> · public development key: receipts prove nothing</span> : null}.</p>
          <p className="text-muted">
            The same address is published in the <a className="link" href="/.well-known/agent-card.json">agent card</a>. When verifying, compare against a copy you trust, then run{" "}
            <span className="mono">kept-verify --signer {signer.slice(0, 10)}…</span>; see <Link className="link" href="/docs#verify">how to verify</Link>.
          </p>
          <p className="text-muted">Server secrets are {secretsEncrypted() ? "encrypted at rest" : "stored without at-rest encryption"}. Running code: <span className="mono">{codeCommit().slice(0, 12)}</span>.</p>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="label border-t border-line pt-4 mb-4">Anchoring on Base</h2>
        <div className="grid sm:grid-cols-3 gap-px bg-line border border-line mb-6">
          <Tile label="Receipts" value={counts ? counts.receipts.toLocaleString("en-US") : "—"} tone="ok" detail={counts ? `${counts.anchored.toLocaleString("en-US")} anchored` : null} />
          <Tile label="Waiting for the next anchor" value={anchor ? String(anchor.pending_receipts) : "—"} tone="ok" detail="anchored every 6 hours, or at 500 receipts" />
          <Tile
            label="Anchoring operator"
            value={anchor?.funded ? "Funded" : anchor?.operator ? "Needs funding" : "Not configured"}
            tone={anchor?.funded ? "ok" : "warn"}
            detail={anchor?.operator ? <Addr address={anchor.operator} chainId={anchor.chain_id} /> : null}
          />
        </div>
        {anchors.length === 0 ? (
          <div className="border border-line p-8 text-sm text-muted">No anchors yet.</div>
        ) : (
          <table className="data stack panel">
            <thead><tr><th>Anchored</th><th>Receipts</th><th>Merkle root</th><th>Transaction</th><th>EAS attestation</th></tr></thead>
            <tbody>
              {anchors.map((a) => (
                <tr key={a.id}>
                  <td data-label="Anchored" className="text-xs whitespace-nowrap">{ago(a.anchored_at)}<span className="block mono text-[10px] text-muted">{fmtDate(a.anchored_at, true)}</span></td>
                  <td data-label="Receipts" className="mono">{a.receipt_count}</td>
                  <td data-label="Merkle root"><Hash value={a.merkle_root} /></td>
                  <td data-label="Transaction">{a.tx_hash ? <Tx hash={a.tx_hash} chainId={a.chain_id} /> : "—"}<span className="block text-[10px] text-muted">{CHAIN_NAMES[a.chain_id] ?? a.chain_id}</span></td>
                  <td data-label="EAS attestation">{a.eas_uid ? <Hash value={a.eas_uid} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
