import { explorerAddress, explorerTx } from "@/chain/explorer";
import { CopyButton } from "./copy";

/** Truncated as 0xAbc1…9cA1, never mid-checksum; always with copy and an explorer link. */
export function short(v: string, head = 6, tail = 4): string {
  return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}…${v.slice(-tail)}`;
}

export function Addr({ address, chainId = 8453, full = false }: { address: string; chainId?: number; full?: boolean }) {
  return (
    <span className="mono inline-flex items-center gap-1.5 text-sm">
      <a className="link" href={explorerAddress(chainId, address)} target="_blank" rel="noreferrer">
        {full ? address : short(address)}
      </a>
      <CopyButton value={address} />
    </span>
  );
}

export function Tx({ hash, chainId = 8453 }: { hash: string; chainId?: number }) {
  return (
    <span className="mono inline-flex items-center gap-1.5 text-sm">
      <a className="link" href={explorerTx(chainId, hash)} target="_blank" rel="noreferrer">
        {short(hash, 10, 6)}
      </a>
      <CopyButton value={hash} />
    </span>
  );
}

export function Hash({ value, head = 10 }: { value: string; head?: number }) {
  return (
    <span className="mono inline-flex items-center gap-1.5 text-xs text-muted">
      <span title={value}>{short(value, head, 6)}</span>
      <CopyButton value={value} />
    </span>
  );
}
