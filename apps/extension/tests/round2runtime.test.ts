import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundReply, ContentMessage } from "../src/api";
import { RESTAURANT_GRID } from "./fixtures";

/** Same harness as layouts.test.ts: chrome mock + configurable sendMessage. */
function stubChrome(handler?: (msg: ContentMessage) => Promise<BackgroundReply<never>>) {
  const sent: ContentMessage[] = [];
  const data: Record<string, unknown> = {};
  const area = {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (obj: Record<string, unknown>) => { Object.assign(data, obj); },
    remove: async (key: string) => { delete data[key]; },
  };
  vi.stubGlobal("chrome", {
    storage: { local: area, session: area },
    runtime: {
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onMessageExternal: { addListener: vi.fn() },
      sendMessage: vi.fn(async (msg: ContentMessage): Promise<BackgroundReply<never>> => {
        sent.push(msg);
        if (handler) return handler(msg);
        if (msg.type === "identify") {
          return { ok: true, data: { isList: true, pageType: "place", items: [
            { clientId: "c0", name: "Rintaro", type: "place" },
            { clientId: "c1", name: "Ippudo", type: "place" },
            { clientId: "c2", name: "Chuko", type: "place" },
            { clientId: "c3", name: "Okonomi", type: "place" },
          ] } } as never;
        }
        if (msg.type === "rank") {
          return { ok: true, data: { pageResultId: "p1", status: "ranked", resolvedCount: 1,
            plan: { summary: { lifted: 1 }, ops: [
              { op: "reorder", order: ["c1", "c0", "c2", "c3"] },
              { op: "annotate", clientId: "c1", badge: "top-pick", text: "Top pick" },
            ] } } } as never;
        }
        return { ok: true, data: {} } as never;
      }),
    },
    extension: { inIncognitoContext: false },
    tabs: { create: vi.fn() },
  });
  return { data, sent };
}

let prevMod: typeof import("../src/content") | null = null;
beforeEach(() => {
  // A previous test's content module still has live watchers/timers — kill it.
  prevMod?.__stopForTests();
  prevMod = null;
  vi.useRealTimers(); // a previous test's fake timers must not leak
  vi.resetModules(); // each test gets a fresh content module -> void run() refires
  document.body.innerHTML = "";
});

describe("R2-2: no_signals keeps the stored layout", () => {
  it("does not invalidate when resolution never ran", async () => {
    stubChrome();
    prevMod = await import("../src/content");
    const { shouldInvalidateLayout } = prevMod;
    expect(shouldInvalidateLayout({ ok: true, data: { resolvedCount: 0, status: "no_signals" } })).toBe(false);
    expect(shouldInvalidateLayout({ ok: true, data: { resolvedCount: 0, status: "nothing_scored" } })).toBe(true);
    expect(shouldInvalidateLayout({ ok: false })).toBe(false);
  });
});

describe("R2-15: rerun suppression and fresh detection", () => {
  it("site re-sort of a known card schedules a rerun", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = RESTAURANT_GRID;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 3000 });
    // Simulate the site re-sorting: move a known card to the end.
    const container = document.querySelector(".results")!;
    const card = container.querySelector("div.card")!;
    container.appendChild(card); // removal + add of a known node
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBeGreaterThan(1), { timeout: 5000 });
  });

  it("focal-injected mutations never trigger a rerun", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = RESTAURANT_GRID;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 3000 });
    const injected = document.createElement("span");
    injected.setAttribute("data-focal", "label");
    injected.textContent = "x";
    document.querySelector(".results div.card")!.append(injected);
    await new Promise((r) => setTimeout(r, 1200));
    expect(sent.filter((m) => m.type === "rank").length).toBe(1);
  });
});

describe("R2-15f: retry budget for failed identify", () => {
  it("retries at most 3 times per container", async () => {
    vi.useFakeTimers();
    const { sent } = stubChrome(async (msg) => ({ ok: false } as never));
    document.body.innerHTML = RESTAURANT_GRID;
    prevMod = await import("../src/content");
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(61000);
    const identifies = sent.filter((m) => m.type === "identify").length;
    expect(identifies).toBeLessThanOrEqual(4); // initial + 3 retries
    vi.useRealTimers();
  });
});

describe("R3-4: strip Undo does not schedule a rerun (move mode)", () => {
  it("undoing a lifted plan leaves the card set alone", async () => {
    const { sent } = stubChrome();
    // Plain container (no flex/grid) -> applyPlan uses move mode; Undo re-appends.
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 3000 });
    await vi.waitFor(() => expect(document.querySelector("[data-focal='strip']")).not.toBeNull(), { timeout: 3000 });
    const undo = document.querySelector<HTMLElement>("[data-focal='undo']");
    expect(undo).not.toBeNull();
    undo!.click();
    await new Promise((r) => setTimeout(r, 1500));
    expect(sent.filter((m) => m.type === "rank").length).toBe(1);
  });
});

describe("R2-15c: gate ownership", () => {
  it("a failing run cancels only its own gate, leaving a newer gate live", async () => {
    let rankCalls = 0;
    let resolveSecond: ((v: unknown) => void) | null = null;
    const { sent } = stubChrome(async (msg) => {
      if (msg.type === "identify") {
        return { ok: true, data: { isList: true, pageType: "place", items: [
          { clientId: "c0", name: "Rintaro", type: "place" },
          { clientId: "c1", name: "Ippudo", type: "place" },
          { clientId: "c2", name: "Chuko", type: "place" },
          { clientId: "c3", name: "Okonomi", type: "place" },
        ] } } as never;
      }
      if (msg.type === "rank") {
        rankCalls++;
        if (rankCalls === 1) throw new Error("rank failed"); // first run fails at rank
        return new Promise<BackgroundReply<never>>((res) => { resolveSecond = res as (v: unknown) => void; }); // second run's rank hangs
      }
      return { ok: true, data: {} } as never;
    });
    document.body.innerHTML = RESTAURANT_GRID;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(rankCalls).toBe(1), { timeout: 3000 });
    // Trigger run 2 via a structural mutation.
    const container = document.querySelector(".results")!;
    const extra = document.createElement("div");
    extra.className = container.querySelector("div.card")!.className;
    extra.innerHTML = "<a href='/biz/new'><h3>New Ramen</h3></a><p>izakaya</p>";
    container.appendChild(extra);
    await vi.waitFor(() => expect(rankCalls).toBe(2), { timeout: 5000 });
    // Run 1's failure already threw inside its own gate scope — run 2's rank resolves.
    resolveSecond!({ ok: true, data: { pageResultId: "p2", status: "ranked", resolvedCount: 2,
      plan: { summary: { lifted: 1 }, ops: [{ op: "reorder", order: ["c0", "c1", "c2", "c3", "c4"] }, { op: "annotate", clientId: "c0", badge: "top-pick", text: "Top" }] } } });
    await vi.waitFor(() => expect(document.querySelector("[data-focal]")).not.toBeNull(), { timeout: 3000 });
  });
});

describe("R2-15h: settings traffic serialises through one queue", () => {
  it("runs queued work in order even when the first rejects", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const { enqueueSettings } = await import("../src/background");
    const order: string[] = [];
    const a = enqueueSettings(async () => { await new Promise((r) => setTimeout(r, 30)); order.push("a"); throw new Error("boom"); });
    const b = enqueueSettings(async () => { order.push("b"); return 1; });
    const c = enqueueSettings(async () => { order.push("c"); return 2; });
    await expect(a).rejects.toThrow("boom");
    expect(await b).toBe(1);
    expect(await c).toBe(2);
    expect(order).toEqual(["a", "b", "c"]);
  });
});
