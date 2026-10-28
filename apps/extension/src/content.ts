import type { BackgroundReply, ContentMessage, FeedbackResponse, IdentifiedItem, IdentifyResponse, InsightType, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards, type DetectedList } from "./detect/detect";
import { checkEligibility } from "./guards/eligibility";
import { applyLayout } from "./layouts/apply";
import { getLayout, layoutKey, saveLayout } from "./layouts/store";
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
let lastList: { container: Element; cards: Set<Element> } | null = null;
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

function sameList(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container || list.cards.size !== lastList.cards.size) return false;
  return [...list.cards.values()].every((el) => lastList!.cards.has(el));
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
async function run(gateMs?: number): Promise<void> {
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
  lastList = { container: list.container, cards: new Set(list.cards.values()) };
  watch(list.container, list.cards.values());

  const cards = snapshotCards(list);
  // Apps can change the URL (and its search box) before swapping the list; cards keep the context they came with.
  const key = cards.map((c) => c.snippets[0] ?? "").sort().join("\n");
  const hints = last?.key === key ? last.hints : cityHints(document);
  last = { key, hints };

  const gate = createGate(list.container as HTMLElement, gateMs);
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
            void send<FeedbackResponse>({ type: "feedback", body: { pageResultId, clientId, verdict } }).then((res) => {
              if (!res.ok || !res.data.saved) return;
              const { eventId } = res.data;
              label.querySelectorAll("button[data-focal-action]").forEach((b) => b.remove());
              const saved = document.createElement("span");
              saved.textContent = "Saved · ";
              const undo = document.createElement("button");
              undo.setAttribute("type", "button");
              undo.textContent = "Undo";
              undo.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                void send<FeedbackResponse>({ type: "feedback", body: { action: "undo", eventId } }).then((u) => {
                  if (u.ok && u.data.saved) {
                    saved.remove();
                    undo.remove();
                  }
                });
              });
              label.append(saved, undo);
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
  rejected = new WeakMap();
  scheduleRerun();
}, 1000);

void run();
