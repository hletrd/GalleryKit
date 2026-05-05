# Cycle 18 — Review Aggregate

**Date:** 2026-05-06
**Source:** code-reviewer, security-reviewer, perf-reviewer, debugger, test-engineer, architect, critic

---

## Actionable Findings (NEW this cycle)

| ID | Severity | Confidence | File | Description | Action |
|----|----------|------------|------|-------------|--------|
| C18-HIGH-01 | HIGH | HIGH | `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151` | Stripe checkout idempotency key includes `randomUUID()`, making every request's key unique. Stripe deduplication is completely disabled. A double-click creates two checkout sessions. Introduced by fix for C17-SEC-01 (commit 80a1956). | Remove randomUUID; use deterministic per-user key (session hash or IP+UA fingerprint + imageId + minute). |
| C18-MED-01 | MEDIUM | MEDIUM | `apps/web/public/sw.template.js:94` / `sw.js:94` | `imageCache.delete(entry.url)` uses string URL, but entries stored via `imageCache.put(request, ...)`. Cache API may not match string to Request key. LRU eviction may fail to remove actual entries, causing unbounded cache growth. | Use consistent key types — store Request in metadata or use string URLs for both put and delete. |
| C18-MED-02 | MEDIUM | MEDIUM | `apps/web/src/app/api/search/semantic/route.ts:111` | `query.length < 3` uses UTF-16 code units instead of `countCodePoints`. Inconsistent with rest of codebase. Emoji queries can bypass minimum-length gate. | Import `countCodePoints` and use it for the min-length check. |
| C18-LOW-01 | LOW | LOW | `apps/web/src/lib/image-queue.ts:351-400` | Fire-and-forget caption/embedding hooks run after `processed=true` commit without checking image existence. If admin deletes image in the narrow window, hooks waste CPU on non-existent rows. | Optional: add existence guard before DB UPDATE in hooks. |
| C18-LOW-02 | LOW | LOW | `apps/web/public/sw.template.js:42` / `sw.js:42` | `isHtmlRoute` only checks `Accept: text/html`. Some navigation contexts send `Accept: */*`, causing HTML routes to bypass network-first strategy. Offline fallback lost. | Add `request.mode === 'navigate'` as fallback check. |
| C18-LOW-03 | LOW | LOW | `apps/web/src/app/api/search/semantic/route.ts:76-90` | Content-Length guard accepts negative values (protocol-illegal but not rejected). | Add `contentLengthNum < 0` to rejection condition. |

---

## Verified Prior Fixes (from cycle 17, confirmed in codebase)

| ID | Status | Commit |
|----|--------|--------|
| C17-MED-01 (missing EXIF hints in upload) | FIXED | 38077b9 |
| C17-MED-02 (missing iccProfileName in upload) | FIXED | 38077b9 |
| C17-MED-03 (icc_profile_name schema gap) | FIXED | 4d1f323 |
| C17-LOW-01 (SW NaN age check) | FIXED | 0d243db |
| C17-SEC-01 (checkout idempotency collision) | ADDRESSED but REGRESSED — see C18-HIGH-01 | 80a1956 |

---

## Cross-Agent Agreement

- **C18-HIGH-01**: 7/7 agents — universal agreement. The randomUUID in idempotency key is a functional regression.
- **C18-MED-01**: 3/7 agents (code-reviewer, perf-reviewer, debugger) — cache key mismatch is a real correctness issue.
- **C18-MED-02**: 2/7 agents (code-reviewer, critic) — consistency issue, easily fixed.
- **C18-LOW-01**: 2/7 agents (code-reviewer, debugger) — minor race, low impact.

---

## Agent Failures

None.

---

## Deferred Items (carry-forward from prior cycles)

- **C16-HIGH-01:** SW metadata cache read-modify-write race — deferred, requires SW architecture refactor.
- **C16-LOW-03:** getRateLimitBucketStart truncates sub-second windows — deferred, all current windows are whole-second.
- **C16-LOW-04:** Service Worker caches non-image responses as images — deferred, requires Content-Type verification.
- **C16-LOW-05:** Analytics record functions don't validate entity existence — deferred, extra SELECTs would add latency.
- **C17-ARCH-03:** SW metadata store uses single shared JSON blob — deferred.
- **C17-PERF-02:** getImagesLitePage COUNT(*) OVER() may be expensive at scale — deferred.
