import type { RenderOp, RenderPlan } from "../types";
import { blockAnchor, decorate, flip, popIn, sparkleSvg, VIOLET } from "./ui";

export const FOCAL_ATTR = "data-focal";

export interface ApplyTarget {
  container: Element;
  cards: Map<string, Element>;
}

export interface ApplyOptions {
  onWhy?: () => void;
  /** Strip Undo clicked by the user — content marks the container so later
   * mutations re-baseline instead of re-lifting (R5-8). */
  onUserUndo?: () => void;
  /** Tap on a lifted card's More like this / Not for me button (X-08). */
  onFeedback?: (clientId: string, verdict: "more" | "less", label: HTMLElement) => void;
  /** Force a mode; by default flex / grid containers use CSS order. */
  mode?: "css-order" | "move";
}

export interface ApplyHandle {
  mode: "css-order" | "move";
  lifted: number;
  undo(): void;
  readonly active: boolean;
  /** The plan this handle applied, its container and the cards it touched (R5-6). */
  readonly plan: RenderPlan;
  readonly container: Element;
  readonly applied: Map<string, Element>;
}

function isFlexOrGrid(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  const display = view?.getComputedStyle(el).display ?? (el as HTMLElement).style.display;
  return /(^|-)(flex|grid)$/.test(display);
}

/** Records an element's original style attribute once, for Undo. */
function saveStyle(el: HTMLElement, saved: Map<HTMLElement, string | null>): void {
  if (!saved.has(el)) saved.set(el, el.getAttribute("style"));
}

function make(doc: Document, tag: string, kind: string, text?: string): HTMLElement {
  const el = doc.createElement(tag);
  el.setAttribute(FOCAL_ATTR, kind);
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * New child sequence for the container: lifted cards first, then every other
 * card. Cards the plan doesn't know (unidentified, past the 60-card cap) keep
 * their place among the others. Anything that is not a card keeps its slot.
 */
function sequenceFor(container: Element, cards: Map<string, Element>, order: string[], lifted: number): Element[] {
  const inContainer = [...cards.values()].filter((el) => el.parentElement === container);
  const cardSet = new Set(inContainer);
  const pick = (ids: string[]) => ids.map((id) => cards.get(id)).filter((el): el is Element => !!el && cardSet.has(el));
  const top = pick(order.slice(0, lifted));
  const planned = pick(order.slice(lifted));
  const known = new Set([...top, ...planned]);
  const pending = inContainer.filter((el) => !known.has(el));
  const pos = new Map(inContainer.map((el, i) => [el, i]));
  const queue = [...top];
  for (const el of planned) {
    while (pending.length > 0 && pos.get(pending[0]!)! < pos.get(el)!) queue.push(pending.shift()!);
    queue.push(el);
  }
  queue.push(...pending);
  return [...container.children].map((child) => (cardSet.has(child) ? (queue.shift() ?? child) : child));
}

const hasTitleLink = (el: Element) => !!el.querySelector("a[href]") && (el.textContent ?? "").trim().length > 1;

/**
 * Where a label goes: the main cell for table rows, the text column for
 * side-by-side cards (poster left, text right), else the card itself.
 */
function labelSlot(card: HTMLElement): HTMLElement {
  if (card.tagName === "TR") {
    const cells = [...card.children].filter((c): c is HTMLElement => c.tagName === "TD" || c.tagName === "TH");
    return cells.find(hasTitleLink) ?? cells.find((c) => (c.textContent ?? "").trim().length > 1) ?? cells[0] ?? card;
  }
  return textColumnByLayout(card) ?? textColumnByStyle(card);
}

function titleOf(card: HTMLElement): HTMLElement | null {
  const heading = card.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]');
  if (heading) return heading;
  return [...card.querySelectorAll<HTMLElement>("a[href]")].find((a) => (a.textContent ?? "").trim().length > 1) ?? null;
}

/** Highest ancestor of the title that sits clearly right of the card's left edge. */
function textColumnByLayout(card: HTMLElement): HTMLElement | null {
  const box = card.getBoundingClientRect();
  const title = titleOf(card);
  if (box.width === 0 || !title || title.getBoundingClientRect().left - box.left < 24) return null;
  let col = title;
  while (col.parentElement && col.parentElement !== card && col.parentElement.getBoundingClientRect().left - box.left >= 24) col = col.parentElement;
  return /^(A|BUTTON)$/.test(col.tagName) && col.parentElement ? col.parentElement : col;
}

