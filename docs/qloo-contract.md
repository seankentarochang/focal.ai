# Qloo API contract — live probe record (T-01)

> **No live verification has been performed yet — the API key has not been received.**
> Every section below is a fill-in template. When the key arrives, run `scripts/probe-qloo.ts`, then transcribe exact (redacted) outcomes here. Copy real excerpts; never paraphrase or guess. Mark anything unverified as `UNKNOWN — <reason>`.

How to fill this file: run the probe with `QLOO_API_KEY` set, capture per-endpoint request/response pairs, paste redacted excerpts (structure intact, key material stripped), answer every prompt, and update `packages/qloo/src/parsers/**` in the same PR. If any mapping changes, edit `docs/contracts.md` first.

## 0. Session metadata

| Field | Value |
| --- | --- |
| Verified at (UTC) | _fill_ |
| Verifier | _fill_ |
| Key source | hackathon key, header `X-Api-Key` |
| Environment | _fill_ (node version, git commit) |
| Probe script | `scripts/probe-qloo.ts` |

## 1. Host & auth

- Base URL expected: `https://hackathon.api.qloo.com`. Confirmed: _yes/no + evidence_
- Auth: header `X-Api-Key`. Keys work ONLY against this host.
- 401 without key: documented as confirmed; re-confirm during probe. Status/body: `_paste here_`
- Behavior with an invalid key: `_paste here (status, body code if any)_`

## 2. Endpoint shapes

### 2.1 `GET /search` (entity resolution)

Request tried (query string, key redacted): `_paste here_`

Response excerpt (real, redacted):
```json
_paste real excerpt here — keep structure (results.entities[] fields, pagination, total)_
```

Field mapping observed:

| Upstream field | Maps to `QlooEntity` | Confidence |
| --- | --- | --- |
| `_fill_` | `entityId` | _ |
| `_fill_` | `name` | _ |
| `_fill_` | `subtype` | _ |
| `_fill_` | `disambiguation` | _ |
| `_fill_` | `popularity` | _ |
| `_fill_` | `tagIds` / `tagNames` | _ |

Pagination: does `take`/`page` apply? Max observed: `_fill_`

### 2.2 `GET /v2/insights` (recommendations / affinity — GET only)

Request params exercised (values redacted where they identify a person): `filter.type`, `signal.interests.entities` (comma-separated, cross-domain claimed), `filter.results.entities` (comma-separated candidates — the scoring primitive), `filter.location.query`, `feature.explainability=true`, `take`, `page`.

Questions to answer with evidence:
- Does `filter.results.entities` restrict the response to exactly those IDs and rank/score them? `_fill_`
- Order of returned entities vs input order; where does `rankIndex` come from? `_fill_`
- Candidate not scored: absent from response, or present without affinity? `_fill_`
- Cross-domain signals (e.g. `urn:entity:artist` seed → `urn:entity:place` results): works? `_fill_`

Response excerpt (real, redacted):
```json
_paste real excerpt here — include one full entity object and one contribution entry_
```

### 2.3 `GET /v2/tags?filter.query=...` (tag search)

Request: `_paste here_`

Response excerpt:
```json
_paste real excerpt here_
```

Tag fields observed (id / name / subtype? pagination?): `_fill_`

### 2.4 `GET /v2/entities` (entity by ID)

ID parameter name and format (`entity_id`? plural?): `_fill_`
Batch size limit: `_fill_`

Response excerpt:
```json
_paste real excerpt here_
```

## 3. Affinity field verdict (THE critical question)

Candidate JSON paths, checked in order:

- [ ] `entity.query.affinity`
- [ ] `entity.query.measurements.affinity`
- [ ] other: `_exact path_`

Verdict:

| Item | Value |
| --- | --- |
| Exact JSON path | _fill_ |
| Scale | _min/max observed (expected 0..1)_ |
| Sample values | _fill (3+) |
| Confidence | _fill_ |

Decision recorded: `packages/qloo/src/insights.ts` extraction order and `affinityFoundAt` strings updated to: `_fill_` / `_none needed_`

