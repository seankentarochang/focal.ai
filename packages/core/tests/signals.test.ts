import { describe, expect, it } from "vitest";
import { selectSignals } from "../src/index";
import { profileOf, thing, vibe } from "./helpers-v2";

describe("selectSignals", () => {
  it("takes top favourites of any type, then fills with the page type", () => {
    const p = profileOf(
      thing("artist1", { type: "urn:entity:artist", strength: "love" }),
      thing("movie1", { type: "urn:entity:movie", strength: "love" }),
      thing("place1"),
      thing("place2"),
      thing("brand1", { type: "urn:entity:brand" }),
      thing("disliked", { strength: "dislike" }),
    );
    const s = selectSignals(p, "urn:entity:place", { cap: 4, topOverall: 2 });
    expect(s.entities.map((e) => e.id)).toEqual(["artist1", "movie1", "place1", "place2"]);
    expect(s.entities[0]).toMatchObject({ strength: "love" });
  });

  it("never exceeds the cap and never includes dislikes", () => {
    const entries = Array.from({ length: 30 }, (_, i) => thing(`p${i}`));
    const s = selectSignals(profileOf(...entries, thing("x", { strength: "dislike" })), "urn:entity:place");
    expect(s.entities).toHaveLength(20);
    expect(s.entities.some((e) => e.id === "x")).toBe(false);
  });

  it("sends applicable liked vibes as tags, loves first", () => {
    const p = profileOf(
      vibe("urn:tag:cozy"),
      vibe("urn:tag:natural_wine", { strength: "love", types: ["urn:entity:place"] }),
      vibe("urn:tag:noir", { types: ["urn:entity:movie"] }),
      vibe("urn:tag:sports_bar", { strength: "dislike" }),
    );
    const s = selectSignals(p, "urn:entity:place");
    expect(s.tags.map((t) => t.id)).toEqual(["urn:tag:natural_wine", "urn:tag:cozy"]);
    expect(s.localBoosts).toEqual([]);
  });

  it("turns vibes into local boosts when tag signals are off for the type", () => {
    const p = profileOf(vibe("urn:tag:cozy"));
    const s = selectSignals(p, "urn:entity:brand", { tagSignalTypes: ["urn:entity:place"] });
    expect(s.tags).toEqual([]);
    expect(s.localBoosts.map((b) => b.id)).toEqual(["urn:tag:cozy"]);
    expect(selectSignals(p, "urn:entity:place", { tagSignalTypes: "none" }).localBoosts).toHaveLength(1);
  });
});
