import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { applyPlan } from "../src/apply/apply";
import { detectList } from "../src/detect/detect";
import type { RenderPlan, RenderOp } from "../src/types";
import { BOOK_LIST, RESTAURANT_GRID } from "./fixtures";

const page = (html: string) => new JSDOM(`<body>${html}</body>`, { url: "https://www.example.com/" }).window.document;

const plan = (ops: RenderOp[], lifted = 1): RenderPlan => ({
  id: "p1",
  pageId: "page1",
  createdAt: "2026-10-20T00:00:00Z",
  ops,
  summary: { moved: lifted, collapsed: 0, unresolved: 0, avgMovement: 0, lifted },
});

const titles = (els: Iterable<Element>) => [...els].map((el) => el.querySelector("h3, b")?.textContent ?? el.className);

describe("applyPlan", () => {
  it("uses CSS order for grid containers without moving nodes", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d)!;
    const before = [...list.container.children];
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] }]));
    expect(handle.mode).toBe("css-order");
    expect([...list.container.children]).toEqual(before);
    const byOrder = before.slice().sort((a, b) => Number((a as HTMLElement).style.order) - Number((b as HTMLElement).style.order));
    // R6-9: only the lifted prefix gets an order — everything else keeps DOM order.
    expect(titles(byOrder)).toEqual(["Chuko", "Rintaro", "Ippudo", "ad-slot", "Okonomi"]);
  });

  it("css-order keeps a site's own order on non-lifted children; a prepend stays first among the rest", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d)!;
    // The site gave a card its own order — R6-9 leaves it untouched.
    const third = list.container.children[2] as HTMLElement;
    third.style.setProperty("order", "5");
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] }], 1));
    expect(third.style.getPropertyValue("order")).toBe("5");
    // A site-prepended card (no order) sorts after the lifted prefix.
    const extra = document.createElement("div");
    extra.className = "card";
    list.container.prepend(extra);
    const ordered = [...list.container.children].sort((a, b) => (Number((a as HTMLElement).style.order) || 0) - (Number((b as HTMLElement).style.order) || 0));
    expect(titles(ordered)[0]).toBe("Chuko");
    expect(ordered.indexOf(extra)).toBeGreaterThan(0);
  });

  it("moves nodes for block lists and keeps non-card siblings in their slots", () => {
    const d = page(BOOK_LIST.replace("<li><a href=\"/book/3\">", '<li class="sep">—</li><li><a href="/book/3">'));
    const list = detectList(d)!;
    const handle = applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c4", "c3"] }], 2));
    expect(handle.mode).toBe("move");
    expect(titles(list.container.children)).toEqual(["Pachinko", "Circe", "sep", "The Overstory", "Piranesi", "Klara and the Sun"]);
  });

  it("keeps cards the plan doesn't know in their place among the others", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c3", "c0", "c4"] }], 1));
    expect(titles(list.container.children)).toEqual(["Circe", "The Overstory", "Piranesi", "Klara and the Sun", "Pachinko"]);
  });

  it("puts labels in the text column of side-by-side cards", () => {
    const cards = ["Dune", "Emma", "Ulysses"].map((t, i) => `<li><div style="display:flex"><div><a href="/t/${i}"><img alt="${t} poster"></a></div><div><a href="/t/${i}"><h3>${t}</h3></a><span>2021</span></div></div></li>`).join("");
    const d = page(`<ul>${cards}</ul>`);
    const list = detectList(d)!;
    applyPlan(list, plan([{ op: "annotate", containerId: "x", clientId: "c1", text: "Top pick for you", badge: "top-pick" }], 0));
    const label = d.querySelector('[data-focal="label"]')!;
    expect(label.nextElementSibling!.querySelector("h3")!.textContent).toBe("Emma");
  });

  it("puts labels inside a cell for table rows", () => {
    const rows = ["Dune", "Emma", "Ulysses", "Beloved"].map((t, i) => `<tr><td>${i + 1}</td><td><a href="/book/${i}"><b>${t}</b></a><span>Author ${i}</span></td><td>4.${i}</td></tr>`).join("");
    const d = page(`<table><tbody>${rows}</tbody></table>`);
    const list = detectList(d)!;
    expect(list.container.tagName).toBe("TBODY");
    const handle = applyPlan(
      list,
      plan([
        { op: "reorder", containerId: "x", order: ["c2", "c0", "c1", "c3"] },
        { op: "annotate", containerId: "x", clientId: "c2", text: "Top pick for you", badge: "top-pick" },
        { op: "collapse", containerId: "x", clientIds: ["c3"], label: "1 hidden by your rules" },
      ]),
    );
    expect(d.querySelector('[data-focal="fold"]')!.closest("tr")!.parentElement!.tagName).toBe("TBODY");
    const label = d.querySelector('[data-focal="label"]')!;
    expect(label.parentElement!.tagName).toBe("TD");
    expect(d.querySelector('[data-focal="strip"]')!.nextElementSibling!.tagName).toBe("TABLE");
    expect([...d.querySelectorAll("tr")].every((tr) => [...tr.children].every((c) => c.tagName === "TD"))).toBe(true);
    handle.undo();
    expect(d.querySelector('[data-focal="label"]')).toBeNull();
  });

  it("Undo restores the original DOM order and removes everything focal added", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const container = list.container;
    const originalHtml = container.outerHTML;
    const onUserUndo = vi.fn();
    const handle = applyPlan(
      list,
      plan([
        { op: "reorder", containerId: "x", order: ["c3", "c0", "c1", "c2", "c4"] },
        { op: "annotate", containerId: "x", clientId: "c3", text: "Top pick for you", badge: "top-pick" },
        { op: "emphasize", containerId: "x", clientId: "c3", level: "high" },
        { op: "collapse", containerId: "x", clientIds: ["c4"], label: "1 hidden by your rules (chain)" },
      ]),
      { onUserUndo },
    );
    expect(d.querySelector('[data-focal="strip"]')).not.toBeNull();
    d.querySelector<HTMLButtonElement>('[data-focal="undo"]')!.click();
    expect(handle.active).toBe(false);
    expect(onUserUndo).toHaveBeenCalledOnce();
    expect(container.outerHTML).toBe(originalHtml);
    expect(d.querySelector("[data-focal]")).toBeNull();
  });

  it("site click handlers still work after reordering", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    const clicked = vi.fn();
    list.cards.get("c2")!.querySelector("a")!.addEventListener("click", (e) => {
      e.preventDefault();
      clicked();
    });
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c2"] }]));
    (list.container.firstElementChild!.querySelector("a") as HTMLAnchorElement).click();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("adds labels with the badge and fold lines with Show", () => {
    const d = page(BOOK_LIST);
    const list = detectList(d)!;
    applyPlan(
      list,
      plan(
        [
          { op: "annotate", containerId: "x", clientId: "c1", text: "Good match · because you like Circe", badge: "good-match" },
          { op: "collapse", containerId: "x", clientIds: ["c3", "c4"], label: "2 hidden by your rules (chain)" },
        ],
        0,
      ),
    );
    const label = list.cards.get("c1")!.firstElementChild!;
    expect(label.getAttribute("data-badge")).toBe("good-match");
    expect(label.shadowRoot!.textContent).toBe("Good match · because you like Circe");
    const c3 = list.cards.get("c3") as HTMLElement;
    expect(c3.style.display).toBe("none");
    const fold = d.querySelector('[data-focal="fold"]')!;
    expect(fold.nextElementSibling).toBe(c3);
    expect(fold.textContent).toContain("2 hidden by your rules (chain)");
    fold.querySelector("button")!.click();
    expect(c3.style.display).toBe("");
    expect(d.querySelector('[data-focal="fold"]')).toBeNull();
  });

  it("Why this order? calls back", () => {
    const d = page(BOOK_LIST);
    const onWhy = vi.fn();
    applyPlan(detectList(d)!, plan([{ op: "reorder", containerId: "x", order: ["c1"] }]), { onWhy });
    d.querySelector<HTMLButtonElement>('[data-focal="why"]')!.click();
    expect(onWhy).toHaveBeenCalledOnce();
    expect(d.querySelector('[data-focal="strip-text"]')!.textContent).toBe("focal lifted 1 match for your taste");
  });

  it("Undo restores grid order styles", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d)!;
    const html = list.container.outerHTML;
    applyPlan(list, plan([{ op: "reorder", containerId: "x", order: ["c3"] }])).undo();
    expect(list.container.outerHTML).toBe(html);
  });
});

