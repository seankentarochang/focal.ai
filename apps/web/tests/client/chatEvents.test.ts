import { describe, expect, it } from "vitest";
import type { ActivityEvent, ProfileEntry } from "@focal-ai/core";
import { describeEvent } from "@/lib/client/chatEvents";

const thing: ProfileEntry = {
  id: "e1",
  kind: "thing",
  qlooId: "q",
  name: "Fugazi",
  type: "urn:entity:artist",
  strength: "love",
  source: "chat",
  createdAt: "2026-10-20T00:00:00.000Z",
};
const rule: ProfileEntry = {
  id: "e2",
  kind: "rule",
  qlooId: "urn:tag:x",
  name: "chain restaurants",
  strength: "never",
  status: "pending",
  source: "chat",
  createdAt: "2026-10-20T00:00:00.000Z",
};
const ev = (action: ActivityEvent["action"], over: Partial<ActivityEvent>): ActivityEvent => ({
  id: "a",
  actor: "chat",
  action,
  entryId: "e1",
  at: "2026-10-20T00:00:00.000Z",
  ...over,
});

describe("describeEvent", () => {
  it("summarises saved likes with their strength", () => {
    expect(describeEvent(ev("add", { after: thing }))).toBe("Saved Fugazi · love");
    expect(describeEvent(ev("remove", { before: thing }))).toBe("Removed Fugazi");
  });
  it("marks new rules as pending", () => {
    expect(describeEvent(ev("add", { after: rule }))).toContain("pending your approval");
  });
});