function textColumnByStyle(card: HTMLElement): HTMLElement {
  let slot = card;
  let el: HTMLElement = card;
  for (let depth = 0; depth < 4 && !/^(A|BUTTON)$/.test(el.tagName); depth++) {
    const kids = [...el.children].filter((c): c is HTMLElement => !c.hasAttribute(FOCAL_ATTR));
    if (kids.length === 1) {
      el = kids[0]!;
      continue;
    }
    const title = titleOf(el);
    const text = kids.length > 1 && isFlexOrGrid(el) && title ? kids.find((k) => k.tagName !== "A" && k.contains(title)) : undefined;
    if (!text) break;
    slot = el = text;
  }
  return slot;
}

const LABEL_STYLE: Record<string, string> = {
  "top-pick": `background:linear-gradient(135deg,#8b74ff,${VIOLET});color:#fff;border:1px solid rgba(255,255,255,.12)`,
  "good-match": "background:#18181b;color:#fafafa;border:1px solid #3f3f46",
};

function labelElement(doc: Document, text: string, badge: string | undefined, compact = false): HTMLElement {
  const kind = badge === "top-pick" ? "top-pick" : "good-match";
  const host = make(doc, "focal-label", "label");
  host.setAttribute("data-badge", badge ?? "good-match");
  const root = host.attachShadow({ mode: "open" });
  const span = doc.createElement("span");
  span.setAttribute(
    "style",
    "display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;margin:2px 0;padding:3px 9px 3px 7px;border-radius:999px;" +
      'font:500 12px/16px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;' +
      "box-shadow:0 1px 2px rgba(0,0,0,.12);white-space:nowrap;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;" +
      LABEL_STYLE[kind],
  );
  if (kind === "top-pick") span.insertAdjacentHTML("afterbegin", sparkleSvg());
  // Narrow tiles (poster grids) get the short form; the full reason stays in the tooltip.
  span.append(doc.createTextNode(compact ? (text.split(" · ")[0] ?? text) : text));
  if (compact) span.title = text;
  // Feedback buttons are appended as light-DOM children; they render through
  // this slot, which is the second flex item in the host's row. On narrow
  // cards the whole button group wraps under the pill instead of squeezing it.
  const slot = doc.createElement("slot");
  slot.style.cssText = "display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center";
  root.append(span, slot);
  // One inline-flex row (pill + buttons) with !important where host page CSS
  // could restyle the focal-label element or the slotted light-DOM buttons.
  host.setAttribute(
    "style",
    "all:initial;display:inline-flex!important;flex-wrap:wrap;gap:4px;align-items:center;vertical-align:middle;margin-inline-end:8px!important",
  );
  popIn(span);
  return host;
}

/**
 * Applies a declarative plan to the site's own cards. Nodes are never
 * recreated, so the site's click handlers keep working; Undo restores the
 * original order, styles and removes everything focal inserted.
 */