## 4. Explainability (`feature.explainability=true`)

Excerpt (one result with its contributions):
```json
_paste real excerpt here_
```

Interpretation notes: what do contribution entries reference (signal entities? tags?)? Score scale? Per-result vs aggregate (`aggregateExplainability`)? `_fill_`

If shape is unusable for reasons, record the fallback decision from §9 instead: `_fill_`

## 5. `filter.results.entities` size behavior

| Question | Answer |
| --- | --- |
| Max IDs accepted in one call | _fill_ |
| Above-limit behavior (400? silent truncation?) | _fill_ |
| Chunking required in `@focal-ai/qloo`? | _yes/no_ |

## 6. Latency measurements

| Endpoint | n | p50 | p95 | max | Notes (cold vs warm/cache) |
| --- | --- | --- | --- | --- | --- |
| `GET /search` | _ | _ | _ | _ | _ |
| `GET /v2/insights` | _ | _ | _ | _ | _ |
| `GET /v2/tags` | _ | _ | _ | _ | _ |
| `GET /v2/entities` | _ | _ | _ | _ | _ |

Implication for `timeoutMs` (default 8000) and the 1-retry policy: `_fill_`

## 7. 429 behavior

- Trigger method (burst size / rate): `_fill_`
- Response headers (`Retry-After`? `X-RateLimit-*`?): `_fill_`
- Response body shape: `_paste here_`
- Decision for `QlooError.retryAfterMs` population: `_fill_`

## 8. Coverage checklist — pinned demo sets

Pinned demo sets must resolve against live Qloo. Fill for every pinned entity; on any failure, swap to a pinned alternate (see §9).

Columns: resolves via `/search`? · entity ID · subtype · has affinity via insights? · notes.

| Page | Entity | Resolved? | Entity ID | Subtype | Scored? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Tables (SF) | Bar Part Time | _ | _ | _ | _ | _ |
| Tables (SF) | Rintaro | _ | _ | _ | _ | _ |
| Tables (SF) | State Bird Provisions | _ | _ | _ | _ | _ |
| Tables (SF) | Zuni Café | _ | _ | _ | _ | _ |
| Tables (SF) | `_remaining 8 names + 3 alternates from T-12_` | _ | _ | _ | _ | _ |
| Tables (SF) | Chez Panisse-style fine-dining entry (Cal-Italian) | _ | _ | _ | _ | _ |
| Atlas (Lisbon) | `_hotel set from T-16_` | _ | _ | _ | _ | _ |
| Verve (brands) | Aesop | _ | _ | _ | _ | _ |
| Verve (brands) | Muji | _ | _ | _ | _ | _ |
| Verve (brands) | `_remaining set from T-16_` | _ | _ | _ | _ | _ |

## 9. Fallback decisions if a capability is missing

Pre-agreed fallbacks — pick and record the active one per row; if a fallback changes an interface, edit `docs/contracts.md` first.

| Missing capability | Fallback | Contract impact |
| --- | --- | --- |
| Explainability contributions | Reasons cite affinity + tagNames only; drop `contributions` | None (optional fields) |
| Affinity at any known path | Candidate is treated as unresolved, never scored; UI says "not scored" | None |
| `filter.results.entities` ignored or restricted | Score via signal-only insights; match candidate IDs locally; disclose deviation in README | Update insights mapping in `docs/contracts.md` first |
| Cross-domain signals rejected | Same-domain seeds; honest UI note | Contracts unchanged; product note |
| `take` too small / ID limits | Chunk requests, merge by upstream rank | T-04 owns chunking |
| Frequent 429s | Smaller `take`, backoff via `retryAfterMs`, lean on TTL cache | None |
| Tag search unavailable | Use `tagIds` from entity payloads only | None |

## 10. Deviations log

| Date | Deviation from `docs/contracts.md` | Action taken |
| --- | --- | --- |
| _ | _ | _ |

---

Until this file is filled: all Qloo integration work runs against the mock adapter (`QLOO_MOCK=1`) with labeled fixtures and canned unit payloads. Nothing in this file may be cited as verified until §0 is complete.
