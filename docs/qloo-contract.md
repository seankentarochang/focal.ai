# Qloo API contract — live probe record (T-01)

> **Live verification completed 2026-10-19** against `https://hackathon.api.qloo.com` with a hackathon key.
> Probe: `scripts/probe-qloo.ts` (exit 0, 4/4 requests HTTP 200) plus paced extended checks.
> Everything below is observed behavior; anything not exercised is marked `UNVERIFIED`.
> No key material is recorded in this file.

## 0. Session metadata

| Field | Value |
| --- | --- |
| Verified at (UTC) | 2026-10-19, ~21:41–21:57 |
| Verifier | automated live probe (K1) |
| Key source | hackathon key, header `X-Api-Key` |
| Environment | Node v24.1.0, darwin, git `7152647` |
| Probe script | `scripts/probe-qloo.ts` (`pnpm probe`, exit 0) |

## 1. Host & auth

- Base URL `https://hackathon.api.qloo.com`: **confirmed** (all 2xx below came from this host).
- Auth: header `X-Api-Key`: confirmed.
- No key → HTTP 401:
  ```json
  {"error":{"reason":"No API key found in request","message":"Unauthorized","code":401}}
  ```
- Invalid key → HTTP 401:
  ```json
  {"error":{"reason":"API keys mismatch","message":"Unauthorized","code":401}}
  ```
- Unknown path (e.g. `/v2/entities`) → HTTP 404 `{"error":{"reason":"Not Found","message":"The requested resource could not be found.","code":404}}`.
- All responses carry `x-qloo-request-id` and rate-limit headers (see §7).

## 2. Endpoint shapes

### 2.1 `GET /search` (entity resolution)

Request tried: `GET /search?query=Rintaro%20San%20Francisco&types=urn:entity:place&take=5` → 200, `results` is a bare array.

Response shape (fields, not bulk):
```json
{"results":[{"name":"Rintaro","entity_id":"01BD29B2-…","types":["urn:entity:place"],
  "properties":{…,"external":{"michelin":…,"resy":…,"tripadvisor":…,"google_place":…}},
  "popularity":0.9857…,"disambiguation":"82 14th St San Francisco, CA 94103",
  "location":{"lat":37.768875,"lon":-122.4151361},
  "tags":[{"name":"Gluten free","tag_id":"urn:tag:dietary_option:qloo:gluten_free","type":…,"value":…}]}]}
```

Field mapping observed:

| Upstream field | Maps to `QlooEntity` | Confidence |
| --- | --- | --- |
| `entity_id` | `entityId` | high |
| `name` | `name` | high |
| `types[0]` (`["urn:entity:place"]`) | `subtype` | high — **`subtype`/`type` fields do not exist on `/search` results** (see §3 note S1) |
| `disambiguation` | `disambiguation` | high |
| `popularity` | `popularity` | high — 0..1 (0.98 observed) |
| `tags[].name` | `tagNames` | high |
| `tags[].tag_id` | `tagIds` | high — **key is `tag_id`, not `id`** (client currently reads `id`, so search `tagIds` come back empty) |
| `properties` (incl. nested `external`) | `properties.raw` | high |
| `location` | not mapped (lat/lon only) | — |

- Pagination: `take` works, **max 100**; `take=200` → 400 `"take:  must be <= 100"`. `page` not exercised (`UNVERIFIED`).
- Location filter: **`filter.location` must be `lat,lon`**; a text value 400s:
  `"filter.location:  must be in the form lat,lon (e.g. 40.726408,-73.994275)"`. Text locality works via `location=<text>` or `filter.location.query=<text>` (both returned 200 and surfaced the correct top hit). Client-side location handling needs a fix (see §10).

### 2.2 `GET /v2/insights` (recommendations / affinity — GET only)

Params exercised: `filter.type`, `signal.interests.entities` (comma-separated, cross-domain), `filter.results.entities` (comma-separated candidates), `filter.location.query`, `feature.explainability=true`, `take`.

