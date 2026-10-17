import { vi } from "vitest";
import { createQlooClient } from "../src/client.js";
import { QlooError } from "../src/errors.js";
import type { QlooClient } from "../src/types.js";

export const TEST_BASE_URL = "https://qloo.test";
export const TEST_API_KEY = "test-api-key";

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function statusResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response("upstream error", { status, headers });
}

type FetchInput = Parameters<typeof globalThis.fetch>[0];

export function createFetchSpy(impl: (input: FetchInput, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

export type FetchSpy = ReturnType<typeof createFetchSpy>;

export function requestAt(spy: FetchSpy, index = 0): { url: URL; init: RequestInit | undefined } {
  const call = spy.mock.calls[index];
  if (call === undefined) throw new Error(`fetch call #${index} is missing`);
  return { url: new URL(String(call[0])), init: call[1] };
}

export function createLiveClient(
  fetchImpl: FetchSpy,
  overrides: { timeoutMs?: number; cacheTtlMs?: number } = {},
): QlooClient {
  return createQlooClient({
    apiKey: TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
    fetchImpl,
    cacheTtlMs: overrides.cacheTtlMs ?? 0,
    ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
  });
}

export async function rejection(promise: Promise<unknown>): Promise<QlooError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QlooError) return error;
    throw error;
  }
  throw new Error("expected promise to reject, but it resolved");
}

export function abortErrorLike(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}