describe("R10-2: focalClickTrusted", () => {
  it("accepts trusted keyboard activation, rejects untrusted/occluded/out-of-host", async () => {
    const { focalClickTrusted } = await import("../src/apply/apply");
    const host = document.createElement("div");
    const btn = document.createElement("button");
    host.appendChild(btn);
    document.body.appendChild(host);

    const ev = (init: Partial<MouseEvent>) => init as MouseEvent;

    // untrusted synthetic events never count
    expect(focalClickTrusted(ev({ isTrusted: false, detail: 1, clientX: 1, clientY: 1, currentTarget: btn }), host)).toBe(false);
    // keyboard activation (detail 0) only needs isTrusted
    expect(focalClickTrusted(ev({ isTrusted: true, detail: 0, currentTarget: btn }), host)).toBe(true);

    // pointer click: stub the point/geometry the production predicate reads
    const r = { left: 10, top: 10, right: 50, bottom: 30, width: 40, height: 20, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
    btn.getBoundingClientRect = () => r;
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.elementsFromPoint = () => [btn];
    const click = ev({ isTrusted: true, detail: 1, clientX: 20, clientY: 20, currentTarget: btn });
    expect(focalClickTrusted(click, host)).toBe(true);

    // occluded: another element is topmost at the point
    const overlay = document.createElement("div");
    document.elementsFromPoint = () => [overlay];
    expect(focalClickTrusted(click, host)).toBe(false);
    document.elementsFromPoint = () => [btn];

    // invisible ancestor (opacity 0)
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => ({ visibility: "visible", opacity: el === host ? "0" : "1" }) as CSSStyleDeclaration);
    expect(focalClickTrusted(click, host)).toBe(false);
    vi.restoreAllMocks();

    // button rect outside the host rect
    host.getBoundingClientRect = () => ({ left: 500, top: 500, right: 600, bottom: 600, width: 100, height: 100, x: 500, y: 500, toJSON: () => ({}) }) as DOMRect;
    expect(focalClickTrusted(click, host)).toBe(false);
  });
});

