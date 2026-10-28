/** Reproduce the e2e content-script calls against a live server to see where apply stops. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://localhost:3300";
const here = dirname(fileURLToPath(import.meta.url));
const { token } = JSON.parse(
  readFileSync(join(here, process.env.LIVE_TOKEN ? ".live-session.json" : join("..", ".session.json")), "utf8"),
);

const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const names = ["House of Prime Rib", "Zuni Café", "Rintaro", "State Bird Provisions", "Che Fico"];
const cards = names.map((name, i) => ({
  clientId: `c${i}`,
  snippets: [name, "San Francisco", "$$"],
  links: [],
}));

const idRes = await fetch(`${BASE}/api/page/identify`, {
  method: "POST",
  headers,
  body: JSON.stringify({ host: "www.yelp.test", pathPattern: "/search", cityHints: ["San Francisco"], cards }),
});
const id = await idRes.json();
console.log("identify", idRes.status, JSON.stringify(id).slice(0, 800));

const items = (id.items ?? cards.map((c, i) => ({ clientId: c.clientId, name: names[i], type: "place", city: "San Francisco" })));
const rk = await fetch(`${BASE}/api/page/rank`, {
  method: "POST",
  headers,
  body: JSON.stringify({ host: "www.yelp.test", pathPattern: "/search", pageType: id.pageType ?? "place", items }),
});
const rank = await rk.json();
console.log("rank", rk.status, JSON.stringify(rank).slice(0, 800));
