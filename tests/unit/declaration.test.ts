import { describe, expect, it } from "vitest";
import { declarationText } from "@/components/project-forms";
import { declarationMessage } from "@/services/declarations";

describe("wallet declaration message", () => {
  it("is built identically in the browser and on the server (a mismatch would reject every signature)", () => {
    const input = { project: " Alien Base ", address: "0xa53d1fd0aae780f5f4f3c2f75a35ca9e74269d3d", role: "lock", date: "2026-11-16" };
    expect(declarationText(input.project, input.address, input.role, input.date)).toBe(declarationMessage({ ...input, project: input.project.trim() }));
    expect(declarationMessage(input).split("\n")).toHaveLength(6);
  });
});
