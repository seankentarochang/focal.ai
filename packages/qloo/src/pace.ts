import type { QlooClient, QlooEntityType } from "./types";

export interface WarmSearchRequest {
  query: string;
  types?: string[];
  location?: string;
}

export interface WarmSearchOptions {
  concurrency?: number;
  minIntervalMs?: number;
}

export interface WarmSearchResult {
  warmed: number;
  failed: number;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MIN_INTERVAL_MS = 240;

export async function warmSearchCache(
  client: QlooClient,
  requests: WarmSearchRequest[],
  opts: WarmSearchOptions = {},
): Promise<WarmSearchResult> {
  const concurrency = positiveInt(opts.concurrency, DEFAULT_CONCURRENCY);
  const minIntervalMs = nonNegativeNumber(opts.minIntervalMs, DEFAULT_MIN_INTERVAL_MS);
  if (requests.length === 0) return { warmed: 0, failed: 0 };

  let warmed = 0;
  let failed = 0;
  let nextIndex = 0;
  let nextStartAt = 0;
  let startGate: Promise<void> = Promise.resolve();

  function reserveStart(): Promise<void> {
    const slot = startGate.then(async () => {
      const waitMs = nextStartAt - Date.now();
      if (waitMs > 0) await delay(waitMs);
      nextStartAt = Date.now() + minIntervalMs;
    });
    startGate = slot.catch(() => undefined);
    return slot;
  }

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const request = requests[index];
      if (request === undefined) return;
      await reserveStart();
      try {
        await client.search({
          query: request.query,
          ...(request.types !== undefined ? { types: request.types as QlooEntityType[] } : {}),
          ...(request.location !== undefined ? { location: request.location } : {}),
        });
        warmed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  const workerCount = Math.min(concurrency, requests.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { warmed, failed };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.trunc(value);
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}
