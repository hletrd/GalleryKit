# Aggregate Review — Cycle 8 (2026-05-04)

## Review method

Deep single-pass review of all source files from multiple specialist perspectives
(code quality, security, performance, architecture, correctness, UI/UX, test coverage,
documentation, debugging). Key modules examined: data.ts, auth.ts, public.ts,
sharing.ts, admin-users.ts, images.ts, settings.ts, image-queue.ts, rate-limit.ts,
session.ts, proxy.ts, sanitize.ts, validation.ts, content-security-policy.ts,
bounded-map.ts, upload-tracker-state.ts, action-guards.ts, lightbox.tsx,
photo-viewer.tsx, photo-navigation.tsx, image-manager.tsx, info-bottom-sheet.tsx,
image-zoom.tsx, health/route.ts.

Focus this cycle: photographer workflow, edge cases in error handling,
keyboard navigation, focus traps, responsive breakpoints, performance at scale.

## GATE STATUS (prior cycle — all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK

---

## New findings (not in cycles 1-7)

### MEDIUM severity

#### C8-MED-01: `InfoBottomSheet` shutter speed conditional inconsistent with desktop sidebar
- **Source**: Code review of `apps/web/src/components/info-bottom-sheet.tsx:295`
- **Location**: Expanded EXIF section, shutter speed row
- **Issue**: The bottom sheet checks `formattedShutterSpeed &&` before rendering (line 295), while the desktop sidebar in `photo-viewer.tsx` line 700-703 checks `hasExifData(image.exposure_time) &&` and passes the raw value to `formatShutterSpeed`. The desktop sidebar pattern is more robust because `hasExifData()` explicitly rejects null/undefined/empty strings, while the bottom sheet relies on `formatShutterSpeed()` returning a falsy value for invalid input. This inconsistency makes future maintenance harder -- a developer fixing one surface might miss the other.
- **Fix**: Use `hasExifData(image.exposure_time) &&` in the bottom sheet too, matching the desktop sidebar pattern.
- **Confidence**: Medium

#### C8-MED-02: `info-bottom-sheet.tsx` expanded content max-height does not account for safe-area-inset-bottom
- **Source**: Code review of `apps/web/src/components/info-bottom-sheet.tsx:239`
- **Location**: Expanded content `max-h` calc
- **Issue**: The expanded content area uses `max-h-[calc(95vh-140px)]` which does not account for the `paddingBottom: env(safe-area-inset-bottom)` set on the parent container (line 179). On devices with home indicators (iPhone X+), the safe-area padding is ~34px, but the content's max-height calculation doesn't subtract it. This means the bottom portion of the expanded content (including the download button) can be clipped behind the safe-area padding area.
- **Fix**: Use `max-h-[calc(95vh-140px-env(safe-area-inset-bottom,0px))]` or use `95dvh` consistently.
- **Confidence**: Medium

### LOW severity

#### C8-LOW-01: `health/route.ts` DB probe still missing timing information
- **Source**: Code review of `apps/web/src/app/api/health/route.ts:29`
- **Location**: DB health check
- **Issue**: Already noted in C7-LOW-04 and not yet implemented. The health endpoint checks DB connectivity with `SELECT 1` but does not report query duration. For monitoring/alerting, a slow-but-successful DB connection is nearly as bad as a failed one.
- **Fix**: Add timing around the `db.execute()` call and include `dbOkDurationMs` in the response JSON when `HEALTH_CHECK_DB=true`.
- **Confidence**: Low (enhancement)

#### C8-LOW-02: `image-zoom.tsx` onKeyDown casts React KeyboardEvent to React.MouseEvent
- **Source**: Code review of `apps/web/src/components/image-zoom.tsx:335`
- **Location**: Keyboard handler on zoom container
- **Issue**: The `onKeyDown` handler calls `handleClick(e as unknown as React.MouseEvent)`. The `handleClick` function only reads `e.target` (available on both event types) and calls `e.preventDefault()` (also available on both). The cast is type-unsafe but functionally safe today. However, it bypasses TypeScript's type checking -- if `handleClick` ever reads a mouse-specific property (e.g., `clientX`), the cast would produce `undefined` at runtime.
- **Fix**: Extract the shared logic from `handleClick` into a separate function that accepts a generic `React.SyntheticEvent`, or add an explicit check in handleClick.
- **Confidence**: Low (defensive improvement)

#### C8-LOW-03: `image-manager.tsx` edit dialog `maxLength` uses browser UTF-16 code unit counting (carried from C7-MED-03)
- **Source**: Code review of `apps/web/src/components/image-manager.tsx` (Input/Textarea with maxLength)
- **Location**: Edit dialog title (maxLength=255) and description (maxLength=5000) inputs
- **Issue**: Already noted in C7-MED-03. The browser's native `maxLength` attribute counts UTF-16 code units while the server validates using `countCodePoints()`. A title with emoji could be rejected client-side at ~127 characters even though the server allows 255 code points.
- **Fix**: Either add a custom `onInput` handler counting code points, or document the discrepancy as acceptable tradeoff.
- **Confidence**: Low (UX inconvenience only -- server still validates correctly)

## Previously fixed findings (confirmed still fixed from cycles 1-7)

- All previous HIGH and MEDIUM fixes remain in place
- C7-HIGH-01: deleteAdminUser advisory lock (confirmed: global lock name with comment)
- C7-MED-05: claimRetryCounts cleanup on permanentlyFailedIds eviction (FIXED)
- C7-LOW-03: photo-viewer navigate stale closure (FIXED -- guards added)

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
- C7-LOW-04: Health route DB probe lacks timing info (re-found as C8-LOW-01)
- C7-LOW-05: CSP style-src-attr/style-src-elem split
- C7-LOW-06: admin-users.ts deleteAdminUser lock release on error paths

## Summary statistics

- Total new findings this cycle: 4
- HIGH severity: 0
- MEDIUM severity: 2
- LOW severity: 2
- Previously fixed (verified): 3
- Deferred carry-forward: 24 items (no change)