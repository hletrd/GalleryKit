# Aggregate Review — Cycle 9 (2026-05-04)

## Review method

Deep single-pass review of all source files from multiple specialist perspectives
(security, performance, correctness, UI/UX, architecture, test coverage). Focus:
photographer workflow, edge cases in error handling, keyboard navigation, responsive
breakpoints, performance at scale, and previously undiscovered issues.

Key modules examined: data.ts, public.ts, images.ts (actions), sharing.ts,
photo-viewer.tsx, lightbox.tsx, info-bottom-sheet.tsx, home-client.tsx,
photo-navigation.tsx, search.tsx, load-more.tsx, image-types.ts, exif-datetime.ts,
rate-limit.ts, auth-rate-limit.ts, bounded-map.ts, sanitize.ts, blur-data-url.ts,
content-security-policy.ts, download-tokens.ts, download route, health route,
gallery-config-shared.ts, photo-title.ts, process-image.ts (partial), image-queue.ts
(partial), image-manager.tsx (partial).

## GATE STATUS (prior cycle — all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK

---

## New findings (not in cycles 1-8)

### MEDIUM severity

#### C9-MED-01: Analytics view-recording endpoints lack rate limiting
- **Source**: Code review of `apps/web/src/app/actions/public.ts:245-288`
- **Location**: `recordPhotoView`, `recordTopicView`, `recordSharedGroupView`
- **Issue**: These fire-and-forget server actions perform unconditional DB INSERTs with zero rate limiting. While `isBot()` marks bot views, it does not prevent the INSERT. A malicious actor or aggressive crawler could generate millions of view records, bloating the `imageViews`/`topicViews`/`sharedGroupViews` tables and consuming DB storage. Unlike `loadMoreImages` and `searchImagesAction`, which both have in-memory + DB-backed rate limiting, these analytics endpoints are completely unguarded.
- **Confidence**: High
- **Fix**: Add per-IP rate limiting (e.g., 60 requests/min) matching the existing pattern in `rate-limit.ts`. The budget should be generous enough that normal browsing (one view per page load) never hits it, but restrictive enough to prevent automated flooding.

#### C9-MED-02: `searchImagesAction` minimum query length uses JS `.length` instead of `countCodePoints`
- **Source**: Code review of `apps/web/src/app/actions/public.ts:160`
- **Location**: Minimum length check in `searchImagesAction`
- **Issue**: `sanitizedQuery.length < 2` uses JS `.length` (UTF-16 code units), while the maximum length check on the same line uses `countCodePoints(sanitizedQuery) > 200`. A single supplementary character (e.g., emoji "😀") has `.length === 2` (surrogate pair) and passes the minimum check, even though it is semantically one character. The `searchImages` function in `data.ts` line 1136 also uses `countCodePoints(query) > 200` for its max check, creating an inconsistency where the min and max checks count characters differently.
- **Confidence**: Medium
- **Fix**: Change `sanitizedQuery.length < 2` to `countCodePoints(sanitizedQuery) < 2` for consistency.

#### C9-MED-03: Lightbox slideshow button visible when only one image
- **Source**: Code review of `apps/web/src/components/lightbox.tsx:502-521` and `apps/web/src/components/photo-viewer.tsx:861-883`
- **Location**: Lightbox Play/Pause button and slideshow advance callback
- **Issue**: The Play/Pause slideshow button is always rendered regardless of `totalCount`. When viewing a single photo (e.g., individual photo page `/p/[id]`), starting a slideshow does nothing meaningful — `onSlideshowAdvance` wraps `(currentIndex + 1) % images.length` which stays at index 0. The button is visible, clickable, and toggles state, but produces no visible effect. A photographer viewing a single photo would be confused by a slideshow button that doesn't work.
- **Confidence**: Medium
- **Fix**: Conditionally render the Play/Pause button only when `totalCount > 1` (or `images.length > 1`).

#### C9-MED-04: `bulkUpdateImages` per-row UPDATE loop for alt-text application
- **Source**: Code review of `apps/web/src/app/actions/images.ts:907-916`
- **Location**: `applyAltSuggested` path in `bulkUpdateImages`
- **Issue**: When `applyAltSuggested` is `'title'` or `'description'`, the code issues individual `UPDATE ... WHERE id = ?` statements in a `for` loop — one per qualifying image. For a batch of 100 images, this generates up to 100 sequential DB round-trips within a single transaction. Each round-trip adds ~1-2ms of network latency plus lock acquisition time. While functional, this could be replaced with a single `CASE WHEN id=? THEN ? ... END` bulk update or a multi-row upsert.
- **Confidence**: Medium (performance, not correctness)
- **Fix**: Batch the updates into a single SQL statement using a CASE/WHEN expression, or at minimum use `Promise.all` for parallel execution within the transaction. Low priority since bulk alt-text application is an infrequent admin operation.

