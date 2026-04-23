# Aggregate Review — Cycle 3 Fresh Pass (2026-04-19)

## Summary

Cycle 3 fresh deep review of the full codebase found **4 new actionable issues** (1 MEDIUM, 3 LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. All C39 fixes confirmed properly implemented.

## New Findings (Deduplicated)

### C3R-01: `photo-viewer.tsx` GPS guard uses `canShare` instead of `isAdmin` [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/components/photo-viewer.tsx` line 474
- **Description**: The GPS coordinates block in the desktop sidebar is guarded by `canShare`, while the same block in `info-bottom-sheet.tsx` (line 292) uses `isAdminProp`. These are semantically different flags. `canShare` controls the share button visibility; `isAdminProp` explicitly indicates admin status. In current usage they are equivalent, but the semantic mismatch could cause confusion in future refactors. Not a live data leak (selectFields excludes lat/lng from public data), but violates defense-in-depth clarity.
- **Fix**: Change the guard to a dedicated `isAdmin` prop matching `info-bottom-sheet.tsx`, or add a comment explaining the equivalence.

### C3R-02: `batchAddTags` uses slug-only lookup after INSERT IGNORE (slug collision risk) [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 212-213
- **Description**: After `INSERT IGNORE`, `batchAddTags` looks up the tag by slug only. When two names produce the same slug (e.g., "SEO" and "S-E-O"), this returns the wrong tag. The `removeTagFromImage` and `batchUpdateImageTags` remove paths already use name-first lookup for safety, but `batchAddTags` and `addTagToImage` add paths still use slug-only.
- **Fix**: Apply the same name-first, slug-fallback lookup pattern used in `removeTagFromImage`.

### C3R-03: `photo-viewer.tsx` document.title cleanup restores stale title [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/components/photo-viewer.tsx` lines 72-78
- **Description**: The `useEffect` for `document.title` captures `previousTitle` at effect time and restores it on cleanup. When navigating between photos, the cleanup restores the title to what it was before the first photo was loaded, not the previous photo's title. Causes a brief flash of the original document title.
- **Fix**: Track "previous" title via a ref that updates after each title change, or set title unconditionally without cleanup restoration.

### C3R-04: `info-bottom-sheet.tsx` eslint-disable for `react-hooks/set-state-in-effect` [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/info-bottom-sheet.tsx` line 33
- **Description**: The `setSheetState('peek')` call inside `useEffect` has an eslint-disable comment. A cleaner approach would eliminate the need for the suppression by tracking the previous `isOpen` value via a ref.
- **Fix**: Track previous `isOpen` via a ref and only call `setSheetState('peek')` when transitioning from `false` to `true`.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status:
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window

## Agent Failures

None — single-agent deep review completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security, DB schema (schema.ts), admin pages, public pages, API routes (health, og, db download), SQL restore scanning (sql-restore-scan.ts), validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager), base56 encoding.
