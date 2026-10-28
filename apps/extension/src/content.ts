import type { BackgroundReply, ContentMessage, FeedbackResponse, IdentifiedItem, IdentifyResponse, InsightType, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards, type DetectedList } from "./detect/detect";
import type { CardSnapshot, RenderOp, RenderPlan } from "./types";
import { checkEligibility } from "./guards/eligibility";
import { applyLayout } from "./layouts/apply";
import { deleteLayout, getLayout, layoutKey, saveLayout } from "./layouts/store";
import { getSettings } from "./storage";

function send<T>(msg: ContentMessage): Promise<BackgroundReply<T>> {
  return chrome.runtime.sendMessage(msg);
}

let current: ApplyHandle | null = null;
let watcher: MutationObserver | null = null;
let rerunTimer: ReturnType<typeof setTimeout> | undefined;
let firstScheduledAt = 0;
const runTimes: number[] = [];
let generation = 0;
let lastList: { container: Element; cards: Element[]; fp: string } | null = null;
let retryBudget = new Map<Element, { count: number; timer: ReturnType<typeof setTimeout> }>();
/** Records we mutate ourselves queue MutationObserver records; drain them
 * synchronously after each self-mutation instead of suppressing delivery. */
const drainRecords = () => { watcher?.takeRecords(); };
/** Baseline post-apply: re-detect so our own moves/collapses don't look fresh.
 * Limitation (R3-25): site changes that landed in the same batch are absorbed
 * too — a site re-sort arriving mid-apply is treated as part of our write. */
const fingerprint = (list: DetectedList) =>
  snapshotCards(list).map((c) => c.snippets[0] ?? "").join("\n");
const recomputeLastList = () => {
  const fresh = detectList(document);
  if (!fresh) return;
  lastList = { container: fresh.container, cards: [...fresh.cards.values()], fp: fingerprint(fresh) };
  watch(fresh.container, fresh.cards.values());
};
let bodyBackoffMs = 1000; // doubles after consecutive no-list/same-list outcomes, caps at 30 s
let last: { key: string; hints: string[] } | null = null;
/** Lists that weren't worth ranking, with their size then; a new card makes them worth another look. */
let rejected = new WeakMap<Element, number>();

const RERUN_DELAY_MS = 1000;
const RERUN_MAX_WAIT_MS = 3000;
const MAX_RUNS_PER_MINUTE = 6;

/** Sorting, infinite scroll and in-app navigation change the list after load; rank it again. */
function scheduleRerun(): void {
  const now = Date.now();
  if (rerunTimer === undefined) firstScheduledAt = now;
  else if (now - firstScheduledAt > RERUN_MAX_WAIT_MS) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    rerunTimer = undefined;
    const at = Date.now();
    while (runTimes.length > 0 && at - runTimes[0]! > 60_000) runTimes.shift();
    if (runTimes.length >= MAX_RUNS_PER_MINUTE) return scheduleRerun();
    const list = detectList(document);
    if (!list) {
      bodyBackoffMs = Math.min(bodyBackoffMs * 2, 30000);
      return watchPage();
    }
    if (sameList(list) || userUndidFor === list.container) {
      lastList = { container: list.container, cards: [...list.cards.values()], fp: fingerprint(list) };
      bodyBackoffMs = Math.min(bodyBackoffMs * 2, 30000);
      return;
    }
    if (rejected.get(list.container) === list.cards.size) return;
    bodyBackoffMs = 1000;
    // R4-11: no eager undo — the applied DOM is a valid input (marked hidden
    // cards still detect). The next run's gate.ready un- undoes before apply.
    void run(0);
  }, RERUN_DELAY_MS);
}

export function __setLastListForTests(list: DetectedList | null): void {
  lastList = list ? { container: list.container, cards: [...list.cards.values()], fp: fingerprint(list) } : null;
}

export function sameList(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container) return false;
  const now = [...list.cards.values()];
  const then = lastList.cards;
  // Order-sensitive: a card the page moved is a fresh change, not a rerun loop.
  if (!(now.length === then.length && now.every((el, i) => el === then[i]))) return false;
  // R4-13: recycled elements (same nodes, new contents) still rerun — compare
  // the first-snippet fingerprint, not just element identity.
  return fingerprint(list) === lastList.fp;
}

function inFocal(n: Node): boolean {
  return n instanceof Element && !!n.closest("[data-focal]");
}

