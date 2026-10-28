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

beforeAll(async () => {
  searchPOST = (await import("@/app/api/qloo/search/route")).POST;
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

