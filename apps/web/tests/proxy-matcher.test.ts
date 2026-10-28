import { describe, expect, it } from "vitest";

// Every route that resolves a session (withAuth/currentViewer/caller) must be
// matched by proxy.ts — authkit only stamps session headers on matched paths.
const NEEDS_PROXY = [
  "/connect", "/chat", "/profile", "/activity", "/settings", "/onboarding",
  "/post-sign-in", "/sign-in", "/sign-out",
  "/api/chat", "/api/me", "/api/settings", "/api/profile",
];
const NEEDS_GLOB = ["/why/", "/auth/", "/api/extension/", "/api/activity/", "/api/profile/"];

describe("proxy matcher covers every sessioned route", () => {
  it("matches all withAuth/currentViewer/caller call-site paths", async () => {
    const { config } = await import("../proxy");
    const matcher: string[] = config.matcher;
    for (const path of NEEDS_PROXY) {
      expect(matcher, `missing ${path}`).toContain(path);
    }
    for (const prefix of NEEDS_GLOB) {
      const glob = prefix + ":path*";
      expect(matcher, `missing ${glob}`).toContain(glob);
    }
  });
});