describe("R10-3: fold Show restores the full style attribute", () => {
  it("a folded card with inline style is visible after Show", async () => {
    const { applyPlan, __setTrustCheckForTests } = await import("../src/apply/apply");
    __setTrustCheckForTests(() => true);
    document.body.innerHTML = "<main><div class='cards'><div class='card' style='color:red'>A</div><div class='card'>B</div></div></main>";
    const cards = document.querySelectorAll<HTMLElement>(".card");
    const container = document.querySelector<HTMLElement>(".cards")!;
    const plan = { ops: [{ op: "collapse", clientIds: ["c0"], label: "2 hidden" }], pageId: "p", createdAt: "", summary: {} } as never;
    const handle = applyPlan({ container, cards: new Map([["c0", cards[0]!]]) }, plan, {});
    expect(cards[0]!.style.display).toBe("none");
    const show = document.querySelector<HTMLButtonElement>("[data-focal='fold'] button")!;
    show.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cards[0]!.style.display).not.toBe("none");
    expect(cards[0]!.style.color).toBe("red"); // the original inline style survives
    __setTrustCheckForTests(() => true);
  });
});

describe("R13-RT-3: css-order assigns order to the lifted CARDS", () => {
  it("a promo tile keeps no order; only the 3 lifted cards get negative orders", async () => {
    const { applyPlan } = await import("../src/apply/apply");
    document.body.innerHTML = "<main><div class='grid'><div class='promo'>AD</div><div class='card'>A</div><div class='card'>B</div><div class='card'>C</div><div class='card'>D</div></div></main>";
    const container = document.querySelector<HTMLElement>(".grid")!;
    const promo = container.children[0]!;
    const cardEls = [...container.querySelectorAll<HTMLElement>(".card")];
    const plan = {
      ops: [{ op: "reorder", containerId: "c", order: ["c1", "c2", "c3", "c0"] }],
      summary: { lifted: 3 },
    } as never;
    container.style.display = "grid"; // isFlexOrGrid -> css-order (jsdom needs the inline hint)
    applyPlan({ container, cards: new Map([["c0", cardEls[0]!], ["c1", cardEls[1]!], ["c2", cardEls[2]!], ["c3", cardEls[3]!]]) }, plan, {});
    expect((promo as HTMLElement).style.getPropertyValue("order")).toBe("");
    const orders = cardEls.map((c) => c.style.getPropertyValue("order"));
    // c1,c2,c3 lifted -> -3,-2,-1; c0 untouched; the promo tile gets nothing.
    expect(orders).toEqual(["", "-3", "-2", "-1"]);
  });
});
