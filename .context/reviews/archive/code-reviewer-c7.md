# Code Quality Review — Cycle 7

## Summary

Overall code quality is high with strong defensive patterns, comprehensive error handling, and thoughtful comments. A few maintainability issues and edge cases remain.

---

## C7-CODE-01: `data.ts` line count approaching 1500 — god module risk — Medium

**File:** `apps/web/src/lib/data.ts`
**Current size:** ~1480 lines

**Finding:** `data.ts` remains a near-god module handling image queries, topic queries, shared groups, search, tags, prev/next navigation, view count buffering, and SEO settings. The deferred item D3-MED (data.ts god module) has been carried for multiple cycles. New functionality (smart collections, embeddings, entitlements) continues to be added to adjacent modules rather than `data.ts`, which is good, but the core data module is still oversized.

**Fix:** Begin extracting domain-specific query modules: `image-queries.ts`, `topic-queries.ts`, `shared-group-queries.ts`. The public/admin field selection objects (`publicSelectFields`, `adminSelectFields`) should move with the image queries. This is deferred per project conventions but should be planned.

**Confidence:** Medium

---

## C7-CODE-02: Inconsistent error-return patterns between server actions — Medium

**File:** `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`

**Finding:** Some server actions return structured `{ success: false, error: string }` objects (images.ts, sharing.ts), while others throw errors directly (auth.ts login). The `updateImageMetadata` action returns a plain object with `success` boolean, but `deleteAdminUser` throws `new Error('DELETE_LOCK_TIMEOUT')`. This inconsistency makes client-side error handling fragile — callers must know whether to try/catch or check `.success`.

**Fix:** Standardize on structured error returns for all new server actions. Audit existing actions and migrate throwing ones to structured returns in a dedicated refactor cycle. The auth.ts actions are intentionally throw-heavy for middleware compatibility; document this exception.

**Confidence:** Medium

---

## C7-CODE-03: `process-image.ts` `_highBitdepthAvifProbed` flag is process-global without reset mechanism — Low

**File:** `apps/web/src/lib/process-image.ts`
**Lines:** 49-66

**Finding:** The 10-bit AVIF probe uses a process-global `let` flag. If the first probe fails (e.g., transient libheif issue), the entire process lifetime downgrades to 8-bit AVIF. There is no way to retry or reset without restarting the Node process. For a long-running Docker container, this could silently degrade image quality permanently after a single transient failure.

**Fix:** Add a maximum probe-attempt count (e.g., 3) before permanently downgrading, or add a scheduled retry after a time window. Alternatively, probe on every wide-gamut image until one succeeds, then lock the flag.

**Confidence:** Low

---

## C7-CODE-04: Duplicate retry/eviction logic across BoundedMap, upload-tracker, image-queue — Low

**File:** Multiple — `bounded-map.ts`, `upload-tracker-state.ts`, `image-queue.ts`

**Finding:** The collect-then-delete prune pattern appears in three places with slight variations. The `upload-tracker-state.ts` hard-cap eviction (lines 33-40) duplicates BoundedMap's FIFO logic. The image-queue's `pruneRetryMaps` (lines 92-106) is another variant. This is a known deferred item (C7-MED-02) but worth noting from the code-quality angle.

**Fix:** Extract a generic `pruneMapFifo(map, maxSize)` utility to `lib/utils.ts` and replace all three call sites.

**Confidence:** Low

---

## C7-CODE-05: `searchImages` uses raw SQL aliases without Drizzle type safety — Low

**File:** `apps/web/src/lib/data.ts`
**Lines:** ~1060-1160

**Finding:** The tag search and alias search sub-queries use raw SQL strings with manually typed aliases (`it`, `t`, `ta`). While the fixture test at `__tests__/data-tag-names-sql.test.ts` locks the contract, these queries bypass Drizzle's type-safe query builder and are vulnerable to silent breakage if column names change.

**Fix:** Add a compile-time check that the raw SQL aliases match the Drizzle column names, or refactor to use Drizzle's relational query API for the tag join. If refactoring is deferred, add a comment noting the coupling.

**Confidence:** Low

---

## C7-CODE-06: `adminSettings` key strings are scattered as literals — Low

**File:** `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/session.ts`

**Finding:** Settings keys like `'session_secret'`, `'image_quality_webp'`, `'strip_gps_on_upload'` appear as string literals in multiple files. There is no centralized enum or constant for `adminSettings` keys outside of `GALLERY_SETTING_KEYS` (which covers only gallery-config keys). A typo in a key string would silently fail (returning the default) rather than failing fast.

**Fix:** Add an `AdminSettingKey` enum or const object that includes ALL keys used in `adminSettings`, and ban literal strings via a lint rule or simple regex check.

**Confidence:** Low

---

## Commendations

- Extensive inline comments explaining security rationale (rate-limit rollback patterns, advisory lock scope notes).
- Consistent use of `satisfies` for type narrowing in error objects.
- `countCodePoints` utility correctly handles Unicode supplementary characters instead of naive `.length`.
- The `stripGpsFromOriginal` function is well-documented with its privacy rationale.
