/**
 * Signal selection for one ranking (spec §5.5).
 *
 * - The top `topOverall` favourite things of any type (cross-domain taste).
 * - Filled up to `cap` with the strongest liked things of the page's type.
 * - Liked vibes that apply to the page's type: sent as Qloo tag signals for
 *   types listed in `tagSignalTypes`, otherwise kept as local boosts.
 *
 * Qloo honours tag signals but rejects per-signal weights (verified
 * 2026-10-20, spec §5.5), so strength is returned on every signal and the
 * Qloo adapter decides how (or whether) to encode it.
 */
import { favouriteThings, type InsightType, type ProfileV2, type VibeEntry } from "./taste";

export const DEFAULT_SIGNAL_CAP = 20;
export const DEFAULT_TOP_OVERALL = 5;
export const DEFAULT_TAG_SIGNAL_CAP = 10;

export interface Signal {
  id: string;
  name: string;
  strength: "love" | "like";
}

export interface SignalConfig {
  cap?: number;
  topOverall?: number;
  tagCap?: number;
  /** Types for which vibes are sent to Qloo as tag signals. Default: every type. */
  tagSignalTypes?: readonly InsightType[] | "all" | "none";
}

export interface SignalSelection {
  entities: Signal[];
  tags: Signal[];
  /** Vibes applied locally because tag signals are off for this type. */
  localBoosts: Signal[];
}

export function vibeApplies(vibe: VibeEntry, type: InsightType): boolean {
  return vibe.types === undefined || vibe.types.length === 0 || vibe.types.includes(type);
}

export function selectSignals(
  profile: ProfileV2,
  pageType: InsightType,
  config: SignalConfig = {},
): SignalSelection {
  const cap = Math.max(1, config.cap ?? DEFAULT_SIGNAL_CAP);
  const topOverall = Math.min(cap, Math.max(0, config.topOverall ?? DEFAULT_TOP_OVERALL));
  const tagCap = Math.max(0, config.tagCap ?? DEFAULT_TAG_SIGNAL_CAP);

  const favourites = favouriteThings(profile);
  const chosen = favourites.slice(0, topOverall);
  const chosenIds = new Set(chosen.map((t) => t.id));
  for (const thing of favourites) {
    if (chosen.length >= cap) break;
    if (thing.type !== pageType || chosenIds.has(thing.id)) continue;
    chosen.push(thing);
    chosenIds.add(thing.id);
  }

  const vibes = profile.entries
    .filter(
      (e): e is VibeEntry & { strength: "love" | "like" } =>
        e.kind === "vibe" && e.strength !== "dislike" && vibeApplies(e, pageType),
    )
    .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "love" ? -1 : 1));

  const tagTypes = config.tagSignalTypes ?? "all";
  const tagsAreSignals =
    tagTypes === "all" ? true : tagTypes === "none" ? false : tagTypes.includes(pageType);

  const vibeSignals: Signal[] = vibes.map((v) => ({ id: v.qlooId, name: v.name, strength: v.strength }));

  return {
    entities: chosen.map((t) => ({ id: t.qlooId, name: t.name, strength: t.strength as "love" | "like" })),
    tags: tagsAreSignals ? vibeSignals.slice(0, tagCap) : [],
    localBoosts: tagsAreSignals ? [] : vibeSignals,
  };
}
