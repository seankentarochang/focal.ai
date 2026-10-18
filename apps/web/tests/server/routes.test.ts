import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";

process.env.QLOO_MOCK = "1";
process.env.QLOO_API_KEY = "test-secret-key-that-must-not-leak";

const RINTARO_ENTITY_ID = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
const STATE_BIRD_ENTITY_ID = "9C4D7E12-5F38-4A61-B7C0-2D8F1E5A9B42";
const FUGAZI_ENTITY_ID = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
const ENTITY_PLACE_TYPE = "urn:entity:place";

type RoutePost = (req: Request) => Promise<Response>;

let searchPOST: RoutePost;
let rankPOST: RoutePost;

beforeAll(async () => {
  searchPOST = (await import("@/app/api/qloo/search/route")).POST;
  rankPOST = (await import("@/app/api/qloo/rank/route")).POST;
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

const rankBody = {
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

describe("POST /api/qloo/search", () => {
  it("searches through the mock client and reports the mock data source", async () => {
    const res = await searchPOST(post("/api/qloo/search", { query: "Rintaro" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.dataSource).toBe("mock");
    expect(typeof body.meta.durationMs).toBe("number");
    expect(body.entities.length).toBeGreaterThanOrEqual(1);
    expect(body.entities[0].name).toBe("Rintaro");
    expect(body.entities[0].entityId).toBe(RINTARO_ENTITY_ID);
  });

  it("rejects an invalid body with 400 before any upstream call", async () => {
    const res = await searchPOST(post("/api/qloo/search", { query: "" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("invalid request body");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await searchPOST(post("/api/qloo/search", "{not valid json"));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("POST /api/qloo/rank", () => {
  it("ranks resolved mock candidates, builds a plan and records the insights request", async () => {
    const res = await rankPOST(post("/api/qloo/rank", rankBody));

    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(body.ranked).toHaveLength(3);

    const resolved = body.ranked.filter((entry: { status: string }) => entry.status === "resolved");
    expect(resolved).toHaveLength(2);

    const rintaro = resolved.find((entry: { clientId: string }) => entry.clientId === "c-0");
    expect(rintaro?.entity?.entityId).toBe(RINTARO_ENTITY_ID);
    expect(rintaro?.affinityPct).toBe(93);
    expect(rintaro?.reason?.text).toBe("Matches your taste for Fugazi");
    expect(rintaro?.reason?.contributions).toEqual([{ name: "Fugazi", score: 0.44 }]);

    const stateBird = resolved.find((entry: { clientId: string }) => entry.clientId === "c-1");
    expect(stateBird?.entity?.entityId).toBe(STATE_BIRD_ENTITY_ID);
    expect(stateBird?.affinityPct).toBe(78);
    expect(stateBird?.reason?.text).toContain("Fugazi");

    expect(body.plan.pageId).toBe("test-page");
    expect(body.plan.ops.length).toBeGreaterThanOrEqual(1);
    expect(body.plan.ops[0].op).toBe("reorder");
    expect(body.plan.ops[0].order).toHaveLength(3);

    expect(body.meta.dataSource).toBe("mock");
    expect(typeof body.meta.durationMs).toBe("number");
    expect(body.meta.unresolved).toBe(1);

    expect(body.meta.qlooRequest.path).toBe("/v2/insights");
    expect(body.meta.qlooRequest.params["filter.type"]).toBe(ENTITY_PLACE_TYPE);
    expect(body.meta.qlooRequest.params["signal.interests.entities"]).toBe(FUGAZI_ENTITY_ID);
    expect(body.meta.qlooRequest.params["filter.results.entities"]).toBe(
      `${RINTARO_ENTITY_ID},${STATE_BIRD_ENTITY_ID}`,
    );
    expect(body.meta.qlooRequest.params["filter.location.query"]).toBe("San Francisco");
    expect(body.meta.qlooRequest.params["feature.explainability"]).toBe("true");
    expect(body.meta.qlooRequest.params.take).toBe("20");

    expect(text).not.toContain("QLOO_API_KEY");
    expect(text).not.toContain("test-secret-key-that-must-not-leak");
  });

  it("keeps unresolved candidates in the response with no affinity", async () => {
    const res = await rankPOST(post("/api/qloo/rank", rankBody));
    const body = await res.json();

    const notReal = body.ranked.find(
      (entry: { clientId: string }) => entry.clientId === "c-2",
    );
    expect(notReal.status).toBe("unresolved");
    expect(notReal.affinityPct).toBeUndefined();
    expect(notReal.entity).toBeUndefined();
  });

  it("rejects a profile with no positive seeds", async () => {
    const res = await rankPOST(
      post("/api/qloo/rank", {
        ...rankBody,
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
    const res = await rankPOST(post("/api/qloo/rank", { ...rankBody, candidates: [] }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("invalid request body");
  });
});
