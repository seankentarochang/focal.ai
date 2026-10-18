import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { CANDIDATES, fixtureProfile, writeProfileFile } from "./support.js";

const TEST_TIMEOUT_MS = 25_000;
const packageRoot = resolve(fileURLToPath(import.meta.url), "../..");

const TOOL_NAMES = [
  "create_render_plan",
  "discover_cross_domain",
  "explain_ranking",
  "get_taste_profile",
  "score_candidates",
  "search_entities",
];

describe("focal MCP server over stdio", () => {
  let client: Client;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "focal-mcp-smoke-"));
    const profilePath = writeProfileFile(join(tmpDir, "profile.json"), fixtureProfile());
    const transport = new StdioClientTransport({
      command: "pnpm",
      args: ["--filter", "@focal-ai/mcp", "start"],
      cwd: packageRoot,
      env: { QLOO_MOCK: "1", FOCAL_PROFILE_PATH: profilePath },
      stderr: "pipe",
    });
    client = new Client({ name: "focal-mcp-smoke", version: "0.0.0" });
    await client.connect(transport);
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await client?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "lists exactly the six focal tools",
    async () => {
      const listing = await client.listTools();
      expect(listing.tools.map((tool) => tool.name).sort()).toEqual(TOOL_NAMES);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "scores candidates through tools/call",
    async () => {
      const raw = await client.callTool(
        {
          name: "score_candidates",
          arguments: {
            pageId: "tables",
            pageType: "urn:entity:place",
            locationQuery: "San Francisco",
            candidates: CANDIDATES,
          },
        },
        CallToolResultSchema,
      );
      const result = CallToolResultSchema.parse(raw);
      const first = result.content[0];
      if (first === undefined || first.type !== "text") {
        throw new Error("expected a text content block");
      }
      const payload = JSON.parse(first.text) as {
        ranked: { clientId: string; affinityPct?: number }[];
        summary: { unresolved: number };
      };
      const rintaro = payload.ranked.find((entry) => entry.clientId === "c-0");
      expect(rintaro?.affinityPct).toBe(93);
      expect(payload.summary.unresolved).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );
});