Answers with evidence:
- `filter.results.entities` **restricts and scores exactly the supplied IDs**, ordered by affinity descending. 3 candidates → 3 results; 15 candidates → 14 results (one dropped, see below). Input order is irrelevant.
- Candidates that cannot be scored are **absent** from `results.entities` (not present with null affinity): a non-matching-type ID (artist in a `place` call) is dropped; Olive Garden returned `{"success":true,"results":{"entities":[]}}` even when passed alone.
- Cross-domain signals work: `urn:entity:artist` (Fugazi) → `place`/`brand`/`destination`/`artist` results; `place` (Rintaro) → `artist` results. All scored.
- Affinity is present when at least one signal entity is supplied; a `filter.results.entities`-only call returned entities but no `query.affinity`.
- Response top level: `{"success":true,"results":{"entities":[…]},"query":{…}}`.

### 2.3 `GET /v2/tags?filter.query=…`

`GET /v2/tags?filter.query=natural%20wine&take=5` → 200. Top level: `{"duration":…,"results":{"tags":[…]}, "success":true}`.

Tag fields: `id` (e.g. `urn:tag:cuisine:qloo:natural_wine`), `name`, `type`, `popularity`, `parents`, `properties`, `tags`. No `subtype` field. `filter.query=chain` finds `urn:tag:business:place:chain` — chain detection for the policy feature is available.

### 2.4 `GET /entities` (entity by ID)

**Path is `/entities`; `/v2/entities` returns 404.** Param is `entity_ids=<comma-separated>`; batches of 3 and 10 both returned all IDs. Response shape is identical to `/search` results (array under `results`; `types`, no `subtype`; 196 tags + full `properties` for Rintaro). Max batch size `UNVERIFIED` (≥10 accepted).

## 3. Affinity field verdict (THE critical question)

- [x] `entity.query.affinity` — **the path**
- [ ] `entity.query.measurements.affinity` — does not exist; `measurements` holds other metrics only (e.g. `audience_growth`, can be negative, not 0..1)
- [ ] other: none

| Item | Value |
| --- | --- |
| Exact JSON path | `results.entities[i].query.affinity` |
| Scale | 0..1 (observed 0.69–0.94); domain-dependent baseline — destinations scored ~0.92–0.94 in one call while places in the same call family scored ~0.69–0.79 |
| Sample values | Rintaro 0.7525, State Bird 0.7586, Zuni 0.7224, Aesop 0.7593, Muji 0.7521, Fugazi (artist, place signal) 0.8341 |
| Confidence | high (n≈20 scored entities, 5 types) |

Client decision: **no change needed** — `AFFINITY_PATHS` already tries `query.affinity` first, so `affinityFoundAt === "query.affinity"`. The second candidate path is dead code in practice.

Example entity (minimal):
```json
{"name":"Rintaro","entity_id":"…","subtype":"urn:entity:place","type":"urn:entity",
 "query":{"affinity":0.7524660016924375,
          "measurements":{"audience_growth":1},
          "explainability":{"signal.interests.entities":[{"entity_id":"…","score":1}]}}}
```

**Subtype note (S1, critical):** on `/v2/insights` entities carry `subtype:"urn:entity:place"` (the entity type URN) and `type:"urn:entity"`; observed for place/artist/brand/movie/destination. On `/search` and `/entities` there is **no `subtype` or `type` field at all** — only `types:["urn:entity:…"]`. There is no finer subtype vocabulary (no `urn:place:restaurant` anywhere). The client maps missing `subtype` to `""`, and the frozen resolver requires `subtype === expectedType`, so **live search results currently never resolve** until the mapper falls back to `types[0]`.

## 4. Explainability (`feature.explainability=true`)

Per entity, `query.explainability` is keyed by the signal source:
```json
{"signal.interests.entities":[{"entity_id":"ACF3C4D7-…","score":1}]}
```
Top-level `query.explainability` carries aggregate effects:
```json
{"signal.interests.entities":{"effect_on_top3_recs":[{"entity_id":"…","avg_score":1}],
 "effect_on_top5_recs":[…],"effect_on_top10_recs":[…],"effect_on_all_recs":[…]}}
```
Interpretation: contributions reference the **signal entity IDs** with a relevance `score` (1 = the signal); the aggregate block reports per-signal average effect on the top-N cutoffs. Scale is 0..1 (`avg_score` observed 1).

Client gap: `extractContributions` looks for `contributions`/`entities` keys inside `query.explainability`; the live key is `signal.interests.entities`, so `ScoredEntity.contributions` is currently always `undefined` on live data (`explainabilityRaw` is populated). Unmapped bonus: insights `tags[]` entries carry `{id, name, type, weight}` — `weight` is a per-tag score usable for reason strings.

