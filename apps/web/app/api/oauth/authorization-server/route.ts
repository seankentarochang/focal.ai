import { authkitIssuer } from "@/lib/server/mcp/auth";

/** Mirrors AuthKit's metadata for MCP clients that look it up on the resource's origin.
 * The discovery doc is static per issuer — memoize it (E S4-5). */
let cached: unknown | undefined; // the issuer is per-deployment — one value is enough

export async function GET(): Promise<Response> {
  const issuer = authkitIssuer();
  if (!issuer) return Response.json({ error: { code: "NOT_FOUND", message: "OAuth is not configured" } }, { status: 404 });
  // Only a parsed non-null object from an ok response may be cached — a
  // rejection, non-ok response, array or primitive is never stored (R5-4/R6-5).
  if (cached === undefined) {
    try {
      const r = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) });
      const body = r.ok ? await r.json() : undefined;
      if (body !== null && typeof body === "object" && !Array.isArray(body)) cached = body;
    } catch {
      // leave cached undefined
    }
  }
  if (cached === undefined) {
    return Response.json({ error: { code: "UPSTREAM", message: "authorization server unavailable" } }, { status: 502 });
  }
  return Response.json(cached, { headers: { "Access-Control-Allow-Origin": "*" } });
}
