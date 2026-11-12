import { describe, expect, it } from "vitest";
import { burnV1, erc20OutflowV1, statedVestedAt, vestingScheduleV1 } from "@/core/methods";
import { deriveStatus } from "@/core/status";
import { toBaseUnits, formatUnits } from "@/core/amounts";
import { BUYER, DEAD, E18, TEAM, TEAM2, VESTING, evidence, lockSpec, t, transfer } from "../fixtures";

describe("amounts", () => {
  it("converts decimals exactly and rejects excess precision", () => {
    expect(toBaseUnits("1.5", 18)).toBe(1500000000000000000n);
    expect(toBaseUnits("1000000", 6)).toBe(1000000000000n);
    expect(() => toBaseUnits("0.0000001", 6)).toThrow();
    expect(formatUnits(4_000_000n * E18, 18)).toBe("4,000,000");
  });
});

describe("erc20_outflow_v1", () => {
  it("is pending before the window starts", () => {
    const r = erc20OutflowV1(lockSpec(), evidence([], "2026-02-01"));
    expect(r.outcome).toBe("not_started");
    expect(deriveStatus(lockSpec(), r, "not_needed").status).toBe("pending");
  });

  it("holds to date with no outflows, and is final once the window closes", () => {
    const spec = lockSpec();
    const mid = erc20OutflowV1(spec, evidence([], "2026-09-01"));
    expect(mid.outcome).toBe("in_progress");
    expect(deriveStatus(spec, mid, "not_needed")).toMatchObject({ status: "verified", final: false });
    const end = erc20OutflowV1(spec, evidence([], "2027-03-02"));
    expect(deriveStatus(spec, end, "not_needed")).toMatchObject({ status: "verified", final: true });
  });

  it("breaches on an attributed outflow, only after a second provider confirms", () => {
    const spec = lockSpec();
    const tx = transfer({ from: TEAM, to: BUYER, amount: 4_000_000n * E18, at: "2026-09-27" });
    const r = erc20OutflowV1(spec, evidence([tx], "2026-10-01"));
    expect(r.outcome).toBe("violated");
    expect(r.violating[0].txHash).toBe(tx.txHash);
    expect(deriveStatus(spec, r, "unavailable").status).toBe("at_risk");
    expect(deriveStatus(spec, r, "disagreed").status).toBe("at_risk");
    const d = deriveStatus(spec, r, "confirmed");
    expect(d).toMatchObject({ status: "breached", final: true });
    expect(d.reason).toMatch(/day 211 of a 365-day window/);
    expect(d.reason).not.toMatch(/fraud|scam|rug|lied/i);
  });

  it("caps an unconfirmed subject at At risk", () => {
    const spec = lockSpec({ subjects: [{ address: TEAM, role: "holder", label: null, attribution: { level: "unconfirmed", evidence: null, confirmed_by: null } }] });
    const r = erc20OutflowV1(spec, evidence([transfer({ from: TEAM, to: BUYER, amount: E18, at: "2026-05-01" })], "2026-06-01"));
    expect(deriveStatus(spec, r, "confirmed")).toMatchObject({ status: "at_risk" });
  });

  it("ignores moves between the entity's own addresses and transfers outside the window", () => {
    const spec = lockSpec({ subjects: [...lockSpec().subjects, { address: TEAM2, role: "holder", label: null, attribution: { level: "declared_by_project", evidence: null, confirmed_by: null } }] });
    const r = erc20OutflowV1(
      spec,
      evidence(
        [
          transfer({ from: TEAM, to: TEAM2, amount: E18, at: "2026-04-01" }),
          transfer({ from: TEAM, to: BUYER, amount: E18, at: "2026-02-01" }),
          transfer({ from: TEAM, to: BUYER, amount: E18, at: "2027-04-01" }),
        ],
        "2026-12-01",
      ),
    );
    expect(r.outcome).toBe("in_progress");
    expect(r.computed_value).toBe("0");
    expect(r.notes[0]).toMatch(/own addresses/);
  });

  it("warns on an unfinalized outflow but never breaches on it", () => {
    const spec = lockSpec();
    const pending = transfer({ from: TEAM, to: BUYER, amount: E18, at: "2026-09-01" });
    const r = erc20OutflowV1(spec, evidence([], "2026-09-01", { unfinalizedTransfers: [pending] }));
    expect(r.outcome).toBe("in_progress");
    expect(r.warnings[0].code).toBe("UNFINALIZED_OUTFLOW");
    expect(deriveStatus(spec, r, "confirmed").status).toBe("at_risk");
  });

  it("allows outflows up to a non-zero cap", () => {
    const spec = lockSpec({ threshold: "100", threshold_base_units: (100n * E18).toString() });
    const ok = erc20OutflowV1(spec, evidence([transfer({ from: TEAM, to: BUYER, amount: 60n * E18, at: "2026-04-01" }), transfer({ from: TEAM, to: BUYER, amount: 40n * E18, at: "2026-05-01" })], "2026-06-01"));
    expect(ok.outcome).toBe("in_progress");
    const bad = erc20OutflowV1(spec, evidence([transfer({ from: TEAM, to: BUYER, amount: 60n * E18, at: "2026-04-01" }), transfer({ from: TEAM, to: BUYER, amount: 41n * E18, at: "2026-05-01" })], "2026-06-01"));
    expect(bad.outcome).toBe("violated");
    expect(bad.violating).toHaveLength(1);
  });
});

