import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmptyProfile, serializeProfile, validatePlan } from "@focal-ai/core";
import { createQlooClient } from "@focal-ai/qloo";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createToolHandlers, type ToolHandlers } from "../src/tools.js";
import {
  CANDIDATES,
  FUGAZI_ENTITY_ID,
  FUGAZI_SEED,
  fixtureProfile,
  RINTARO_ENTITY_ID,
  writeProfileFile,
} from "./support.js";

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("expected a text content block");
  }
  return first.text;
}

function dataOf<T>(result: CallToolResult): T {
  return JSON.parse(textOf(result)) as T;
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const baseRankingArgs = {
  pageId: "tables",
  pageType: "urn:entity:place",
  locationQuery: "San Francisco",
  candidates: CANDIDATES,
};

describe("createToolHandlers with QLOO_MOCK=1 fixtures", () => {
  let tmpDir: string;
  let profilePath: string;
  let handlers: ToolHandlers;
  const savedEnv = {
    mock: process.env.QLOO_MOCK,
    key: process.env.QLOO_API_KEY,
    profile: process.env.FOCAL_PROFILE_PATH,
  };

  beforeAll(() => {
    setEnv("QLOO_MOCK", "1");
    setEnv("QLOO_API_KEY", undefined);
    tmpDir = mkdtempSync(join(tmpdir(), "focal-mcp-tools-"));
    profilePath = writeProfileFile(join(tmpDir, "profile.json"), fixtureProfile());
    setEnv("FOCAL_PROFILE_PATH", profilePath);
    handlers = createToolHandlers();
  });

  afterAll(() => {
    setEnv("QLOO_MOCK", savedEnv.mock);
    setEnv("QLOO_API_KEY", savedEnv.key);
    setEnv("FOCAL_PROFILE_PATH", savedEnv.profile);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("get_taste_profile reports seed counts, seeds and path without network", async () => {
    const result = await handlers.getTasteProfile();
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{
      seedCount: number;
      positiveCount: number;
      seeds: { name: string; subtype: string; polarity: string }[];
      rules: unknown[];
      profilePath: string;
      source: string;
    }>(result);
    expect(payload.seedCount).toBe(1);
    expect(payload.positiveCount).toBe(1);
    expect(payload.seeds).toEqual([
      { name: "Fugazi", subtype: "urn:entity:artist", polarity: "like" },
    ]);
    expect(payload.rules).toEqual([]);
    expect(payload.profilePath).toBe(profilePath);
    expect(payload.source).toBe(`file: ${profilePath}`);
  });

  it("get_taste_profile falls back to an empty profile with a note when the file is missing", async () => {
    const missingPath = join(tmpDir, "missing.json");
    setEnv("FOCAL_PROFILE_PATH", missingPath);
    try {
      const result = await handlers.getTasteProfile();
      expect(result.isError).toBeUndefined();
      const payload = dataOf<{ seedCount: number; profilePath: string; source: string }>(result);
      expect(payload.seedCount).toBe(0);
      expect(payload.profilePath).toBe(missingPath);
      expect(payload.source).toContain("file not found");
    } finally {
      setEnv("FOCAL_PROFILE_PATH", profilePath);
    }
  });

  it("get_taste_profile rejects a corrupt profile file with a clear error", async () => {
    const badPath = join(tmpDir, "corrupt.json");
    writeFileSync(badPath, "{ not json");
    setEnv("FOCAL_PROFILE_PATH", badPath);
    try {
      const result = await handlers.getTasteProfile();
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(`Invalid taste profile at ${badPath}`);
    } finally {
      setEnv("FOCAL_PROFILE_PATH", profilePath);
    }
  });

  it("search_entities('Rintaro') returns the fixture entity", async () => {
    const result = await handlers.searchEntities({ query: "Rintaro" });
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{
      entities: { entityId: string; name: string; subtype: string; disambiguation?: string }[];
    }>(result);
    expect(payload.entities.length).toBeGreaterThanOrEqual(1);
    expect(payload.entities.length).toBeLessThanOrEqual(5);
    expect(payload.entities).toContainEqual({
      entityId: RINTARO_ENTITY_ID,
      name: "Rintaro",
      subtype: "urn:entity:place",
      disambiguation: "San Francisco, California",
    });
  });

  it("score_candidates ranks Rintaro at 93 with one unresolved candidate", async () => {
    const result = await handlers.scoreCandidates(baseRankingArgs);
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{
      ranked: {
        clientId: string;
        name: string;
        position: number;
        affinityPct?: number;
        reason?: string;
        status: string;
      }[];
      summary: { moved: number; collapsed: number; unresolved: number };
    }>(result);

    const rintaro = payload.ranked.find((entry) => entry.clientId === "c-0");
    expect(rintaro).toMatchObject({
      name: "Rintaro",
      position: 0,
      affinityPct: 93,
      status: "resolved",
      reason: "Matches your taste for Fugazi",
    });

    const stateBird = payload.ranked.find((entry) => entry.clientId === "c-1");
    expect(stateBird).toMatchObject({ status: "resolved", affinityPct: 78 });

    const bogus = payload.ranked.find((entry) => entry.clientId === "c-2");
    expect(bogus?.status).toBe("unresolved");
    expect(bogus?.affinityPct).toBeUndefined();

    expect(payload.summary).toEqual({ moved: 0, collapsed: 0, unresolved: 1 });
  });

  it("discover_cross_domain returns at least one signal-only item", async () => {
    const result = await handlers.discoverCrossDomain({ pageType: "urn:entity:place" });
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{ items: { name: string; subtype: string; affinityPct?: number }[] }>(
      result,
    );
    expect(payload.items.length).toBeGreaterThanOrEqual(1);
    expect(payload.items.some((item) => typeof item.affinityPct === "number")).toBe(true);
    expect(payload.items[0]?.subtype).toBe("urn:entity:place");
  });

  it("explain_ranking grounds Rintaro's affinity in the Fugazi seed", async () => {
    const result = await handlers.explainRanking({ ...baseRankingArgs, clientId: "c-0" });
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{
      name: string;
      status: string;
      resolved: boolean;
      affinityPct: number;
      reason: { text?: string; contributions?: { name: string; score: number }[] };
      contributions: { entityId: string; score: number; name?: string }[];
    }>(result);
    expect(payload.name).toBe("Rintaro");
    expect(payload.status).toBe("resolved");
    expect(payload.resolved).toBe(true);
    expect(payload.affinityPct).toBe(93);
    expect(payload.reason.text).toBe("Matches your taste for Fugazi");
    expect(payload.contributions).toContainEqual({
      entityId: FUGAZI_ENTITY_ID,
      score: 0.44,
      name: "Fugazi",
    });
  });

  it("explain_ranking returns a clear message for an unresolved candidate", async () => {
    const result = await handlers.explainRanking({ ...baseRankingArgs, clientId: "c-2" });
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{ resolved: boolean; status: string; message: string }>(result);
    expect(payload.resolved).toBe(false);
    expect(payload.status).toBe("unresolved");
    expect(payload.message).toContain("unresolved");
  });

  it("create_render_plan returns a validatePlan-clean plan with ops", async () => {
    const result = await handlers.createRenderPlan(baseRankingArgs);
    expect(result.isError).toBeUndefined();
    const payload = dataOf<{
      plan: Parameters<typeof validatePlan>[0];
      summary: { moved: number; collapsed: number; unresolved: number };
    }>(result);
    expect(payload.plan.ops.map((op) => op.op)).toContain("reorder");
    expect(validatePlan(payload.plan)).toEqual({ ok: true });
    expect(payload.summary.unresolved).toBe(1);
  });

  it("maps an empty profile to the NO_SEEDS tool error with the profile path", async () => {
    const emptyPath = join(tmpDir, "empty.json");
    writeFileSync(emptyPath, serializeProfile(createEmptyProfile()));
    setEnv("FOCAL_PROFILE_PATH", emptyPath);
    try {
      const result = await handlers.scoreCandidates(baseRankingArgs);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(`No positive taste seeds in the profile at ${emptyPath}`);
    } finally {
      setEnv("FOCAL_PROFILE_PATH", profilePath);
    }
  });

  it("maps a missing QLOO_API_KEY to a tool error", async () => {
    setEnv("QLOO_MOCK", undefined);
    setEnv("QLOO_API_KEY", undefined);
    try {
      const liveHandlers = createToolHandlers({ client: createQlooClient() });

      const search = await liveHandlers.searchEntities({ query: "Rintaro" });
      expect(search.isError).toBe(true);
      expect(textOf(search)).toContain("QLOO_API_KEY is not set");

      const score = await liveHandlers.scoreCandidates(baseRankingArgs);
      expect(score.isError).toBe(true);
      expect(textOf(score)).toContain("QLOO_API_KEY is not set");
      expect(textOf(score)).not.toContain(FUGAZI_ENTITY_ID);
    } finally {
      setEnv("QLOO_MOCK", "1");
      setEnv("QLOO_API_KEY", undefined);
    }
  });
});