function watch(container: Element, cards: Iterable<Element>): void {
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
      // A text node appearing/disappearing inside a known card is fresh (R4-13).
      if (knownOrDescendant(r.target) && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 3 && !inFocal(n))) return true;
      return [...r.addedNodes].some((n) => n.nodeType === 1 && !inFocal(n));
    });
    if (fresh || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true, subtree: true });
}

/** A stored layout that resolves nothing is stale — drop it (G2). */
export function shouldInvalidateLayout(ranked: { ok: boolean; data?: { resolvedCount?: number; status?: string } }): boolean {
  // "no_signals" means resolution never ran — the layout may still be fine.
  return ranked.ok && ranked.data?.status !== "no_signals" && (ranked.data?.resolvedCount ?? 0) === 0;
}

/** Whether any part of the element is inside the viewport. */
function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/** No rankable list yet (still loading, or the wrong group was found): look again when the page changes. */
function watchPage(): void {
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (document.hidden) { droppedRecords = true; return; }
    if (records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && !inFocal(n)))) {
      clearTimeout(rerunTimer);
      rerunTimer = setTimeout(() => { rerunTimer = undefined; scheduleRerun(); }, bodyBackoffMs);
    }
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

function reject(list: DetectedList): void {
  rejected.set(list.container, list.cards.size);
  current?.undo(); // R5-6
  drainRecords();
  // R4-10: keep the baseline so the body watcher's same-list check stays cheap.
  lastList = { container: list.container, cards: [...list.cards.values()], fp: fingerprint(list) };
  watchPage();
}

/** guards → list detection → identify → rank → apply (§4.1). */
let activeGate: ReturnType<typeof createGate> | null = null;

async function run(gateMs?: number): Promise<void> {
  try {
    await runInner(gateMs);
  } catch {
    // runInner cancels the gate it created on failure — activeGate may belong
    // to a newer run by now, so never touch it here.
  }
}

async function runInner(gateMs?: number): Promise<void> {
  runTimes.push(Date.now());
  const gen = ++generation;
  const settings = await getSettings();
  const eligibility = checkEligibility({
    url: location.href,
    settings,
    incognito: chrome.extension.inIncognitoContext,
    focalHosts: FOCAL_HOSTS,
    document,
  });
  if (!eligibility.eligible) return;

  const list = detectList(document);
  if (!list) {
    lastList = null;
    current?.undo(); // R5-6: no focal UI outliving its list
    drainRecords();
    return watchPage();
  }
  if (userUndidFor === list.container) {
    // The user reverted this container — re-baseline and stand down (R5-8).
    lastList = { container: list.container, cards: [...list.cards.values()], fp: fingerprint(list) };
    return;
  }
  lastList = { container: list.container, cards: [...list.cards.values()], fp: fingerprint(list) };
  watch(list.container, list.cards.values());

  const cards = snapshotCards(list);
  // Apps can change the URL (and its search box) before swapping the list; cards keep the context they came with.
  const key = cards.map((c) => c.snippets[0] ?? "").sort().join("\n");
  const hints = last?.key === key ? last.hints : cityHints(document);
  last = { key, hints };

  const host = location.hostname.replace(/^www\./, "");
  const pattern = pathPattern(location.pathname);
  activeGate?.cancel();
  drainRecords();
  const gate = createGate(list.container as HTMLElement, gateMs, {
    offerOnly: gen > 1 && onScreen(list.container),
  });
  activeGate = gate;
  try {
    return await runWithGate(list, cards, gate, gen, hints, pattern, host);
  } catch (e) {
    gate.cancel(); // only this run's gate
    drainRecords();
    throw e;
  }
}

/** (f) A failed identify/rank gets up to 3 retries per container, 60 s apart.
 *  Permanent rejections (not-a-list) still go through reject(). */
function scheduleRetry(container: Element): void {
  const entry = retryBudget.get(container) ?? { count: 0, timer: undefined as unknown as ReturnType<typeof setTimeout> };
  if (entry.count >= 3) return;
  entry.count += 1;
  clearTimeout(entry.timer); // a second failure while queued never double-books a run
  entry.timer = setTimeout(() => void run(0), 60000);
  retryBudget.set(container, entry);
}

