import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Db } from "@focal-ai/db";
import { DbError } from "@focal-ai/db";
import { ensureUser, workosGone } from "../auth/users";

/** OAuth access tokens are JWTs, longer than the extension's session tokens. */
function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S{1,4096})$/i.exec(req.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}

/** AuthKit is the OAuth authorization server for the hosted MCP endpoint. */
export function authkitIssuer(): string | null {
  const raw = process.env.WORKOS_AUTHKIT_DOMAIN?.trim();
  if (!raw) return null;
  return (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, "");
}

/** Public origin of this deployment, honouring the proxy's forwarded headers. */
export function publicOrigin(req: Request): string {
  const configured = process.env.FOCAL_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const mcpResourceUrl = (req: Request) => `${publicOrigin(req)}/mcp`;
export const protectedResourceMetadataUrl = (req: Request) => `${publicOrigin(req)}/.well-known/oauth-protected-resource/mcp`;

export function protectedResourceMetadata(req: Request) {
  const issuer = authkitIssuer();
  return {
    resource: mcpResourceUrl(req),
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
    resource_name: "focal",
    resource_documentation: `${publicOrigin(req)}/connect`,
  };
}

/** 401 that points MCP clients at the OAuth discovery document (RFC 9728). */
export function mcpUnauthorized(req: Request, error?: "invalid_token"): Response {
  const params = [`resource_metadata="${protectedResourceMetadataUrl(req)}"`];
  if (error) params.unshift(`error="${error}"`);
  return Response.json(
    { error: { code: "UNAUTHORIZED", message: "Sign in to focal to use this server." } },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` } },
  );
}

let jwks: { issuer: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;
function jwksFor(issuer: string) {
  if (jwks?.issuer !== issuer) jwks = { issuer, set: createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) };
  return jwks.set;
}

/** Audiences a focal MCP token may carry: the MCP resource, or the focal app when no resource indicator is set up. */
function allowedAudiences(req: Request): string[] {
  const extra = (process.env.MCP_ALLOWED_AUDIENCES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [mcpResourceUrl(req), process.env.WORKOS_CLIENT_ID ?? "", ...extra].filter(Boolean);
}

export async function verifyAccessToken(req: Request, token: string): Promise<JWTPayload | null> {
  const issuer = authkitIssuer();
  if (!issuer) return null;
  try {
    const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer });
    const aud = typeof payload.aud === "string" ? [payload.aud] : (payload.aud ?? []);
    if (aud.length === 0 || !aud.some((a) => allowedAudiences(req).includes(a))) return null;
    return payload.sub ? payload : null;
  } catch (e) {
    if (process.env.MCP_AUTH_DEBUG) console.error(e);
    return null;
  }
}

const KNOWN_CLIENTS: [RegExp, string][] = [
  [/claude|anthropic/i, "claude"],
  [/chatgpt|openai/i, "chatgpt"],
  [/cursor/i, "cursor"],
  [/codex/i, "codex"],
  [/windsurf|codeium/i, "windsurf"],
  [/vscode|visual studio code|copilot/i, "vscode"],
];

/** Short client name for activity attribution ("via claude"), from the token's client id or the user agent. */
export function clientLabel(claims: JWTPayload | null, userAgent: string | null): string {
  const clientId = [claims?.client_id, claims?.azp].find((v): v is string => typeof v === "string" && v.length > 0);
  for (const hint of [clientId, userAgent]) {
    if (!hint) continue;
    const known = KNOWN_CLIENTS.find(([re]) => re.test(hint));
    if (known) return known[1];
  }
  if (clientId && /^https?:\/\//.test(clientId)) {
    try {
      return new URL(clientId).hostname.replace(/^www\./, "").slice(0, 40);
    } catch {
      /* fall through */
    }
  }
  return "assistant";
}

export interface McpCaller {
  userId: string;
  client: string;
  scopes: string[];
}

async function userForWorkosId(db: Db, workosId: string): Promise<string | null> {
  // No cache: account deletion must take effect on the very next MCP call.
  let user = await db.users.byAuthId("workos", workosId);
  if (!user && process.env.WORKOS_API_KEY) {
    const { WorkOS } = await import("@workos-inc/node");
    // Only a 404 proves the WorkOS user is gone; any other error must surface.
    const remote = await new WorkOS(process.env.WORKOS_API_KEY).userManagement.getUser(workosId).catch((e: unknown) => {
      if (workosGone(e)) return null;
      throw e;
    });
    if (remote?.email) {
      try {
        user = await ensureUser(db, { id: workosId, email: remote.email, emailVerified: remote.emailVerified === true }, { workosVerified: true });
      } catch (e) {
        if (e instanceof DbError && e.code === "CONFLICT") return null; // invalid token for MCP purposes
        throw e;
      }
    }
  }
  return user?.id ?? null;
}

/**
 * Resolves the MCP caller from an AuthKit access token, or from an extension
 * session token for clients that only support a static bearer header.
 */
export async function resolveMcpCaller(req: Request, db: Db): Promise<McpCaller | "missing" | "invalid"> {
  const token = bearer(req);
  if (!token) return "missing";
  const ua = req.headers.get("user-agent");
  // MCP is OAuth-only: fx_ extension tokens carry full REST power (settings,
  // feedback, undo) which MCP clients must not get via the documented bearer
  // path (R7-7). Extension tokens still work on the REST routes.
  if (token.startsWith("fx_")) return "invalid";
  const claims = await verifyAccessToken(req, token);
  if (!claims?.sub) return "invalid";
  const userId = await userForWorkosId(db, claims.sub);
  if (!userId) return "invalid";
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  return { userId, client: clientLabel(claims, ua), scopes };
}

export function __resetMcpAuthForTests() {
  jwks = null;
}
