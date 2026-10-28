/**
 * Layout learning (X-04): once the identifier has picked names on a page, the
 * server learns where names sit in that card structure, the page's type and
 * where the city comes from, and saves a Layout. Later visits to a matching
 * layout are answered locally — the extension replays the same applyLayout.
 *
 * Layouts hold structure only (§6): snippet indexes, hint indexes, the type
 * and a structure fingerprint. No card text or page content is stored.
 */
import { getDb } from "../db";
import { CONFIDENCE_THRESHOLD, type CardAnswer, type PageAnswer } from "./identify";
import { SHORT_TYPES, type IdentifyBody, type IdentifiedItem, type ShortType } from "./schemas";

/** Structure-only layout description shared over the wire with the extension. */
export interface LearnedLayout {
  fingerprint: string;
  namePosition: { snippetIndex: number };
  type: ShortType;
  citySource: { hintIndex: number } | null;
}

/** Row shape accepted by the layouts repo (db.layouts.save). */
export interface SavableLayout extends LearnedLayout {
  hostname: string;
  pathPattern: string;
  confidence: number;
}

/** Persisted row shape read back from the layouts repo. */
export interface StoredLayout {
  id: string;
  hostname: string;
  pathPattern: string;
  fingerprint: string;
  namePosition: unknown;
  type: string;
  citySource: unknown;
  confidence: number;
  learnedAt: string;
}

export interface LayoutStore {
  find(hostname: string, pathPattern: string, fingerprint: string): Promise<StoredLayout | null>;
  save(layout: SavableLayout): Promise<StoredLayout>;
}

let storeOverride: LayoutStore | null | undefined;

/** db.layouts when a database is configured; null keeps today's behaviour. */
export function getLayoutStore(): LayoutStore | null {
  if (storeOverride !== undefined) return storeOverride;
  return getDb()?.layouts ?? null;
}

export function __setLayoutStoreForTests(store: LayoutStore | null | undefined): void {
  storeOverride = store;
}

const MIN_CONFIDENT_CARDS = 3;
const MIN_AGREEMENT = 0.8;
const CITY_TYPES: readonly ShortType[] = ["place", "destination"];

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Majority entry of a numeric vote map; ties go to the smaller index. */
function majority(votes: Map<number, number>): [number, number] | null {
  let best: [number, number] | null = null;
  for (const [index, count] of votes) {
    if (best === null || count > best[1] || (count === best[1] && index < best[0])) {
      best = [index, count];
    }
  }
  return best;
}

function confidentCards(answer: PageAnswer): (CardAnswer & { name: string; type: ShortType })[] {
  return answer.cards.filter(
    (c): c is CardAnswer & { name: string; type: ShortType } =>
      c.confidence >= CONFIDENCE_THRESHOLD && c.name !== null && c.type !== null,
  );
}

/**
 * Derives a Layout from one identified page, or null when the cards don't
 * agree enough to be safe to replay: needs ≥ 3 confident cards of the page
 * type and ≥ 0.8 agreement on where the name sits (and on the city hint for
 * places/destinations).
 */
export function deriveLayout(body: IdentifyBody, answer: PageAnswer): SavableLayout | null {
  if (!answer.isList) return null;
  const confident = confidentCards(answer);
  const typeCounts = new Map<string, number>();
  for (const card of confident) typeCounts.set(card.type, (typeCounts.get(card.type) ?? 0) + 1);
  const pageType = ([...typeCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as ShortType | null;
  if (pageType === null) return null;
  const typed = confident.filter((card) => card.type === pageType);
  if (typed.length < MIN_CONFIDENT_CARDS) return null;

  const cardsByClientId = new Map(body.cards.map((card) => [card.clientId, card]));
  const nameVotes = new Map<number, number>();
  for (const card of typed) {
    const index =
      cardsByClientId.get(card.clientId)?.snippets.findIndex((s) => sameText(s, card.name)) ?? -1;
    if (index >= 0) nameVotes.set(index, (nameVotes.get(index) ?? 0) + 1);
  }
  const nameWinner = majority(nameVotes);
  if (nameWinner === null) return null;
  const agreement = nameWinner[1] / typed.length;
  if (agreement < MIN_AGREEMENT) return null;

  let citySource: LearnedLayout["citySource"] = null;
  if (CITY_TYPES.includes(pageType)) {
    const cityVotes = new Map<number, number>();
    for (const card of typed) {
      const index = card.city === null ? -1 : body.cityHints.findIndex((h) => sameText(h, card.city!));
      if (index >= 0) cityVotes.set(index, (cityVotes.get(index) ?? 0) + 1);
    }
    const cityWinner = majority(cityVotes);
    if (cityWinner !== null && cityWinner[1] / typed.length >= MIN_AGREEMENT) {
      citySource = { hintIndex: cityWinner[0] };
    }
  }

  return {
    hostname: body.host,
    pathPattern: body.pathPattern,
    fingerprint: body.signature,
    namePosition: { snippetIndex: nameWinner[0] },
    type: pageType,
    citySource,
    confidence: agreement,
  };
}

/** Validates a stored layout row into the structure-only shape; null when malformed. */
export function readLayout(row: {
  fingerprint: unknown;
  namePosition: unknown;
  type: unknown;
  citySource: unknown;
}): LearnedLayout | null {
  const snippetIndex =
    row.namePosition !== null &&
    typeof row.namePosition === "object" &&
    typeof (row.namePosition as Record<string, unknown>).snippetIndex === "number"
      ? (row.namePosition as { snippetIndex: number }).snippetIndex
      : null;
  const type = typeof row.type === "string" && (SHORT_TYPES as readonly string[]).includes(row.type)
    ? (row.type as ShortType)
    : null;
  const hintIndex =
    row.citySource !== null &&
    typeof row.citySource === "object" &&
    typeof (row.citySource as Record<string, unknown>).hintIndex === "number"
      ? (row.citySource as { hintIndex: number }).hintIndex
      : null;
  if (
    typeof row.fingerprint !== "string" ||
    snippetIndex === null ||
    !Number.isInteger(snippetIndex) ||
    snippetIndex < 0 ||
    type === null
  ) {
    return null;
  }
  return {
    fingerprint: row.fingerprint,
    namePosition: { snippetIndex },
    type,
    citySource: hintIndex !== null && Number.isInteger(hintIndex) && hintIndex >= 0 ? { hintIndex } : null,
  };
}

/**
 * Replays a layout against a freshly detected page: items are the cards whose
 * snippet at the learned position exists, named by that snippet. Needs ≥ 3
 * items to stand on its own.
 */
export function applyLayout(
  layout: { fingerprint: unknown; namePosition: unknown; type: unknown; citySource: unknown },
  body: IdentifyBody,
): { isList: true; pageType: ShortType; items: IdentifiedItem[] } | null {
  const learned = readLayout(layout);
  if (learned === null) return null;
  const { snippetIndex } = learned.namePosition;
  const hintIndex = learned.citySource?.hintIndex;
  const items: IdentifiedItem[] = [];
  for (const card of body.cards) {
    const name = card.snippets[snippetIndex];
    if (name === undefined) continue;
    const city = hintIndex !== undefined ? body.cityHints[hintIndex] : undefined;
    items.push({
      clientId: card.clientId,
      name,
      type: learned.type,
      ...(city !== undefined ? { city } : {}),
    });
  }
  if (items.length < MIN_CONFIDENT_CARDS) return null;
  return { isList: true, pageType: learned.type, items };
}
