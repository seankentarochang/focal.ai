import { describe, expect, it } from "vitest";
import { createFetchSpy, createLiveClient, jsonResponse } from "./support.js";

function payloadFor(name: string) {
  return { success: true, results: [{ entity_id: `id-${name}`, name, subtype: "urn:place:restaurant" }] };
}

describe("TTL cache", () => {
  it("serves identical searches from cache (1 fetch for 2 calls)", async () => {
    const fetchImpl = createFetchSpy(async () => jsonResponse(payloadFor("Rintaro")));
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });

    const first = await client.search({ query: "Rintaro" });
    const second = await client.search({ query: "Rintaro" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second.entities[0]?.name).toBe("Rintaro");
  });

  it("fetches again when the params differ (2 fetches for 2 calls)", async () => {
    const fetchImpl = createFetchSpy(async () => jsonResponse(payloadFor("Any")));
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });

    await client.search({ query: "a" });
    await client.search({ query: "b" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not cache when the TTL is zero", async () => {
    const fetchImpl = createFetchSpy(async () => jsonResponse(payloadFor("Rintaro")));
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 0 });

    await client.search({ query: "Rintaro" });
    await client.search({ query: "Rintaro" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches insights independently of searches", async () => {
    const fetchImpl = createFetchSpy(async () => jsonResponse({ success: true, results: { entities: [] } }));
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });

    await client.insights({ resultType: "urn:entity:place", signalEntityIds: ["s1"] });
    await client.insights({ resultType: "urn:entity:place", signalEntityIds: ["s1"] });
    await client.search({ query: "Rintaro" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
