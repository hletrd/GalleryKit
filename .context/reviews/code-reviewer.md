# Code Review Report — code-reviewer (Cycle 2 Fresh)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: `npm run lint --workspace=apps/web` passed. `npx tsc --noEmit` clean. 503/503 tests passing.

## Inventory reviewed

All primary source files in `apps/web/src/`, scripts, config, tests. Full inventory from prior reviews confirmed still accurate.

## Summary

- Critical: 0
- High: 0
- Medium: 2
- Low: 1

## New Findings (not in prior cycle 1 aggregate AGG1-*)

### C2-CR-01 (Medium / Medium). `deleteImages` processes file cleanup sequentially per image

- Location: `apps/web/src/app/actions/images.ts:618-636`
- The implementation uses a plain `for...of` loop with `await` per image, serializing across all images in the batch. Each image's four format deletions run in parallel internally, but the outer loop serializes. For a batch of 50-100 images with `sizes=[]` triggering directory scans, this adds unnecessary latency.
- Concrete scenario: admin deletes 50 images; sequential loop takes 50*4*5ms=~1s minimum I/O latency, but could be much longer on cold filesystem caches or NAS. Server action response blocked throughout.
- Suggested fix: Chunk the outer loop with a small concurrency (e.g., process 5 images at a time via chunked Promise.all). Keep the inner format-parallel structure.

### C2-CR-02 (Medium / High). Shared-group view counts still increment for intra-share photo navigation

- Location: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/lib/data.ts:844-848`
- This was AGG1-07 in cycle 1. Still present. `SharedGroupPage` calls `getSharedGroupCached(key)` without `incrementViewCount: false` for `?photoId=` detail views. Each photo selection re-fetches the group and increments the view counter.
- Suggested fix: pass `{ incrementViewCount: !photoIdParam }` from the page component.

### C2-CR-03 (Low / High). `batchUpdateImageTags` string-as-tagNames guard lacks explicit test

- Location: `apps/web/src/app/actions/tags.ts:338-408`
- The `Array.isArray` guard is present. But the existing test does not explicitly cover the case where `tagNames` is a string instead of an array. A test asserting `batchUpdateImageTags(1, "abc")` returns an error would close the gap.
