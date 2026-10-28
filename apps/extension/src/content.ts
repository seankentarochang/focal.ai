import type { BackgroundReply, ContentMessage, FeedbackResponse, IdentifiedItem, IdentifyResponse, InsightType, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards, type DetectedList } from "./detect/detect";
import type { CardSnapshot } from "./types";
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
let lastList: { container: Element; cards: Element[] } | null = null;
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
let suppress = false; // set around applyPlan/undo so our own mutations don't schedule reruns
const retryBudget = new Map<Element, { count: number; until: number }>();
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
    if (sameList(list)) {
      bodyBackoffMs = Math.min(bodyBackoffMs * 2, 30000);
      return;
    }
    if (rejected.get(list.container) === list.cards.size) return;
    bodyBackoffMs = 1000;
    watcher?.disconnect();
    watcher = null;
    suppress = true;
    try { current?.undo(); } finally { queueMicrotask(() => { suppress = false; }); }
    current = null;
    void run(0);
  }, RERUN_DELAY_MS);
}

export function __setLastListForTests(list: { container: Element; cards: Element[] } | null): void {
  lastList = list;
}

export function sameList(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container) return false;
  const now = [...list.cards.values()];
  const then = lastList.cards;
  // Order-sensitive: a card the page moved is a fresh change, not a rerun loop.
  return now.length === then.length && now.every((el, i) => el === then[i]);
}

function inFocal(n: Node): boolean {
  return n instanceof Element && !!n.closest("[data-focal]");
}

function watch(container: Element, cards: Iterable<Element>): void {
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
    if (suppress) return;
    if (records.some((r) => [...r.addedNodes].some((n) => n instanceof Element && n.childElementCount > 0 && !inFocal(n)))) {
      clearTimeout(rerunTimer);
      rerunTimer = setTimeout(() => { rerunTimer = undefined; scheduleRerun(); }, bodyBackoffMs);
    }
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

function reject(list: DetectedList): void {
  rejected.set(list.container, list.cards.size);
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
  if (!list) return watchPage();
  lastList = { container: list.container, cards: [...list.cards.values()] };
  watch(list.container, list.cards.values());

  const cards = snapshotCards(list);
  // Apps can change the URL (and its search box) before swapping the list; cards keep the context they came with.
  const key = cards.map((c) => c.snippets[0] ?? "").sort().join("\n");
  const hints = last?.key === key ? last.hints : cityHints(document);
  last = { key, hints };

  const host = location.hostname.replace(/^www\./, "");
  const pattern = pathPattern(location.pathname);
  const gate = createGate(list.container as HTMLElement, gateMs, {
    offerOnly: gen > 1 && onScreen(list.container),
  });
  suppress = true;
  try { activeGate?.cancel(); } finally { queueMicrotask(() => { suppress = false; }); }
  activeGate = gate;
  try {
    return await runWithGate(list, cards, gate, gen, hints, pattern, host);
  } catch (e) {
    gate.cancel(); // only this run's gate
    throw e;
  }
}

/** (f) A failed identify/rank gets up to 3 retries per container, 60 s apart.
 *  Permanent rejections (not-a-list) still go through reject(). */
function scheduleRetry(container: Element): void {
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
      suppress = true;
      try { gate.cancel(); } finally { queueMicrotask(() => { suppress = false; }); }
      if (identified.ok) reject(list); // identified and not a list: permanent for this container
      else scheduleRetry(list.container); // transport/API failure: retry budget
      return;
    }
    pageType = identified.data.pageType;
    items = identified.data.items;
    if (identified.data.layout) void saveLayout(storageKey, identified.data.layout);
  }
  if (gen !== generation) return gate.cancel();

  const ranked = await send<RankResponse>({
    type: "rank",
    body: { host, pageType, items },
  });
  if (gen !== generation) return gate.cancel();
  if (!ranked.ok || !ranked.data.plan) {
    suppress = true;
    try { gate.cancel(); } finally { queueMicrotask(() => { suppress = false; }); }
    if (local && shouldInvalidateLayout(ranked)) {
      // The stored layout identified nothing the resolver knows — it is stale.
      void deleteLayout(storageKey);
    }
    if (!ranked.ok) scheduleRetry(list.container);
    return;
  }
  const { plan, pageResultId } = ranked.data;
  gate.ready(() => {
    if (gen !== generation) return;
    suppress = true;
    try {
      current?.undo();
      current = applyPlan(list, plan, {
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
    if (pageResultId) void send({ type: "page-result", pageResultId, lifted: current!.lifted });
    } finally {
      queueMicrotask(() => { suppress = false; });
    }
    // (b) Recompute lastList post-apply so move/collapse doesn't look like a
    // site re-sort and trigger an endless rerun loop.
    const fresh = detectList(document);
    lastList = fresh ? { container: fresh.container, cards: [...fresh.cards.values()] } : lastList;
    if (fresh) watch(fresh.container, fresh.cards.values());
  });
}

let lastHref = location.href;
const hrefTimer = setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  last = null; // E-1: hints came from the old URL's search box.
  rejected = new WeakMap();
  scheduleRerun();
}, 1000);

export function __stopForTests(): void {
  watcher?.disconnect();
  watcher = null;
  clearTimeout(rerunTimer);
  rerunTimer = undefined;
  for (const t of retryTimers) clearTimeout(t);
  retryTimers.clear();
  clearInterval(hrefTimer);
  activeGate = null;
}

void run();
