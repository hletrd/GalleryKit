# Cycle 16 Review Aggregate

Date: 2026-05-06
Cycles included: 16
Reviewers: cycle16-comprehensive (single-agent comprehensive review)

## Aggregate Findings

### HIGH SEVERITY

**C16-HIGH-01: Service Worker metadata cache read-modify-write race condition**
- **File:** `apps/web/public/sw.js` (lines 79–106, `recordAndEvict`)
- **Confidence:** High
- **Problem:** The `recordAndEvict` function reads metadata from cache, mutates it, and writes it back. Between await points, concurrent fetch events can interleave, causing one update to overwrite another. Lost metadata entries mean the LRU eviction doesn't account for all cached images, causing the cache to exceed its 50 MB budget.
- **Fix:** Serialize metadata updates or use per-URL metadata keys instead of a single shared object.

---

### MEDIUM SEVERITY

**C16-MED-01: Bootstrap query omits caption-generation hints**
- **File:** `apps/web/src/lib/image-queue.ts` (lines 534–546)
- **Confidence:** High
- **Problem:** `bootstrapImageProcessingQueue` selects only basic fields but `enqueueImageProcessing` passes `camera_model` and `capture_date` to `generateCaption`. Bootstrapped jobs lack these EXIF hints, degrading caption quality after server restarts.
- **Fix:** Add `camera_model` and `capture_date` to the bootstrap query.

**C16-MED-02: Service Worker install event skipWaiting not awaited**
- **File:** `apps/web/public/sw.js` (lines 178–181)
- **Confidence:** Medium
- **Problem:** `self.skipWaiting()` is not wrapped in `event.waitUntil()`, which may cause inconsistent activation timing across browsers.
- **Fix:** `event.waitUntil(self.skipWaiting())`.

**C16-MED-03: Public route rate-limit lint misses single-quote rate-limit imports**
- **File:** `apps/web/scripts/check-public-route-rate-limit.ts` (lines 148–157)
- **Confidence:** Medium
- **Problem:** `RATE_LIMIT_MODULE_HINTS` only includes `['auth-rate-limit']`, not `'rate-limit'`. Routes importing bespoke helpers from `@/lib/rate-limit` with non-standard names wouldn't be caught by the module hint check.
- **Fix:** Add `'rate-limit'` to `RATE_LIMIT_MODULE_HINTS`.

---

### LOW SEVERITY

**C16-LOW-01: pruneRetryMaps omits lastErrors from cleanup**
- **File:** `apps/web/src/lib/image-queue.ts` (lines 92–105)
- **Confidence:** Medium
- **Problem:** `pruneRetryMaps` cleans `retryCounts` and `claimRetryCounts` but not `lastErrors`. Leak is bounded by concurrent failing jobs.
- **Fix:** Include `lastErrors` in the prune loop.

**C16-LOW-02: stripGpsFromOriginal uses predictable temp path**
- **File:** `apps/web/src/lib/process-image.ts` (lines 979–1001)
- **Confidence:** Low
- **Problem:** Temp path is always `filePath + '.gps-strip.tmp'`. Concurrent processes could race on the same path.
- **Fix:** Use `crypto.randomUUID()` for the temp suffix.

**C16-LOW-03: getRateLimitBucketStart truncates sub-second windows**
- **File:** `apps/web/src/lib/rate-limit.ts` (lines 347–351)
- **Confidence:** Low
- **Problem:** `Math.floor(windowMs / 1000)` truncates sub-second precision. All current callers use whole-second windows, so this is latent.
- **Fix:** Document the truncation or use ms-precision bucketing.

**C16-LOW-04: Service Worker caches non-image responses as images**
- **File:** `apps/web/public/sw.js` (lines 110–136)
- **Confidence:** Low
- **Problem:** The SW checks `networkResponse.ok` but not `Content-Type`. A misconfigured server returning HTML at an image URL would be cached as an image.
- **Fix:** Verify `Content-Type` starts with `image/` before caching.

**C16-LOW-05: Analytics record functions don't validate entity existence**
- **File:** `apps/web/src/app/actions/public.ts` (lines 272–317)
- **Confidence:** Low
- **Problem:** `recordPhotoView`, `recordTopicView`, `recordSharedGroupView` INSERT without checking if the referenced entity exists.
- **Fix:** Add lightweight existence checks or use INSERT IGNORE with FK constraints.

---

## Cross-Agent Agreement

N/A — single-agent review cycle.

## Agent Failures

None.

## Deferred Items

- Module-level singletons in serverless contexts: acceptable for documented single-instance topology.
- Caption generation fire-and-forget: by design.
- EXIF date timezone ambiguity: known EXIF limitation.
- GROUP_CONCAT separator assumption: protected by tag sanitization.
