# Aggregate Review — Cycle 8 (2026-04-30)

## Review method

Deep single-pass review of all source files from multiple specialist perspectives
(code quality, security, performance, architecture, correctness, UI/UX, test coverage,
documentation, debugging). All key modules examined: data.ts, auth.ts, public.ts,
sharing.ts, admin-users.ts, images.ts, settings.ts, seo.ts, image-queue.ts, rate-limit.ts,
session.ts, proxy.ts, sanitize.ts, validation.ts, content-security-policy.ts,
bounded-map.ts, upload-tracker-state.ts, upload-tracker.ts, db-restore.ts,
action-guards.ts, photo-viewer.tsx, image-manager.tsx, lightbox.tsx, topics.ts,
schema.ts, db-actions.ts.

## GATE STATUS (prior cycle — all green)

- eslint: clean
- tsc --noEmit: clean
- vitest: passing
- lint:api-auth: OK
- lint:action-origin: OK
- next build: success

---

## New findings (not in cycles 1-7 deferred lists)

### HIGH severity

(none)

### MEDIUM severity

#### C8-MED-01: `uploadTracker` prune uses iteration-during-deletion on raw Map (same ES6 pattern as C7-MED-01 but on `pruneUploadTracker`)
- **Source**: Code review of `apps/web/src/lib/upload-tracker-state.ts:26-29`
- **Location**: `pruneUploadTracker()` function
- **Issue**: The prune method iterates over `uploadTracker` entries and calls `uploadTracker.delete(key)` inside the `for...of` loop. While ES6 guarantees this is safe for Maps (same as C7-MED-01), the BoundedMap.prune() was already fixed to use collect-then-delete in cycle 7, but this raw Map prune was left as-is. The hard-cap eviction loop at lines 33-40 also uses the same pattern. These are the last two remaining raw-Map iteration-during-deletion sites in the codebase.
- **Fix**: Apply collect-then-delete pattern to `pruneUploadTracker`, matching the BoundedMap.prune() fix from C7-MED-01.
- **Confidence**: Medium

#### C8-MED-02: `searchImages` `searchFields` GROUP BY comment is still missing despite C7-MED-04 deferral
- **Source**: Code review of `apps/web/src/lib/data.ts:1055-1060`
- **Location**: `searchFields` constant
- **Issue**: C7-MED-04 was deferred as "add a comment noting that any new field must be added to both GROUP BY clauses." The comment was never added even though the deferral's exit criterion was specifically "when a new column is added to searchFields." Adding the comment is a zero-risk, zero-cost improvement that should have been done even as part of the deferral.
- **Fix**: Add a comment above `searchFields` noting that any new column must be added to both GROUP BY clauses (lines 1127-1139 and 1147-1159).
- **Confidence**: High

#### C8-MED-03: `photo-viewer.tsx` `navigate` callback includes `images` in dependency array but `currentIndex` derivation from `images` can be stale within the same render
- **Source**: Code review of `apps/web/src/components/photo-viewer.tsx:137-158`
- **Location**: `navigate` useCallback
- **Issue**: The `navigate` function depends on `currentIndex` which is derived from `images.findIndex((img) => img.id === currentImageId)`. The C7-LOW-03 fix added a guard for `currentIndex === -1`, but there is a subtler issue: when `images` changes (e.g., new page load via router.push), the `useEffect` on line 80-82 runs asynchronously to update `currentImageId`. Between the `images` update and the effect running, `currentIndex` could point to a wrong image. The existing `-1` guard catches the "not found" case but not the "found wrong image" case. In practice this is low-risk because `navigate` is only called by user interaction (click/keyboard) and the effect runs synchronously in the same microtask, but the theoretical race exists.
- **Fix**: Add a guard in `navigate` that verifies `images[currentIndex]?.id === currentImageId` before proceeding. This is a belt-and-suspenders check that costs nothing and eliminates the theoretical race.
- **Confidence**: Low-Medium (theoretical race, unlikely in practice)

### LOW severity

#### C8-LOW-01: `exportImagesCsv` uses `results = [] as typeof results` — type assertion masks potential misuse
- **Source**: Code review of `apps/web/src/app/[locale]/admin/db-actions.ts:97`
- **Location**: `exportImagesCsv()` function
- **Issue**: Line 97 uses `results = [] as typeof results` to release the reference for GC. The `as typeof results` assertion is necessary because the empty array literal `[]` doesn't satisfy the Drizzle row type. While the intent is clear (release for GC), the type assertion is a pattern that could mask a future bug if someone reads `results` after the assignment and expects non-empty data. This is purely a code-clarity issue — the current code is correct.
- **Fix**: Add a comment explaining that the assignment is intentionally releasing the reference for GC and that `results` must not be read after this point. Or rename to `void results` pattern.
- **Confidence**: Low (informational)

