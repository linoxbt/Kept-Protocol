import { describe, expect, it } from "vitest";
import { runGrifter } from "@/grifter/runner";

describe("Grifter golden suite (offline, fooled-model fixtures)", () => {
  it("passes every case; no critical or high regression", async () => {
    const report = await runGrifter();
    const failed = report.results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.failures.join("; ")}`);
    expect(failed).toEqual([]);
    expect(report.summary.total).toBeGreaterThanOrEqual(20);
    expect(report.summary.blocking).toBe(0);
  });
});
