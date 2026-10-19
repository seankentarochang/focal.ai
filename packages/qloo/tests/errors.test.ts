import { describe, expect, it, vi } from "vitest";
import { QlooError } from "../src/errors.js";
import { abortErrorLike, createFetchSpy, createLiveClient, jsonResponse, rejection, statusResponse } from "./support.js";

const ONE_ENTITY = {
  success: true,
  results: [{ entity_id: "e-1", name: "Rintaro", subtype: "urn:place:restaurant" }],
};

describe("HTTP error mapping", () => {
  it("maps 401 to AUTH without retrying", async () => {
    const fetchImpl = createFetchSpy(async () => statusResponse(401));
    const error = await rejection(createLiveClient(fetchImpl).search({ query: "x" }));

    expect(error).toBeInstanceOf(QlooError);
    expect(error.code).toBe("AUTH");
    expect(error.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps repeated 429 to RATE_LIMIT after exactly one retry, honoring Retry-After", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = createFetchSpy(async () => statusResponse(429, { "retry-after": "2" }));
      const pending = rejection(createLiveClient(fetchImpl).search({ query: "x" }));
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;

      expect(error.code).toBe("RATE_LIMIT");
      expect(error.status).toBe(429);
      expect(error.retryAfterMs).toBe(2000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a 429 once after ~1000ms by default and returns the result", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = createFetchSpy(async () => {
        calls += 1;
        return calls === 1 ? statusResponse(429) : jsonResponse(ONE_ENTITY);
      });
      const pending = createLiveClient(fetchImpl).search({ query: "Rintaro" });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]?.name).toBe("Rintaro");
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps 400 and 422 to BAD_REQUEST", async () => {
    const bad = createFetchSpy(async () => statusResponse(400));
    const badError = await rejection(createLiveClient(bad).search({ query: "x" }));
    expect(badError.code).toBe("BAD_REQUEST");
    expect(badError.status).toBe(400);

    const unprocessable = createFetchSpy(async () => statusResponse(422));
    const unprocessableError = await rejection(createLiveClient(unprocessable).search({ query: "x" }));
    expect(unprocessableError.code).toBe("BAD_REQUEST");
    expect(unprocessableError.status).toBe(422);
  });

  it("maps 404 to NOT_FOUND", async () => {
    const fetchImpl = createFetchSpy(async () => statusResponse(404));
    const error = await rejection(createLiveClient(fetchImpl).search({ query: "x" }));

    expect(error.code).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 500 to UPSTREAM after exactly one retry (2 fetch calls)", async () => {
    const fetchImpl = createFetchSpy(async () => statusResponse(500));
    const error = await rejection(createLiveClient(fetchImpl).search({ query: "x" }));

    expect(error.code).toBe("UPSTREAM");
    expect(error.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once and returns the successful result", async () => {
    let calls = 0;
    const fetchImpl = createFetchSpy(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(ONE_ENTITY);
    });

    const result = await createLiveClient(fetchImpl).search({ query: "Rintaro" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.name).toBe("Rintaro");
  });

  it("maps an AbortError-like rejection to TIMEOUT (after one retry)", async () => {
    const fetchImpl = createFetchSpy(async () => {
      throw abortErrorLike();
    });
    const error = await rejection(createLiveClient(fetchImpl).search({ query: "x" }));

    expect(error).toBeInstanceOf(QlooError);
    expect(error.code).toBe("TIMEOUT");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
