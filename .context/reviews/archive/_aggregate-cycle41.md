# Aggregate Review — Cycle 41 (2026-04-19)

## Summary

Cycle 41 deep review of the full codebase found **3 new actionable issues** (1 MEDIUM, 2 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C41-01: `updateTag` validates on unsanitized `name`, then sanitizes — same bug pattern as C29-09/C30-01 [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 51-58
- **Flagged by**: code-reviewer, security-reviewer
- **Cross-agent agreement**: 2 angles flagged
- **Description**: In `updateTag()`, `isValidTagName(name)` is called on line 54 with the raw `name` parameter, but `stripControlChars(name.trim())` is only applied on line 58 after validation. This is the exact same bug pattern as the C29-09/C30-01 SEO and settings fix: control characters pass validation but get stripped before storage, causing a mismatch between validated and persisted data. For example, a tag name like `"foo\x00bar"` would pass `isValidTagName()` (which only checks for `<`, `>`, `"`, `'`, `&`, `\x00`, and commas), but after `stripControlChars`, the stored name becomes `"foobar"`. The slug is then computed from the sanitized name, but the validation was on the unsanitized name.
- **Fix**: Move `stripControlChars(name.trim())` before `isValidTagName()` call, matching the pattern already established in `settings.ts` and `seo.ts`.

### C41-02: `addTagToImage` does not apply `stripControlChars` to `cleanName` before validation [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 113-127
- **Flagged by**: code-reviewer
- **Cross-agent agreement**: 1 angle
- **Description**: In `addTagToImage()`, `cleanName` is computed as `tagName?.trim()` on line 118, then validated with `isValidTagName(cleanName)` on line 120, but `stripControlChars` is never applied. The tag name stored in the DB could contain control characters. This is the same pattern as C41-01 but lower severity since `isValidTagName` does check for `\x00`, but other C0 controls (tab, newline, carriage return) are not rejected by the regex `!/[<>"'&\x00]/`. For example, a tag name containing a tab character `\x09` would pass validation and be stored with the tab intact.
- **Fix**: Apply `stripControlChars` to `cleanName` before `isValidTagName()`, matching the `updateTag` fix pattern.

### C41-03: `batchUpdateImageTags` does not apply `stripControlChars` to tag names in the add path [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/tags.ts` lines 305-333
- **Flagged by**: code-reviewer
- **Cross-agent agreement**: 1 angle
- **Description**: Same as C41-02: in `batchUpdateImageTags()`, `cleanName` is `name.trim()` (line 308), then validated with `isValidTagName(cleanName)` (line 310), but `stripControlChars` is never applied. The tag names in the add path could contain C0 control characters (tab, newline, etc.) that pass the `isValidTagName` regex. The remove path is not affected since it only looks up tags by name.
- **Fix**: Apply `stripControlChars` to `cleanName` before `isValidTagName()` in the add path.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-40 remain deferred with no change in status. See `.context/reviews/_aggregate-cycle40.md` for the full list.

Key deferred items still outstanding:
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C30-03 (data) / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window

## Agent Failures

None — single-reviewer cycle completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public, seo, settings), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts, upload-paths.ts), DB schema (schema.ts), admin pages (dashboard, db, password, users, categories, tags, seo, settings), public pages (photo, shared group, shared photo, topic, home), API routes (health, og, db download), instrumentation & graceful shutdown, validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager, etc.), SQL restore scanning (sql-restore-scan.ts), safe JSON-LD serialization, image URL construction, storage abstraction (local, minio, s3).
