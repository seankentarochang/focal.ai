import { authkitIssuer } from "@/lib/server/mcp/auth";

/** Mirrors AuthKit's metadata for MCP clients that look it up on the resource's origin.
 * The discovery doc is static per issuer — memoize it (E S4-5). */
const discovered = new Map<string, Promise<unknown>>();

export async function GET(): Promise<Response> {
  const issuer = authkitIssuer();
  if (!issuer) return Response.json({ error: { code: "NOT_FOUND", message: "OAuth is not configured" } }, { status: 404 });
  let doc = discovered.get(issuer);
  if (!doc) {
    // Only a parsed object from an ok response may live in the cache — a
    // rejection or non-ok response deletes itself and is never stored (R5-4).
    doc = (async () => {
      try {
        const r = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return undefined;
        return await r.json();
      } catch {
        return undefined;
      }
    })();
    discovered.set(issuer, doc);
  }
  const body = await doc;
  if (body === undefined) {
    discovered.delete(issuer);
    return Response.json({ error: { code: "UPSTREAM", message: "authorization server unavailable" } }, { status: 502 });
  }
  return Response.json(body, { headers: { "Access-Control-Allow-Origin": "*" } });
}