## 5. `filter.results.entities` size behavior

| Question | Answer |
| --- | --- |
| Max IDs accepted in one call | ≥15 accepted (`take=20`); no limit hit |
| Above-limit behavior | `UNVERIFIED` |
| Unscorable / wrong-type IDs | silently omitted from `results.entities` (Fugazi omitted under `filter.type=place`; Olive Garden returned an empty entity list) |
| Chunking required in `@focal-ai/qloo`? | No at demo scale (≤15 candidates tested); keep chunking as a safety valve if pages grow |

## 6. Latency measurements

| Endpoint | n | p50 | p95 | max | Notes |
| --- | --- | --- | --- | --- | --- |
| `GET /search` | 34 | 158 ms | 394 ms | 433 ms | min 47 ms; 3 fresh single calls 185/225/246 ms |
| `GET /v2/insights` | ~8 | ~115 ms | ~290 ms | 294 ms | 3-candidate calls 113/151/201 ms |
| `GET /v2/tags` | 4 | ~100 ms | ~220 ms | 221 ms | |
| `GET /entities` | 2 | ~52 ms | — | 58 ms | single ID; 10-ID batch returned in one call |

Implication: default `timeoutMs` 8000 is generous. The real risk is not latency but the 5 req/s burst limit (§7) — the client's single 300 ms retry can still land inside a saturated window; add client-side pacing (≥250 ms between upstream calls) and lean on the TTL cache.

## 7. 429 behavior

- Trigger: **more than 5 requests in one second** (`x-second-ratelimit-limit: 5`). A 7-request parallel burst produced 4×200 / 3×429.
- Monthly quota: `x-month-ratelimit-limit: 10000` (remaining ~9920 after this session).
- 429 body is a **different shape** from other errors:
  ```json
  {"error_msg":"Rate limit exceeded"}
  ```
- 429 headers: `x-second-ratelimit-limit: 5`, `x-second-ratelimit-remaining: 0`, `x-second-ratelimit-reset: 0.79` (seconds). **No `Retry-After`.**
- Recovery is fast: a single request 3 s later succeeded. Sustained bursts (>5/s continuously) keep producing 429s.
- Decision: `QlooError.retryAfterMs` stays `undefined` (no header to parse). Optional improvement: use `x-second-ratelimit-reset` when present.

## 8. Coverage checklist — pinned demo sets

Resolution rules below assume the mapper fix from §3 (subtype from `types[0]`). "Scored" = candidate returned an affinity in `filter.results.entities` insights. Subtype on search results is always the type URN; on insights `subtype` equals it.

