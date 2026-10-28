import type { BackgroundReply, ContentMessage, FeedbackResponse, IdentifiedItem, IdentifyResponse, InsightType, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards, type DetectedList } from "./detect/detect";
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
    if (!list || sameList(list) || rejected.get(list.container) === list.cards.size) return;
    watcher?.disconnect();
    watcher = null;
    current?.undo();
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

function watch(container: Element, cards: Iterable<Element>): void {
  const known = new Set(cards);
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    const fresh = records.some((r) =>
      [...r.addedNodes].some((n) => n.nodeType === 1 && !known.has(n as Element) && !(n as Element).hasAttribute("data-focal")),
    );
    if (fresh || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true });
  if (container.parentElement) watcher.observe(container.parentElement, { childList: true });
}

/** A stored layout that resolves nothing is stale — drop it (G2). */
export function shouldInvalidateLayout(ranked: { ok: boolean; data?: { resolvedCount?: number } }): boolean {
  return ranked.ok && (ranked.data?.resolvedCount ?? 0) === 0;
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
    if (records.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && !(n as Element).hasAttribute("data-focal")))) scheduleRerun();
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
    // Any failure after the gate hides the list must still reveal it.
    activeGate?.cancel();
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

  const gate = createGate(list.container as HTMLElement, gateMs, {
    offerOnly: gen > 1 && onScreen(list.container),
  });
  activeGate = gate;
  const host = location.hostname.replace(/^www\./, "");
  const pattern = pathPattern(location.pathname);

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
      if (identified.ok) reject(list);
      return;
    }
    pageType = identified.data.pageType;
    items = identified.data.items;
    if (identified.data.layout) void saveLayout(storageKey, identified.data.layout);
  }
  if (gen !== generation) return gate.cancel();

  const ranked = await send<RankResponse>({
    type: "rank",
    body: { host, pathPattern: pattern, pageType, items },
  });
  if (gen !== generation) return gate.cancel();
  if (!ranked.ok || !ranked.data.plan) {
    gate.cancel();
    if (local && shouldInvalidateLayout(ranked)) {
      // The stored layout identified nothing the resolver knows — it is stale.
      void deleteLayout(storageKey);
    }
    return;
  }
  const { plan, pageResultId } = ranked.data;
  gate.ready(() => {
    if (gen !== generation) return;
    current?.undo();
    current = applyPlan(list, plan, {
      onWhy: pageResultId ? () => void send({ type: "open-why", pageResultId }) : undefined,
      onFeedback: pageResultId
        ? (clientId, verdict, label) => {
            const buttons = [...label.querySelectorAll<HTMLButtonElement>("button[data-focal-action]")];
            for (const b of buttons) b.disabled = true;
            void send<FeedbackResponse>({ type: "feedback", body: { pageResultId, clientId, verdict } }).then((res) => {
              if (!res.ok || !res.data.saved) {
                for (const b of buttons) b.disabled = false;
                const failed = document.createElement("span");
                failed.setAttribute("data-focal", "fb-error");
                failed.textContent = "Couldn't save";
                failed.style.cssText =
                  "font:500 11px/1 ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;color:#f87171!important;align-self:center";
                label.append(failed);
                setTimeout(() => failed.remove(), 4000);
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
                  if (u.ok) {
                    saved.remove();
                    undo.remove();
                  } else {
                    undo.disabled = false;
                  }
                });
              });
              label.append(saved);
              if (eventId !== null) label.append(undo);
            });
          }
        : undefined,
    });
    if (pageResultId) void send({ type: "page-result", pageResultId, lifted: current.lifted });
  });
}

let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  last = null; // E-1: hints came from the old URL's search box.
  rejected = new WeakMap();
  scheduleRerun();
}, 1000);

void run();