export function applyPlan(target: ApplyTarget, plan: RenderPlan, opts: ApplyOptions = {}): ApplyHandle {
  const { container, cards } = target;
  const doc = container.ownerDocument;
  const mode = isFlexOrGrid(container) ? "css-order" : "move";
  const savedStyles = new Map<HTMLElement, string | null>();
  const inserted: Element[] = [];
  const originalChildren = [...container.children];
  const originalNodes = [...container.childNodes];
  const markedHidden: Element[] = [];
  let active = true;

  const reorder = plan.ops.find((o): o is Extract<RenderOp, { op: "reorder" }> => o.op === "reorder");
  const lifted = plan.summary.lifted ?? plan.summary.moved;
  const sequence = reorder ? sequenceFor(container, cards, reorder.order, lifted) : originalChildren;
  const handle: ApplyHandle = {
    mode,
    lifted,
    get active() {
      return active;
    },
    plan,
    container,
    applied: cards,
    undo() {
      if (!active) return;
      active = false;
      flip([...cards.values()], () => {
        for (const el of inserted) el.remove();
        for (const el of markedHidden) el.removeAttribute("data-focal-hidden");
        for (const [el, style] of savedStyles) {
          if (style === null) el.removeAttribute("style");
          else el.setAttribute("style", style);
        }
        if (reorder && mode === "move") {
          // Insert the originals back before the first non-original child —
          // appending would bury them behind cards the site added meanwhile.
          const originalSet = new Set(originalNodes);
          const anchor = [...container.childNodes].find((n) => !originalSet.has(n)) ?? null;
          for (const node of originalNodes) if (node.parentNode === container) container.insertBefore(node, anchor);
        }
      });
      // onUserUndo fires from the strip button only — programmatic undos
      // (rerun, re-apply, undo-event) must never mark the container (R5-8).
    },
  };

  const cardEls = [...cards.values()];
  const glow = reorder ? reorder.order.slice(0, lifted).map((id) => cards.get(id)).filter((el): el is Element => !!el) : [];
  flip(cardEls, () => {
    if (reorder) {
      if (mode === "css-order") {
        // Only the lifted prefix gets an order (-lifted..-1); every other
        // child keeps whatever order the site gave it, so site appends and
        // prepends keep their own position (R6-9). Undo restores savedStyles.
        sequence.slice(0, lifted).forEach((el, i) => {
          const h = el as HTMLElement;
          saveStyle(h, savedStyles);
          h.style.setProperty("order", String(i - lifted));
        });
      } else {
        // Re-append only nodes whose position actually changes — touching every
        // child would re-fire the mutation watcher against our own edits.
        sequence.forEach((el, i) => {
          if (container.children[i] !== el) container.insertBefore(el, container.children[i] ?? null);
        });
      }
    }

    const position = (el: Element) => (el as HTMLElement).style.getPropertyValue("order");

    for (const op of plan.ops) {
      if (op.op === "annotate") {
        const card = cards.get(op.clientId) as HTMLElement | undefined;
        if (!card) continue;
        const slot = labelSlot(card);
        const width = slot.getBoundingClientRect().width;
        const compact = width > 0 && width < 160;
        const label = labelElement(doc, op.text, op.badge, compact);
        slot.prepend(label);
        inserted.push(label);
        if (opts.onFeedback) {
          for (const [verdict, text] of (
            compact
              ? ([["more", "More"], ["less", "Less"]] as const)
              : ([["more", "More like this"], ["less", "Not for me"]] as const)
          )) {
            const btn = make(doc, "button", `fb-${verdict}`, text);
            btn.setAttribute("type", "button");
            btn.setAttribute("data-focal-action", verdict);
            btn.style.cssText =
              "display:inline-flex!important;align-items:center;height:20px!important;padding:0 8px!important;border-radius:999px;cursor:pointer;" +
              "font:500 11px/1 ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;color:#fafafa!important;" +
              "background:#18181b!important;border:1px solid #3f3f46!important";
            btn.addEventListener("click", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              opts.onFeedback?.(op.clientId, verdict, label);
            });
            label.append(btn);
          }
        }
      } else if (op.op === "emphasize") {
        const card = cards.get(op.clientId) as HTMLElement | undefined;
        if (!card) continue;
        saveStyle(card, savedStyles);
        card.style.setProperty("outline", "2px solid rgba(110, 86, 207, 0.7)");
        card.style.setProperty("outline-offset", "3px");
      } else if (op.op === "collapse" || op.op === "hide") {
        const els = op.clientIds.map((id) => cards.get(id)).filter((el): el is HTMLElement => !!el);
        const first = els.slice().sort((a, b) => sequence.indexOf(a) - sequence.indexOf(b))[0];
        if (!first) continue;
        for (const el of els) {
          saveStyle(el, savedStyles);
          el.style.setProperty("display", "none", "important");
          // Mark ours so the rerun detector still counts the card (R4-11).
          el.setAttribute("data-focal-hidden", "");
          markedHidden.push(el);
        }
        const fold = decorate(make(doc, "div", "fold"), "fold");
        fold.append(doc.createTextNode(op.label));
        let holder: HTMLElement = fold;
        if (first.tagName === "TR") {
          holder = make(doc, "tr", "fold-row");
          const cell = doc.createElement("td");
          cell.colSpan = Math.max(1, first.children.length);
          cell.append(fold);
          holder.append(cell);
        }
        if (op.op === "collapse") {
          const show = make(doc, "button", "show", "Show");
          show.setAttribute("type", "button");
          show.addEventListener("click", () => {
            for (const el of els) { el.removeAttribute("data-focal-hidden"); el.style.removeProperty("display"); }
            holder.remove();
          });
          fold.append(show);
        }
        if (mode === "css-order" && position(first)) holder.style.setProperty("order", position(first));
        first.before(holder);
        inserted.push(holder);
      }
    }
    if (reorder || plan.ops.some((o) => o.op === "collapse" || o.op === "hide")) blockAnchor(container).before(strip());
  }, glow);

  function strip(): HTMLElement {
    const el = decorate(make(doc, "div", "strip"), "strip");
    el.setAttribute("role", "status");
    el.append(
      make(doc, "span", "strip-text", lifted > 0 ? `focal lifted ${lifted} ${lifted === 1 ? "match" : "matches"} for your taste` : "focal applied your rules"),
    );
    if (opts.onWhy) {
      const why = make(doc, "button", "why", "Why this order?");
      why.setAttribute("type", "button");
      why.addEventListener("click", () => opts.onWhy?.());
      el.append(why);
    }
    const undo = make(doc, "button", "undo", "Undo");
    undo.setAttribute("type", "button");
    undo.addEventListener("click", () => {
      handle.undo();
      opts.onUserUndo?.();
    });
    el.append(undo);
    inserted.push(el);
    return el;
  }

  return handle;
}
