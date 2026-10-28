import { describe, expect, it } from "vitest";
import { deriveLayout } from "@/lib/server/page/layout";
import type { PageAnswer } from "@/lib/server/page/identify";
import type { IdentifyBody } from "@/lib/server/page/schemas";

const body = (cards: { clientId: string; snippets: string[] }[], cityHints: string[] = []): IdentifyBody => ({
  host: "yelp.com",
  pathPattern: "/search",
  signature: "DIV.card",
  cityHints,
  cards: cards.map((c) => ({ clientId: c.clientId, snippets: c.snippets })),
});

const answer = (
  cards: { clientId: string; name: string | null; type?: string | null; city?: string | null; confidence: number }[],
): PageAnswer => ({
  isList: true,
  cards: cards.map((c) => ({
    clientId: c.clientId,
    name: c.name,
    type: (c.type ?? "place") as PageAnswer["cards"][number]["type"],
    city: c.city ?? null,
    confidence: c.confidence,
  })),
});

const confident = (clientId: string, name: string, over: Record<string, unknown> = {}) => ({
  clientId,
  name,
  confidence: 0.9,
  ...over,
});

describe("deriveLayout", () => {
  it("learns the layout when every confident card agrees on type", () => {
    const b = body(
      [0, 1, 2, 3, 4].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`, `Area ${i}`] })),
      ["San Francisco"],
    );
    const a = answer([
      confident("c0", "Place 0", { city: "San Francisco" }),
      confident("c1", "Place 1", { city: "San Francisco" }),
      confident("c2", "Place 2", { city: "San Francisco" }),
      confident("c3", "Area 3", { city: "San Francisco" }),
      confident("c4", "Place 4", { city: "San Francisco" }),
    ]);
    expect(deriveLayout(b, a)).toEqual({
      fingerprint: "DIV.card",
      namePosition: { snippetIndex: 0 },
      type: "place",
      citySource: { hintIndex: 0 },
    });
  });

  it("needs at least 3 confident cards", () => {
    const b = body([0, 1].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })));
    const a = answer([confident("c0", "Place 0"), confident("c1", "Place 1")]);
    expect(deriveLayout(b, a)).toBeNull();
  });

  it("rejects below 0.8 name agreement", () => {
    const b = body([0, 1, 2, 3].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`, `Area ${i}`] })));
    const a = answer([
      confident("c0", "Place 0"),
      confident("c1", "Place 1"),
      confident("c2", "Place 2"),
      confident("c3", "Area 3"),
    ]);
    expect(deriveLayout(b, a)).toBeNull(); // 3/4 = 0.75
  });

  it("rejects when a confident card has a different type", () => {
    const b = body([0, 1, 2, 3].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })));
    const a = answer([
      confident("c0", "Place 0"),
      confident("c1", "Place 1"),
      confident("c2", "Place 2"),
      confident("c3", "Elsewhere", { type: "movie" }),
    ]);
    expect(deriveLayout(b, a)).toBeNull();
  });

  it("ignores low-confidence cards", () => {
    const b = body([0, 1, 2, 3].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })));
    const a = answer([
      confident("c0", "Place 0"),
      confident("c1", "Place 1"),
      confident("c2", "Place 2"),
      confident("c3", "Place 3", { confidence: 0.5 }),
    ]);
    const layout = deriveLayout(b, a);
    expect(layout?.namePosition).toEqual({ snippetIndex: 0 });
    expect(layout?.type).toBe("place");
  });

  it("drops citySource when a confident card disagrees or has a null city", () => {
    const b = body(
      [0, 1, 2, 3].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })),
      ["San Francisco", "Oakland"],
    );
    const a = answer([
      confident("c0", "Place 0", { city: "San Francisco" }),
      confident("c1", "Place 1", { city: "Oakland" }),
      confident("c2", "Place 2", { city: "San Francisco" }),
      confident("c3", "Place 3", { city: null }),
    ]);
    const layout = deriveLayout(b, a);
    expect(layout?.namePosition).toEqual({ snippetIndex: 0 });
    expect(layout?.citySource).toBeNull();
  });

  it("never gives a citySource to non-location types", () => {
    const b = body([0, 1, 2].map((i) => ({ clientId: `c${i}`, snippets: [`Book ${i}`] })), ["London"]);
    const a = answer([
      confident("c0", "Book 0", { type: "book", city: "London" }),
      confident("c1", "Book 1", { type: "book", city: "London" }),
      confident("c2", "Book 2", { type: "book", city: "London" }),
    ]);
    expect(deriveLayout(b, a)?.citySource).toBeNull();
  });

  it("returns null when the page is not a list", () => {
    const b = body([{ clientId: "c0", snippets: ["Place 0"] }]);
    expect(deriveLayout(b, { isList: false, cards: [] })).toBeNull();
  });
});
