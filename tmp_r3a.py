import io
p='apps/extension/src/content.ts'
t=io.open(p,encoding='utf-8').read()

t=t.replace('''const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let suppress = false; // set around applyPlan/undo so our own mutations don't schedule reruns
const retryBudget = new Map<Element, { count: number; until: number }>();''','''const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let retryBudget = new WeakMap<Element, { count: number; timer: ReturnType<typeof setTimeout> }>();
/** Records we mutate ourselves queue MutationObserver records; drain them
 * synchronously after each self-mutation instead of suppressing delivery. */
const drainRecords = () => { watcher?.takeRecords(); };
/** Baseline post-apply: re-detect so our own moves/collapses don't look fresh.
 * Limitation (R3-25): site changes that landed in the same batch are absorbed
 * too — a site re-sort arriving mid-apply is treated as part of our write. */
const recomputeLastList = () => {
  const fresh = detectList(document);
  if (!fresh) return;
  lastList = { container: fresh.container, cards: [...fresh.cards.values()] };
  watch(fresh.container, fresh.cards.values());
};''')

t=t.replace('''    if (rejected.get(list.container) === list.cards.size) return;
    bodyBackoffMs = 1000;
    watcher?.disconnect();
    watcher = null;
    suppress = true;
    try { current?.undo(); } finally { queueMicrotask(() => { suppress = false; }); }
    current = null;
    void run(0);''','''    if (rejected.get(list.container) === list.cards.size) return;
    bodyBackoffMs = 1000;
    current?.undo(); // our own edits; the watcher drops them via takeRecords
    drainRecords();
    current = null;
    void run(0);''')

t=t.replace('''function watch(container: Element, cards: Iterable<Element>): void {
  const known = new Set(cards);
  const knownOrDescendant = (n: Node) =>
    n instanceof Element && ([...known].some((k) => k === n || k.contains(n) || n.contains(k)));
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (suppress) return;
    const fresh = records.some((r) => {
      if (r.type === "characterData") {
        return knownOrDescendant(r.target) && !inFocal(r.target);
      }
      if (r.type !== "childList") return false;
      if (inFocal(r.target)) return false;
      // Site re-sorts and removals of known cards are fresh; focal nodes never are.
      if ([...r.removedNodes].some((n) => n.nodeType === 1 && knownOrDescendant(n) && !inFocal(n))) return true;
      return [...r.addedNodes].some((n) => n.nodeType === 1 && !inFocal(n));
    });
    if (fresh || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true, subtree: true, characterData: true });
}''','''function watch(container: Element, cards: Iterable<Element>): void {
  const known = [...cards];
  const knownOrDescendant = (n: Node) =>
    n instanceof Element && known.some((k) => k === n || k.contains(n) || n.contains(k));
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (document.hidden) { droppedRecords = true; return; }
    const fresh = records.some((r) => {
      if (r.type !== "childList") return false;
      if (inFocal(r.target)) return false;
      // Site re-sorts and removals of known cards are fresh; focal nodes never are.
      if ([...r.removedNodes].some((n) => n.nodeType === 1 && knownOrDescendant(n) && !inFocal(n))) return true;
      return [...r.addedNodes].some((n) => n.nodeType === 1 && !inFocal(n));
    });
    if (fresh || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true, subtree: true });
}''')

t=t.replace('''  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (suppress) return;
    if (records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && n.childElementCount > 0 && !inFocal(n)))) {''','''  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (document.hidden) { droppedRecords = true; return; }
    if (records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && !inFocal(n)))) {''')

t=t.replace('''  suppress = true;
  try { activeGate?.cancel(); } finally { queueMicrotask(() => { suppress = false; }); }
  activeGate = gate;
  try {
    return await runWithGate(list, cards, gate, gen, hints, pattern, host);
  } catch (e) {
    gate.cancel(); // only this run's gate
    throw e;
  }''','''  activeGate?.cancel();
  drainRecords();
  activeGate = gate;
  try {
    return await runWithGate(list, cards, gate, gen, hints, pattern, host);
  } catch (e) {
    gate.cancel(); // only this run's gate
    drainRecords();
    throw e;
  }''')

t=t.replace('''function scheduleRetry(container: Element): void {
  const now = Date.now();
  const entry = retryBudget.get(container) ?? { count: 0, until: 0 };
  if (entry.count >= 3) return;
  entry.count += 1;
  entry.until = now + 60000;
  retryBudget.set(container, entry);
  const t = setTimeout(() => {
    retryTimers.delete(t);
    void run(0);
  }, 60000);
  retryTimers.add(t);
}''','''function scheduleRetry(container: Element): void {
  const entry = retryBudget.get(container) ?? { count: 0, timer: undefined as unknown as ReturnType<typeof setTimeout> };
  if (entry.count >= 3) return;
  entry.count += 1;
  clearTimeout(entry.timer); // a second failure while queued never double-books a run
  entry.timer = setTimeout(() => {
    retryTimers.delete(entry.timer);
    void run(0);
  }, 60000);
  retryBudget.set(container, entry);
  retryTimers.add(entry.timer);
}''')

io.open(p,'w',encoding='utf-8',newline='').write(t)
print('part A done')
