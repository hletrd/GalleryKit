# Cycle 18 — Architect Review

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes
Focus: Architectural/design risks, coupling, layering

## Verified Prior Fixes

- C17-ARCH-01 (ImageProcessingJob weak contract): Partially addressed by 38077b9 — fields now passed, but type remains optional.
- C17-ARCH-02 (icc_profile_name schema gap): FIXED in 4d1f323 — column added.
- C17-ARCH-03 (SW metadata store): Still present, deferred.
- C17-ARCH-04 (single-writer topology): Documented, accepted.

---

## New Findings

### HIGH SEVERITY

**C18-HIGH-01: Checkout idempotency key design trade-off broken by overcorrection**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151`
- **Confidence:** HIGH
- **Problem:** The original design used a deterministic key (`imageId-ip-minute`) to deduplicate rapid duplicate clicks. C17-SEC-01 identified that `ip='unknown'` causes cross-user collision. The fix (adding randomUUID) traded off deduplication for uniqueness. But deduplication is the PRIMARY purpose of an idempotency key — without it, the key has no value. The architecture now has a mechanism with no function.
- **Suggested fix:** Use a hierarchical key: deterministic per-session component + minute window. If no session, fall back to IP + User-Agent hash. If IP is 'unknown', accept that deduplication is unavailable (document this in deployment requirements).

---

### MEDIUM SEVERITY

**C18-MED-01: Service Worker cache abstraction leaks implementation details**
- **File:** `apps/web/public/sw.template.js`
- **Confidence:** MEDIUM
- **Problem:** The `recordAndEvict` function manipulates both a metadata Map and the Cache API, but the key types differ (string vs Request). This is a leaky abstraction — the LRU tracker assumes its keys match the cache keys, but they don't. The architecture should either: (a) use string URLs consistently for both metadata and cache keys, or (b) store Request objects in metadata.
- **Suggested fix:** Refactor `staleWhileRevalidateImage` to use `request.url` as the cache key for both `put` and `match`, making it consistent with `delete`.

---

### LOW SEVERITY

**C18-LOW-01: Semantic search endpoint mixes validation concerns**
- **File:** `apps/web/src/app/api/search/semantic/route.ts`
- **Confidence:** LOW
- **Problem:** The route performs body parsing, rate limiting, feature-gate checking, embedding computation, and result enrichment all in one handler. While acceptable for a prototype endpoint, the tight coupling makes unit testing difficult — every test must mock the full pipeline.
- **Suggested fix:** Extract validation, embedding, and enrichment into separate functions. Deferred until semantic search graduates from stub to real ONNX inference.