| Page | Entity | Resolved? | Entity ID | Subtype | Scored? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Tables (SF) | Bar Part Time | yes (name-only query or with `location`) | 82998585-3638-4AB9-8EF1-216FC246FC90 | urn:entity:place | not tested | query "Bar Part Time San Francisco" fails name match; drop the city from the query or use the location param |
| Tables (SF) | Rintaro | yes | 01BD29B2-9241-4D90-8569-95D2E5FEA851 | urn:entity:place | yes (0.7525) | |
| Tables (SF) | State Bird Provisions | yes | 28B6D3B0-DC6B-4284-95E9-4B3B5C48C789 | urn:entity:place | yes (0.7586) | |
| Tables (SF) | Zuni Café | yes | F65F5515-2BE0-4631-9856-B4176C90327B | urn:entity:place | yes (0.7224) | accent-safe |
| Tables (SF) | House of Prime Rib | yes | 1D9E51B5-EC82-4472-B19E-27E82047D7C0 | urn:entity:place | yes (0.7308) | |
| Tables (SF) | Tartine Manufactory | yes | 5E6AC0AF-85AB-4112-B939-FD6236174874 | urn:entity:place | yes (0.7896) | top affinity in 15-candidate call |
| Tables (SF) | Che Fico | yes | 55B2E62D-59DA-4581-B9BC-67BDD78F858C | urn:entity:place | yes (0.7375) | |
| Tables (SF) | Nari | yes | 24915058-1E86-4117-9953-82F8493AC7E9 | urn:entity:place | yes (0.7228) | |
| Tables (SF) | Kin Khao | yes | A1789BF6-5E0E-4B1A-839C-B439D9D87213 | urn:entity:place | yes (0.7246) | |
| Tables (SF) | Lazy Bear | yes | 3F9C6CF8-3660-4A3E-AF1A-08C8D54198A2 | urn:entity:place | yes (0.7585) | |
| Tables (SF) | Olive Garden | yes (search) | B012C1A3-0994-48FE-8BCC-5B5D7E154FB7 | urn:entity:place | **no — insights returns empty entities** | chain cannot be scored; UI must handle "not scored" |
| Tables (SF) | Chili's | yes | 8DCE2A7D-986D-4832-B08D-C96301E434FA | urn:entity:place | yes (0.7407) | |
| Atlas (Lisbon) | Bairro Alto Hotel | yes | 9045D948-F934-4E51-9B06-90D39C65CA71 | urn:entity:place | yes (0.6920) | |
| Atlas (Lisbon) | Santiago de Alfama | yes (prefix) | AFC6F04C-E044-4E90-BEC5-CFC48043F6D7 | urn:entity:place | yes (0.7172) | result name "Santiago de Alfama - Boutique Hotel" |
| Atlas (Lisbon) | Memmo Alfama | yes (prefix) | C8D73DCD-9A99-4E34-9CE1-652ACD86811A | urn:entity:place | yes (0.7268) | result name "Memmo Alfama Hotel Lisboa" |
| Atlas (Lisbon) | The Lumiares | yes — as "The Lumiares Hotel & Spa" | 594126AD-BA21-4AC4-8B21-CB659A54A52B | urn:entity:place | not tested | plain "The Lumiares Lisbon" mis-resolves; use full name |
| Atlas (Lisbon) | 1908 Lisboa Hotel | yes — plain query "1908 Lisboa" | 19520ED1-73A5-40DD-9C38-B8AE0FC37493 | urn:entity:place | not tested | city suffix pushed it off the top |
| Atlas (Lisbon) | Palácio Belmonte | no hotel entity; best = "Palacio Belmonte Cafe & Bar" | E6DB31AB-EC64-4C50-95EC-69128543082B | urn:entity:place | not tested | consider swap (hotel not in graph under this name) |
| Atlas (Lisbon) | Hotel da Baixa | yes — plain query | D266FDB0-EF37-4079-8847-5B8A50036F9F | urn:entity:place | not tested | city suffix pushed it off the top |
| Atlas (Lisbon) | Torel Avantgarde | yes | 9FD4E949-737B-4BDF-887C-781CC163F064 | urn:entity:place | yes (0.6932) | |
| Atlas (Lisbon) | Four Seasons Hotel Ritz Lisbon | yes | 7BDE3867-BC82-4DDE-8263-D2BBF4A92E0A | urn:entity:place | yes (0.7149) | |
| Atlas (Lisbon) | Pestana CR7 Lisboa | yes | 333978D7-AA9E-412C-8E29-7AD2AC2BDD2A | urn:entity:place | yes (0.7111) | |
| Verve (brands) | Aesop | yes | 32F867B9-E6DF-44C3-BCE4-40160C7ED5E4 | urn:entity:brand | yes (0.7593) | |
| Verve (brands) | MUJI | yes (name "Muji") | E12201A5-CC50-40AF-97AE-C54A2CA303F7 | urn:entity:brand | yes (0.7521) | case-insensitive match needed |
| Verve (brands) | Arket | yes | C4E6B787-F993-4568-B6ED-498321F64388 | urn:entity:brand | not tested | |
| Verve (brands) | COS | yes | 2CA2569D-223D-42D6-BB2F-F8B5D36B9AEC | urn:entity:brand | not tested | |
| Verve (brands) | Our Legacy | yes | F02ECD25-8F39-48DE-B802-BCEFD94E2422 | urn:entity:brand | not tested | |
| Verve (brands) | Acne Studios | yes | C90E3920-BF05-4537-903F-085BFE2E41AC | urn:entity:brand | not tested | |
| Verve (brands) | Vitsoe | **no — absent from brand search** | — | — | — | swap candidate |
| Verve (brands) | HAY | yes | 52C68410-550C-4AB5-8966-E1107D6D8EBD | urn:entity:brand | not tested | |
| Verve (brands) | Tekla | **no — absent from brand search** | — | — | — | swap candidate |
| Verve (brands) | Patagonia | yes | DB4CE34E-3A63-4947-946F-9D52502C5762 | urn:entity:brand | not tested | |
| Verve (brands) | Zara | yes | 74A44B01-5C99-4754-9585-F487D21C543D | urn:entity:brand | not tested | |
| Verve (brands) | Uniqlo | yes | 46C9F889-EC89-4715-A767-DEABACF52C41 | urn:entity:brand | not tested | |

