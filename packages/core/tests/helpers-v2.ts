import type { InsightType, ProfileEntry, ProfileV2, Strength } from "../src/index";

let n = 0;
export const fixedClock = {
  now: () => "2026-10-20T00:00:00.000Z",
  newId: () => `id-${++n}`,
};

export function thing(qlooId: string, opts: { name?: string; type?: InsightType; strength?: Strength; createdAt?: string } = {}): ProfileEntry {
  return {
    id: `e-${qlooId}`,
    kind: "thing",
    qlooId,
    name: opts.name ?? qlooId,
    type: opts.type ?? "urn:entity:place",
    strength: opts.strength ?? "like",
    source: "chat",
    createdAt: opts.createdAt ?? "2026-10-01T00:00:00.000Z",
  };
}

export function vibe(qlooId: string, opts: { name?: string; strength?: Strength; types?: InsightType[] } = {}): ProfileEntry {
  return {
    id: `v-${qlooId}`,
    kind: "vibe",
    qlooId,
    name: opts.name ?? qlooId,
    strength: opts.strength ?? "like",
    ...(opts.types ? { types: opts.types } : {}),
    source: "chat",
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

export function rule(qlooId: string, opts: { name?: string; status?: "pending" | "active" } = {}): ProfileEntry {
  return {
    id: `r-${qlooId}`,
    kind: "rule",
    qlooId,
    name: opts.name ?? qlooId,
    strength: "never",
    status: opts.status ?? "active",
    source: "manual",
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

export function profileOf(...entries: ProfileEntry[]): ProfileV2 {
  return { version: 2, updatedAt: "2026-10-20T00:00:00.000Z", entries };
}
