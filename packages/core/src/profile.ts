/**
 * Taste-profile model and JSON codec.
 *
 * The profile is the ONLY stateful artifact of the engine, and it lives in the
 * browser (localStorage key PROFILE_STORAGE_KEY). Every function here is pure:
 * it returns new objects and never mutates its inputs.
 */
import { z } from "zod";
import type { TasteProfile, TasteSeed } from "./types";

export const PROFILE_STORAGE_KEY = "focal.profile.v1";

const seedSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().min(1),
  subtype: z.string().min(1),
  disambiguation: z.string().optional(),
  polarity: z.enum(["like", "dislike"]),
  weight: z.number().finite(),
  source: z.enum(["typed", "searched", "agent"]),
  addedAt: z.string(),
});

const ruleSchema = z.object({
  kind: z.enum(["exclude", "collapse", "boost"]),
  match: z.object({
    tagId: z.string().optional(),
    brandId: z.string().optional(),
    flag: z.literal("sponsored").optional(),
  }),
  weight: z.number().finite().optional(),
});

const profileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  seeds: z.array(seedSchema),
  rules: z.array(ruleSchema),
});

export function createEmptyProfile(): TasteProfile {
  return { version: 1, updatedAt: new Date().toISOString(), seeds: [], rules: [] };
}

/**
 * Add a seed, deduped by entityId. Re-adding an entity replaces its
 * polarity/weight/subtype/name (so flipping like -> dislike works) while the
 * original addedAt is kept; source and disambiguation of the existing seed are
 * preserved. Always returns a new profile with a fresh updatedAt.
 */
export function addSeed(p: TasteProfile, seed: TasteSeed): TasteProfile {
  const index = p.seeds.findIndex((s) => s.entityId === seed.entityId);
  const seeds =
    index === -1
      ? [...p.seeds, seed]
      : p.seeds.map((s, i) =>
          i === index
            ? {
                ...s,
                name: seed.name,
                subtype: seed.subtype,
                polarity: seed.polarity,
                weight: seed.weight,
                addedAt: s.addedAt,
              }
            : s,
        );
  return { ...p, updatedAt: new Date().toISOString(), seeds };
}

/** Remove a seed by entityId. Idempotent. Always returns a new profile. */
export function removeSeed(p: TasteProfile, entityId: string): TasteProfile {
  return {
    ...p,
    updatedAt: new Date().toISOString(),
    seeds: p.seeds.filter((s) => s.entityId !== entityId),
  };
}

/** Deterministic JSON: explicit key order for stable output across callers. */
export function serializeProfile(p: TasteProfile): string {
  return JSON.stringify({
    version: p.version,
    updatedAt: p.updatedAt,
    seeds: p.seeds.map((s) => ({
      entityId: s.entityId,
      name: s.name,
      subtype: s.subtype,
      ...(s.disambiguation !== undefined ? { disambiguation: s.disambiguation } : {}),
      polarity: s.polarity,
      weight: s.weight,
      source: s.source,
      addedAt: s.addedAt,
    })),
    rules: p.rules.map((r) => ({
      kind: r.kind,
      match: {
        ...(r.match.tagId !== undefined ? { tagId: r.match.tagId } : {}),
        ...(r.match.brandId !== undefined ? { brandId: r.match.brandId } : {}),
        ...(r.match.flag !== undefined ? { flag: r.match.flag } : {}),
      },
      ...(r.weight !== undefined ? { weight: r.weight } : {}),
    })),
  });
}

/**
 * Parse and validate a serialized profile. Throws a clear Error on bad JSON,
 * an unsupported version, or an invalid shape — callers (the web layer) decide
 * whether to surface a warning and fall back to createEmptyProfile().
 */
export function deserializeProfile(json: string): TasteProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Invalid profile JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid profile: expected a JSON object");
  }
  const version = (raw as Record<string, unknown>).version;
  if (version !== 1) {
    throw new Error(`Unsupported profile version: ${JSON.stringify(version)} (expected 1)`);
  }
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid profile shape: ${detail}`);
  }
  return parsed.data as TasteProfile;
}
