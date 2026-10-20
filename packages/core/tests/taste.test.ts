import { describe, expect, it } from "vitest";
import {
  addEntry,
  approveRule,
  changeStrength,
  createEmptyProfileV2,
  favouriteThings,
  migrateProfileV1,
  parseProfileV2,
  ProfileError,
  removeEntry,
  summarizeProfile,
  undoEvent,
} from "../src/index";
import { fixedClock, profileOf, thing } from "./helpers-v2";

const rintaro = { kind: "thing" as const, qlooId: "RINTARO", name: "Rintaro", type: "urn:entity:place" as const, strength: "love" as const, source: "chat" as const };

describe("profile v2 writes", () => {
  it("adds an entry with an attributed add event", () => {
    const { profile, event } = addEntry(createEmptyProfileV2(fixedClock), rintaro, "chat", fixedClock);
    expect(profile.entries).toHaveLength(1);
    expect(event).toMatchObject({ action: "add", actor: "chat", entryId: profile.entries[0]!.id });
    expect(event.before).toBeUndefined();
    expect(event.after).toEqual(profile.entries[0]);
  });

  it("re-adding the same qlooId changes the entry instead of duplicating", () => {
    const first = addEntry(createEmptyProfileV2(), rintaro, "chat", fixedClock);
    const second = addEntry(first.profile, { ...rintaro, strength: "dislike" }, "mcp:claude", fixedClock);
    expect(second.profile.entries).toHaveLength(1);
    expect(second.profile.entries[0]).toMatchObject({ strength: "dislike", id: first.profile.entries[0]!.id });
    expect(second.event).toMatchObject({ action: "change", actor: "mcp:claude" });
    expect(second.event.before).toMatchObject({ strength: "love" });
  });

  it("agent rules start pending; manual rules are active; approve activates", () => {
    const rule = { kind: "rule" as const, qlooId: "urn:tag:business:place:chain", name: "chain", source: "chat" as const };
    const fromChat = addEntry(createEmptyProfileV2(), rule, "chat", fixedClock);
    expect(fromChat.profile.entries[0]).toMatchObject({ status: "pending", strength: "never" });
    const fromMcp = addEntry(createEmptyProfileV2(), { ...rule, source: "mcp:chatgpt" }, "mcp:chatgpt", fixedClock);
    expect(fromMcp.profile.entries[0]).toMatchObject({ status: "pending" });
    const manual = addEntry(createEmptyProfileV2(), { ...rule, source: "manual" }, "manual", fixedClock);
    expect(manual.profile.entries[0]).toMatchObject({ status: "active" });

    const approved = approveRule(fromChat.profile, fromChat.profile.entries[0]!.id, fixedClock);
    expect(approved.profile.entries[0]).toMatchObject({ status: "active" });
    expect(approved.event).toMatchObject({ action: "approve", actor: "manual" });
  });

  it("an agent re-proposing an approved rule keeps it active", () => {
    const rule = { kind: "rule" as const, qlooId: "urn:tag:chain", name: "chain", source: "manual" as const };
    const manual = addEntry(createEmptyProfileV2(), rule, "manual", fixedClock);
    const again = addEntry(manual.profile, { ...rule, source: "chat" }, "chat", fixedClock);
    expect(again.profile.entries[0]).toMatchObject({ status: "active" });
  });

  it("rejects invalid entries", () => {
    expect(() =>
      addEntry(createEmptyProfileV2(), { ...rintaro, type: "urn:entity:spaceship" as never }, "chat", fixedClock),
    ).toThrow(ProfileError);
    expect(() => addEntry(createEmptyProfileV2(), { ...rintaro, name: "" }, "chat", fixedClock)).toThrow(ProfileError);
  });

  it("changes strength and refuses strength on rules", () => {
    const p = profileOf(thing("A"));
    const { profile, event } = changeStrength(p, "e-A", "love", "manual", fixedClock);
    expect(profile.entries[0]).toMatchObject({ strength: "love" });
    expect(event).toMatchObject({ action: "change", before: { strength: "like" }, after: { strength: "love" } });
    const withRule = addEntry(p, { kind: "rule", qlooId: "t", name: "t", source: "manual" }, "manual", fixedClock).profile;
    const ruleId = withRule.entries[1]!.id;
    expect(() => changeStrength(withRule, ruleId, "like", "manual")).toThrow(/Rules have no strength/);
  });

  it("removing an unknown entry throws NOT_FOUND", () => {
    expect(() => removeEntry(profileOf(), "nope", "manual")).toThrow(ProfileError);
  });
});

