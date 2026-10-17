import { describe, expect, it } from "vitest";
import { TEST_API_KEY, TEST_BASE_URL, createFetchSpy, createLiveClient, jsonResponse, requestAt } from "./support.js";

const EMPTY_RESULTS = { success: true, results: [] };
const FUG = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
const RIN = "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01";
const SBP = "9C4D7E12-5F38-4A61-B7C0-2D8F1E5A9B42";

function spyWithEmptyResults() {
  return createFetchSpy(async () => jsonResponse(EMPTY_RESULTS));
}

describe("search request params", () => {
  it("sends the golden query, method, and headers for a fully specified search", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.search({
      query: "Rintaro",
      types: ["urn:entity:place"],
      location: "San Francisco, California",
      take: 5,
      page: 2,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = requestAt(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${TEST_BASE_URL}/search`);
    expect(url.searchParams.get("query")).toBe("Rintaro");
    expect(url.searchParams.get("types")).toBe("urn:entity:place");
    expect(url.searchParams.get("filter.location")).toBe("San Francisco, California");
    expect(url.searchParams.get("take")).toBe("5");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("feature.explainability")).toBe(false);
    expect(init?.method).toBe("GET");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Api-Key")).toBe(TEST_API_KEY);
    expect(headers.get("accept")).toBe("application/json");
  });

  it("joins multiple types with commas and omits absent optional params", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.search({ query: "Fugazi", types: ["urn:entity:artist", "urn:entity:place"] });

    const { url } = requestAt(fetchImpl);
    expect(url.searchParams.get("types")).toBe("urn:entity:artist,urn:entity:place");
    expect(url.searchParams.has("filter.location")).toBe(false);
    expect(url.searchParams.has("take")).toBe(false);
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("clamps search take to 1..199", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.search({ query: "a", take: 500 });
    await client.search({ query: "b", take: 0 });

    expect(requestAt(fetchImpl, 0).url.searchParams.get("take")).toBe("199");
    expect(requestAt(fetchImpl, 1).url.searchParams.get("take")).toBe("1");
  });
});

describe("insights request params", () => {
  it("sends the golden query for a fully specified insights call", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG, RIN],
      resultEntityIds: [RIN, SBP],
      locationQuery: "San Francisco",
      explainability: true,
      take: 10,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = requestAt(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${TEST_BASE_URL}/v2/insights`);
    expect(url.searchParams.get("filter.type")).toBe("urn:entity:place");
    expect(url.searchParams.get("signal.interests.entities")).toBe(`${FUG},${RIN}`);
    expect(url.searchParams.get("filter.results.entities")).toBe(`${RIN},${SBP}`);
    expect(url.searchParams.get("filter.location.query")).toBe("San Francisco");
    expect(url.searchParams.get("feature.explainability")).toBe("true");
    expect(url.searchParams.get("take")).toBe("10");
    expect(init?.method).toBe("GET");
  });

  it("omits feature.explainability unless requested and defaults take to 20", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.insights({
      resultType: "urn:entity:place",
      signalEntityIds: [FUG],
      explainability: false,
    });

    const { url } = requestAt(fetchImpl);
    expect(url.searchParams.has("feature.explainability")).toBe(false);
    expect(url.searchParams.has("filter.results.entities")).toBe(false);
    expect(url.searchParams.has("filter.location.query")).toBe(false);
    expect(url.searchParams.get("take")).toBe("20");
  });

  it("clamps insights take to 1..50", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.insights({ resultType: "urn:entity:place", signalEntityIds: [FUG], take: 999 });
    await client.insights({ resultType: "urn:entity:place", signalEntityIds: [RIN], take: -3 });

    expect(requestAt(fetchImpl, 0).url.searchParams.get("take")).toBe("50");
    expect(requestAt(fetchImpl, 1).url.searchParams.get("take")).toBe("1");
  });
});

describe("tags and entities request params", () => {
  it("sends the golden query for a tag search", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.searchTags({ query: "natural wine", take: 3 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = requestAt(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${TEST_BASE_URL}/v2/tags`);
    expect(url.searchParams.get("filter.query")).toBe("natural wine");
    expect(url.searchParams.get("take")).toBe("3");
    expect(init?.method).toBe("GET");
  });

  it("omits take for tags when not given", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.searchTags({ query: "izakaya" });

    expect(requestAt(fetchImpl).url.searchParams.has("take")).toBe(false);
  });

  it("sends comma-joined entity_ids and omits the param for an empty list", async () => {
    const fetchImpl = spyWithEmptyResults();
    const client = createLiveClient(fetchImpl);

    await client.getEntities([RIN, FUG]);
    await client.getEntities([]);

    const first = requestAt(fetchImpl, 0);
    expect(first.url.origin + first.url.pathname).toBe(`${TEST_BASE_URL}/v2/entities`);
    expect(first.url.searchParams.get("entity_ids")).toBe(`${RIN},${FUG}`);
    expect(requestAt(fetchImpl, 1).url.searchParams.has("entity_ids")).toBe(false);
  });
});
