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
    expect(titles(byOrder)).toEqual(["Chuko", "Rintaro", "ad-slot", "Ippudo", "Okonomi"]);
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
    const onUndo = vi.fn();
    const handle = applyPlan(
      list,
      plan([
        { op: "reorder", containerId: "x", order: ["c3", "c0", "c1", "c2", "c4"] },
        { op: "annotate", containerId: "x", clientId: "c3", text: "Top pick for you", badge: "top-pick" },
        { op: "emphasize", containerId: "x", clientId: "c3", level: "high" },
        { op: "collapse", containerId: "x", clientIds: ["c4"], label: "1 hidden by your rules (chain)" },
      ]),
      { onUndo },
    );
    expect(d.querySelector('[data-focal="strip"]')).not.toBeNull();
    d.querySelector<HTMLButtonElement>('[data-focal="undo"]')!.click();
    expect(handle.active).toBe(false);
    expect(onUndo).toHaveBeenCalledOnce();
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