### LOW severity

#### C9-LOW-01: `exif-datetime.ts` regex rejects sub-second EXIF timestamps
- **Source**: Code review of `apps/web/src/lib/exif-datetime.ts:1`
- **Location**: `EXIF_DATETIME_PATTERN` regex
- **Issue**: The pattern `/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/` does not accept fractional seconds. Some cameras (especially newer mirrorless bodies like Sony A7RV, Nikon Z8) write sub-second capture timestamps like `2024:01:15 14:30:45.123` to EXIF. The regex would fail to match, causing `parseStoredExifDateTime` to return `null` and the entire capture date to be lost in the UI. The EXIF extraction in `process-image.ts` may strip the fractional part before storing (needs verification), but if it passes the raw string, the display layer silently drops it.
- **Confidence**: Low (depends on whether `extractExifForDb` normalizes the datetime before storage)
- **Fix**: Update the regex to optionally match fractional seconds: `/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/`

#### C9-LOW-02: `health/route.ts` DB probe still missing timing information (carried from C7/C8)
- **Source**: Code review of `apps/web/src/app/api/health/route.ts:29`
- **Location**: DB health check
- **Issue**: Already noted in C7-LOW-04 and C8-LOW-01. Not yet implemented.
- **Confidence**: Low (enhancement)

#### C9-LOW-03: `image-zoom.tsx` onKeyDown casts React KeyboardEvent to React.MouseEvent (carried from C8)
- **Source**: Code review of `apps/web/src/components/image-zoom.tsx`
- **Location**: Keyboard handler on zoom container
- **Issue**: Already noted in C8-LOW-02. Not yet fixed.
- **Confidence**: Low (defensive improvement)

#### C9-LOW-04: `image-manager.tsx` maxLength uses browser UTF-16 code unit counting (carried from C7/C8)
- **Source**: Code review of `apps/web/src/components/image-manager.tsx`
- **Location**: Edit dialog title (maxLength=255) and description (maxLength=5000) inputs
- **Issue**: Already noted in C7-MED-03 and C8-LOW-03. Not yet fixed.
- **Confidence**: Low (UX inconvenience only)

## Previously fixed findings (confirmed still fixed from cycles 1-8)

- All HIGH and MEDIUM fixes from cycles 1-8 remain in place
- C8-MED-01: InfoBottomSheet shutter speed conditional (FIXED — now uses `hasExifData`)
- C8-MED-02: info-bottom-sheet expanded content safe-area (FIXED — now uses `95dvh`)
- C7-MED-05: claimRetryCounts cleanup on permanentlyFailedIds eviction (FIXED)
- C7-LOW-03: photo-viewer navigate stale closure (FIXED)

## Cross-agent agreement (self-review multi-perspective)

Since subagent fan-out was not available this cycle, findings were validated from
multiple perspectives (security, performance, correctness, UX) within a single
deep pass. The analytics rate-limiting gap (C9-MED-01) was confirmed from both
the security perspective (DoS vector) and the performance perspective (DB write
amplification). The search length inconsistency (C9-MED-02) was confirmed from
both the correctness perspective (inconsistent character counting) and the
security perspective (bypass potential, though currently benign).

## Deferred items carried forward (no change)

All items from prior deferred lists remain deferred:
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D2-MED: auth patterns inconsistency
- D3-MED: data.ts god module
- D4-MED: CSP unsafe-inline
- D5-MED: getClientIp "unknown" without TRUST_PROXY
- D6-MED: restore temp file predictability
- D7-LOW: process-local state
- D8-LOW: orphaned files
- D9-LOW: env var docs
- D10-LOW: oversized functions
- D11-LOW: lightbox auto-hide UX
- D12-LOW: photo viewer layout shift
- C5F-02: sort-order condition builder consolidation
- C6F-06: getImageByShareKey parallel tag query
- C7-MED-02: uploadTracker prune/evict duplicates BoundedMap pattern
- C7-MED-04: searchImages GROUP BY lists all columns
- C7-LOW-01: upload-tracker-state.ts prune iteration-deletion on raw Map
- C7-LOW-04: Health route DB probe lacks timing info (re-found as C9-LOW-02)
- C7-LOW-05: CSP style-src-attr/style-src-elem split
- C7-LOW-06: admin-users.ts deleteAdminUser lock release on error paths