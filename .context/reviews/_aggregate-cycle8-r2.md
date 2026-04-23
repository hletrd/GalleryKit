# Aggregate Review — Cycle 8 Re-review (2026-04-19)

## Summary

Cycle 8 re-review of the full codebase found **2 new actionable issues** (1 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. All C39 fixes have been verified as correctly implemented.

## Verification of Prior Fixes

- **C39-01** (batchUpdateImageTags slug-only lookup): VERIFIED — name-first, slug-fallback pattern applied to both add and remove loops.
- **C39-02** (GPS dead code annotation in info-bottom-sheet.tsx): VERIFIED — comment block present at lines 291-294.
- **C39-03** (Admin user creation labels/ids): VERIFIED — `htmlFor`/`id` pairs present for username, password, and confirm-password fields.
- **SEC-39-01** (Locale cookie Secure flag): VERIFIED — `;Secure` appended when on HTTPS in nav-client.tsx line 60.
- **SEC-39-03** (SET @@global. SQL pattern): VERIFIED — pattern `/\bSET\s+@@global\./i` present in sql-restore-scan.ts line 30.
- **UX-39-02** (Password confirmation field): VERIFIED — confirm-password input with client-side validation present in admin-user-manager.tsx.

## New Findings (Deduplicated)

### C8R2-01: `searchImages` tag query does not deduplicate against main query results at SQL level [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/lib/data.ts` lines 609-641
- **Flagged by**: code-reviewer, verifier
- **Cross-agent agreement**: 2 angles of analysis
- **Description**: The `searchImages` function runs two sequential queries — first the main search, then a tag search if results are insufficient. The tag query uses `LIMIT remainingLimit` but doesn't exclude IDs already found by the main query. If the same image matches both the title/description and the tag name, the tag query wastes a slot returning a duplicate that is later filtered out in JavaScript. With a small `remainingLimit`, this can cause fewer total results than expected — e.g., if `effectiveLimit=5`, main returns 3, and 2 of the 2 tag results are duplicates of the main 3, the combined result has only 3 items instead of 5.
- **Fix**: Add `WHERE images.id NOT IN (ids from main results)` to the tag query, or accept the current JS deduplication as best-effort and document the behavior. The practical impact is low because `effectiveLimit` defaults to 20 and tag/title overlap is uncommon, but for small limits it can noticeably reduce result counts.

### C8R2-02: `photo-viewer.tsx` sidebar EXIF grid has mismatched tag name formatting vs bottom sheet [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/components/photo-viewer.tsx` line 344 vs `apps/web/src/components/info-bottom-sheet.tsx` line 121
- **Flagged by**: designer, code-reviewer
- **Cross-agent agreement**: 2 angles of analysis
- **Description**: In the desktop sidebar (photo-viewer.tsx line 344), tag names are formatted with underscores replaced by spaces: `image.tags.map((tag: TagInfo) => \`#${tag.name.replace(/_/g, ' ')}\`)`. In the mobile bottom sheet (info-bottom-sheet.tsx line 121), the same tag names are rendered without this transformation: `image.tags.map((tag: TagInfo) => \`#${tag.name}\`)`. This creates a visual inconsistency: a tag named "new_york" shows as "#new york" on desktop but "#new_york" on mobile.
- **Fix**: Either apply `replace(/_/g, ' ')` in both components, or remove it from both (keeping the raw tag name). The bottom sheet version (without replacement) is likely the correct behavior since tag names should display as authored.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status:
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
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

None — all review agents completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, seo, settings, public), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, process-topic-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts), DB schema (schema.ts), admin pages (dashboard, db, password, users, categories, tags, seo, settings), public pages (photo, shared group, shared photo, topic, home), API routes (health, og, db download), instrumentation & graceful shutdown, validation (validation.ts, sql-restore-scan.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, search, lightbox, info-bottom-sheet, admin-user-manager, tag-input, tag-filter, load-more, histogram, image-zoom, optimistic-image), storage abstraction (storage/index.ts, local.ts).
