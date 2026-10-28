import type { IdentifiedItem, InsightType, LearnedLayout } from "../api";
import type { CardSnapshot } from "../types";

const MIN_ITEMS = 3;

/**
 * Local port of the server's applyLayout (apps/web/lib/server/page/layout.ts):
 * items are the cards whose snippet at the learned position exists, named by
 * that snippet. Needs ≥ 3 items to stand on its own; otherwise the page falls
 * back to a fresh identify call.
 */
export function applyLayout(
  layout: LearnedLayout,
  cards: CardSnapshot[],
  cityHints: string[],
): { pageType: InsightType; items: IdentifiedItem[] } | null {
  const { snippetIndex } = layout.namePosition;
  const hintIndex = layout.citySource?.hintIndex;
  const items: IdentifiedItem[] = [];
  for (const card of cards) {
    const name = card.snippets[snippetIndex];
    if (name === undefined) continue;
    const city = hintIndex !== undefined ? cityHints[hintIndex] : undefined;
    items.push({
      clientId: card.clientId,
      name,
      type: layout.type,
      ...(city !== undefined ? { city } : {}),
    });
  }
  if (items.length < MIN_ITEMS) return null;
  return { pageType: layout.type, items };
}
