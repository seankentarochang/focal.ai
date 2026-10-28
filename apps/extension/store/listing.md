# Chrome Web Store listing — focal

## Name
focal — the web, re-ordered around your taste

## Short description (132 chars max)
Lifts the items that match your taste to the top of any list — restaurants, films, books — with the reason why.

## Category
Productivity

## Single-purpose statement
focal does one thing: on pages containing a list of things Qloo knows about (restaurants, films, shows, artists, books, podcasts, games, brands, destinations, people), it moves the items that best match your taste profile to the top and labels why.

## Long description
You tell a chat agent what you like. It builds your taste profile. Every site you visit after that shows what you care about most first, automatically.

- On any eligible page with a list of things, focal lifts your clear matches to the top with a label like "Top pick for you · because you like Fugazi and Rintaro". The rest of the page stays exactly as the site made it.
- Each lifted card has "More like this" and "Not for me" buttons that teach the profile.
- "Why this order?" opens an inspector showing what was identified, what was sent to Qloo, and each item's affinity.
- Your profile is yours: every change is attributed and undoable, and you can export or delete it from the website's Settings page.
- Built-in never-run categories (banking, health, government, email, messaging, documents, passwords, sign-in) plus your own skip list. No passive browsing tracking. No sponsored-placement detection.

Requires a free focal.ai account and a Chromium-based browser.

## Permission justifications

| Permission | Why it's needed |
|---|---|
| `storage` | Caches your session token, per-site settings (skip/off lists synced from the server), and learned page layouts in chrome.storage so eligibility checks never need the network. |
| `tabs` | The toolbar popup needs the active tab's hostname to offer "turn focal off on this site" and "Why this order?"; no tab content is read through it. |
| `host_permissions: <all_urls>` | The extension's purpose is reordering lists on any site the user browses. Content scripts extract card text snippets and lift matching items on eligible pages. There is no fixed allowlist — eligibility is decided per page by structure, then disabled by never-run categories, the user's skip/off lists, incognito state, and pages with password/payment fields. |
| Content scripts (`http://*/*`, `https://*/*`) | The single-purpose feature — detecting list cards and rendering the lift/labels — runs in the page. See Privacy below for exactly what is extracted and sent. |
| `externally_connectable` (localhost dev / focal.ai origin) | Receives the signed-in session token from the focal website when the user connects their account; the token is stored locally for API calls. |

## Data use disclosures (mirrors focal.ai/privacy)
- On a new site layout, list-card text snippets (≤6 per card, ≤80 chars, ≤60 cards) plus the site's hostname, path pattern and city hints go to TypeSafe (list identification); the structure-only page signature goes only to the focal server. On known layouts, only item names, type and city go to the server — every rank request also carries the page's hostname, kept 24 h with the page result. Card links are not extracted or sent. Item names and the page's city go to Qloo for entity resolution. Website chat sends your messages and taste-profile summary to the LLM chain (Groq → Cerebras → OpenRouter).
- Stored server-side: account, profile, activity, site settings, a shared resolution cache of normalized item names (resolved entries do not expire), and page results (24 h). Learned layouts live only in extension storage. No browsing history, no passive tracking.
- Never collected: full pages, form fields, screenshots, passwords, payment data.
- Data is never sold. Users can export and delete their profile and account at any time from Settings.

## Screenshots to capture
1. A Yelp search page with focal's label strip ("focal lifted 3 for you") and labelled top cards.
2. The "Why this order?" inspector showing one item's affinity and the likes behind it.
3. "More like this / Not for me" buttons under a lifted card.
4. The website onboarding chat writing a profile entry.
5. The toolbar popup showing the per-site on/off toggle.
