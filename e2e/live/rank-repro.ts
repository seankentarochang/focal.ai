import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { token } = JSON.parse(readFileSync(join(here, ".live-session.json"), "utf8"));
const names = ["Rintaro", "Lazy Bear", "State Bird Provisions", "Kokkari Estiatorio", "House of Prime Rib", "Zuni Café", "Saison", "Che Fico", "Nopa", "Foreign Cinema", "Liholiho Yacht Club", "Rich Table"];
const rk = await fetch("http://localhost:3300/api/page/rank", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    host: "www.yelp.com",
    pathPattern: "/search",
    pageType: "place",
    items: names.map((name, i) => ({ clientId: `c${i}`, name, type: "place", city: "San Francisco" })),
  }),
});
console.log("rank", rk.status, JSON.stringify(await rk.json()).slice(0, 300));
