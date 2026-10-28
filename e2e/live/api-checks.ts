/**
 * L4 live API checks against the production build on :3300.
 *   pnpm exec tsx e2e/live/api-checks.ts [baseUrl]
 * Results land in e2e/artifacts/live/api-checks.json — tokens are never
 * written into the report.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] ?? "http://localhost:3300").replace(/\/+$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "artifacts", "live");
const REPORT: Record<string, unknown> = { base: BASE, startedAt: new Date().toISOString(), checks: {} };
const note = (k: string, v: unknown) => {
  (REPORT.checks as Record<string, unknown>)[k] = v;
  console.log(`- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
};

const post = async (path: string, body: unknown, token?: string) => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, ms: Date.now() - t0, json: await res.json().catch(() => null) };
};
const get = async (path: string, token?: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const put = async (path: string, body: unknown, token?: string) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

/** Lift-only: strip the annotate (lifted) ids from the new order - the rest must equal the original minus them, and the lifted ids form the prefix. */
function checkLiftOnly(
  plan: { ops?: { op: string; order?: string[]; clientId?: string; text?: string }[] },
  originalOrder: string[],
) {
  const reorder = plan.ops?.find((o) => o.op === "reorder");
  if (!reorder?.order) return { ok: false, why: "no reorder op" };
  const labels = (plan.ops ?? []).filter((o) => o.op === "annotate");
  const liftedIds = labels.map((l) => l.clientId!).filter(Boolean);
  const rest = reorder.order.filter((id) => !liftedIds.includes(id));
  const restOrig = originalOrder.filter((id) => !liftedIds.includes(id));
  const liftedPrefix = reorder.order.slice(0, liftedIds.length);
  const ok =
    liftedPrefix.every((id) => liftedIds.includes(id)) &&
    JSON.stringify(rest) === JSON.stringify(restOrig) &&
    labels.every((l) => (l.text ?? "").trim().length > 0);
  return {
    ok,
    lifted: liftedIds.length,
    emptyLabels: labels.filter((l) => !(l.text ?? "").trim()).length,
    labels: labels.map((l) => l.text),
    order: reorder.order,
    liftedIds,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // ---- b: live search ----
  const s = await post("/api/qloo/search", { query: "Rintaro", types: ["urn:entity:place"] });
  const ents = (s.json?.entities ?? s.json?.results ?? []) as { name: string; entityId?: string }[];
  note("b.search", { status: s.status, entities: ents.length, rintaroFound: ents.some((e) => /rintaro/i.test(e.name)) });

  // Resolve seed entities for the profile + try-rank seeds (top hit only on case-insensitive name match).
  const SEED_WANTS = [
    { query: "Rintaro", types: ["urn:entity:place"], want: "Rintaro" },
    { query: "State Bird Provisions", types: ["urn:entity:place"], want: "State Bird Provisions" },
    { query: "San Francisco", types: ["urn:entity:destination"], want: "San Francisco" },
    { query: "Spirited Away", types: ["urn:entity:movie"], want: "Spirited Away" },
    { query: "Parasite", types: ["urn:entity:movie"], want: "Parasite" },
    { query: "The Name of the Wind", types: ["urn:entity:book"], want: "The Name of the Wind" },
    { query: "Radiohead", types: ["urn:entity:artist"], want: "Radiohead" },
    { query: "Hades", types: ["urn:entity:videogame"], want: "Hades" },
  ] as const;
  const seeds: { entityId: string; name: string; type: string; skipped?: boolean }[] = [];
  for (const w of SEED_WANTS) {
    const r = await post("/api/qloo/search", { query: w.query, types: [...w.types] });
    const list = (r.json?.entities ?? r.json?.results ?? []) as { name: string; entityId?: string; id?: string }[];
    const top = list.find((e) => e.name.toLowerCase() === w.want.toLowerCase());
    if (top) seeds.push({ entityId: (top.entityId ?? top.id)!, name: top.name, type: w.types[0] });
    else seeds.push({ entityId: "", name: w.want, type: w.types[0], skipped: true });
  }
  note("d.seedResolution", seeds.map((x) => `${x.name}:${x.skipped ? "SKIP" : "ok"}`));

  // ---- c: /api/try/rank per demo page + a pasted list ----
  const { PAGES } = await import("../../apps/web/lib/pages/index.js").catch(() => import("../../apps/web/lib/pages/index"));
  const trySeeds = seeds.filter((x) => !x.skipped).map((x) => ({ entityId: x.entityId, name: x.name, subtype: x.type, strength: "love" }));
  const tryChecks: Record<string, unknown> = {};
  for (const id of ["tables", "atlas", "verve"] as const) {
    const page = PAGES[id];
    const items = page.candidates.map((c: { name: string; locationText?: string }) => ({ name: c.name, city: c.locationText }));
    const r = await post("/api/try/rank", { pageType: page.type, items, seeds: trySeeds });
    tryChecks[id] = {
      status: r.status,
      ms: r.ms,
      nItems: items.length,
      plan: r.json?.plan ? checkLiftOnly(r.json.plan, items.map((_c: unknown, i: number) => `c${i}`)) : "no plan",
      summaryLifted: r.json?.plan?.summary?.lifted,
    };
  }
  const pasted = ["Rintaro", "Lazy Bear", "State Bird Provisions", "Kokkari Estiatorio", "House of Prime Rib", "Zuni Café", "Saison", "Che Fico", "Nopa", "Foreign Cinema"];
  const rp = await post("/api/try/rank", { pageType: "urn:entity:place", items: pasted.map((name) => ({ name, city: "San Francisco" })), seeds: trySeeds });
  tryChecks["pasted"] = { status: rp.status, ms: rp.ms, plan: rp.json?.plan ? checkLiftOnly(rp.json.plan, pasted.map((_n, i) => `c${i}`)) : "no plan", summaryLifted: rp.json?.plan?.summary?.lifted };
  note("c.tryRank", tryChecks);

  // ---- d: seed DB user + token, /api/page/rank twice ----
  const { openDb, migrate } = await import("@focal-ai/db");
  const { addEntry } = await import("@focal-ai/core");
  const db = openDb(process.env.DATABASE_URL!);
  await migrate(db.sql);
  const user = await db.users.upsert("live-e2e@focal.test");
  const { token } = await db.extensionSessions.issue(user.id);
  let profile = await db.profile.load(user.id);
  for (const x of seeds.filter((s) => !s.skipped)) {
    if (profile.entries.some((e: { kind: string; qlooId?: string }) => e.kind === "thing" && e.qlooId === x.entityId)) continue;
    profile = await db.profile.load(user.id); // re-read so `expected` tracks any concurrent write
    const w = addEntry(profile, { kind: "thing", qlooId: x.entityId, name: x.name, type: x.type, strength: "love", source: "manual" }, "manual");
    await db.profile.commit(user.id, w.event as never, profile.version);
    profile = w.profile;
  }
  note("d.profileEntries", profile.entries.length);

  const names = ["Rintaro", "Lazy Bear", "State Bird Provisions", "Kokkari Estiatorio", "House of Prime Rib", "Zuni Café", "Saison", "Che Fico", "Nopa", "Foreign Cinema", "Liholiho Yacht Club", "Rich Table"];
  const rankBody = {
    host: "www.yelp.com",
    pathPattern: "/search",
    pageType: "place",
    items: names.map((name, i) => ({ clientId: `c${i}`, name, type: "place", city: "San Francisco" })),
  };
  const cacheBefore = (await db.sql`select count(*)::int n, max(updated_at) mx from resolution_cache`)[0];
  const r1 = await post("/api/page/rank", rankBody, token);
  const r2 = await post("/api/page/rank", rankBody, token);
  const cacheAfter = (await db.sql`select count(*)::int n, max(updated_at) mx from resolution_cache`)[0];
  // Items live in the stored page_results row, not the rank response body —
  // compare statuses run1 vs run2 to explain any cache growth.
  const prRows = await db.sql`select id, items, plan from page_results where id in (${r1.json?.pageResultId ?? "none"}, ${r2.json?.pageResultId ?? "none"})`;
  const statusOf = (id: string) => {
    const row = (prRows as { id: string; items: { clientId: string; status: string; name: string }[] }[]).find((x) => x.id === id);
    const c: Record<string, number> = {};
    for (const i of row?.items ?? []) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  };
  const items1 = (((prRows as { id: string; items: { status: string }[] }[]).find((x) => x.id === r1.json?.pageResultId))?.items ?? []);
  note("d.pageRank", {
    run1: { status: r1.status, ms: r1.ms, resolved: items1.filter((i) => i.status === "resolved" || i.status === "ambiguous").length, total: items1.length, lifted: r1.json?.plan?.summary?.lifted ?? r1.json?.result?.plan?.summary?.lifted },
    run2: { status: r2.status, ms: r2.ms },
    cacheUnchanged: cacheBefore.n === cacheAfter.n && String(cacheBefore.mx) === String(cacheAfter.mx),
    cache: { before: cacheBefore.n, after: cacheAfter.n },
    statusRun1: statusOf(r1.json?.pageResultId ?? "x"),
    statusRun2: statusOf(r2.json?.pageResultId ?? "x"),
    resultKeys: Object.keys(r1.json ?? {}),
  });

  // ---- e: feedback more -> undo ----
  const resultId = r1.json?.pageResultId;
  const annotateIds = ((r1.json?.plan?.ops ?? []) as { op: string; clientId?: string }[]).filter((o) => o.op === "annotate").map((o) => o.clientId!);
  const liftedClientId = annotateIds[0] ?? "c0";
  const fb = await post("/api/feedback", { pageResultId: resultId, clientId: liftedClientId, verdict: "more" }, token);
  let undo: { status: number } = { status: 0 };
  let actRow: Record<string, unknown> | null = null;
  if (fb.status === 200 && fb.json?.eventId) {
    undo = await post("/api/feedback", { action: "undo", eventId: fb.json.eventId }, token);
    const rows = await db.sql`select actor, action, undoes, undone_by from activity_events where user_id = ${user.id} order by at desc limit 5`;
    actRow = (rows as Record<string, unknown>[]).find((r) => r.actor === "page") ?? null;
  }
  note("e.feedback", { fb: fb.status, saved: fb.json?.saved, undo: undo.status, actor: actRow?.actor, action: actRow?.action, undoneBy: !!actRow?.undone_by, resultIdUsed: !!resultId, clientId: liftedClientId });

  // ---- f: settings round-trip ----
  const before = await get("/api/settings", token);
  const put1 = await put("/api/settings", { sites: [{ hostname: "example.com", mode: "skip" }] }, token);
  const after = await get("/api/settings", token);
  await put("/api/settings", before.json ?? { sites: [] }, token); // restore
  note("f.settings", { put: put1.status, get: after.status, sites: after.json?.sites?.length, restored: true });

  // ---- g: unauth 401s ----
  const unauth: Record<string, number> = {};
  unauth["/api/page/rank"] = (await post("/api/page/rank", rankBody)).status;
  unauth["/api/feedback"] = (await post("/api/feedback", { pageResultId: "x", clientId: "x", verdict: "more" })).status;
  unauth["/api/settings"] = (await get("/api/settings")).status;
  unauth["/api/profile/export"] = (await get("/api/profile/export")).status;
  unauth["/mcp"] = (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status;
  note("g.unauth", unauth);

  await db.sql.end();
  REPORT.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, "api-checks.json"), JSON.stringify(REPORT, null, 2));
  console.log(`\nreport -> ${join(OUT, "api-checks.json")}`);
}

main().catch((e) => {
  REPORT.error = String(e);
  writeFileSync(join(OUT, "api-checks.json"), JSON.stringify(REPORT, null, 2));
  console.error(e);
  process.exit(1);
});
