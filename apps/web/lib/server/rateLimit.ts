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
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return "local";
}
