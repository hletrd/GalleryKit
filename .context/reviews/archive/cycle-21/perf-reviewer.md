# Performance Review — Cycle 21
**Date:** 2026-06-29
**HEAD:** (post-cycle-20 fixes)
**Findings:** 2 new (both LOW); 0 regressions; PERF-C20-01 verified fixed; PERF-C19-01..05 / PERF-C20-02/03 re-confirmed deferred

---

## PERF-C20-01 Verification — CONFIRMED FIXED

`apps/web/src/lib/og-photo-fetch.ts:41,54`:

```ts
const OG_PHOTO_FETCH_TIMEOUT_MS = 3500;        // line 41 — per-attempt abort
export const OG_PHOTO_TOTAL_BUDGET_MS = 10000;  // line 54 — overall chain deadline
```

The per-attempt timeout is now strictly less than the total budget (`3500 < 10000`). A cycle-20
comment at line 36–40 documents the rationale: "at 3500 ms a cold/broken path gets ~2 real
fallback attempts within the 10 s total budget instead of one 10 s hang." On a hung connection
the first attempt burns at most 3.5 s; the deadline check at line 113 still has ~6.5 s left for
1–2 additional size fallbacks. The warm path (first size resolves in < 1 s) is unaffected.

The cycle-20 LOW recommendation is implemented correctly and in full.

---

## PERF-C19-01..05 / PERF-C20-02/03 Re-evaluation — All Still Correctly Deferred

| ID | Item | Status |
|----|------|--------|
| PERF-C19-01 | `getImagesForSmartCollection` COUNT(*) OVER() per cursor page | Deferred — exit criterion unmet |
| PERF-C19-02 | Bootstrap `NOT IN (≤1000 failed IDs)` per 30 s | Deferred — bounded, indexed PK scan |
| PERF-C19-03 | Serial smart-collection UPDATEs in held advisory lock | Deferred — admin-only, infrequent |
| PERF-C19-04 | Histogram 768-elem temp array per redraw | Deferred — single canvas worker, micro-cost |
| PERF-C19-05 | `useDisplayCapability` 5 listeners × N consumers | Deferred — bounded, idempotent |
| PERF-C20-02 | `getTopics()` N correlated subqueries per call | Deferred — < 50 topics, idx_images_topic hit |
| PERF-C20-03 | Semantic search 2000×512-dim scoring synchronous on event loop | Deferred — hard-capped + rate-limited; 445 prod embeddings ≈ 228K ops |

No exit criteria triggered for any of the seven. No material regression from cycle-20 changes.

---

## New Findings

### PERF-C21-01 — `similar/[id]` route shares PERF-C20-03 scoring class and adds an extra mandatory DB round-trip (LOW)

**File:** `apps/web/src/app/api/search/similar/[id]/route.ts:116–172`

The similar-photos route was absent from the cycle-20 perf review scope (it was added after PERF-C20-03
was written). It shares the same synchronous scoring pattern as the semantic text-search route and
adds one extra sequential DB query.

**Gate 6 (lines 116–140):** PK lookup for the target image's embedding before the full scan:

```ts
const targetRows = await db
    .select({ embedding: imageEmbeddings.embedding })
    .from(imageEmbeddings)
    .where(and(
        eq(imageEmbeddings.imageId, id),
        eq(imageEmbeddings.modelVersion, PRODUCTION_MODEL_VERSION),
    ))
    .limit(1);
```

**Step 7 (lines 147–155):** second query fetches up to `SEMANTIC_SCAN_LIMIT` (2000) rows ordered
by `updatedAt DESC`, covered by `idx_image_embeddings_model_version_updated`.

**Lines 162–170:** same synchronous dotProduct scoring loop as PERF-C20-03 (2000 × 512 ops).

The extra round-trip validates that the target has a production embedding before burning the scan
budget — correct defensive design. The Gate 6 query hits the PK and is effectively instant (< 1 ms).
The scoring loop is bounded by the same hard mitigations as PERF-C20-03:

- Rate limit: **shared** `preIncrementSemanticAttempt` / `rollbackSemanticAttempt` budget (30/min/IP)
  with the semantic text-search route — a burst of similar-photo requests exhausts the text-search
  budget for the same IP and vice versa; intentional but undocumented
- Hard scan cap: `SEMANTIC_SCAN_LIMIT = 2000`
- Top-K cap: `SEMANTIC_TOP_K_DEFAULT` / `SEMANTIC_TOP_K_MAX`
- `idx_image_embeddings_model_version_updated` composite index covers the scan plan

At current corpus (445 production embeddings) the effective cost is ≈ 228K float ops per request,
identical to PERF-C20-03. No current warrant for offloading to `worker_threads`.

**Severity:** LOW — same exit criterion as PERF-C20-03: escalate when corpus approaches the 2000
scan limit, OR when similar-photo + semantic text-search combined request rate from a single IP
makes the shared rate-limit budget too tight.

---

### PERF-C21-02 — `handleLoadMore` O(N) array spread per batch (LOW / informational, no action)

