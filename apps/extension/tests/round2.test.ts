import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { applyPlan } from "../src/apply/apply";
import { cityHints, detectList, extractSnippets } from "../src/detect/detect";
import type { RenderPlan, RenderOp } from "../src/types";
import { BOOK_LIST } from "./fixtures";

const page = (html: string) => new JSDOM(`<body>${html}</body>`, { url: "https://www.example.com/" }).window.document;

const plan = (ops: RenderOp[], lifted = 1): RenderPlan => ({
  id: "p1",
  pageId: "page1",
  createdAt: "2026-10-20T00:00:00Z",
  ops,
  summary: { moved: lifted, collapsed: 0, unresolved: 0, avgMovement: 0, lifted },
});

const titles = (els: Iterable<Element>) => [...els].map((el) => el.querySelector("h3, b")?.textContent ?? el.className);

describe("RR-1: move-mode undo restores originals before newer nodes", () => {
  it("inserts originals ahead of a node the site appended after apply", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c4", "c3", "c0", "c1", "c2"] }], 2));
    expect(handle.mode).toBe("move");
    // The site appends a fresh card after our reorder.
    const newer = d.createElement("li");
    newer.innerHTML = '<a href="/book/9"><b>New Arrival</b></a>';
    list.container.appendChild(newer);
    handle.undo();
    const kids = [...list.container.children];
    expect(kids.indexOf(newer)).toBe(kids.length - 1);
    expect(titles(kids.slice(0, 5))).toEqual(["The Overstory", "Piranesi", "Klara and the Sun", "Circe", "Pachinko"]);
  });
});

describe("RR-7: collapse hides with !important and restores", () => {
  it("sets display none as important; Show clears it", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const hidden = [...list.cards.values()][0] as HTMLElement;
    applyPlan(list, plan([{ op: "collapse", clientIds: ["c0"], label: "1 folded" }] as RenderOp[], 0));
    expect(hidden.style.getPropertyValue("display")).toBe("none");
    expect(hidden.style.getPropertyPriority("display")).toBe("important");
    const show = list.container.querySelector<HTMLElement>('button[data-focal="show"]')!;
    show.click();
    expect(hidden.style.getPropertyPriority("display")).toBe("");
    expect(hidden.style.getPropertyValue("display")).not.toBe("none");
  });
});

describe("RR-12: move-mode only re-appends nodes whose position changed", () => {
  it("touches only the moved cards", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const moves: string[] = [];
    const orig = list.container.insertBefore.bind(list.container);
    list.container.insertBefore = ((node: Node, ref: Node | null) => {
      moves.push((node as Element).querySelector("b")?.textContent ?? "?");
      return orig(node, ref);
    }) as typeof list.container.insertBefore;
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c4", "c0", "c1", "c2", "c3"] }]));
    expect(moves).toEqual(["Pachinko"]);
  });
});

describe("[data-focal] nodes are invisible to detection", () => {
  it("extractSnippets skips injected focal subtrees", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const card = [...list.cards.values()][0]!;
    card.insertAdjacentHTML("afterbegin", '<focal-label data-focal="label"><span>Top pick for you</span></focal-label>');
    const snippets = extractSnippets(card);
    expect(snippets.join("|")).not.toContain("Top pick for you");
    expect(snippets).toContain("The Overstory");
  });

  it("card shape/grouping ignores injected focal children", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const before = [...list.cards.values()];
    for (const card of before) card.insertAdjacentHTML("afterbegin", '<div data-focal="strip">focal</div>');
    const again = detectList(d)!;
    expect([...again.cards.values()]).toEqual(before);
    expect(again.cards.size).toBe(before.length);
  });
});

describe("layout TTL and invalidation", () => {
  it("expires entries older than 14 days and deletes them", async () => {
    const data: Record<string, unknown> = {
      layouts: {
        "yelp.com|/search|DIV.card": {
          fingerprint: "DIV.card",
          namePosition: { snippetIndex: 0 },
          type: "place",
          citySource: null,
          savedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    };
    const store = {
      get: async (key: string) => ({ [key]: data[key] }),
      set: async (obj: Record<string, unknown>) => {
        Object.assign(data, obj);
      },
    };
    vi.stubGlobal("chrome", { storage: { local: store } });
    vi.resetModules();
    const { getLayout } = await import("../src/layouts/store");
    expect(await getLayout("yelp.com|/search|DIV.card")).toBeNull();
    expect((data.layouts as Record<string, unknown>)["yelp.com|/search|DIV.card"]).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("marks a stored layout stale when the rank resolves nothing", async () => {
    const { shouldInvalidateLayout } = await import("../src/content");
    expect(shouldInvalidateLayout({ ok: true, data: { resolvedCount: 0 } })).toBe(true);
    expect(shouldInvalidateLayout({ ok: true, data: { resolvedCount: 3 } })).toBe(false);
    expect(shouldInvalidateLayout({ ok: false })).toBe(false);
  });
});

describe("RR-4: sameList is order-sensitive", () => {
  it("moved known cards count as a fresh list", async () => {
    const { sameList, __setLastListForTests } = await import("../src/content");
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const a = [...list.cards.values()];
    __setLastListForTests(list);
    expect(sameList(list)).toBe(true);
    // same cards, different order — a fresh change, not "the same list"
    const reordered = { container: list.container, cards: new Map([...a].reverse().map((el, i) => [`r${i}`, el])) };
    expect(sameList(reordered as never)).toBe(false);
    __setLastListForTests(null);
  });
});
