import { describe, expect, it } from "vitest";
import { classifyChange, fieldDiff, retroactiveRevisionFlags } from "@/core/precedent";
import { runHindcast } from "@/core/hindcast";
import { BUYER, E18, TEAM, lockSpec, t, transfer } from "../fixtures";

const v1 = lockSpec();
const v2 = lockSpec({
  window: { start: "2026-03-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" },
  excerpt: "Team tokens are locked for 9 months from 1 March 2026.",
});
const base = { finalizedBlock: 1n, finalizedTime: 0, latestBlock: 1n, fromBlock: 0n, vesting: null };

describe("Precedent", () => {
  it("classifies a shortened window as a policy change", () => {
    expect(classifyChange(v1, v2)).toBe("policy_change");
    const end = fieldDiff(v1, v2).find((c) => c.field === "window.end");
    expect(end).toMatchObject({ from: "2027-03-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", policy: true });
  });

  it("classifies wording-only changes as editorial", () => {
    expect(classifyChange(v1, lockSpec({ condition_summary: "Reworded." }))).toBe("editorial");
    expect(classifyChange(v1, lockSpec())).toBe("none");
  });

  it("flags a transfer that only the later version excuses, if the later version came after it", () => {
    const tx = transfer({ from: TEAM, to: BUYER, amount: 4_000_000n * E18, at: "2026-12-15" });
    const flags = retroactiveRevisionFlags(v1, v2, t("2026-12-20"), [tx], base);
    expect(flags).toHaveLength(1);
    expect(flags[0].txHash).toBe(tx.txHash);
    expect(flags[0].message).toMatch(/Condition relaxed after the event/);
  });

  it("does not flag when the revision was published before the transfer", () => {
    const tx = transfer({ from: TEAM, to: BUYER, amount: E18, at: "2026-12-15" });
    expect(retroactiveRevisionFlags(v1, v2, t("2026-11-01"), [tx], base)).toHaveLength(0);
  });
});

describe("Hindcast", () => {
  it("replays both versions over the same evidence and shows where they diverge", () => {
    const tx = transfer({ from: TEAM, to: BUYER, amount: 4_000_000n * E18, at: "2026-12-15" });
    const res = runHindcast(
      [
        { version: 1, spec: v1, publishedAt: t("2026-03-01") },
        { version: 2, spec: v2, publishedAt: t("2026-12-20") },
      ],
      [tx],
      { from: t("2026-03-01"), to: t("2027-03-05"), vesting: null, confirmation: "confirmed", blockAt: () => 1n },
    );
    const [l1, l2] = res.lanes;
    expect(l1.firstBreachedAt).toBe(tx.blockTime);
    expect(l2.firstBreachedAt).toBeNull();
    expect(l2.firstVerifiedFinalAt).toBe(t("2026-12-01"));
    expect(l1.changes.at(-1)?.txHash).toBe(tx.txHash);
    expect(res.divergences.length).toBeGreaterThan(0);
  });
});

describe("Precedent sees every relaxation (audit B4)", () => {
  it("treats a new internal address or a downgraded attribution as a policy change", () => {
    const v1 = lockSpec();
    const widened = lockSpec({ internal_addresses: [BUYER] });
    const internal = fieldDiff(v1, widened).find((c) => c.field === "internal_addresses");
    expect(internal).toMatchObject({ policy: true, from: null, to: BUYER.toLowerCase() });
    expect(classifyChange(v1, widened)).toBe("policy_change");

    const downgraded = lockSpec({ subjects: v1.subjects.map((s) => ({ ...s, attribution: { level: "unconfirmed" as const, evidence: null, confirmed_by: null } })) });
    const attr = fieldDiff(v1, downgraded).find((c) => c.field === "subjects.attribution");
    expect(attr?.policy).toBe(true);
    expect(attr?.to).toMatch(/=unconfirmed$/);
  });
});