**File:** `apps/web/src/components/home-client.tsx:126–128`

```ts
setAllImages(prev => [...prev, ...newImages]);
```

Each load-more call copies the full existing array before appending the new batch. Over P pages of
B images each, total allocation is B + 2B + … + PB = O(P²B). For 300 images at B=30/page:
10 pages → 1650 total element copies — negligible compared to React reconciliation time.

V8 GC reclaims the replaced arrays within microseconds; this cost is dwarfed by the
network + SQL latency of each load-more request (~100–500 ms). The pattern is idiomatic React
state update and correct for the single-writer append-only case.

**No fix warranted.** This becomes meaningful only at gallery sizes in the tens of thousands with
rapid pagination, which is outside the personal-gallery scope. Noted for completeness; do not act.

**Severity:** LOW / informational — no realistic impact at gallery scale.

---

## Items Investigated and Confirmed Not New

### Env-parse correctness sweep (R20C20 fixes) — all confirmed

All six env-parse sites switched from `parseInt(env, 10)` to `Number(env)` in cycle 20.
Each carries a `// R20C20:` comment. Sites confirmed:

- `process-image.ts:45,46` — `SHARP_CONCURRENCY`
- `process-image.ts:331,343` — `IMAGE_MAX_INPUT_PIXELS` / `IMAGE_MAX_INPUT_PIXELS_TOPIC`
- `rate-limit.ts:144` — `TRUSTED_PROXY_HOPS`
- `actions/images.ts:796` — `IMAGE_CLEANUP_CONCURRENCY`
- `audit.ts:111` — `AUDIT_LOG_RETENTION_DAYS`
- `upload-limits.ts:11` — `parsePositiveIntEnv` helper (covers `UPLOAD_MAX_TOTAL_BYTES` + `UPLOAD_MAX_FILES_PER_WINDOW`)

These were correctness fixes; all in place and confirmed.

### Schema indexes — no gaps detected

`db/schema.ts` reviewed in full. All query patterns are covered:

- `imageEmbeddings`: `idx_image_embeddings_model_version_updated` composite `(model_version, updated_at)` (migration 0022) covers both the semantic and similar-photo scan (`WHERE model_version = ? ORDER BY updated_at DESC LIMIT N`).
- `imageViews`: three-index design — `(imageId, viewed_at)` for per-photo analytics, `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` for breakdown queries.
- `images`: `(processed, capture_date, created_at)` for homepage, `(processed, created_at)` for prev/next navigation, `(topic, processed, capture_date, created_at)` for topic galleries. All intact.
- `sessions.expiresAt` index covers the hourly GC purge.
- `auditLog`: `(created_at)`, `(userId, created_at)`, `(action, created_at)` cover the three access patterns.
- `imageTags`: `imageIdTagIdUnique` serves imageId-filtered JOIN; `idxImageTagsTagId` serves tag-filtered JOIN.

No missing or unused indexes detected.

### Sharp pipeline — correct and unchanged

`process-image.ts:36–57`: `sharp.concurrency = Math.max(1, floor((cpuCount-1) / 3))` correctly
divides by the 3-format fan-out (AVIF + WebP + JPEG). `sharp.cache(false)` prevents libvips
operation-cache RSS growth. Both unchanged from cycle-19 / WI-14. No regression.

### `home-client.tsx` scroll listener — not a re-render hotspot

`handleScroll` checks `scrollY > 600` and uses `setShowBackToTop(prev => prev === shouldShow ? prev : shouldShow)`.
The functional update prevents a React re-render unless the boolean changes, meaning reconciliation
fires at most twice per scroll session (threshold crossing in each direction). Passive listener
on raw scroll events is correct. No concern.

### `searchImages` parallelization — well-optimized

Three-query (main + tag + topic-alias) pattern runs via `Promise.all` with short-circuit when
the main query fills `effectiveLimit`. No N+1. No concern.

### `getMapImages` — bounded and index-selective

`MAP_MAX_MARKERS = 10000` hard cap. INNER JOIN on `topics.map_visible = true` is selective for a
personal gallery with few GPS-opted topics; `idx_images_topic` covers the join. No concern.

---

## Overall Assessment

Cycle 21 is a clean cycle. PERF-C20-01 (OG per-attempt timeout) landed correctly — the single
actionable finding from cycle 20. The two new LOW findings are both informational: PERF-C21-01
closes the scope gap on `similar/[id]` (same class as PERF-C20-03, same exit criterion, same
in-place mitigations) and PERF-C21-02 is a normal React pattern that has no practical impact at
gallery scale.

The foundational performance investments remain intact and unregressed: React `cache()` SSR
deduplication across 10 data-access functions; cursor-based gallery pagination with no public
COUNT(*); Sharp concurrency formula tuned for 3-format parallel fan-out; per-format-fresh Sharp
instances (WI-14); `sharp.cache(false)` RSS control; semantic scan hard-capped with composite
index coverage; histogram worker offload; rAF-debounced masonry resize; OG fetch chain now
correctly bounded per-attempt at 3.5 s.
