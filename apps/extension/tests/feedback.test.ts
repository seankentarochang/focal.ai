import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPlan } from "../src/apply/apply";
import type { RenderPlan } from "../src/types";
import { RESTAURANT_GRID } from "./fixtures";

function stubChrome(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...seed };
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
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onMessageExternal: { addListener: vi.fn() },
      getManifest: () => ({ version: "0.1.0" }),
    },
    extension: { inIncognitoContext: false },
    tabs: { create: vi.fn(), query: vi.fn(async () => []) },
  });
  return { data };
}

describe("feedback buttons on lifted labels", () => {
  beforeEach(() => stubChrome());

  const plan: RenderPlan = {
    id: "p1",
    pageId: "pg1",
    createdAt: new Date().toISOString(),
    summary: { moved: 0, collapsed: 0, unresolved: 0, avgMovement: 0, lifted: 1 },
    ops: [{ op: "annotate", clientId: "c0", text: "Top pick for you" }],
  };

  it("a tap on More like this / Not for me fires onFeedback with the verdict", () => {
    document.body.innerHTML = RESTAURANT_GRID;
    const card = document.querySelector<HTMLElement>(".card")!;
    const container = card.parentElement!;
    const onFeedback = vi.fn();
    applyPlan({ container, cards: new Map([["c0", card]]) }, plan, { onFeedback });

    const more = card.querySelector<HTMLButtonElement>("button[data-focal-action='more']");
    const less = card.querySelector<HTMLButtonElement>("button[data-focal-action='less']");
    expect(more).toBeTruthy();
    expect(less).toBeTruthy();
    more!.click();
    expect(onFeedback).toHaveBeenCalledWith("c0", "more", expect.any(HTMLElement));
    less!.click();
    expect(onFeedback).toHaveBeenCalledWith("c0", "less", expect.any(HTMLElement));
  });

  it("does not add buttons without an onFeedback handler", () => {
    document.body.innerHTML = RESTAURANT_GRID;
    const card = document.querySelector<HTMLElement>(".card")!;
    applyPlan({ container: card.parentElement!, cards: new Map([["c0", card]]) }, plan, {});
    expect(card.querySelector("button[data-focal-action]")).toBeNull();
  });
});

describe("settings sync from the server", () => {
  it("maps skip/off rows into cached skipSites and siteOff", async () => {
    const { data } = stubChrome({ session: { token: "t", email: "a@b.c", savedAt: "x" }, settings: { skipSites: [], siteOff: [], incognito: true } });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ sites: [
      { hostname: "reddit.com", mode: "skip" },
      { hostname: "news.site", mode: "off" },
      { hostname: "fine.com", mode: "on" },
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const { refreshSettingsFromServer } = await import("../src/background");
    await refreshSettingsFromServer();

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/api/settings"), expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer t" }) }));
    expect((data.settings as { skipSites: string[] }).skipSites).toEqual(["reddit.com"]);
    expect((data.settings as { siteOff: string[] }).siteOff).toEqual(["news.site"]);
    // incognito stays local
    expect((data.settings as { incognito: boolean }).incognito).toBe(true);
  });

  it("set-site write-back PUTs the updated list", async () => {
    stubChrome({ session: { token: "t", email: "a@b.c", savedAt: "x" }, settings: { skipSites: [], siteOff: [], incognito: false } });
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "PUT") return new Response(JSON.stringify({ sites: [{ hostname: "yelp.com", mode: "off" }] }), { status: 200 });
      return new Response(JSON.stringify({ sites: [] }), { status: 200 });
    }));

    const { setSiteOnServer } = await import("../src/background");
    await setSiteOnServer("yelp.com", false);

    const putCall = calls.find((c) => c.method === "PUT");
    expect(putCall).toBeTruthy();
    expect((putCall!.body as { sites: unknown[] }).sites).toEqual([{ hostname: "yelp.com", mode: "off" }]);
  });
});
