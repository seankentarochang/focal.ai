import io

# ---------- apply.ts ----------
p='apps/extension/src/apply/apply.ts'
t=io.open(p,encoding='utf-8').read()

# R5-5: delete originalOrder; R5-6: handle exposes plan/container/applied; R5-8: onUserUndo (strip click only)
t=t.replace('''export interface ApplyHandle {
  mode: "css-order" | "move";
  lifted: number;
  undo(): void;
  readonly active: boolean;
  /** Card elements in their pre-apply DOM order (R4-11). */
  readonly originalOrder: Element[];
}''','''export interface ApplyHandle {
  mode: "css-order" | "move";
  lifted: number;
  undo(): void;
  readonly active: boolean;
  /** The plan this handle applied, its container and the cards it touched (R5-6). */
  readonly plan: RenderPlan;
  readonly container: Element;
  readonly applied: Set<Element>;
}''')

t=t.replace('''    get active() {
      return active;
    },
    get originalOrder() {
      const cardSet = new Set(cards.values());
      return originalChildren.filter((el) => cardSet.has(el));
    },''','''    get active() {
      return active;
    },
    plan,
    container,
    applied: new Set(cards.values()),''')

# R5-8: strip click -> undo + onUserUndo; undo() itself no longer fires it
t=t.replace('''      opts.onUndo?.();''','''      // onUserUndo fires from the strip button only — programmatic undos
      // (rerun, re-apply, undo-event) must never mark the container (R5-8).''')
t=t.replace('''    undo.addEventListener("click", () => handle.undo());''','''    undo.addEventListener("click", () => {
      handle.undo();
      opts.onUserUndo?.();
    });''')
t=t.replace('''  onUndo?: () => void;''','''  /** Strip Undo clicked by the user — content marks the container so later
   * mutations re-baseline instead of re-lifting (R5-8). */
  onUserUndo?: () => void;''')

# R5-7: negative order keeps site-appended items last
t=t.replace('''        sequence.forEach((el, i) => {
          const h = el as HTMLElement;
          saveStyle(h, savedStyles);
          h.style.setProperty("order", String(i));
        });''','''        sequence.forEach((el, i) => {
          const h = el as HTMLElement;
          saveStyle(h, savedStyles);
          // Negative orders sort before the default 0 — site-appended items
          // keep their place at the end (R5-7).
          h.style.setProperty("order", String(i - sequence.length));
        });''')
io.open(p,'w',encoding='utf-8',newline='').write(t)
print('apply done')
