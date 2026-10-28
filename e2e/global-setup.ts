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
  const user = await db.users.upsert("e2e@focal.test");
  const { token } = await db.extensionSessions.issue(user.id);
  let profile: ProfileV2 = await db.profile.load(user.id);
  for (const seed of [
    { qlooId: "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948", name: "Fugazi", type: "urn:entity:artist", strength: "love" },
    { qlooId: "3A8F2C41-7B6D-4E92-8A55-1F0C9D2E6A01", name: "Rintaro", type: "urn:entity:place", strength: "like" },
  ] as const) {
    // Idempotent: the seeded user persists across runs.
    if (profile.entries.some((e) => e.kind === "thing" && "qlooId" in e && e.qlooId === seed.qlooId)) continue;
    const expected = profile.version;
    const write = addEntry(profile, { kind: "thing", ...seed, source: "manual" }, "manual");
    profile = write.profile;
    await db.profile.commit(user.id, write.event as never, expected);
  }
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), ".session.json"), JSON.stringify({ token, userId: user.id }));
  await db.sql.end();
}
