import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

process.env.QLOO_MOCK = "1";
process.env.QLOO_API_KEY = "test-secret-key-that-must-not-leak";

// Entity ids from packages/qloo/fixtures/*.json (same as tests/server/routes.test.ts)
const RINTARO_ENTITY_ID = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
const STATE_BIRD_ENTITY_ID = "9C4D7E12-5F38-4A61-B7C0-2D8F1E5A9B42";
const FUGAZI_ENTITY_ID = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
// Tag id from packages/qloo/fixtures/tags-natural-wine.json
const NATURAL_WINE_TAG_ID = "urn:tag:cuisine:natural_wine";
const ENTITY_PLACE_TYPE = "urn:entity:place";

type RoutePost = (req: Request) => Promise<Response>;

let agentPOST: RoutePost;

beforeAll(async () => {
  agentPOST = (await import("@/app/api/agent/route")).POST;
});

beforeEach(() => {
  __resetRateLimitForTests();
});

function post(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const profile = {
  version: 1,
  updatedAt: "2026-10-17T00:00:00.000Z",
  seeds: [
    {
      entityId: FUGAZI_ENTITY_ID,
      name: "Fugazi",
      subtype: "urn:entity:artist",
      disambiguation: "Washington, D.C.",
      polarity: "like",
      weight: 1,
      source: "searched",
      addedAt: "2026-10-17T00:00:00.000Z",
    },
  ],
  rules: [],
};

const agentBody = {
  message: "rank this page",
  pageId: "test-page",
  pageType: ENTITY_PLACE_TYPE,
  locationQuery: "San Francisco",
  candidates: [
    { clientId: "c-0", name: "Rintaro", locationText: "San Francisco", originalIndex: 0 },
    {
      clientId: "c-1",
      name: "State Bird Provisions",
      locationText: "San Francisco",
      originalIndex: 1,
    },
    {
      clientId: "c-2",
      name: "Absolutely Not A Real Venue",
      locationText: "San Francisco",
      originalIndex: 2,
    },
  ],
  profile,
};

function tools(body: { steps: { tool: string }[] }): string[] {
  return body.steps.map((step) => step.tool);
}

describe("POST /api/agent", () => {
  it("ranks the page for a rank intent and records the insights request", async () => {
    const res = await agentPOST(post("/api/agent", { ...agentBody, message: "rank this page" }));

    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(body.steps[0].tool).toBe("get_taste_profile");
    expect(body.steps[0].summary).toBe("1 seeds (1 positive)");
    expect(tools(body)).toContain("score_candidates");
    expect(body.steps.every((step: { status: string }) => step.status === "ok")).toBe(true);

    expect(body.result.kind).toBe("rank");
    expect(body.result.ranked).toHaveLength(3);
    expect(
      body.result.ranked.filter((entry: { status: string }) => entry.status === "resolved"),
    ).toHaveLength(2);
    expect(body.result.meta.dataSource).toBe("mock");
    expect(typeof body.result.meta.durationMs).toBe("number");
    expect(body.result.meta.unresolved).toBe(1);
    expect(body.result.meta.qlooRequest.path).toBe("/v2/insights");
    expect(body.result.meta.qlooRequest.params["filter.type"]).toBe(ENTITY_PLACE_TYPE);
    expect(body.result.meta.qlooRequest.params["filter.results.entities"]).toBe(
      `${RINTARO_ENTITY_ID},${STATE_BIRD_ENTITY_ID}`,
    );

    expect(text).not.toContain("test-secret-key-that-must-not-leak");
  });

  it("discovers cross-domain candidates for a discovery intent", async () => {
    const res = await agentPOST(post("/api/agent", { ...agentBody, message: "find me something" }));

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(tools(body)).toContain("discover_cross_domain");
    expect(body.result.kind).toBe("discovery");
    expect(body.result.items.length).toBeGreaterThanOrEqual(1);

    const names = body.result.items.map((item: { name: string }) => item.name);
    expect(names).toContain("Rintaro");

    const rintaro = body.result.items.find((item: { name: string }) => item.name === "Rintaro");
    expect(rintaro.subtype).toBe(ENTITY_PLACE_TYPE);
    expect(rintaro.affinityPct).toBe(93);
    expect(body.message).toBe(
      `Found ${body.result.items.length} candidates across Qloo's graph for your taste.`,
    );
  });

  it("compiles 'hide sponsored' into a collapse rule with a preview", async () => {
    const res = await agentPOST(post("/api/agent", { ...agentBody, message: "hide sponsored" }));

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result.kind).toBe("policy");
    expect(body.result.rules[0]).toEqual({ kind: "collapse", match: { flag: "sponsored" } });
    expect(body.result.rulesHuman.length).toBeGreaterThan(0);
    expect(body.result.rulesHuman[0]).toBe("Collapse sponsored results");

    expect(body.result.preview.ranked).toHaveLength(3);
    expect(body.result.preview.plan.pageId).toBe("test-page");
    expect(body.result.preview.meta.qlooRequest.path).toBe("/v2/insights");
    expect(tools(body)).toContain("create_render_plan");
    expect(body.message).toBe("Compiled 1 rule(s) and previewed the effect.");
  });

  it("resolves 'boost natural wine' through search_tags and previews the rule", async () => {
    const res = await agentPOST(post("/api/agent", { ...agentBody, message: "boost natural wine" }));

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result.kind).toBe("policy");
    const tagStep = body.steps.find((step: { tool: string }) => step.tool === "search_tags");
    expect(tagStep).toBeDefined();
    expect(tagStep.status).toBe("ok");

    expect(body.result.rules[0]).toEqual({
      kind: "boost",
      match: { tagId: NATURAL_WINE_TAG_ID },
      weight: 1.5,
    });
    expect(body.result.rulesHuman[0]).toBe("Boost natural wine");
    expect(body.result.preview.plan.ops.length).toBeGreaterThanOrEqual(1);
  });

  it("explains the top resolved candidates for an explain intent", async () => {
    const res = await agentPOST(
      post("/api/agent", { ...agentBody, message: "why is this ranked here?" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result.kind).toBe("explanation");
    expect(tools(body)).toContain("explain_ranking");
    expect(body.result.items[0]).toEqual({
      name: "Rintaro",
      affinityPct: 93,
      reason: "Matches your taste for Fugazi",
    });
    expect(body.message).toContain("Rintaro");
  });

  it("rejects ranking when the profile has no positive seeds", async () => {
    const res = await agentPOST(
      post("/api/agent", {
        ...agentBody,
        profile: {
          ...profile,
          seeds: profile.seeds.map((seed) => ({ ...seed, polarity: "dislike" })),
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("Add at least one positive taste seed before ranking.");
  });

  it("rejects an invalid body with 400", async () => {
    const res = await agentPOST(post("/api/agent", { ...agentBody, message: "" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("invalid request body");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await agentPOST(post("/api/agent", "{not valid json"));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });
});
