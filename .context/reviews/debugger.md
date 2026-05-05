# Cycle 18 — Debugger Review

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes
Focus: Latent bug surface, failure modes, regressions

## Verified Prior Fixes

- C17-DEBUG-01 (wrong AVIF colorspace for fresh uploads): FIXED in 38077b9 — `iccProfileName` now passed.
- C17-DEBUG-02 (missing caption hints): FIXED in 38077b9 — `camera_model`/`capture_date` now passed.
- C17-DEBUG-03 (SW NaN age): FIXED in 0d243db — `!Number.isNaN(age)` validated.
- C17-DEBUG-04 (checkout idempotency collision): Addressed by 80a1956, but see C18-HIGH-01 for regression.

---

## New Findings

### HIGH SEVERITY

**C18-HIGH-01: Checkout idempotency key randomness defeats Stripe deduplication — double-session bug**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151`
- **Confidence:** HIGH
- **Failure scenario:**
  1. Visitor clicks "Buy" on a photo. Browser sends POST to `/api/checkout/123`.
  2. Server generates idempotency key with randomUUID: `checkout-123-203.0.113.1-12345678-abc...`
  3. Network hiccup or double-click: a second POST arrives 50ms later.
  4. Server generates a DIFFERENT randomUUID: `checkout-123-203.0.113.1-12345678-def...`
  5. Stripe sees two distinct keys and creates TWO Checkout sessions.
  6. Visitor is redirected to the first session URL; the second sits unpaid in Stripe dashboard.
  7. Gallery operator sees a false-positive "abandoned checkout" alert.
- **Root cause:** Commit 80a1956 added randomUUID to prevent cross-user collision (C17-SEC-01), but the fix was too broad. It removed ALL deduplication, including same-user double-clicks.
- **Detection:** Stripe dashboard shows duplicate sessions with identical metadata but different session IDs.

---

### MEDIUM SEVERITY

**C18-MED-01: Service Worker cache key mismatch — silent unbounded growth**
- **File:** `apps/web/public/sw.template.js:94`
- **Confidence:** MEDIUM
- **Failure scenario:**
  1. User browses gallery; images are cached via `imageCache.put(request, response)`.
  2. Cache exceeds 50 MB budget; LRU eviction triggers.
  3. `recordAndEvict` calls `imageCache.delete(entry.url)` with a string URL.
  4. Cache API does NOT match the string URL against the Request-object key (different matching semantics).
  5. Entry remains in cache; metadata Map thinks it was deleted.
  6. Repeated browsing adds more entries; cache grows without bound.
  7. Eventually browser quota eviction clears everything, but until then storage is wasted.
- **Detection:** Hard to detect in production. Could be caught by monitoring `caches.keys()` size or by a SW self-test.

**C18-MED-02: Semantic search length gate inconsistency — emoji queries bypass minimum**
- **File:** `apps/web/src/app/api/search/semantic/route.ts:111`
- **Confidence:** MEDIUM
- **Failure scenario:**
  1. Attacker sends semantic search query with two emoji: "🚀🌙".
  2. `query.length` is 4 (UTF-16 code units), so `4 < 3` is false — passes gate.
  3. `countCodePoints` would be 2, which should fail a "3 characters" minimum.
  4. Query proceeds to embedding computation and DB scan.
  5. Impact is low (rate-limited, same-origin required), but the gate is inconsistent with other endpoints.

---

### LOW SEVERITY

**C18-LOW-01: Caption/embedding hooks target deleted image — wasted DB round-trip**
- **File:** `apps/web/src/lib/image-queue.ts:351-400`
- **Confidence:** LOW
- **Failure scenario:**
  1. Image processing completes; `processed=true` committed.
  2. Admin deletes the image in the narrow window before hooks fire.
  3. `generateCaption` or embedding IIFE attempts DB UPDATE on non-existent row.
  4. Error caught and logged at warn level. No user-visible impact.
  5. One wasted DB round-trip and CPU cycle per race.
