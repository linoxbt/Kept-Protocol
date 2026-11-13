import { describe, expect, it } from "vitest";
import { FixtureChain } from "@/chain/fixture";
import { ArchiveFallbackAdapter } from "@/chain/fallback";
import { ArchiveRequired } from "@/chain/evm";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const TEAM = "0x2222222222222222222222222222222222222222" as const;

/** A primary that serves only recent blocks, like a free public RPC. */
class PrunedChain extends FixtureChain {
  constructor(readonly oldestServed: bigint) {
    super(8453, 1_735_689_600, 600, "pruned");
  }
  async getTransfers(q: Parameters<FixtureChain["getTransfers"]>[0]) {
    if (q.fromBlock < this.oldestServed) throw new ArchiveRequired("no archive");
    return super.getTransfers(q);
  }
}

describe("archive fallback", () => {
  it("serves recent ranges from the primary and old ranges from the archive", async () => {
    const primary = new PrunedChain(500n);
    const archive = new FixtureChain(8453, 1_735_689_600, 600, "archive");
    for (const c of [primary, archive]) {
      c.add({ txHash: `0x${"aa".repeat(32)}`, token: TOKEN, from: TEAM, to: TEAM, amount: 1n, at: "2025-01-02T00:00:00Z" });
      c.add({ txHash: `0x${"bb".repeat(32)}`, token: TOKEN, from: TEAM, to: TEAM, amount: 2n, at: "2025-01-10T00:00:00Z" });
      c.setNow("2025-02-01T00:00:00Z");
    }
    const a = new ArchiveFallbackAdapter(primary, archive);
    expect(a.name).toMatch(/archive fallback/);
    const all = await a.getTransfers({ token: TOKEN, from: [TEAM], fromBlock: 0n, toBlock: primary.finalized });
    expect(all.map((t) => t.amount)).toEqual([1n, 2n]);
    const recent = await a.getTransfers({ token: TOKEN, from: [TEAM], fromBlock: 600n, toBlock: primary.finalized });
    expect(recent.map((t) => t.amount)).toEqual([2n]);
  });

  it("does not hide ordinary failures", async () => {
    const broken = new FixtureChain(8453, 1_735_689_600, 600, "broken");
    broken.getTransfers = async () => {
      throw new Error("rate limited");
    };
    const a = new ArchiveFallbackAdapter(broken, new FixtureChain());
    await expect(a.getTransfers({ token: TOKEN, from: [TEAM], fromBlock: 0n, toBlock: 1n })).rejects.toThrow(/rate limited/);
  });
});
