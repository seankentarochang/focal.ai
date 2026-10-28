import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundReply, ContentMessage, LearnedLayout } from "../src/api";
import { applyLayout } from "../src/layouts/apply";
import { getLayout, layoutKey, saveLayout } from "../src/layouts/store";
import { RESTAURANT_GRID } from "./fixtures";

const CARDS = ["Rintaro", "Ippudo", "Chuko", "Okonomi"].map((name, i) => ({
  clientId: `c${i}`,
  snippets: [name, "Ramen · $$"],
  links: [],
}));

const LAYOUT: LearnedLayout = {
  fingerprint: "DIV.card",
  namePosition: { snippetIndex: 0 },
  type: "place",
  citySource: null,
};

/** chrome.* stand-in over an in-memory storage map. */
function stubChrome(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...seed };
  const sent: ContentMessage[] = [];
  const area = {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (obj: Record<string, unknown>) => {
      Object.assign(data, obj);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
  vi.stubGlobal("chrome", {
    storage: { local: area, session: area },
    runtime: {
      sendMessage: vi.fn(async (msg: ContentMessage): Promise<BackgroundReply<never>> => {
        sent.push(msg);
        if (msg.type === "identify") {
          return {
            ok: true,
            data: { isList: true, pageType: "place", items: [], layout: LAYOUT },
          } as never;
        }
        return { ok: true, data: { pageResultId: null, status: "no_signals", plan: null } } as never;
      }),
    },
    extension: { inIncognitoContext: false },
    tabs: { create: vi.fn() },
  });
  return { data, sent };
}

describe("layouts store", () => {
  beforeEach(() => stubChrome());

  it("round-trips a layout by host|pathPattern|signature", async () => {
    const key = layoutKey("yelp.com", "/search", "DIV.card");
    expect(await getLayout(key)).toBeNull();
    await saveLayout(key, LAYOUT);
    const stored = await getLayout(key);
    expect(stored).toMatchObject(LAYOUT);
    expect(typeof stored?.savedAt).toBe("string");
  });

  it("caps at 200 entries, dropping the oldest savedAt", async () => {
    for (let i = 0; i < 205; i += 1) {
      const savedAt = new Date(2026, 0, 1, 0, 0, i).toISOString();
      await saveLayout(`k${i}`, { ...LAYOUT });
      // saveLayout stamps its own savedAt; backdate it directly for ordering.
      const { layouts } = await chrome.storage.local.get("layouts");
      (layouts as Record<string, { savedAt: string }>)[`k${i}`]!.savedAt = savedAt;
      await chrome.storage.local.set({ layouts });
    }
    const { layouts } = await chrome.storage.local.get("layouts");
    const keys = Object.keys(layouts as Record<string, unknown>);
    expect(keys).toHaveLength(200);
    expect(keys).not.toContain("k0");
    expect(keys).toContain("k204");
  });
});

describe("applyLayout (extension port)", () => {
  it("names items from the learned snippet position", () => {
    const out = applyLayout(LAYOUT, CARDS, []);
    expect(out).toEqual({
      pageType: "place",
      items: CARDS.map((c, i) => ({ clientId: `c${i}`, name: c.snippets[0], type: "place" })),
    });
  });

  it("attaches the hinted city and needs ≥ 3 items", () => {
    const withCity = { ...LAYOUT, citySource: { hintIndex: 0 } };
    const out = applyLayout(withCity, CARDS, ["San Francisco"]);
    expect(out?.items[0]?.city).toBe("San Francisco");
    expect(applyLayout(withCity, CARDS.slice(0, 2), ["San Francisco"])).toBeNull();
  });
});

describe("run() with a stored layout", () => {
  it("skips the identify message and sends rank directly", async () => {
    const key = layoutKey("yelp.com", "/search", "DIV.card");
    const { sent } = stubChrome({ layouts: { [key]: { ...LAYOUT, savedAt: new Date().toISOString() } } });
    document.body.innerHTML = RESTAURANT_GRID;

    await import("../src/content");

    await vi.waitFor(() => expect(sent.some((m) => m.type === "rank")).toBe(true), { timeout: 2000 });
    expect(sent.some((m) => m.type === "identify")).toBe(false);
    const rank = sent.find((m) => m.type === "rank");
    expect(rank?.type === "rank" && rank.body.pageType).toBe("place");
    expect(rank?.type === "rank" && rank.body.items.map((i) => i.name)).toEqual([
      "Rintaro",
      "Ippudo",
      "Chuko",
      "Okonomi",
    ]);
  });
});
