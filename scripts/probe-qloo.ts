import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const outputDir = join(scriptDir, "probe-output");

for (const envFile of [join(repoRoot, ".env"), join(repoRoot, "apps/web/.env.local")]) {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

const apiKey = process.env.QLOO_API_KEY?.trim();
const baseUrl = (process.env.QLOO_API_BASE?.trim() || "https://hackathon.api.qloo.com").replace(/\/+$/, "");

if (!apiKey) {
  console.log("");
  console.log("No QLOO_API_KEY found — the live Qloo contract probe cannot run yet.");
  console.log("");
  console.log("To get a key:");
  console.log("  1. Request a hackathon key via the form at https://forms.gle/zz12orkLHTAneLGz6");
  console.log("     (keys are issued within a few business days)");
  console.log("  2. Set QLOO_API_KEY in .env at the repo root");
  console.log("     (cp .env.example .env)");
  console.log("  3. Re-run: pnpm probe");
  console.log("");
  process.exit(2);
}

type ProbeResult = {
  name: string;
  fileName: string;
  path: string;
  status: number;
  ms: number;
  body: unknown;
  ok: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function extractEntities(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  if (!root) return [];
  const results = root.results;
  const candidates = asArray(results) ?? asArray(asRecord(results)?.entities) ?? [];
  return candidates
    .map((candidate) => asRecord(candidate))
    .filter((entity): entity is Record<string, unknown> => entity !== undefined);
}

function extractTags(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  if (!root) return [];
  const results = root.results;
  const candidates = asArray(results) ?? asArray(asRecord(results)?.tags) ?? [];
  return candidates
    .map((candidate) => asRecord(candidate))
    .filter((tag): tag is Record<string, unknown> => tag !== undefined);
}

function entityId(entity: Record<string, unknown> | undefined): string | undefined {
  const id = entity?.entity_id ?? entity?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

async function runProbe(name: string, fileName: string, path: string): Promise<ProbeResult> {
  const url = `${baseUrl}${path}`;
  console.log(`\n→ ${name}`);
  console.log(`  GET ${path}`);

  const startedAt = performance.now();
  let status = 0;
  let body: unknown = undefined;
  let rawText = "";
  try {
    const response = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    status = response.status;
    rawText = await response.text();
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  } catch (error) {
    rawText = error instanceof Error ? error.message : String(error);
    body = rawText;
  }
  const ms = Math.round(performance.now() - startedAt);
  const ok = status >= 200 && status < 300;

  console.log(`  HTTP ${status} in ${ms}ms`);

  if (ok) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, fileName), JSON.stringify(body, null, 2) + "\n");
    console.log(`  saved scripts/probe-output/${fileName}`);
  } else {
    console.log("  error body:");
    console.dir(body, { depth: 6 });
  }

  return { name, fileName, path, status, ms, body, ok };
}

function summarizeSearch(result: ProbeResult): void {
  const entities = extractEntities(result.body);
  console.log(`  results: ${entities.length}`);
  const first = entities[0];
  if (first) {
    console.log("  first result:");
    console.dir(
      {
        entity_id: first.entity_id,
        name: first.name,
        subtype: first.subtype,
        disambiguation: first.disambiguation,
      },
      { depth: 4 },
    );
  }
}

function summarizeInsights(result: ProbeResult): void {
  const entities = extractEntities(result.body);
  console.log(`  results.entities.length: ${entities.length}`);
  const first = entities[0];
  if (first) {
    console.log("  first entity query block (depth 6):");
    console.dir(first.query, { depth: 6 });
    const topLevelQuery = asRecord(result.body)?.query;
    if (topLevelQuery !== undefined) {
      console.log("  top-level query object (depth 6):");
      console.dir(topLevelQuery, { depth: 6 });
    } else {
      console.log("  top-level query object: not present");
    }
  }
}

function summarizeTags(result: ProbeResult): void {
  const tags = extractTags(result.body);
  console.log(`  tags: ${tags.length}`);
  const first = tags[0];
  if (first) {
    console.log("  first tag:");
    console.dir(first, { depth: 6 });
  }
}

console.log(`Qloo contract probe against ${baseUrl}`);
console.log("(key present — value never printed)");

const placeSearch = await runProbe(
  "search: place",
  "01-search-place.json",
  "/search?query=Rintaro%20San%20Francisco&types=urn:entity:place&take=5",
);
summarizeSearch(placeSearch);

const artistSearch = await runProbe(
  "search: artist",
  "02-search-artist.json",
  "/search?query=Fugazi&types=urn:entity:artist&take=5",
);
summarizeSearch(artistSearch);

const placeIds = extractEntities(placeSearch.body)
  .map((entity) => entityId(entity))
  .filter((id): id is string => id !== undefined);
const artistId = entityId(extractEntities(artistSearch.body)[0]);

const signalIds = artistId ? [artistId] : placeIds;
const resultIds = placeIds.slice(0, 3);
const distinctIds = new Set([...signalIds, ...resultIds]);

const results: ProbeResult[] = [placeSearch, artistSearch];

if (distinctIds.size < 2) {
  console.log(
    "\n→ insights: SKIPPED — fewer than 2 entity ids available " +
      `(places: ${placeIds.length}, artist: ${artistId ? 1 : 0})`,
  );
} else {
  const params = new URLSearchParams();
  params.set("filter.type", "urn:entity:place");
  params.set("signal.interests.entities", signalIds.join(","));
  params.set("filter.results.entities", resultIds.join(","));
  params.set("feature.explainability", "true");
  params.set("take", "10");
  const insights = await runProbe("insights", "03-insights.json", `/v2/insights?${params.toString()}`);
  summarizeInsights(insights);
  results.push(insights);
}

const tags = await runProbe("tags", "04-tags.json", "/v2/tags?filter.query=natural%20wine&take=5");
summarizeTags(tags);
results.push(tags);

const failures = results.filter((result) => !result.ok);
console.log("");
if (failures.length > 0) {
  console.log(`✗ ${failures.length} of ${results.length} requests failed:`);
  for (const failure of failures) {
    console.log(`  - ${failure.name}: HTTP ${failure.status}`);
  }
  process.exit(1);
}
console.log(`✓ all ${results.length} requests returned 2xx`);