describe("undo", () => {
  it("undoes add, remove and change", () => {
    const added = addEntry(createEmptyProfileV2(), rintaro, "chat", fixedClock);
    expect(undoEvent(added.profile, added.event, "manual", fixedClock).profile.entries).toHaveLength(0);

    const removed = removeEntry(added.profile, added.profile.entries[0]!.id, "manual", fixedClock);
    const restored = undoEvent(removed.profile, removed.event, "manual", fixedClock);
    expect(restored.profile.entries).toEqual(added.profile.entries);
    expect(restored.event).toMatchObject({ action: "undo", undoes: removed.event.id });

    const changed = changeStrength(added.profile, added.profile.entries[0]!.id, "dislike", "page", fixedClock);
    const reverted = undoEvent(changed.profile, changed.event, "manual", fixedClock);
    expect(reverted.profile.entries[0]).toMatchObject({ strength: "love" });
  });

  it("undoing an undo re-applies the change", () => {
    const added = addEntry(createEmptyProfileV2(), rintaro, "chat", fixedClock);
    const undone = undoEvent(added.profile, added.event, "manual", fixedClock);
    const redone = undoEvent(undone.profile, undone.event, "manual", fixedClock);
    expect(redone.profile.entries).toEqual(added.profile.entries);
  });

  it("keeps unrelated later writes", () => {
    const a = addEntry(createEmptyProfileV2(), rintaro, "chat", fixedClock);
    const b = addEntry(a.profile, { ...rintaro, qlooId: "FUGAZI", name: "Fugazi", type: "urn:entity:artist" }, "chat", fixedClock);
    const undone = undoEvent(b.profile, a.event, "manual", fixedClock);
    expect(undone.profile.entries.map((e) => e.name)).toEqual(["Fugazi"]);
  });

  it("refuses to restore a removed entry that was re-added since", () => {
    const a = addEntry(createEmptyProfileV2(), rintaro, "chat", fixedClock);
    const removed = removeEntry(a.profile, a.profile.entries[0]!.id, "manual", fixedClock);
    const readded = addEntry(removed.profile, rintaro, "chat", fixedClock);
    expect(() => undoEvent(readded.profile, removed.event, "manual")).toThrow(/added again/);
  });
});

describe("helpers", () => {
  it("favouriteThings orders loves first then newest, excludes dislikes", () => {
    const p = profileOf(
      thing("old-like", { createdAt: "2026-01-01" }),
      thing("new-like", { createdAt: "2026-06-01" }),
      thing("love", { strength: "love", createdAt: "2025-01-01" }),
      thing("nope", { strength: "dislike" }),
    );
    expect(favouriteThings(p).map((t) => t.qlooId)).toEqual(["love", "new-like", "old-like"]);
  });

  it("parses valid profiles and rejects invalid ones", () => {
    const p = profileOf(thing("A"));
    expect(parseProfileV2(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parseProfileV2({ version: 1 })).toThrow(ProfileError);
  });

  it("summarizes compactly", () => {
    expect(summarizeProfile(profileOf())).toBe("(empty profile)");
    expect(summarizeProfile(profileOf(thing("A", { name: "Rintaro" })))).toBe('like thing "Rintaro" (place)');
  });

  it("migrates v1 profiles", () => {
    const v2 = migrateProfileV1(
      {
        version: 1,
        updatedAt: "2026-10-01T00:00:00.000Z",
        seeds: [
          { entityId: "A", name: "Rintaro", subtype: "urn:entity:place", polarity: "like", weight: 2, source: "searched", addedAt: "x" },
          { entityId: "B", name: "Chili's", subtype: "urn:entity:place", polarity: "dislike", weight: 1, source: "agent", addedAt: "x" },
          { entityId: "C", name: "Bad", subtype: "unknown", polarity: "like", weight: 1, source: "typed", addedAt: "x" },
        ],
        rules: [
          { kind: "collapse", match: { tagId: "urn:tag:chain" } },
          { kind: "boost", match: { tagId: "urn:tag:natural_wine" } },
          { kind: "exclude", match: { flag: "sponsored" } },
        ],
      },
      fixedClock,
    );
    expect(v2.entries.map((e) => [e.kind, e.qlooId, e.strength])).toEqual([
      ["thing", "A", "love"],
      ["thing", "B", "dislike"],
      ["rule", "urn:tag:chain", "never"],
      ["vibe", "urn:tag:natural_wine", "like"],
    ]);
    expect(() => parseProfileV2(v2)).not.toThrow();
  });
});