async function runWithGate(
  list: DetectedList,
  cards: CardSnapshot[],
  gate: ReturnType<typeof createGate>,
  gen: number,
  hints: string[],
  pattern: string,
  host: string,
): Promise<void> {

  // A stored layout identifies the cards locally — no identify call (§5.3).
  const storageKey = layoutKey(host, pattern, list.signature);
  const stored = await getLayout(storageKey);
  const local = stored ? applyLayout(stored, cards, hints) : null;

  let pageType: InsightType;
  let items: IdentifiedItem[];
  if (local) {
    ({ pageType, items } = local);
  } else {
    const identified = await send<IdentifyResponse>({
      type: "identify",
      body: { host, pathPattern: pattern, signature: list.signature, cityHints: hints, cards },
    });
    if (gen !== generation) return gate.cancel();
    if (!identified.ok || !identified.data.isList || !identified.data.pageType || identified.data.items.length === 0) {
      gate.cancel();
      drainRecords();
      if (identified.ok && identified.data.isList === false) reject(list); // definite non-list: permanent
      else scheduleRetry(list.container); // failure, null type or empty items: retry budget (R4-14)
      return;
    }
    pageType = identified.data.pageType;
    items = identified.data.items;
    if (identified.data.layout) void saveLayout(storageKey, identified.data.layout).catch(() => {});
  }
  if (gen !== generation) return gate.cancel();

  const ranked = await send<RankResponse>({
    type: "rank",
    body: { host, pageType, items },
  });
  if (gen !== generation) return gate.cancel();
  if (!ranked.ok || !ranked.data.plan) {
    gate.cancel();
    drainRecords();
    if (local && shouldInvalidateLayout(ranked)) {
      // The stored layout identified nothing the resolver knows — it is stale.
      void deleteLayout(storageKey);
    }
    if (!ranked.ok) scheduleRetry(list.container);
    return;
  }
  const { plan, pageResultId } = ranked.data;
  // R5-6/R5-10: skip only when the applied plan still covers this container:
  // every detected card is in it, every applied card is still connected, and
  // the new plan's effect on those elements is identical.
  const applied = current;
  if (
    applied?.active &&
    applied.container === list.container &&
    [...list.cards.values()].every((el) => [...applied.applied.values()].includes(el)) &&
    [...applied.applied.values()].every((el) => el.isConnected) &&
    effectEquivalent(plan, list, applied)
  ) {
    gate.cancel();
    drainRecords();
    return;
  }
  const applyNow = (p: RenderPlan) => {
    if (gen !== generation) return;
    current?.undo();
    drainRecords();
    current = applyPlan(list, p, {
      onUserUndo: () => {
        // User reverted our arrangement — mark the container so its next
        // mutation batches re-baseline instead of re-lifting (R5-8).
        userUndidFor = list.container;
        drainRecords();
        recomputeLastList();
      },
      onWhy: pageResultId ? () => void send({ type: "open-why", pageResultId }) : undefined,
      onFeedback: pageResultId
        ? (clientId, verdict, label) => {
            const buttons = [...label.querySelectorAll<HTMLButtonElement>("button[data-focal-action]")];
            for (const b of buttons) b.disabled = true;
            const showSaveFailed = () => {
              for (const b of buttons) b.disabled = false;
              const failed = document.createElement("span");
              failed.setAttribute("data-focal", "fb-error");
              failed.textContent = "Couldn't save";
              failed.style.cssText =
                "font:500 11px/1 ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;color:#f87171!important;align-self:center";
              label.append(failed);
              setTimeout(() => failed.remove(), 4000);
            };
            void send<FeedbackResponse>({ type: "feedback", body: { pageResultId, clientId, verdict } }).catch(showSaveFailed).then((res) => {
              if (res === undefined) return; // catch already handled
              if (!res?.ok || !res.data?.saved) {
                showSaveFailed();
                return;
              }
              const { eventId } = res.data;
              buttons.forEach((b) => b.remove());
              const saved = document.createElement("span");
              saved.textContent = eventId === null ? "Saved" : "Saved · ";
              saved.style.cssText =
                "font:500 11px/1 ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;color:#52525b!important;align-self:center";
              const undo = document.createElement("button");
              undo.setAttribute("type", "button");
              undo.textContent = "Undo";
              undo.style.cssText =
                "display:inline-flex!important;align-items:center;height:20px!important;padding:0 8px!important;border-radius:999px;cursor:pointer;" +
                "font:500 11px/1 ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;color:#fafafa!important;" +
                "background:#18181b!important;border:1px solid #3f3f46!important";
              const id = eventId ?? "";
              undo.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                undo.disabled = true;
                void send<FeedbackResponse>({ type: "undo-event", eventId: id }).then((u) => {
                  if (u?.ok) {
                    saved.remove();
                    undo.remove();
                  } else {
                    undo.disabled = false;
                  }
                }).catch(() => {
                  undo.disabled = false;
                  saved.textContent = "Couldn't save";
                });
              });
              label.append(saved);
              if (eventId !== null) label.append(undo);
            });
          }
        : undefined,
    });
    if (pageResultId) void send({ type: "page-result", pageResultId, lifted: current!.lifted }).catch(() => {});
    // R4-9: drain synchronously — the observer callback runs before our
    // microtask would, so records from our own writes must go now. The
    // microtask recompute still waits for the gate's synchronous reveal.
    drainRecords();
    queueMicrotask(() => {
      recomputeLastList();
    });
  };
  // R5-9: a late-offered plan still labels in place immediately (spec §5.7
  // "clear matches are labelled where they appear"); the chip's deferred apply
  // undoes this label-only handle and applies the full reorder.
  const outcome = gate.ready(() => applyNow(plan));
  if (outcome === "late-offered") {
    applyNow({ ...plan, ops: plan.ops.filter((o) => o.op === "annotate") });
  }
}

