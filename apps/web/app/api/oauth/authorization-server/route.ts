import { authkitIssuer } from "@/lib/server/mcp/auth";

/** Mirrors AuthKit's metadata for MCP clients that look it up on the resource's origin.
 * The discovery doc is static per issuer — memoize it (E S4-5). */
const discovered = new Map<string, Promise<unknown>>();

export async function GET(): Promise<Response> {
  const issuer = authkitIssuer();
  if (!issuer) return Response.json({ error: { code: "NOT_FOUND", message: "OAuth is not configured" } }, { status: 404 });
  let doc = discovered.get(issuer);
  if (!doc) {
    doc = fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) })
      .then(async (r) => (r.ok ? r.json() : discovered.delete(issuer)));
    discovered.set(issuer, doc);
  }
  const body = await doc;
  if (body === undefined) return Response.json({ error: { code: "UPSTREAM", message: "authorization server unavailable" } }, { status: 502 });
  return Response.json(body, { headers: { "Access-Control-Allow-Origin": "*" } });
}
