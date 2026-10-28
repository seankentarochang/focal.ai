import { focalTrusted } from "./apply";
import { blockAnchor, decorate } from "./ui";

export const GATE_MS = 300;

export type GateOutcome = "before-reveal" | "late-applied" | "late-offered" | "cancelled";

export interface RenderGate {
  /** Call when the plan is ready. `apply` runs now or behind an "Apply" chip. */
  ready(apply: () => void, offer: boolean): GateOutcome;
  /** No plan (no list, nothing to lift, error): reveal and clean up. */
  cancel(): void;
  readonly revealed: boolean;
  readonly interacted: boolean;
}

/** Mount the shared "focal found matches · Apply" chip; the click applies (R12-1). */
function mountApplyChip(container: HTMLElement, apply: () => void): HTMLElement {
  const doc = container.ownerDocument;
  const chip = decorate(doc.createElement("div"), "chip");
  chip.setAttribute("data-focal", "chip");
  chip.setAttribute("role", "status");
  chip.textContent = "focal found matches";
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("data-focal", "apply");
  button.textContent = "Apply";
  button.addEventListener("click", (ev) => {
    if (!focalTrusted(ev, chip)) return; // host: the chip (R10-2)
    chip.remove();
    apply();
  });
  chip.append(button);
  blockAnchor(container).before(chip);
  return chip;
}

/**
 * First-run gate (§5.7): hide the list for at most GATE_MS. A plan that arrives
 * in time is applied before the list is shown. A late plan re-orders only if the
 * user has not scrolled or clicked in the list; otherwise a chip offers Apply.
 */
export function createFirstRunGate(container: HTMLElement): RenderGate {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const prevVisibility = container.style.getPropertyValue("visibility");
  let revealed = false;
  let interacted = false;
  let settled = false;
  let chip: HTMLElement | null = null;

  container.style.setProperty("visibility", "hidden");

  const onInteract = () => {
    if (revealed) interacted = true;
  };
  const events = ["pointerdown", "click", "keydown", "wheel", "touchstart"] as const;
  for (const e of events) container.addEventListener(e, onInteract, { passive: true });
  win?.addEventListener("scroll", onInteract, { passive: true });

  const reveal = () => {
    if (revealed) return;
    revealed = true;
    if (prevVisibility) container.style.setProperty("visibility", prevVisibility);
    else container.style.removeProperty("visibility");
  };

  const detach = () => {
    for (const e of events) container.removeEventListener(e, onInteract);
    win?.removeEventListener("scroll", onInteract);
  };

  const timer = setTimeout(() => {
    reveal();
    if (settled) return;
    chip = decorate(doc.createElement("div"), "chip");
    chip.setAttribute("data-focal", "chip");
    chip.setAttribute("role", "status");
    chip.textContent = "focal is ranking…";
    blockAnchor(container).before(chip);
  }, GATE_MS);

  return {
    get revealed() { return revealed; },
    get interacted() { return interacted; },
    ready(apply, _offer) {
      if (settled) return "cancelled";
      settled = true;
      clearTimeout(timer);
      if (!revealed) {
        apply();
        reveal();
        detach();
        return "before-reveal";
      }
      if (!interacted) {
        chip?.remove();
        apply();
        detach();
        return "late-applied";
      }
      detach();
      chip?.remove();
      mountApplyChip(container, apply);
      return "late-offered";
    },
    cancel() {
      settled = true;
      clearTimeout(timer);
      chip?.remove();
      reveal();
      detach();
    },
  };
}

/**
 * Rerun gate (§5.7): background reruns never hide the list and never flash a
 * "ranking…" chip — the list stays live while the identify+rank round trip runs.
 * `ready` applies in place unless `offer` says the change touches what's on screen.
 */
export function createRerunGate(container: HTMLElement): RenderGate {
  let settled = false;
  let chip: HTMLElement | null = null;
  return {
    get revealed() { return true; },
    get interacted() { return false; },
    ready(apply, offer) {
      if (settled) return "cancelled";
      settled = true;
      if (!offer) {
        apply();
        return "late-applied";
      }
      chip = mountApplyChip(container, apply);
      return "late-offered";
    },
    cancel() {
      settled = true;
      chip?.remove();
    },
  };
}