#### C8-LOW-02: `photo-viewer.tsx` `useEffect` cleanup for `matchMedia` listener captures stale `showBottomSheet` and `isPinned` values
- **Source**: Code review of `apps/web/src/components/photo-viewer.tsx:171-190`
- **Location**: `useEffect` for sync info state across breakpoints
- **Issue**: The effect depends on `[showBottomSheet, isPinned]` and registers a `matchMedia` change handler that reads those values. When the effect re-runs (because `showBottomSheet` or `isPinned` changed), the cleanup removes the old handler and registers a new one with the updated values. This is correct behavior — the handler always has the latest state via the closure. However, the dependency array means a new `matchMedia` listener is registered every time `showBottomSheet` or `isPinned` changes, which is somewhat wasteful. Using refs for these values would avoid re-registering the listener. In practice, `showBottomSheet` and `isPinned` change rarely (only on user interaction), so the cost is negligible.
- **Fix**: Consider using refs for `showBottomSheet` and `isPinned` in this effect to avoid re-registering the listener. Low priority since the state changes rarely.
- **Confidence**: Low (perf micro-optimization)

#### C8-LOW-03: `db-actions.ts` `dumpDatabase` resolve callback captures `settled` flag but `writeStream.on('error')` may race with `dump.on('close')`
- **Source**: Code review of `apps/web/src/app/[locale]/admin/db-actions.ts:162-246`
- **Location**: `dumpDatabase()` promise
- **Issue**: The `settled` flag correctly prevents double-resolve. However, the `writeStream.on('error')` handler (line 162-169) sets `writeStreamHadError = true` and then checks `if (settled) return`. The `dump.on('close')` handler (line 176) also checks `if (settled) return`. If the writeStream error fires first, it resolves with a failure. Then when `dump.on('close')` fires, `settled` is already true and it returns early. This is correct. But if `dump.on('close')` fires first with `code === 0`, it awaits the writeStream flush and then checks `writeStreamHadError`. If a writeStream error occurred during the flush (after close but before finish), the close handler correctly detects it. The race is handled correctly — this is informational only.
- **Fix**: No fix needed — the race is correctly handled by the `settled` flag and the `writeStreamHadError` check.
- **Confidence**: Low (informational — confirmed correct)

#### C8-LOW-04: `adminListSelectFields` uses destructuring with 18 eslint-disable comments for unused vars
- **Source**: Code review of `apps/web/src/lib/data.ts:227-267`
- **Location**: `adminListSelectFields` derivation from `adminSelectFields`
- **Issue**: The pattern of destructuring out 18 fields with `eslint-disable-next-line @typescript-eslint/no-unused-vars` comments is verbose and creates visual noise. This is an acknowledged tradeoff (the CLAUDE.md documents it) but it means adding any new sensitive field to `adminSelectFields` requires a new destructuring entry + eslint-disable comment. Missing the comment would cause a lint failure; missing the destructuring entry would leak the field to the admin listing.
- **Fix**: Consider a utility function that omits specified keys from an object, which would reduce the pattern to a single line: `const adminListSelectFields = omit(adminSelectFields, ['camera_model', 'lens_model', ...])`. This would eliminate 18 eslint-disable comments and make the intent clearer.
- **Confidence**: Low (maintainability improvement)

## Previously fixed findings (confirmed still fixed from cycles 1-7)

- C7-HIGH-01: deleteAdminUser advisory lock scoped per-user — FIXED
- C7-MED-01: BoundedMap.prune() collect-then-delete — FIXED
- C7-MED-03: image-manager.tsx code-point-aware validation — FIXED
- C7-MED-05: claimRetryCounts cleanup on permanentlyFailedIds eviction — FIXED
- C7-LOW-02: proxy.ts admin login exclusion comment — FIXED
- C7-LOW-03: photo-viewer.tsx navigate currentIndex === -1 guard — FIXED
- A1-HIGH-01: Login rate-limit rollback — FIXED
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED
- C18-MED-01: searchImagesAction re-throws — FIXED
- C6F-01: getSharedGroup returns null on empty images — FIXED
- C6F-02: isNotNull(capture_date) guards — FIXED
- C6F-03: searchImages GROUP BY with created_at — FIXED
- C4F-08/09: getImageByShareKey blur_data_url and topic_label — FIXED
- C4F-12: search ORDER BY matches gallery — FIXED
- C5F-01: undated image prev/next navigation — FIXED

## Deferred items carried forward (no change)

All items from plan-360 (cycle 7 deferred) remain deferred:
- C7-MED-02: uploadTracker prune/evict duplicates BoundedMap pattern
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- C7-LOW-01: upload-tracker-state.ts prune iteration-deletion on raw Map
- C7-LOW-04: Health route DB probe lacks timing info
- C7-LOW-05: CSP style-src-attr/style-src-elem split
- C7-LOW-06: admin-users.ts deleteAdminUser lock release on error paths

All prior deferred items from plan-355 and plan-357 remain valid and deferred:
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
- D1-LOW: BoundedMap.prune() iteration delete
- C5F-02: sort-order condition builder consolidation
- C6F-06: getImageByShareKey parallel tag query

## Summary statistics

- Total new findings this cycle: 7
- HIGH severity: 0
- MEDIUM severity: 3
- LOW severity: 4
- Previously fixed (verified): 15
- Deferred carry-forward: 23 items (no change)
