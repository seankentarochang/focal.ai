import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
const origin = (process.env.FOCAL_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "popup"), { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  define: { __FOCAL_ORIGIN__: JSON.stringify(origin) },
  logLevel: "info",
  minify: process.env.NODE_ENV === "production",
};

await build({ ...common, entryPoints: [join(root, "src/background.ts")], outfile: join(out, "background.js"), format: "esm" });
await build({ ...common, entryPoints: [join(root, "src/content.ts")], outfile: join(out, "content.js"), format: "iife" });
await build({ ...common, entryPoints: [join(root, "src/popup/popup.ts")], outfile: join(out, "popup/popup.js"), format: "esm" });
copyFileSync(join(root, "src/popup/popup.html"), join(out, "popup/popup.html"));

const manifest = {
  manifest_version: 3,
  name: "focal",
  description: "Lifts the items that match your taste to the top of any list.",
  version: pkg.version,
  minimum_chrome_version: "120",
  permissions: ["storage", "tabs"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: ["http://*/*", "https://*/*"], js: ["content.js"], run_at: "document_idle" }],
  action: { default_title: "focal", default_popup: "popup/popup.html" },
  externally_connectable: { matches: [`${origin}/*`] },
  incognito: "spanning",
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (process.argv.includes("--zip")) {
  const zip = join(root, `focal-extension-${pkg.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: out, stdio: "inherit" });
  console.log(`wrote ${zip}`);
}
