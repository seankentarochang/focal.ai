import { describe, expect, it } from "vitest";
import { QLOO_MIN_INTERVAL_MS, warmSearchCache } from "../src/index.js";
import { createFetchSpy, createLiveClient, jsonResponse, statusResponse } from "./support.js";

const EMPTY_RESULTS = { success: true, results: [] };

describe("warmSearchCache", () => {
  it("fetches every unique request and serves repeat runs from the client cache", async () => {
    const fetchImpl = createFetchSpy(async () => jsonResponse(EMPTY_RESULTS));
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });
    const requests = [
      { query: "Rintaro" },
      { query: "State Bird Provisions", types: ["urn:entity:place"] },
      { query: "Zuni Café", location: "San Francisco" },
    ];

    const first = await warmSearchCache(client, requests, { concurrency: 2, minIntervalMs: 0 });
    expect(first).toEqual({ warmed: 3, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const second = await warmSearchCache(client, requests, { concurrency: 2, minIntervalMs: 0 });
    expect(second).toEqual({ warmed: 3, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("counts failed requests without throwing", async () => {
    const fetchImpl = createFetchSpy(async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get("query") === "bad"
        ? statusResponse(400)
        : jsonResponse(EMPTY_RESULTS);
    });
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });

    const result = await warmSearchCache(
      client,
      [{ query: "good" }, { query: "bad" }],
      { concurrency: 2, minIntervalMs: 0 },
    );

    expect(result).toEqual({ warmed: 1, failed: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps at most `concurrency` requests in flight", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = createFetchSpy(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse(EMPTY_RESULTS);
    });
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });
    const requests = Array.from({ length: 6 }, (_, index) => ({ query: `q${index}` }));

    const result = await warmSearchCache(client, requests, { concurrency: 2, minIntervalMs: 0 });

    expect(result).toEqual({ warmed: 6, failed: 0 });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("spaces request starts by minIntervalMs", async () => {
    const starts: number[] = [];
    const fetchImpl = createFetchSpy(async () => {
      starts.push(Date.now());
      return jsonResponse(EMPTY_RESULTS);
    });
    const client = createLiveClient(fetchImpl, { cacheTtlMs: 60_000 });

    const result = await warmSearchCache(
      client,
      [{ query: "a" }, { query: "b" }, { query: "c" }],
      { concurrency: 3, minIntervalMs: 60 },
    );

    expect(result).toEqual({ warmed: 3, failed: 0 });
    expect(starts).toHaveLength(3);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("shared request queue", () => {
  it("keeps concurrent calls across clients at or under 5 req/s", async () => {
    const starts: number[] = [];
    const spy = () =>
      createFetchSpy(async () => {
        starts.push(Date.now());
        return jsonResponse(EMPTY_RESULTS);
      });
    // Default minIntervalMs (QLOO_MIN_INTERVAL_MS, 200 ms) on both clients.
    const a = createLiveClient(spy(), { cacheTtlMs: 0, minIntervalMs: QLOO_MIN_INTERVAL_MS });
    const b = createLiveClient(spy(), { cacheTtlMs: 0, minIntervalMs: QLOO_MIN_INTERVAL_MS });

    await Promise.all([
      a.search({ query: "a1" }),
      a.search({ query: "a2" }),
      b.search({ query: "b1" }),
      b.insights({ resultType: "urn:entity:place", signalEntityIds: ["Q1"] }),
    ]);

    expect(starts).toHaveLength(4);
    const ordered = [...starts].sort((x, y) => x - y);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]! - ordered[index - 1]!).toBeGreaterThanOrEqual(180);
    }
  });
});
