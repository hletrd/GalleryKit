# Code Review — Cycle 19

## Method

Deep read of recently changed files (`sw.js`, `check-public-route-rate-limit.ts`, `api/checkout`, `api/og`, `api/search/semantic`) plus cross-file analysis of `data.ts`, `image-queue.ts`, `process-image.ts`, `actions/images.ts`, `actions/public.ts`, `session.ts`, `rate-limit.ts`, and auth flows. Focus on logic correctness, edge cases, and maintainability.

---

## Findings

### C19-CR-01 (MEDIUM): `check-public-route-rate-limit.ts` ESM entry-point detection is broken

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:179`
- **Issue**: The dual-mode entry-point detection expression:
  ```typescript
  const isCliEntry = require.main === module || (typeof require === 'undefined' && import.meta?.url?.includes('check-public-route-rate-limit'));
  ```
  The left operand `require.main` is evaluated BEFORE the `typeof require === 'undefined'` guard on the right side of `||`. In an ESM environment, `require` does not exist, so `require.main` throws `ReferenceError` before short-circuiting. The code explicitly intends dual-mode support (commented at line 19: "Run with: npx tsx scripts/check-public-route-rate-limit.ts") but the ESM branch is unreachable.
- **Failure scenario**: If the project ever adds `"type": "module"` to package.json, or if the file is imported in an ESM-first test runner context, module evaluation crashes with a ReferenceError on load.
- **Fix**: Reorder the check so `typeof require` is tested first:
  ```typescript
  const isCliEntry = (typeof require !== 'undefined' && require.main === module) || (typeof require === 'undefined' && import.meta?.url?.includes('check-public-route-rate-limit'));
  ```
- **Confidence**: High

### C19-CR-02 (LOW): `check-public-route-rate-limit.ts` regex requires at least one suffix character

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:145-148`
- **Issue**: The rate-limit helper detection regex is `\b${prefix}[A-Za-z0-9_]+\s*\(`. The `[A-Za-z0-9_]+` requires at least one alphanumeric character after the prefix. A helper named exactly `preIncrement()` (with no suffix) would not match, even though the documented convention says "any helper whose name starts with `preIncrement`".
- **Failure scenario**: A future developer adds `export function preIncrement(ip: string, now: number)` (intentionally generic) and the lint gate falsely flags it as missing rate limiting.
- **Fix**: Change `[A-Za-z0-9_]+` to `[A-Za-z0-9_]*` so the suffix is optional.
- **Confidence**: Medium

### C19-CR-03 (LOW): `data.ts` misplaced cache() side-effect comment

- **Source**: `apps/web/src/lib/data.ts:1324-1328`
- **Issue**: The comment about view-count side effects and `incrementViewCount` semantics is placed directly above `getImageByShareKeyCached = cache(getImageByShareKey)`. However, `getImageByShareKey` no longer has any view-count side effect (it was removed in a prior refactor). The actual side-effect-bearing function is `getSharedGroup` (line 1329), which calls `bufferGroupViewCount`. The comment is confusing and documents behavior that no longer exists for the function it sits above.
- **Fix**: Move the comment to line 1329 (above `getSharedGroupCached`) and update it to describe `getSharedGroup`'s `incrementViewCount` / `selectedPhotoId` semantics. Remove or simplify the comment above `getImageByShareKeyCached` since that function is now pure.
- **Confidence**: High

### C19-CR-04 (LOW): `semantic/route.ts` fallback branch includes unprocessed images

- **Source**: `apps/web/src/app/api/search/semantic/route.ts:216-230`
- **Issue**: In the `catch` fallback branch (when the image metadata enrichment query fails), the code returns all `results` from the embedding scan without the `eq(images.processed, true)` filter that the success branch enforces. If an image has embeddings but was later marked unprocessed (e.g., deleted and re-uploaded with the same ID in a test environment, or a race between embedding backfill and admin operations), the fallback could return unprocessed image IDs.
- **Failure scenario**: DB transient error during enrichment causes the API to return unprocessed image IDs with empty metadata (`filename_jpeg: ''`, `width: 0`, etc.). Client-side rendering may break or show broken thumbnails.
- **Fix**: In the fallback branch, filter `results` to only include IDs that were present in the original `imageRows` query, or at minimum return an empty results array instead of raw embedding matches. Alternatively, since this is a degraded-fallback path, returning empty results on DB error is safer.
- **Confidence**: Low (fallback path only, requires DB error)

---

## Previously fixed / confirmed unchanged

- C19-AGG-02 (duplicated slug validation): Confirmed `getImageCount` and `buildImageConditions` now both use `isValidSlug()`. Fixed.
- C19-AGG-01 (getImageByShareKeyCached side effects): `getImageByShareKey` no longer has side effects, but the comment mismatch is new (C19-CR-03 above).
