import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDbForTests } from "@/lib/server/db";
import { __setIdentifierForTests, type Identifier, type PageAnswer } from "@/lib/server/page/identify";
import {
  applyLayout,
  deriveLayout,
  __setLayoutStoreForTests,
  type LayoutStore,
  type SavableLayout,
  type StoredLayout,
} from "@/lib/server/page/layout";
import type { IdentifyBody } from "@/lib/server/page/schemas";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

process.env.QLOO_MOCK = "1";
process.env.FOCAL_DEV_SESSION = "1";

const body = (cards: { clientId: string; snippets: string[] }[], cityHints: string[] = []): IdentifyBody => ({
  host: "yelp.com",
  pathPattern: "/search",
  signature: "DIV.card",
  cityHints,
  cards: cards.map((c) => ({ clientId: c.clientId, snippets: c.snippets, links: [] })),
});

const answer = (cards: { clientId: string; name: string | null; type?: string | null; city?: string | null; confidence: number }[]): PageAnswer => ({
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
  it("learns the majority snippet position with type and city source", () => {
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
    const layout = deriveLayout(b, a);
    expect(layout).toEqual({
      hostname: "yelp.com",
      pathPattern: "/search",
      fingerprint: "DIV.card",
      namePosition: { snippetIndex: 0 },
      type: "place",
      citySource: { hintIndex: 0 },
      confidence: 0.8,
    });
  });

  it("does not save below 3 confident cards", () => {
    const b = body([0, 1].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })));
    const a = answer([confident("c0", "Place 0"), confident("c1", "Place 1")]);
    expect(deriveLayout(b, a)).toBeNull();
  });

  it("does not save below 0.8 name agreement", () => {
    const b = body([0, 1, 2, 3].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`, `Area ${i}`] })));
    const a = answer([
      confident("c0", "Place 0"),
      confident("c1", "Place 1"),
      confident("c2", "Place 2"),
      confident("c3", "Area 3"),
    ]);
    expect(deriveLayout(b, a)).toBeNull(); // 3/4 = 0.75
  });

  it("ignores low-confidence and off-type cards", () => {
    const b = body([0, 1, 2, 3].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })));
    const a = answer([
      confident("c0", "Place 0"),
      confident("c1", "Place 1"),
      confident("c2", "Place 2"),
      confident("c3", "Place 3", { confidence: 0.5 }),
      confident("c4", "Elsewhere", { type: "movie" }),
    ]);
    const layout = deriveLayout(b, a);
    expect(layout?.namePosition).toEqual({ snippetIndex: 0 });
    expect(layout?.type).toBe("place");
    expect(layout?.confidence).toBe(1);
  });

  it("drops citySource when cards disagree on the hint", () => {
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
    expect(layout?.citySource).toBeNull(); // 3/4 = 0.75 on the winning hint
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

describe("applyLayout", () => {
  const layout = {
    fingerprint: "DIV.card",
    namePosition: { snippetIndex: 1 },
    type: "place",
    citySource: { hintIndex: 0 },
  };

  it("names cards from the learned snippet and hint", () => {
    const b = body(
      [0, 1, 2].map((i) => ({ clientId: `c${i}`, snippets: [`Area ${i}`, `Place ${i}`] })),
      ["San Francisco"],
    );
    expect(applyLayout(layout, b)).toEqual({
      isList: true,
      pageType: "place",
      items: [0, 1, 2].map((i) => ({ clientId: `c${i}`, name: `Place ${i}`, type: "place", city: "San Francisco" })),
    });
  });

  it("skips cards missing the learned position and needs ≥ 3 items", () => {
    const b = body([
      { clientId: "c0", snippets: ["Area 0", "Place 0"] },
      { clientId: "c1", snippets: ["Area 1", "Place 1"] },
      { clientId: "c2", snippets: ["only"] },
    ]);
    expect(applyLayout(layout, b)).toBeNull();
  });

  it("returns null for a malformed stored layout", () => {
    const b = body([0, 1, 2].map((i) => ({ clientId: `c${i}`, snippets: [`Place ${i}`] })));
    expect(applyLayout({ ...layout, namePosition: { wrong: 1 } }, b)).toBeNull();
    expect(applyLayout({ ...layout, type: "not_a_type" }, b)).toBeNull();
  });
});

function memoryLayoutStore(): LayoutStore & { rows: Map<string, StoredLayout> } {
  const rows = new Map<string, StoredLayout>();
  let n = 0;
  return {
    rows,
    async find(hostname, pathPattern, fingerprint) {
      return rows.get(`${hostname}|${pathPattern}|${fingerprint}`) ?? null;
    },
    async save(layout: SavableLayout) {
      const key = `${layout.hostname}|${layout.pathPattern}|${layout.fingerprint}`;
      const row: StoredLayout = { id: `l${++n}`, learnedAt: new Date().toISOString(), ...layout };
      rows.set(key, row);
      return row;
    },
  };
}

describe("POST /api/page/identify with a layout store", () => {
  let identifyPOST: (req: Request) => Promise<Response>;
  let store: ReturnType<typeof memoryLayoutStore>;

  beforeAll(async () => {
    __setDbForTests(null);
    identifyPOST = (await import("@/app/api/page/identify/route")).POST;
  });
  beforeEach(() => {
    __resetRateLimitForTests();
    store = memoryLayoutStore();
    __setLayoutStoreForTests(store);
  });
  afterEach(() => {
    __setIdentifierForTests(undefined);
    __setLayoutStoreForTests(undefined);
  });

  const post = (b: unknown) =>
    identifyPOST(
      new Request("http://localhost/api/page/identify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer dev-token" },
        body: JSON.stringify(b),
      }),
    );

  const NAMES = ["Rintaro", "Ippudo", "Chuko", "Okonomi"];
  const listBody = () =>
    body(
      NAMES.map((name, i) => ({ clientId: `c${i}`, snippets: [name, "Ramen · $$"] })),
      ["San Francisco"],
    );
  const countingIdentifier = (): Identifier & { calls: number } => {
    const id: Identifier & { calls: number } = {
      calls: 0,
      async identify(b) {
        id.calls += 1;
        return {
          isList: true,
          cards: b.cards.map((c, i) => ({
            clientId: c.clientId,
            name: c.snippets[0] ?? null,
            type: "place" as const,
            city: b.cityHints[0] ?? null,
            confidence: 0.95,
          })),
        };
      },
    };
    return id;
  };

  it("learns the layout on first identify and skips the identifier on the second", async () => {
    const identifier = countingIdentifier();
    __setIdentifierForTests(identifier);

    const first = await (await post(listBody())).json();
    expect(first.isList).toBe(true);
    expect(first.layout).toEqual({
      fingerprint: "DIV.card",
      namePosition: { snippetIndex: 0 },
      type: "place",
      citySource: { hintIndex: 0 },
    });
    expect(identifier.calls).toBe(1);
    expect(store.rows.size).toBe(1);

    const second = await (await post(listBody())).json();
    expect(identifier.calls).toBe(1);
    expect(second.isList).toBe(true);
    expect(second.pageType).toBe("place");
    expect(second.items.map((i: { name: string }) => i.name)).toEqual(NAMES);
    expect(second.items[0].city).toBe("San Francisco");
    expect(second.layout).toEqual(first.layout);
  });

  it("still calls the identifier when the stored layout cannot cover the page", async () => {
    const identifier = countingIdentifier();
    __setIdentifierForTests(identifier);
    await post(listBody());
    const different = { ...listBody(), signature: "LI.tile", cards: listBody().cards };
    const res = await (await post(different)).json();
    expect(identifier.calls).toBe(2);
    expect(res.isList).toBe(true);
  });
});
