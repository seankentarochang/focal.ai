import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProfileV2 } from "@focal-ai/core";
import type { FullConfig } from "@playwright/test";

export const WEB_ORIGIN = "http://localhost:3100";

/**
 * Builds the extension against the local web app, and when DATABASE_URL is set
 * (feedback needs a real profile store) seeds a user, a bearer session and the
 * same two-profile-seed entries the dev demo profile carries.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // node build.mjs — the same script `pnpm --filter @focal-ai/extension build`
  // runs, without the repo's broken global pnpm.cmd shim.
  execFileSync(process.execPath, ["build.mjs"], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "extension"),
    env: { ...process.env, FOCAL_ORIGIN: WEB_ORIGIN },
    stdio: "inherit",
  });

  const url = process.env.DATABASE_URL;
  if (!url) {
    writeFileSync(join(dirname(fileURLToPath(import.meta.url)), ".session.json"), JSON.stringify({ token: "e2e-token" }));
    return;
  }
  const { openDb, migrate } = await import("@focal-ai/db");
  const { addEntry } = await import("@focal-ai/core");
  const db = openDb(url);
  await migrate(db.sql);
  const live = !!process.env.FOCAL_E2E_LIVE;
  const user = await db.users.upsert(live ? "live-e2e@focal.test" : "e2e@focal.test");
  if (live) {
    // resolution_cache carries mock fixture IDs from offline runs; live mode
    // must not resolve items to fake entities.
    await db.sql`delete from resolution_cache`;
  }
  const { token } = await db.extensionSessions.issue(user.id);
  let profile: ProfileV2 = await db.profile.load(user.id);
  let seedList: readonly { qlooId: string; name: string; type: string; strength: string }[];
  if (live) {
    // Live mode: resolve seeds through the app's own live search — the mock
    // fixture IDs above don't exist in real Qloo.
    const found: { qlooId: string; name: string; type: string; strength: string }[] = [];
    for (const w of [
      { q: "Rintaro", type: "urn:entity:place", strength: "love" },
      { q: "State Bird Provisions", type: "urn:entity:place", strength: "love" },
      { q: "San Francisco", type: "urn:entity:destination", strength: "like" },
      { q: "Fugazi", type: "urn:entity:artist", strength: "love" },
    ]) {
      const res = await fetch(`${WEB_ORIGIN}/api/qloo/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: w.q, types: [w.type] }),
      });
      const j = (await res.json().catch(() => null)) as { entities?: { name: string; entityId?: string; id?: string }[] } | null;
      const top = j?.entities?.find((e) => e.name.toLowerCase() === w.q.toLowerCase());
      if (top?.entityId ?? top?.id) found.push({ qlooId: (top!.entityId ?? top!.id)!, name: top!.name, type: w.type, strength: w.strength });
    }
    seedList = found;
  } else {
    seedList = [
      { qlooId: "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948", name: "Fugazi", type: "urn:entity:artist", strength: "love" },
      { qlooId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01", name: "Rintaro", type: "urn:entity:place", strength: "like" },
    ];
  }
  for (const seed of seedList) {
    // Idempotent: the seeded user persists across runs.
    if (profile.entries.some((e) => e.kind === "thing" && "qlooId" in e && e.qlooId === seed.qlooId)) continue;
    profile = await db.profile.load(user.id); // addEntry doesn't bump the version — re-read each write
    const expected = profile.version;
    const write = addEntry(profile, { kind: "thing", ...seed, source: "manual" }, "manual");
    profile = write.profile;
    await db.profile.commit(user.id, write.event as never, expected);
  }
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), ".session.json"), JSON.stringify({ token, userId: user.id }));
  await db.sql.end();
}
