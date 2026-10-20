/** WorkOS AuthKit is active only when its env is complete; otherwise auth routes 404. */
export function authEnabled(): boolean {
  return Boolean(
    process.env.WORKOS_CLIENT_ID?.trim() &&
      (process.env.WORKOS_COOKIE_PASSWORD?.trim().length ?? 0) >= 32 &&
      process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim(),
  );
}

export function authDisabledResponse(): Response {
  return Response.json({ error: { code: "NOT_CONFIGURED", message: "sign-in is not configured" } }, { status: 404 });
}
