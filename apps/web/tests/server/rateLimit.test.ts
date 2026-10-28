import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTests, checkRateLimit, clientKey } from "@/lib/server/rateLimit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T00:00:00.000Z"));
  __resetRateLimitForTests();
});

afterEach(() => {
  __resetRateLimitForTests();
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows exactly `limit` requests inside the window", () => {
    for (let i = 0; i < 4; i += 1) {
      expect(checkRateLimit("key", { limit: 4, windowMs: 1000 })).toEqual({ ok: true });
    }

    const blocked = checkRateLimit("key", { limit: 4, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("defaults to 30 requests per 60s", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(checkRateLimit("defaults").ok).toBe(true);
    }

    const blocked = checkRateLimit("defaults");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("a", { limit: 1, windowMs: 1000 }).ok).toBe(true);
    expect(checkRateLimit("a", { limit: 1, windowMs: 1000 }).ok).toBe(false);
    expect(checkRateLimit("b", { limit: 1, windowMs: 1000 }).ok).toBe(true);
  });

  it("slides: requests are allowed again once the oldest hit leaves the window", () => {
    expect(checkRateLimit("slide", { limit: 2, windowMs: 1000 }).ok).toBe(true);
    expect(checkRateLimit("slide", { limit: 2, windowMs: 1000 }).ok).toBe(true);
    expect(checkRateLimit("slide", { limit: 2, windowMs: 1000 }).ok).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(checkRateLimit("slide", { limit: 2, windowMs: 1000 }).ok).toBe(true);
  });

  it("reports retryAfterMs and frees up after it elapses", () => {
    expect(checkRateLimit("retry", { limit: 1, windowMs: 1000 }).ok).toBe(true);

    const blocked = checkRateLimit("retry", { limit: 1, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterMs).toBe(1000);
      vi.advanceTimersByTime(blocked.retryAfterMs);
      expect(checkRateLimit("retry", { limit: 1, windowMs: 1000 }).ok).toBe(true);
    }
  });
});

describe("clientKey", () => {
  it("reads the first x-forwarded-for entry on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const req = new Request("http://localhost/api/qloo/search", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientKey(req)).toBe("203.0.113.7");
    vi.unstubAllEnvs();
  });

  it("trims a single x-forwarded-for entry on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const req = new Request("http://localhost/api/qloo/search", {
      headers: { "x-forwarded-for": "  198.51.100.9 " },
    });
    expect(clientKey(req)).toBe("198.51.100.9");
    vi.unstubAllEnvs();
  });

  it("ignores x-forwarded-for off Vercel (attacker-controlled)", () => {
    const req = new Request("http://localhost/api/qloo/search", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(clientKey(req)).toBe("local");
  });

  it("falls back to local when the header is missing or empty", () => {
    expect(clientKey(new Request("http://localhost/api/qloo/search"))).toBe("local");
    expect(
      clientKey(
        new Request("http://localhost/api/qloo/search", { headers: { "x-forwarded-for": " , " } }),
      ),
    ).toBe("local");
  });
});
