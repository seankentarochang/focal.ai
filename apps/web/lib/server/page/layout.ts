/**
 * Layout learning (X-04): once the identifier has picked names on a page, the
 * server derives where names sit in that card structure, the page's type and
 * where the city comes from, and returns the layout in the identify response.
 * The extension stores it locally — the server never stores layouts (D-18).
 *
 * Layouts hold structure only (§6): a snippet index, a hint index, the type
 * and the request signature. No card text or page content is stored.
 */
import { CONFIDENCE_THRESHOLD, type CardAnswer, type PageAnswer } from "./identify";
import type { IdentifyBody, ShortType } from "./schemas";

/** Structure-only layout description sent to the extension for local storage. */
export interface LearnedLayout {
  fingerprint: string;
  namePosition: { snippetIndex: number };
  type: ShortType;
  citySource: { hintIndex: number } | null;
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
 * Derives a layout from one identified page, or null when it isn't safe to
 * replay: every confident card must agree on the page type, and every
 * confident typed card's city must map to the same hint (a null city counts
 * as disagreement → citySource stays null).
 */
export function deriveLayout(body: IdentifyBody, answer: PageAnswer): LearnedLayout | null {
  if (!answer.isList) return null;
  const confident = confidentCards(answer);
  if (confident.length < MIN_CONFIDENT_CARDS) return null;
  const pageType = confident[0].type;
  if (!confident.every((card) => card.type === pageType)) return null;

  const cardsByClientId = new Map(body.cards.map((card) => [card.clientId, card]));
  const nameVotes = new Map<number, number>();
  for (const card of confident) {
    const index =
      cardsByClientId.get(card.clientId)?.snippets.findIndex((s) => sameText(s, card.name)) ?? -1;
    if (index >= 0) nameVotes.set(index, (nameVotes.get(index) ?? 0) + 1);
  }
  const nameWinner = majority(nameVotes);
  if (nameWinner === null) return null;
  const agreement = nameWinner[1] / confident.length;
  if (agreement < MIN_AGREEMENT) return null;

  let citySource: LearnedLayout["citySource"] = null;
  if (CITY_TYPES.includes(pageType)) {
    const cityVotes = new Map<number, number>();
    for (const card of confident) {
      const index = card.city === null ? -1 : body.cityHints.findIndex((h) => sameText(h, card.city!));
      if (index >= 0) cityVotes.set(index, (cityVotes.get(index) ?? 0) + 1);
    }
    const cityWinner = majority(cityVotes);
    if (cityWinner !== null && cityWinner[1] === confident.length) {
      citySource = { hintIndex: cityWinner[0] };
    }
  }

  return {
    fingerprint: body.signature,
    namePosition: { snippetIndex: nameWinner[0] },
    type: pageType,
    citySource,
  };
}
