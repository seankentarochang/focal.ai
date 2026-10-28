import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "specs",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  webServer: [
    {
      // Invoke Next directly: the repo's global pnpm.cmd shim is broken on Windows.
      command: "node node_modules/next/dist/bin/next dev -p 3100",
      cwd: join(here, "..", "apps", "web"),
      port: 3100,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        QLOO_MOCK: "1",
        // No FOCAL_DEV_SESSION here: global-setup issues a real bearer token,
        // and the dev user can't satisfy the feedback route's DB writes.
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : { FOCAL_DEV_SESSION: "1" }),
      },
    },
    {
      command: "node fixture-server.mjs",
      cwd: here,
      port: 8443,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
