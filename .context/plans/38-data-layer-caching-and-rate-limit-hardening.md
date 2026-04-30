# Plan 38 — Data Layer Caching and Rate-Limit Hardening

**Status:** DONE
**Created:** 2026-04-19
**Completed:** 2026-04-19
**Cycle:** 4

## Findings Addressed

- C4-03 [LOW/HIGH]: `getImageByShareKey` called twice without cache in `s/[key]/page.tsx`
- C4-04 [LOW/HIGH]: `getSharedGroup` called twice without cache in `g/[key]/page.tsx`
- C4-05 [LOW/MEDIUM]: `searchImagesAction` DB increment is fire-and-forget (TOCTOU gap)
- C4-06 [LOW/MEDIUM]: No rate limit on share link creation
- C4-07 [LOW/HIGH]: `retryCounts`/`claimRetryCounts` Maps grow unbounded
- C4-08 [LOW/MEDIUM]: `viewCountBuffer` can accumulate during DB outage
- C4-09 [LOW/HIGH]: `uploadTracker` prune is conditional, not unconditional

## Implementation Steps

### C4-03 & C4-04: Cache share queries — DONE
- Added `getImageByShareKeyCached` and `getSharedGroupCached` exports in `data.ts`
- Updated `s/[key]/page.tsx` and `g/[key]/page.tsx` to use cached versions
- Made `blur_data_url` optional in `ImageDetail` interface (fixes pre-existing type error)
- Commit: 1622454

### C4-05: Await search rate-limit DB increment — DONE
- Changed fire-and-forget `incrementRateLimit` to `await` with try/catch
- Commit: 8065efe

### C4-06: Add rate limit on share link creation — DONE
- Added `shareRateLimit` Map with 20/min window, pruning, and hard cap
- Applied to both `createPhotoShareLink` and `createGroupShareLink`
- Commit: 9ed73bc

### C4-07: Cap retryCounts/claimRetryCounts Maps — DONE
- Added `MAX_RETRY_MAP_SIZE = 10000` constant and `pruneRetryMaps()` function
- Called from `finally` block in queue job and from GC interval
- Commit: 6364eaf

### C4-08: Cap viewCountBuffer size — DONE
- Added `MAX_VIEW_COUNT_BUFFER_SIZE = 1000`
- Drops new increments when at capacity (warns in console)
- Commit: 279f674

### C4-09: Make uploadTracker pruning unconditional — DONE
- Removed `if (uploadTracker.size > UPLOAD_TRACKER_MAX_KEYS / 2)` condition
- Commit: 30339e5

## Verification

- [x] `getImageByShareKeyCached` and `getSharedGroupCached` exported and used
- [x] `searchImagesAction` awaits DB increment
- [x] Share link creation has rate limiting
- [x] Retry Maps have hard caps
- [x] View count buffer has hard cap
- [x] Upload tracker pruning is unconditional
- [x] All type checks and lint pass