describe("vesting_schedule_v1", () => {
  const spec = lockSpec({
    category: "vesting",
    method_id: "vesting_schedule_v1",
    comparator: "gte",
    threshold: "1200",
    threshold_base_units: (1200n * E18).toString(),
    subjects: [{ address: VESTING, role: "vesting", label: null, attribution: { level: "onchain_proven", evidence: "beneficiary()", confirmed_by: null } }],
    vesting: { contract: VESTING, start: "2026-01-01T00:00:00.000Z", cliff_seconds: 90 * 86400, duration_seconds: 365 * 86400 },
    window: { start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" },
  });
  const reads = { start: t("2026-01-01"), duration: 365 * 86400, cliff: 90 * 86400, beneficiary: TEAM, funded: 1200n * E18 };

  it("computes the stated schedule", () => {
    expect(statedVestedAt(spec, t("2026-02-01"))).toBe(0n);
    expect(statedVestedAt(spec, t("2027-01-01"))).toBe(1200n * E18);
  });

  it("holds when releases follow the schedule", () => {
    const r = vestingScheduleV1(spec, evidence([transfer({ from: VESTING, to: TEAM, amount: 500n * E18, at: "2026-07-01" })], "2026-08-01", { vesting: reads }));
    expect(r.outcome).toBe("in_progress");
    expect(deriveStatus(spec, r, "not_needed").status).toBe("verified");
  });

  it("breaches when tokens leave before the cliff", () => {
    const r = vestingScheduleV1(spec, evidence([transfer({ from: VESTING, to: TEAM, amount: E18, at: "2026-02-01" })], "2026-03-01", { vesting: reads }));
    expect(r.outcome).toBe("violated");
    expect(deriveStatus(spec, r, "confirmed").status).toBe("breached");
  });

  it("flags a contract that unlocks faster than stated as At risk, not a breach", () => {
    const r = vestingScheduleV1(spec, evidence([], "2026-02-01", { vesting: { ...reads, duration: 270 * 86400 } }));
    expect(r.warnings.map((w) => w.code)).toContain("SCHEDULE_FASTER_THAN_STATED");
    expect(deriveStatus(spec, r, "confirmed").status).toBe("at_risk");
  });

  it("flags underfunding after the grace period", () => {
    const r = vestingScheduleV1(spec, evidence([], "2026-02-01", { vesting: { ...reads, funded: 100n * E18 } }));
    expect(r.warnings.map((w) => w.code)).toContain("UNDERFUNDED");
  });
});

describe("burn_v1", () => {
  const spec = lockSpec({
    category: "burn",
    method_id: "burn_v1",
    comparator: "gte",
    threshold: "1000",
    threshold_base_units: (1000n * E18).toString(),
    subjects: [{ address: TEAM, role: "executor", label: "buyback executor", attribution: { level: "declared_by_project", evidence: null, confirmed_by: null } }],
    burn: { executor: TEAM, burn_addresses: [DEAD] },
    window: { start: "2026-01-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" },
  });

  it("is final as soon as the target is met", () => {
    const r = burnV1(spec, evidence([transfer({ from: TEAM, to: DEAD, amount: 1000n * E18, at: "2026-02-01" })], "2026-02-02"));
    expect(deriveStatus(spec, r, "not_needed")).toMatchObject({ status: "verified", final: true });
  });

  it("does not count burns by anyone else", () => {
    const r = burnV1(spec, evidence([transfer({ from: BUYER, to: DEAD, amount: 5000n * E18, at: "2026-02-01" })], "2026-02-02"));
    expect(r.computed_value).toBe("0");
    expect(r.notes[0]).toMatch(/non-executor/);
  });

  it("shows Pending, not Verified, while the target is unmet and the period is open", () => {
    const r = burnV1(spec, evidence([], "2026-02-01"));
    expect(deriveStatus(spec, r, "not_needed")).toMatchObject({ status: "pending", final: false });
  });

  it("warns near the deadline and breaches when the period closes short", () => {
    const near = burnV1(spec, evidence([], "2026-03-28"));
    expect(near.warnings[0].code).toBe("DEADLINE_NEAR_TARGET_UNMET");
    const closed = burnV1(spec, evidence([transfer({ from: TEAM, to: DEAD, amount: 10n * E18, at: "2026-02-01" })], "2026-04-02"));
    expect(closed.outcome).toBe("violated");
    expect(deriveStatus(spec, closed, "confirmed").status).toBe("breached");
  });
});
