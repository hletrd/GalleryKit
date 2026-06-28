# Code Review — Cycle 21
**Reviewer:** code-reviewer agent  
**Date:** 2026-06-27  
**HEAD:** 993ed471  
**Scope:** `apps/web/src/` — actions/, lib/, components/, app/api/, db/  
**Deferred items not re-reported:** A1, A3, A4, A5, A6+N2, N1, F3 (per cycle-20-deferred.md)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |

**Verdict: APPROVE with observations.**  
No CRITICAL or HIGH findings at HIGH confidence. Two LOW findings noted; both are best-effort analytics or dead code, neither a security risk or data-loss risk.

---

## Findings

### [LOW / HIGH confidence] C21-RVW-01 — Orphaned retry count after post-flush cap eviction

**File:** `apps/web/src/lib/data.ts:163–170`

**Issue:**  
The post-flush cap enforcement while-loop (in the `finally` block of `flushGroupViewCounts`) evicts entries from `viewCountBuffer` but does NOT simultaneously delete the corresponding entry from `viewCountRetryCount`:

```js
// data.ts lines 163–170 — MISSING retryCount cleanup
while (viewCountBuffer.size > MAX_VIEW_COUNT_BUFFER_SIZE) {
    const oldestKey = viewCountBuffer.keys().next().value;
    if (oldestKey !== undefined) {
        viewCountBuffer.delete(oldestKey);
        // MISSING: viewCountRetryCount.delete(oldestKey);
    } else {
        break;
    }
}
```

**Failure scenario:**  
1. Group A accumulates `retries = 2` in `viewCountRetryCount` across two failed flushes.  
2. The post-flush cap enforcement evicts Group A from `viewCountBuffer` (too many entries). `viewCountRetryCount` still holds `retries = 2` for A.  
3. Group A receives a new view increment and is re-buffered with `count = 1`.  
4. During the next flush, the DB fails for Group A.  
5. `retries = viewCountRetryCount.get(groupId) ?? 0` returns the stale `2`.  
6. On the subsequent flush failure, `retries = 3 >= VIEW_COUNT_MAX_RETRIES = 3` → Group A is DROPPED with a warning, having only received ONE actual failure after re-entry instead of the expected three.

**Impact:** Best-effort view-count analytics only. View counts may undercount for groups that experience cap-eviction followed by DB failures. No data-loss risk on durable data.

**Fix:**  
```js
while (viewCountBuffer.size > MAX_VIEW_COUNT_BUFFER_SIZE) {
    const oldestKey = viewCountBuffer.keys().next().value;
    if (oldestKey !== undefined) {
        viewCountBuffer.delete(oldestKey);
        viewCountRetryCount.delete(oldestKey); // ADD THIS
    } else {
        break;
    }
}
```

---

### [LOW / LOW confidence] C21-RVW-02 — Dead condition in `isProtectedAdminRoute` outer `if`

**File:** `apps/web/src/proxy.ts:57`

**Issue:**  
The outer `if` in `isProtectedAdminRoute` includes `|| pathname === \`/${locale}/admin\`` (equality-match for the login page path). The inner `if` only triggers on `pathname.startsWith(\`/${locale}/admin/\`)` (with trailing slash), so the equality-match branch in the outer condition never contributes to a `return true` — a pathname of exactly `/${locale}/admin` enters the outer `if` but falls through the inner `if` to `return false`. The login page is intentionally NOT protected, so the behavior is correct, but the outer equality-check is dead code that may mislead future readers into believing login-page protection is needed.

```js
// proxy.ts:57 — outer condition includes a branch that never fires
if (pathname.startsWith(`/${locale}/admin/`) || pathname === `/${locale}/admin`) {
    // This branch only reached when pathname === `/${locale}/admin`, but:
    if (pathname.startsWith(`/${locale}/admin/`)) {
        return true; // ← never reached via the outer equality-match branch
    }
}
```

**Impact:** No functional or security impact — the middleware correctly does not protect the login page. Low confidence because the comment above the inner `if` ("The login page is exactly /[locale]/admin") suggests the outer condition was intentionally written this way for documentation purposes, not by accident.

**Fix (optional):** Simplify to the inner condition only:
```js
for (const locale of LOCALES) {
    if (pathname.startsWith(`/${locale}/admin/`)) {
        return true;
    }
}
```
Or add a comment clarifying that the outer equality-match is intentionally included for readability despite being unreachable by the inner guard.

---

## Open Questions (low-confidence concerns — not blocking)

None beyond C21-RVW-02 above.

---

## Areas Reviewed and Confirmed Clean

The following areas were explicitly examined this cycle and found to have no new issues:

| Area | Key confirmation |
|------|-----------------|
| `auth.ts` — login flow | Rate-limit pre-incremented before Argon2, dummy-hash for user-enumeration prevention, IP + account buckets, session creation in transaction, `timingSafeEqual` HMAC check |
| `admin-users.ts:107–108` — username length | `.length` correct because `^[a-zA-Z0-9_-]+$` regex is applied first, guaranteeing ASCII-only input (AGG9R-03) |
| `db-actions.ts` — mysqldump | `spawn()` with separate arg array (no shell injection), `MYSQL_PWD` env var, `sanitizeStderr`, advisory lock `gallerykit_db_restore`, `RELEASE_LOCK` in every finally |
| `gps-exif-strip.ts:470` — walkAborted | Unconditional check before processing results (R20C20 T2 fix confirmed) |
| `search/similar/[id]/route.ts` | Gate ordering correct, `rollbackSemanticAttempt` on every early return, `searchEnrichmentSelectFields` compile guard, `dotProduct` only reached in production mode |
| `topics.ts` | Advisory lock pattern correct, `remapTopicSlugInQuery` inside transaction |
| `collections.ts` | `requireSameOriginAdmin()` result stored + early return on all mutating exports |
| `images.ts` | `collectImageCleanupFailures` wraps each op in try/catch (never throws), outer `Promise.all` safe; `CLEANUP_CONCURRENCY` uses `Number()` not `parseInt` |
| `public.ts:375` | `topicSlug.length` correct (ASCII-only), `countCodePoints` used for search query |
| `rate-limit.ts` / `auth-rate-limit.ts` | `GREATEST(count - 1, 0)` prevents negative decrements; rollback uses decrement not delete |
| `clip-embeddings.ts` | Zero-vector protection in `normalizeEmbedding`, dimension mismatch throws, `topK` filter threshold correct |
| `csv-escape.ts` | Formula injection prefix, bidi strip, zero-width strip — all defense-in-depth layers present |
| `avif-support.ts` | `onload` + `onerror` both resolve Promise (no hang path) |
| `data.ts` — drain Promise | `resolveDrain()` always called in `finally` block (no hanging Promise) |
| `og-photo-fetch.ts` | Per-attempt + total-budget timeouts, byte cap, `Number.isFinite` guard on Content-Length |
| `embeddings.ts:134` | `Promise.all` chunks wrapped in `try/catch` per-item — no unhandled rejection |
| `upload-limits.ts` | `Number()` not `parseInt` (R20C20 fix confirmed), `Math.floor` + `isFinite` + `> 0` guard |
| `bounded-map.ts` | Hard cap auto-enforced on `set()`, copy-on-read from `get()` / `entries()`, live `.data` reference documented with mutation warning |
| `view-retention.ts` | Chunked DELETE with per-batch LIMIT — correctly bounded |
| `proxy.ts` | Admin auth guard order correct, `x-gk-admin-render: 1` set after auth check |

---

## Positive Observations

1. **Deferred-item discipline.** The cycle-20 deferred list is clean: none of the A1/A3/A4/A5/A6+N2/N1/F3 items have regressed or grown in scope.

2. **`viewCountRetryCount` multi-eviction-path coverage.** The code already handles three of the four cleanup paths correctly: (a) `viewCountRetryCount.clear()` when buffer empties, (b) `viewCountRetryCount.delete(groupId)` when the max-retry threshold is hit, (c) `viewCountRetryCount.delete(groupId)` when the at-capacity re-buffer is dropped, and (d) `viewCountRetryCount` hard-cap eviction when sustained outage keeps the buffer non-empty. Only the post-flush cap while-loop (finding C21-RVW-01) misses the parallel delete.

3. **Promise error-handling consistency.** Every `Promise.all` over potentially-failing async ops uses an inner try/catch or `.catch()` so the outer `Promise.all` cannot produce unhandled rejections — a pattern applied uniformly across `images.ts`, `embeddings.ts`, and `data.ts`.

4. **`Number()` vs `parseInt` rollout.** The R20C20 fix for scientific-notation env-var parsing (`Number()` + `Math.floor` + `isFinite` + `> 0`) is correctly applied across `upload-limits.ts`, `rate-limit.ts`, `view-retention.ts`, and `audit.ts`. The pattern is now consistent.

5. **GREATEST guard in `decrementRateLimit`.** `GREATEST(count - 1, 0)` prevents the rate-limit counter from going negative during concurrent rollbacks — a sound defensive use of SQL's GREATEST that avoids a CAS loop.

6. **OG-route fetch chain.** `og-photo-fetch.ts` correctly bounds both per-attempt timeout and total chain budget, uses `Number.isFinite` on the Content-Length header, and applies both pre-buffer and post-buffer byte-cap checks. This is defense-in-depth against slow-read and oversized-response scenarios.

---

## Recommendation

**APPROVE.** No CRITICAL or HIGH findings. Two LOW findings documented above with concrete fixes. The single actionable fix (C21-RVW-01: add `viewCountRetryCount.delete(oldestKey)` at `data.ts:166`) is a one-line change and can be included at the implementer's discretion in the next cycle.
