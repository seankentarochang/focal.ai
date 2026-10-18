import { describe, expect, it } from "vitest";
import { formatStepDuration, summarizePreview } from "@/components/agent/AgentPanel";

describe("formatStepDuration", () => {
  it("renders milliseconds below one second", () => {
    expect(formatStepDuration(412)).toBe("412ms");
  });

  it("renders seconds with one decimal from one second up", () => {
    expect(formatStepDuration(1000)).toBe("1.0s");
    expect(formatStepDuration(2450)).toBe("2.5s");
  });
});

describe("summarizePreview", () => {
  it("formats moved/collapsed/unresolved counts", () => {
    expect(summarizePreview({ moved: 4, collapsed: 1, unresolved: 2, avgMovement: 1.5 })).toBe(
      "4 moved · 1 collapsed · 2 unresolved",
    );
  });
});
