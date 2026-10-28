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

describe("R4-11: no eager undo on rerun", () => {
  it("an infinite-scroll append keeps the strip and moves no seen item", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 3000 });
    await vi.waitFor(() => expect(document.querySelector("[data-focal='strip']")).not.toBeNull(), { timeout: 3000 });
    // Infinite scroll appends a fifth card — seen items must not be re-lifted.
    const container = document.querySelector(".results")!;
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/e'><h3>Epsilon</h3></a><p>Pizza</p>";
    container.appendChild(extra);
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(2), { timeout: 5000 });
    // The second plan is element-equivalent -> skipped: strip still present, no flicker.
    await new Promise((r) => setTimeout(r, 800));
    expect(document.querySelector("[data-focal='strip']")).not.toBeNull();
  });
});

describe("R5-6/R5-10: rerun lifecycle", () => {
  it("a swapped container with identical items is re-applied and orphans no strip", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 3000 });
    await vi.waitFor(() => expect(document.querySelector("[data-focal='strip']")).not.toBeNull(), { timeout: 3000 });
    // Whole-sale swap: same items, brand-new container.
    const main = document.querySelector("main")!;
    main.innerHTML = `<div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div>`;
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(2), { timeout: 5000 });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-focal='strip']").length).toBe(1), { timeout: 3000 });
  });

  it("a >60-card move-mode list survives a rerun without crashing", async () => {
    const { sent } = stubChrome();
    const cards = Array.from({ length: 65 }, (_, i) =>
      `<div class="card"><a href="/c${i}"><h3>Card ${i}</h3></a><p>Type ${i}</p></div>`).join("");
    document.body.innerHTML = `<main><div class="results">${cards}</div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 5000 });
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/c65'><h3>Card 65</h3></a><p>Type 65</p>";
    document.querySelector(".results")!.appendChild(extra);
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(2), { timeout: 5000 });
  });

  it("an appended card in css-order mode stays last", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results" style="display:grid">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(document.querySelector("[data-focal='strip']")).not.toBeNull(), { timeout: 3000 });
    const container = document.querySelector(".results")!;
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/e'><h3>Epsilon</h3></a><p>Pizza</p>";
    container.appendChild(extra);
    // Negative orders: every applied card sorts before the un-ordered newcomer.
    const lifted = document.querySelectorAll<HTMLElement>(".card[style*='order']");
    expect([...lifted].every((el) => parseInt(el.style.getPropertyValue("order"), 10) < 0)).toBe(true);
    expect((extra as HTMLElement).style.getPropertyValue("order")).toBe("");
  });

  it("a strip Undo survives a later mutation (no re-lift)", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(document.querySelector("[data-focal='undo']")).not.toBeNull(), { timeout: 3000 });
    (document.querySelector<HTMLElement>("[data-focal='undo']"))!.click();
    const container = document.querySelector(".results")!;
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/e'><h3>Epsilon</h3></a><p>Pizza</p>";
    container.appendChild(extra);
    await new Promise((r) => setTimeout(r, 1800));
    // userUndidFor: the appended card re-baselines instead of re-lifting.
    expect(sent.filter((m) => m.type === "rank").length).toBe(1);
    expect(document.querySelector("[data-focal='strip']")).toBeNull();
  });

  it("a late-offered plan labels in place while the reorder waits for the chip", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(document.querySelector("[data-focal='strip']")).not.toBeNull(), { timeout: 3000 });
    // jsdom rects are zero — pretend the container is visible so gen>1 plans
    // become late-offered.
    const rect = { width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };
    Element.prototype.getBoundingClientRect = () => rect as DOMRect;
    const container = document.querySelector(".results")!;
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/e'><h3>Epsilon</h3></a><p>Pizza</p>";
    container.appendChild(extra);
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(2), { timeout: 5000 });
    await vi.waitFor(() => expect(document.querySelector("[data-focal='label']")).not.toBeNull(), { timeout: 3000 });
  });
});

describe("R6-4/5/7/8: apply lifecycle", () => {
  it("a user Undo during an in-flight rank sticks (applyNow stands down)", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(document.querySelector("[data-focal='undo']")).not.toBeNull(), { timeout: 3000 });
    // Undo, then immediately trigger a rerun — the new apply must not re-lift.
    (document.querySelector<HTMLElement>("[data-focal='undo']"))!.click();
    const container = document.querySelector(".results")!;
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/e'><h3>Epsilon</h3></a><p>Pizza</p>";
    container.appendChild(extra);
    await new Promise((r) => setTimeout(r, 1800));
    expect(document.querySelector("[data-focal='strip']")).toBeNull();
    expect(sent.filter((m) => m.type === "rank").length).toBeLessThanOrEqual(2);
  });

  it("a late-offered label pass leaves the live arrangement untouched", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results" style="display:grid">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(document.querySelector("[data-focal='strip']")).not.toBeNull(), { timeout: 3000 });
    const rect = { width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) };
    Element.prototype.getBoundingClientRect = () => rect as DOMRect;
    const container = document.querySelector(".results")!;
    const orderBefore = [...container.children].map((c) => (c as HTMLElement).style.getPropertyValue("order")).join(",");
    const extra = document.createElement("div");
    extra.className = "card";
    extra.innerHTML = "<a href='/e'><h3>Epsilon</h3></a><p>Pizza</p>";
    container.appendChild(extra);
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(2), { timeout: 5000 });
    await vi.waitFor(() => expect(document.querySelector("[data-focal='label']")).not.toBeNull(), { timeout: 3000 });
    const orderAfter = [...container.children].map((c) => (c as HTMLElement).style.getPropertyValue("order")).join(",");
    expect(orderAfter.startsWith(orderBefore)).toBe(true); // arrangement untouched
  });

  it("a dead chip is retired on an early-return rerun", async () => {
    const { sent } = stubChrome();
    document.body.innerHTML = `<main><div class="results">
      <div class="card"><a href="/a"><h3>Alpha</h3></a><p>Thai</p></div>
      <div class="card"><a href="/b"><h3>Beta</h3></a><p>Japanese</p></div>
      <div class="card"><a href="/c"><h3>Gamma</h3></a><p>Ramen</p></div>
      <div class="card"><a href="/d"><h3>Delta</h3></a><p>Sushi</p></div>
    </div></main>`;
    prevMod = await import("../src/content");
    await vi.waitFor(() => expect(sent.filter((m) => m.type === "rank").length).toBe(1), { timeout: 3000 });
    // A second rerun fires but the site reverts to the same list -> early
    // return; a dead gate chip must be canceled, not left on the page.
    document.querySelector(".results")!.appendChild(Object.assign(document.createElement("div"), { className: "card", innerHTML: "<a href='/e'><h3>E</h3></a><p>X</p>" }));
    await new Promise((r) => setTimeout(r, 1500));
    expect(document.querySelectorAll("[data-focal='gate']").length).toBe(0);
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
