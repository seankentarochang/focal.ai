import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";

const dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FIXTURE_PORT ?? 8443);

/** Host header → fixture file. Every host resolves to 127.0.0.1 via --host-resolver-rules. */
const HOSTS = {
  "www.yelp.test": "restaurant-list.html",
  "secure.yelp.test": "password-list.html",
  "bank.test": "restaurant-list.html",
};

const pem = await selfsigned.generate([{ name: "commonName", value: "*.test" }], {
  altNames: [{ type: 2, value: "*.test" }],
  keySize: 2048,
  days: 1,
});

const server = createServer({ key: pem.private, cert: pem.cert }, (req, res) => {
  const host = (req.headers.host ?? "").split(":")[0] ?? "";
  const file = HOSTS[host];
  if (!file) {
    res.writeHead(404).end("unknown host");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(readFileSync(join(dir, "fixtures", file)));
});

server.listen(PORT, "127.0.0.1", () => console.log(`fixtures on https://127.0.0.1:${PORT}`));
