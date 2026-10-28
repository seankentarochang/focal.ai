/**
 * L8: MCP stdio server against live Qloo (no QLOO_MOCK).
 * initialize → tools/list → search_entities("Rintaro") → seed local profile
 * → score_candidates on 5 SF restaurants.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = join(here, "..", "..", "packages", "mcp");

// Load the live keys from apps/web/.env.local into the child's env.
const env = { ...process.env, FOCAL_PROFILE_PATH: join(tmpdir(), "focal-live-profile.json") };
function tmpdir(): string { return process.env.TEMP ?? process.env.TMP ?? "/tmp"; }
try {
  for (const line of readFileSync(join(here, "..", "..", "apps", "web", ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !env[m[1]!]) env[m[1]!] = m[2];
  }
} catch { /* no env file — rely on shell */ }
delete env.QLOO_MOCK;

const child = spawn("npx", ["tsx", "src/index.ts"], { cwd: MCP_DIR, env, shell: true, stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (d) => console.error("[mcp-stderr]", String(d).slice(0, 200)));

let buf = "";
const pending = new Map<number, (v: unknown) => void>();
child.stdout.on("data", (d) => {
  buf += String(d);
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line) as { id?: number; result?: unknown };
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id); }
    } catch { /* not json */ }
  }
});
let nextId = 1;
const call = (method: string, params: unknown = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.delete(id)) resolve({ error: "timeout" }); }, 60000);
  });

await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "live-check", version: "0" } });
const tools = await call("tools/list") as { tools?: { name: string }[] };
console.log("tools:", (tools.tools ?? []).map((t) => t.name).join(", "));

const search = await call("tools/call", { name: "search_entities", arguments: { query: "Rintaro", types: ["urn:entity:place"] } }) as { content?: { type: string; text?: string }[] };
const searchText = search.content?.find((c) => c.type === "text")?.text ?? "";
console.log("search:", searchText.slice(0, 400));

// Seed the local MCP profile so score_candidates has a taste to compare.
const rintaro = (() => { try { const j = JSON.parse(searchText) as { entities?: { entityId?: string; id?: string; name: string }[] }; return (j.entities ?? []).find((e) => /rintaro/i.test(e.name)); } catch { return undefined; } })();
if (rintaro) {
  // add_thing isn't registered on the stdio server — seed the profile file directly.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(env.FOCAL_PROFILE_PATH!, JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    seeds: [{ entityId: rintaro.entityId ?? rintaro.id, name: "Rintaro", subtype: "urn:entity:place", polarity: "like", weight: 1, source: "typed", addedAt: new Date().toISOString() }],
    rules: [],
  }));
  console.log("seeded profile file:", env.FOCAL_PROFILE_PATH);
}

const rank = await call("tools/call", {
  name: "score_candidates",
  arguments: {
    pageId: "live-check-1",
    pageType: "urn:entity:place",
    locationQuery: "San Francisco",
    candidates: [
      { clientId: "c0", name: "Rintaro", originalIndex: 0 }, { clientId: "c1", name: "Lazy Bear", originalIndex: 1 },
      { clientId: "c2", name: "State Bird Provisions", originalIndex: 2 }, { clientId: "c3", name: "Kokkari Estiatorio", originalIndex: 3 },
      { clientId: "c4", name: "House of Prime Rib", originalIndex: 4 },
    ],
  },
}) as { content?: { type: string; text?: string }[] };
console.log("rank:", (rank.content?.find((c) => c.type === "text")?.text ?? "").slice(0, 800));

child.kill();
process.exit(0);
