/** Only same-origin paths survive sign-in; anything else falls back to /connect. */
export function safeReturnTo(raw: string | null | undefined, fallback = "/connect"): string {
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}
