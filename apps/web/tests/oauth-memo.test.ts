import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/oauth/authorization-server/route";

// R5-4: only a parsed object from an ok response is cached; non-ok and
// rejections return 502 and must never stick in the cache.
describe("/api/oauth/authorization-server memoize", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("non-ok upstream -> 502, and the next call refetches", async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = "https://auth.example";
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issuer: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r1 = await GET();
    expect(r1.status).toBe(502);
    const r2 = await GET();
    expect(r2.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    delete process.env.WORKOS_AUTHKIT_DOMAIN;
  });

  it("a timeout/reject is never cached", async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = "https://auth2.example";
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("abort"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issuer: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r1 = await GET();
    expect(r1.status).toBe(502);
    const r2 = await GET();
    expect(r2.status).toBe(200);
    delete process.env.WORKOS_AUTHKIT_DOMAIN;
  });
});
