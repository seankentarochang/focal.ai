import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { cityHints, detectList, extractLinks, extractSnippets, snapshotCards } from "../src/detect/detect";
import { pathPattern } from "../src/api";
import { ARTICLE, BOOK_LIST, RESTAURANT_GRID } from "./fixtures";

const page = (html: string, url = "https://www.example.com/search") => new JSDOM(`<body>${html}</body>`, { url }).window.document;

describe("detectList", () => {
  it("finds the restaurant cards, not the nav or footer", () => {
    const d = page(RESTAURANT_GRID);
    const list = detectList(d);
    expect(list).not.toBeNull();
    expect(list!.container.className).toBe("results");
    expect([...list!.cards.keys()]).toEqual(["c0", "c1", "c2", "c3"]);
    expect([...list!.cards.values()].every((el) => el.classList.contains("card"))).toBe(true);
    expect(list!.signature).toBe("DIV.card");
  });

  it("finds a classless ul list", () => {
    const list = detectList(page(BOOK_LIST));
    expect(list?.container.tagName).toBe("UL");
    expect(list?.cards.size).toBe(5);
  });

  it("detects nothing on an article page", () => {
    expect(detectList(page(ARTICLE))).toBeNull();
  });

  it("needs at least 3 cards", () => {
    expect(detectList(page('<div><div class="c"><h3>One</h3><p>a b</p></div><div class="c"><h3>Two</h3><p>c d</p></div></div>'))).toBeNull();
  });

  it("ignores hidden groups", () => {
    const html = `<div hidden>${BOOK_LIST}</div>`;
    expect(detectList(page(html))).toBeNull();
  });
});

describe("extraction", () => {
  it("extracts ordered snippets, skipping buttons", () => {
    const d = page(RESTAURANT_GRID);
    const card = detectList(d)!.cards.get("c0")!;
    expect(extractSnippets(card)).toEqual(["Rintaro", "Japanese · $$", "82 Smith St"]);
  });

  it("caps snippets at 6 and 80 characters", () => {
    const long = "x".repeat(120);
    const d = page(`<div>${Array.from({ length: 9 }, (_, i) => `<p>Line ${i} ${long}</p>`).join("")}</div>`);
    const snippets = extractSnippets(d.querySelector("div")!);
    expect(snippets).toHaveLength(6);
    expect(snippets.every((s) => s.length <= 80)).toBe(true);
    expect(snippets[0]!.endsWith("…")).toBe(true);
  });

  it("keeps inline emphasis with its text", () => {
    const d = page("<div><p>The <b>Overstory</b> novel</p></div>");
    expect(extractSnippets(d.querySelector("div")!)).toEqual(["The Overstory novel"]);
  });

  it("extracts link hosts and paths without query strings", () => {
    const d = page(RESTAURANT_GRID, "https://www.yelp.com/search?find_desc=ramen");
    const list = detectList(d)!;
    expect(extractLinks(list.cards.get("c0")!)).toEqual([{ host: "resy.com", path: "/cities/ny/rintaro" }]);
    expect(extractLinks(list.cards.get("c1")!)).toEqual([{ host: "yelp.com", path: "/biz/ippudo" }]);
  });

  it("snapshots never include HTML", () => {
    const d = page(RESTAURANT_GRID);
    const snap = snapshotCards(detectList(d)!);
    expect(snap).toHaveLength(4);
    expect(JSON.stringify(snap)).not.toMatch(/<|class=/);
  });

  it("collects city hints from params, inputs and the heading", () => {
    const d = page(RESTAURANT_GRID, "https://www.yelp.com/search?find_desc=ramen&find_loc=Brooklyn%2C+NY");
    expect(cityHints(d)).toEqual(["Brooklyn, NY", "ramen", "Best ramen in Brooklyn"]);
  });
});

describe("pathPattern", () => {
  it("generalises ids and lowercases", () => {
    expect(pathPattern("/biz/12345/Reviews")).toBe("/biz/:id/reviews");
    expect(pathPattern("/list/3f2a9c1e-7b6d-4e1f-9a2b-1c2d3e4f5a6b")).toBe("/list/:id");
    expect(pathPattern("/Restaurants-g60763-New_York_City")).toBe("/:id");
    expect(pathPattern("/")).toBe("/");
  });
});
