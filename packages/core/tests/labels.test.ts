import { describe, expect, it } from "vitest";
import { buildLiftLabel } from "../src/index";
import { profileOf, thing } from "./helpers-v2";

const profile = profileOf(
  thing("F", { name: "Fugazi", type: "urn:entity:artist" }),
  thing("R", { name: "Rintaro" }),
  thing("X", { name: "Chili's", strength: "dislike" }),
);

describe("buildLiftLabel", () => {
  it("names up to two grounded likes, strongest first", () => {
    const label = buildLiftLabel("top-pick", [
      { entityId: "R", score: 0.6 },
      { entityId: "F", score: 0.9 },
      { entityId: "Q", score: 1 },
    ], profile);
    expect(label.text).toBe("Top pick for you · because you like Fugazi and Rintaro");
    expect(label.reasonNames).toEqual(["Fugazi", "Rintaro"]);
  });

  it("never invents a reason", () => {
    expect(buildLiftLabel("good-match", undefined, profile).text).toBe("Good match");
    expect(buildLiftLabel("good-match", [{ entityId: "Q", score: 1 }], profile).text).toBe("Good match");
    expect(buildLiftLabel("good-match", [{ entityId: "X", score: 1 }], profile).text).toBe("Good match");
    expect(buildLiftLabel("good-match", [{ entityId: "F", score: 0.05 }], profile).text).toBe("Good match");
  });

  it("stays under 140 characters and strips markup", () => {
    const long = profileOf(thing("L", { name: `<b>${"a".repeat(150)}</b>` }));
    const label = buildLiftLabel("top-pick", [{ entityId: "L", score: 1 }], long);
    expect(label.text.length).toBeLessThanOrEqual(140);
    expect(label.text).not.toContain("<");
  });
});
