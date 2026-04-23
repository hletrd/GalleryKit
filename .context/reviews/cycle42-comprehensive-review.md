# Comprehensive Code Review — Cycle 42 (2026-04-19)

## Review Scope

Full codebase review covering: all server actions (auth, images, topics, tags, sharing, admin-users, public, seo, settings), middleware (proxy.ts), data layer (data.ts), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts), DB schema (schema.ts), admin pages, public pages, API routes, instrumentation & graceful shutdown, validation (validation.ts), audit logging (audit.ts), i18n, and frontend components.

## New Findings

### C42-01: `batchAddTags` does not apply `stripControlChars` to tag name before validation [MEDIUM] [HIGH confidence]

- **File**: `apps/web/src/app/actions/tags.ts` lines 218-220
- **Description**: In `batchAddTags()`, `cleanName` is computed as `tagName?.trim()` on line 218, then validated with `isValidTagName(cleanName)` on line 220, but `stripControlChars` is never applied. This is the same bug pattern as C41-01/C41-02/C41-03 which were fixed in cycle 41 for `updateTag`, `addTagToImage`, and `batchUpdateImageTags` add path. Control characters (tab `\x09`, newline `\x0A`, carriage return `\x0D`, etc.) pass the `isValidTagName` regex (which only rejects `<`, `>`, `"`, `'`, `&`, `\x00`, and commas) but get silently stored in the DB with control chars intact. This can cause display issues, MySQL truncation warnings, and inconsistent tag name matching.
- **Concrete failure scenario**: An admin sends a tag name `"nature\tphoto"` (with a tab) via batch add. `isValidTagName` accepts it. The tag is stored in the DB as `"nature\tphoto"`. Later, `removeTagFromImage` or `addTagToImage` with `stripControlChars` would look up `"naturephoto"` (stripped), which wouldn't match, causing tag operations to silently fail or create duplicates.
- **Fix**: Apply `stripControlChars(tagName?.trim() ?? '')` before `isValidTagName()`, matching the pattern in `addTagToImage` and `updateTag`.

### C42-02: `removeTagFromImage` does not apply `stripControlChars` to tag name lookup [LOW] [HIGH confidence]

- **File**: `apps/web/src/app/actions/tags.ts` lines 171-172
- **Description**: In `removeTagFromImage()`, `cleanName` is `tagName?.trim()` without `stripControlChars`. While this is a lookup-only path (not storing data), if a tag was previously stored with control characters (possible via the now-fixed C41-02/C41-03, or via the unfixed C42-01), a removal attempt using the same input string would need to match the exact stored name. More importantly, if the client sends `"foo\tbar"` intending to remove tag `"foobar"` (the stripped version), it would fail because the lookup uses the unstripped name. Applying `stripControlChars` here ensures consistent matching behavior.
- **Fix**: Apply `stripControlChars(tagName?.trim() ?? '')` to `cleanName` in `removeTagFromImage`, matching the pattern used in add/lookup paths.

### C42-03: `batchUpdateImageTags` remove path does not apply `stripControlChars` to tag names [LOW] [HIGH confidence]

- **File**: `apps/web/src/app/actions/tags.ts` line 342
- **Description**: Same as C42-02: in the remove loop of `batchUpdateImageTags()`, `cleanName` is `name.trim()` without `stripControlChars`. The add path (line 311) already uses `stripControlChars`, but the remove path doesn't. This inconsistency means removal lookups use unstripped names while additions use stripped names.
- **Fix**: Apply `stripControlChars(name.trim()) ?? ''` to `cleanName` in the remove path.

### C42-04: `uploadImages` tag validation does not apply `stripControlChars` before `isValidTagName` [MEDIUM] [HIGH confidence]

- **File**: `apps/web/src/app/actions/images.ts` line 65
- **Description**: In `uploadImages()`, tag names are parsed from `tagsString` with `.split(',').map(t => t.trim()).filter(t => t.length > 0 && isValidTagName(t))` — no `stripControlChars` is applied before validation. Tags that pass `isValidTagName` with embedded control characters (tab, newline, CR) would be stored in the DB with those characters intact. This is the same bug pattern as C41-01 through C42-01. The tag names are used directly in `tagEntries` (line 204) which inserts into the `tags` table.
- **Concrete failure scenario**: An upload with tags string `"nature\tphoto, landscape"` results in tag `"nature\tphoto"` being stored with a tab character. Later tag operations that properly strip control chars would fail to match it.
- **Fix**: Apply `stripControlChars(t.trim())` before `isValidTagName()` in the filter, and use the stripped value for the tag entries.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-41 remain deferred with no change in status. See `.context/reviews/_aggregate-cycle41.md` for the full list.

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

## Files Reviewed

All server actions: auth.ts, images.ts, topics.ts, tags.ts, sharing.ts, admin-users.ts, public.ts, seo.ts, settings.ts. Infrastructure: session.ts, rate-limit.ts, auth-rate-limit.ts, serve-upload.ts, upload-limits.ts, validation.ts, sanitize.ts, data.ts, process-image.ts, image-queue.ts, queue-shutdown.ts, proxy.ts, api-auth.ts, sql-restore-scan.ts, audit.ts, locale-path.ts, revalidation.ts, gallery-config-shared.ts. Database: schema.ts, index.ts, seed.ts. API routes: health, og, db download. Admin pages: db-actions.ts. Frontend: (no changes this cycle, no new UI/UX findings).
