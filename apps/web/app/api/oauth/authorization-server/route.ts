import { authkitIssuer } from "@/lib/server/mcp/auth";

/** Mirrors AuthKit's metadata for MCP clients that look it up on the resource's origin. */
export async function GET(): Promise<Response> {
  const issuer = authkitIssuer();
  if (!issuer) return Response.json({ error: { code: "NOT_FOUND", message: "OAuth is not configured" } }, { status: 404 });
  const upstream = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) });
  if (!upstream.ok) return Response.json({ error: { code: "UPSTREAM", message: "authorization server unavailable" } }, { status: 502 });
  return Response.json(await upstream.json(), { headers: { "Access-Control-Allow-Origin": "*" } });
}