Counts: **Tables 12/12 resolve** (1 unscorable: Olive Garden); **Atlas 10/10 resolve** with name variants (Palácio Belmonte is the cafe/bar venue only — swap); **Verve 10/12 resolve** (swap Vitsoe, Tekla).

Resolver city-token nuance: Atlas disambiguations use the Portuguese spelling ("Lisboa"); a `locationText` of "Lisbon" fails the city-token check and yields `ambiguous` (entity still attached). Use "Lisboa" in Atlas fixtures, or add an alias.

## 9. Fallback decisions if a capability is missing

| Missing capability | Status after live probe | Active decision |
| --- | --- | --- |
| Explainability contributions | Partially present with a different key (`signal.interests.entities`) | Extend `extractContributions` to read that key (entity_id + score) or fall back to affinity + tagNames; aggregate block stays in `explainabilityRaw` |
| Affinity at any known path | Present at `query.affinity` | No fallback needed; no code change |
| `filter.results.entities` ignored or restricted | Works; unscorable IDs silently omitted | Keep as-is; UI already distinguishes "not scored" (Olive Garden) |
| Cross-domain signals rejected | Works both directions | No fallback needed |
| `take` too small / ID limits | Search max `take=100`; 15 candidates fine | Clamp search `take` to 100 (client currently allows 199 → will 400); chunking not needed at demo scale |
| Frequent 429s | 5 req/s burst limit; no Retry-After | Add client pacing (≥250 ms between calls) + TTL cache; keep 429 → `RATE_LIMIT` mapping |
| Tag search unavailable | Works | None |

## 10. Deviations log

All six deviations below were fixed in Wave K (`9d6b6fb`); the Action column records the original finding.

| Date | Deviation from `docs/contracts.md` / build | Action taken |
| --- | --- | --- |
| 2026-10-19 | `/search` and `/entities` results carry no `subtype` (only `types[0]`); frozen resolver requires `entity.subtype === expectedType`, so live search never resolves | Recorded; mapper fix (fallback to `types[0]`) required before live rank runs — flagged to owner, not yet applied |
| 2026-10-19 | Client sends text `filter.location` to `/search`; live API requires `lat,lon` there (text returns 400) | Use `location=` or `filter.location.query=` for text locations; fix required in client search param mapping |
| 2026-10-19 | `/v2/entities` does not exist; entity lookup lives at `/entities` | Path fix required in client `getEntities` |
| 2026-10-19 | Search `take` max is 100 (client clamps 1..199); `take=200` → 400 | Clamp search take to 100 |
| 2026-10-19 | `extractContributions` looks for `contributions`/`entities`; live key is `signal.interests.entities` | Parser extension or §9 fallback |
| 2026-10-19 | Entity tag objects use `tag_id` (search/entities) vs `id` (insights, `/v2/tags`); client reads `id` | Use `tag_id ?? id` fallback in mapper |

---

Verification artifacts (raw JSON) are written by the probe to the gitignored `scripts/probe-output/`. The mapper deviations above were fixed in Wave K (`9d6b6fb`).

## 11. Signals, weights and cap (`pnpm probe:unknowns qloo`, 2026-10-20)

- **Tag signals** (`signal.interests.tags`) change insights scores for every type tested: place max |Δaffinity| 0.021 (order unchanged), movie 0.138 and brand 0.131 (order changed). Vibes are sent as tag signals.
- **Weights:** both candidate JSON syntaxes (`[{"entity","weight"}]` and `[{"entity_id","weight"}]`) return HTTP 400. Strength is not sent; it only decides which likes make the cut.
- **Signal cap:** 20 → 35 → 50 entity signals move scores by about 0.002–0.003 per step while latency rises from 0.64 s to 1.29 s, so the cap stays 20.
- **Liked entities are not scored:** Qloo leaves signal entities out of `results.entities`, so a page item the user already likes comes back unscored (open product call, spec §8).

Raw output stays in the gitignored `scripts/probe-output/`.