let lastHref = location.href;
const hrefTimer = setInterval(() => {
  // Container swapped wholesale (SPA route change without a new URL): the old
  // watcher's records stop arriving, so re-detect here (R3-7).
  if (lastList && !lastList.container.isConnected) {
    if (userUndidFor === lastList.container) userUndidFor = null;
    scheduleRerun();
  }
  if (location.href === lastHref) return;
  lastHref = location.href;
  last = null; // E-1: hints came from the old URL's search box.
  rejected = new WeakMap();
  for (const e of retryBudget.values()) clearTimeout(e.timer);
  retryBudget.clear(); // retry history is per page (R3-9)
  bodyBackoffMs = 1000;
  lastList = null;
  userUndidFor = null;
  scheduleRerun();
}, 1000);

/** Container whose strip Undo the user clicked — reruns re-baseline it (R5-8). */
let userUndidFor: Element | null = null;

/** Effect-equivalence over the elements of the currently-applied plan (R5-10):
 * same lifted-prefix element sequence, same (element, text, badge) annotations
 * and same collapse/hide sets. Appended non-lifted cards don't break it. */
function effectEquivalent(plan: RenderPlan, list: DetectedList, handle: ApplyHandle): boolean {
  const ops = (p: RenderPlan, byId: Map<string, Element>) => {
    const reorder = p.ops.find((o): o is Extract<RenderOp, { op: "reorder" }> => o.op === "reorder");
    const lifted = p.summary.lifted ?? p.summary.moved;
    const seq = (reorder?.order.slice(0, lifted) ?? []).map((id) => byId.get(id));
    const ann: [Element, string, string][] = [];
    const gone = new Set<Element>();
    for (const o of p.ops) {
      if (o.op === "annotate") { const el = byId.get(o.clientId); if (el) ann.push([el, o.text, o.badge ?? ""]); }
      else if (o.op === "collapse" || o.op === "hide") {
        for (const id of o.clientIds) { const el = byId.get(id); if (el) gone.add(el); }
      }
    }
    return { seq, ann, gone };
  };
  const a = ops(plan, new Map<string, Element>([...list.cards.entries()].map(([id, el]) => [id, el as Element])));
  const b = ops(handle.plan, handle.applied);
  const sameSeq = a.seq.length === b.seq.length && a.seq.every((el: Element | undefined, i: number) => el === b.seq[i]);
  const sameAnn = a.ann.length === b.ann.length && a.ann.every(([el, tx, bd]) => b.ann.some(([e2, t2, b2]) => e2 === el && t2 === tx && b2 === bd));
  const sameGone = a.gone.size === b.gone.size && [...a.gone].every((el) => b.gone.has(el));
  return sameSeq && sameAnn && sameGone;
}

let droppedRecords = false;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && droppedRecords) {
    droppedRecords = false;
    scheduleRerun();
  }
});

export function __stopForTests(): void {
  watcher?.disconnect();
  watcher = null;
  clearTimeout(rerunTimer);
  rerunTimer = undefined;
  for (const e of retryBudget.values()) clearTimeout(e.timer);
  retryBudget.clear();
  clearInterval(hrefTimer);
  activeGate = null;
}

void run();
