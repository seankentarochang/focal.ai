const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_MS = 60000;

const hits = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): { ok: true } | { ok: false; retryAfterMs: number } {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();

  if (hits.size > 10000) {
    // Evict keys whose newest hit is outside every window we use.
    const maxWindow = DEFAULT_WINDOW_MS * 60;
    for (const [k, ats] of hits) {
      if (ats.every((at) => now - at > maxWindow)) hits.delete(k);
    }
    if (hits.size > 10000) hits.clear();
  }
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: Math.max(1, oldest + windowMs - now) };
  }

  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

export function __resetRateLimitForTests(): void {
  hits.clear();
}

export function clientKey(req: Request): string {
  // x-forwarded-for is only trustworthy on Vercel, which overwrites the header
  // rather than appending to a client-supplied value
  // (https://vercel.com/docs/edge-network/headers/request-headers#x-forwarded-for).
  // Everywhere else the header is attacker-controlled, so fall back to a
  // single global bucket instead of a spoofable per-IP one.
  if (process.env.VERCEL) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded !== null) {
      const first = forwarded.split(",")[0]?.trim();
      if (first !== undefined && first.length > 0) return first;
    }
  }
  return "local";
}
