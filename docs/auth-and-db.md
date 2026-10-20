# Sign-in service and hosted Postgres (V-04)

Requirements (spec §4, decisions 16 and 20): Google and email-link sign-in, free tier, and an OAuth 2.1 authorization server for MCP connectors (ChatGPT, claude.ai). That means resource indicators plus Client ID Metadata Documents (CIMD), with dynamic client registration (DCR) for older clients. It also has to work on Vercel and hand the extension a session token.

## Sign-in

| Option | MCP OAuth | Free tier | Notes |
|---|---|---|---|
| **WorkOS AuthKit** | Yes: CIMD, DCR toggle, resource indicators, token verification ([docs](https://workos.com/docs/authkit/mcp)) | Up to 1M monthly active users | Hosted UI with Google and magic link; Vercel preview URLs supported as redirect wildcards |
| Clerk | Yes: CIMD, DCR, consent screens ([docs](https://clerk.com/docs/guides/development/mcp/overview)) | 50k monthly retained users per app | Mature Next.js SDK; MCP support is solid but the free tier is smaller |
| Better Auth | Yes: `@better-auth/mcp` + `@better-auth/cimd`; never enables DCR ([docs](https://www.better-auth.com/docs/plugins/mcp)) | Free (self-hosted library) | Lives in our own Postgres with no vendor, but we own the security surface. Without DCR, older MCP clients can't connect |
| Supabase Auth | OAuth 2.1 server ([docs](https://supabase.com/docs/guides/auth/oauth-server)) | 50k MAU | Couples auth to Supabase's database; free projects pause after 1 week of inactivity |
| Stytch | Connected Apps with DCR ([docs](https://stytch.com/docs/guides/connected-apps/mcp-servers)) | — | Fine, but no advantage over the above |

**Recommendation: WorkOS AuthKit.**
- Biggest free tier.
- First-class MCP support, including DCR for ChatGPT / claude.ai clients that still need it.
- Hosted sign-in, so no auth UI to build before the deadline.

Fallback: Better Auth, if we would rather not depend on a vendor.

**The extension token is ours either way.** After AuthKit sign-in the website issues an opaque, revocable extension session (stored hashed in Postgres) and hands it over through `externally_connectable` (`focal:session`, already implemented in the extension). The extension never holds a provider token.

## Hosted Postgres

| Option | Free tier | Notes |
|---|---|---|
| **Neon** | Free plan with scale-to-zero (suspends after 5 min idle, wakes on connect) | Native Vercel Marketplace integration; branch per preview deploy; plain Postgres works with `@focal-ai/db` (postgres.js) |
| Supabase | 500 MB, 2 projects | Paused after 1 week of inactivity, which is risky for judges trying the demo later |
| Vercel Postgres | — | Now provisioned through the Marketplace (Neon under the hood); same as choosing Neon |

**Recommendation: Neon** via the Vercel Marketplace. The first query after an idle period pays a cold start of under a second. Page results expire after 24 h and are tiny, so the free storage is ample.

## What's needed to proceed

- A WorkOS account: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and the redirect URI set to `<site>/auth/callback`.
- A Neon database: `DATABASE_URL` (pooled connection string).
- Until then, P-02 develops against local Postgres and WorkOS staging keys.
