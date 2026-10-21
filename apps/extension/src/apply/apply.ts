import type { RenderOp, RenderPlan } from "../types";
import { decorate, flip, popIn, sparkleSvg, VIOLET } from "./ui";

export const FOCAL_ATTR = "data-focal";

export interface ApplyTarget {
  container: Element;
  cards: Map<string, Element>;
}

export interface ApplyOptions {
  onWhy?: () => void;
  onUndo?: () => void;
  /** Force a mode; by default flex / grid containers use CSS order. */
  mode?: "css-order" | "move";
}

export interface ApplyHandle {
  mode: "css-order" | "move";
  lifted: number;
  undo(): void;
  readonly active: boolean;
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

/** Where a label goes: inside the main cell for table rows, else the card itself. */
function labelSlot(card: HTMLElement): HTMLElement {
  if (card.tagName !== "TR") return card;
  const cells = [...card.children].filter((c): c is HTMLElement => c.tagName === "TD" || c.tagName === "TH");
  const withLink = cells.find((c) => c.querySelector("a[href]") && (c.textContent ?? "").trim().length > 1);
  return withLink ?? cells.find((c) => (c.textContent ?? "").trim().length > 1) ?? cells[0] ?? card;
}

const LABEL_STYLE: Record<string, string> = {
  "top-pick": `background:linear-gradient(135deg,#8b74ff,${VIOLET});color:#fff;border:1px solid rgba(255,255,255,.12)`,
  "good-match": "background:#18181b;color:#fafafa;border:1px solid #3f3f46",
};

function labelElement(doc: Document, text: string, badge: string | undefined): HTMLElement {
  const kind = badge === "top-pick" ? "top-pick" : "good-match";
  const host = make(doc, "focal-label", "label");
  host.setAttribute("data-badge", badge ?? "good-match");
  const root = host.attachShadow({ mode: "open" });
  const span = doc.createElement("span");
  span.setAttribute(
    "style",
    "display:inline-flex;align-items:center;gap:5px;max-width:100%;margin:6px 0;padding:3px 9px 3px 7px;border-radius:999px;" +
      'font:500 12px/16px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;' +
      "box-shadow:0 1px 2px rgba(0,0,0,.12);white-space:normal;text-align:left;" +
      LABEL_STYLE[kind],
  );
  if (kind === "top-pick") span.insertAdjacentHTML("afterbegin", sparkleSvg());
  span.append(doc.createTextNode(text));
  root.append(span);
  host.setAttribute("style", "all:initial;display:block");
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
  const mode = opts.mode ?? (isFlexOrGrid(container) ? "css-order" : "move");
  const savedStyles = new Map<HTMLElement, string | null>();
  const inserted: Element[] = [];
  const originalChildren = [...container.children];
  const originalNodes = [...container.childNodes];
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
    undo() {
      if (!active) return;
      active = false;
      flip([...cards.values()], () => {
        for (const el of inserted) el.remove();
        for (const [el, style] of savedStyles) {
          if (style === null) el.removeAttribute("style");
          else el.setAttribute("style", style);
        }
        if (reorder && mode === "move") {
          for (const node of originalNodes) if (node.parentNode === container) container.appendChild(node);
        }
      });
      opts.onUndo?.();
    },
  };

  const cardEls = [...cards.values()];
  const glow = reorder ? reorder.order.slice(0, lifted).map((id) => cards.get(id)).filter((el): el is Element => !!el) : [];
  flip(cardEls, () => {
    if (reorder) {
      if (mode === "css-order") {
        sequence.forEach((el, i) => {
          const h = el as HTMLElement;
          saveStyle(h, savedStyles);
          h.style.setProperty("order", String(i));
        });
      } else {
        for (const el of sequence) container.appendChild(el);
      }
    }

    const position = (el: Element) => (el as HTMLElement).style.getPropertyValue("order");

    for (const op of plan.ops) {
      if (op.op === "annotate") {
        const card = cards.get(op.clientId) as HTMLElement | undefined;
        if (!card) continue;
        const label = labelElement(doc, op.text, op.badge);
        labelSlot(card).prepend(label);
        inserted.push(label);
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
          el.style.setProperty("display", "none");
        }
        const fold = decorate(make(doc, "div", "fold"), "fold");
        fold.append(doc.createTextNode(op.label));
        if (op.op === "collapse") {
          const show = make(doc, "button", "show", "Show");
          show.setAttribute("type", "button");
          show.addEventListener("click", () => {
            for (const el of els) el.style.removeProperty("display");
            fold.remove();
          });
          fold.append(show);
        }
        if (mode === "css-order" && position(first)) fold.style.setProperty("order", position(first));
        first.before(fold);
        inserted.push(fold);
      }
    }
    if (reorder || plan.ops.some((o) => o.op === "collapse" || o.op === "hide")) container.before(strip());
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
    undo.addEventListener("click", () => handle.undo());
    el.append(undo);
    inserted.push(el);
    return el;
  }

  return handle;
}
