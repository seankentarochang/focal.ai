import type { RenderOp, RenderPlan } from "../types";

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
 * New child sequence for the container: card slots are refilled in plan
 * order, anything that is not a card (ads, separators) keeps its slot.
 */
function sequenceFor(container: Element, cards: Map<string, Element>, order: string[]): Element[] {
  const cardSet = new Set(cards.values());
  const ordered = order.map((id) => cards.get(id)).filter((el): el is Element => !!el && el.parentElement === container);
  const rest = [...cards.values()].filter((el) => el.parentElement === container && !ordered.includes(el));
  const queue = [...ordered, ...rest];
  return [...container.children].map((child) => (cardSet.has(child) ? (queue.shift() ?? child) : child));
}

function labelElement(doc: Document, text: string, badge: string | undefined): HTMLElement {
  const host = make(doc, "focal-label", "label");
  host.setAttribute("data-badge", badge ?? "good-match");
  const root = host.attachShadow({ mode: "open" });
  const span = doc.createElement("span");
  span.textContent = text;
  span.setAttribute(
    "style",
    `display:inline-block;margin:4px 0;padding:2px 8px;border-radius:999px;font:500 12px/1.5 system-ui,sans-serif;` +
      (badge === "top-pick" ? "background:#1d4ed8;color:#fff" : "background:#e0e7ff;color:#1e3a8a"),
  );
  root.append(span);
  host.style.display = "block";
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
  const sequence = reorder ? sequenceFor(container, cards, reorder.order) : originalChildren;
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
      card.prepend(label);
      inserted.push(label);
    } else if (op.op === "emphasize") {
      const card = cards.get(op.clientId) as HTMLElement | undefined;
      if (!card) continue;
      saveStyle(card, savedStyles);
      card.style.setProperty("outline", "2px solid #1d4ed8");
      card.style.setProperty("outline-offset", "2px");
    } else if (op.op === "collapse" || op.op === "hide") {
      const els = op.clientIds.map((id) => cards.get(id)).filter((el): el is HTMLElement => !!el);
      const first = els.slice().sort((a, b) => sequence.indexOf(a) - sequence.indexOf(b))[0];
      if (!first) continue;
      for (const el of els) {
        saveStyle(el, savedStyles);
        el.style.setProperty("display", "none");
      }
      const fold = make(doc, "div", "fold");
      fold.append(doc.createTextNode(op.label));
      if (op.op === "collapse") {
        fold.append(doc.createTextNode(" · "));
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

  const lifted = plan.summary.lifted ?? plan.summary.moved;
  const handle: ApplyHandle = {
    mode,
    lifted,
    get active() {
      return active;
    },
    undo() {
      if (!active) return;
      active = false;
      for (const el of inserted) el.remove();
      for (const [el, style] of savedStyles) {
        if (style === null) el.removeAttribute("style");
        else el.setAttribute("style", style);
      }
      if (reorder && mode === "move") {
        for (const node of originalNodes) if (node.parentNode === container) container.appendChild(node);
      }
      opts.onUndo?.();
    },
  };

  if (reorder || plan.ops.some((o) => o.op === "collapse" || o.op === "hide")) {
    const strip = make(doc, "div", "strip");
    strip.setAttribute("role", "status");
    strip.setAttribute(
      "style",
      "display:flex;gap:12px;align-items:center;margin:8px 0;padding:6px 12px;border-radius:8px;background:#eef2ff;color:#1e3a8a;font:500 13px/1.4 system-ui,sans-serif",
    );
    strip.append(
      make(doc, "span", "strip-text", lifted > 0 ? `focal lifted ${lifted} ${lifted === 1 ? "match" : "matches"} for your taste` : "focal applied your rules"),
    );
    if (opts.onWhy) {
      const why = make(doc, "button", "why", "Why this order?");
      why.setAttribute("type", "button");
      why.addEventListener("click", () => opts.onWhy?.());
      strip.append(why);
    }
    const undo = make(doc, "button", "undo", "Undo");
    undo.setAttribute("type", "button");
    undo.addEventListener("click", () => handle.undo());
    strip.append(undo);
    container.before(strip);
    inserted.push(strip);
  }

  return handle;
}
