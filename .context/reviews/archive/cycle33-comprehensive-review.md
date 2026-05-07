# Comprehensive Code Review — Cycle 33 (2026-04-19)

## Review Scope

Full repository deep review examining: all server actions (auth, images, topics, tags, sharing, admin-users, public, seo, settings), middleware (proxy.ts), data layer (data.ts), image processing pipeline (process-image.ts, image-queue.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts), DB schema (schema.ts), admin DB actions (db-actions.ts), SQL restore scanning (sql-restore-scan.ts), validation (validation.ts), sanitization (sanitize.ts), audit logging (audit.ts), gallery config (gallery-config-shared.ts), API routes (health, db download), and frontend components (photo-viewer, histogram, home-client, etc.).

## Previously Fixed Items (Verified Correct)

All cycle 41/42 tag sanitization fixes are properly implemented:
- C41-01: `updateTag` applies `stripControlChars` before `isValidTagName` (tags.ts:55)
- C41-02: `addTagToImage` applies `stripControlChars` before `isValidTagName` (tags.ts:121)
- C41-03: `batchUpdateImageTags` add path applies `stripControlChars` (tags.ts:313)
- C42-01: `batchAddTags` applies `stripControlChars` before `isValidTagName` (tags.ts:220)
- C42-02: `removeTagFromImage` applies `stripControlChars` to lookup (tags.ts:172)
- C42-03: `batchUpdateImageTags` remove path applies `stripControlChars` (tags.ts:344)
- C42-04: `uploadImages` applies `stripControlChars` before `isValidTagName` (images.ts:65)

Prior cycle 33 findings (dead import, dead function) have been cleaned up. No regressions detected.

## New Findings

### C43-01: `removeTagFromImage` audit log uses raw `tagName` instead of sanitized `cleanName` [LOW] [HIGH confidence]

- **File**: `apps/web/src/app/actions/tags.ts`, line 195
- **Description**: The `logAuditEvent` call in `removeTagFromImage` passes the raw `tagName` parameter to the audit log metadata: `{ tag: tagName }`. All other tag operations that log audit events use the sanitized name: `addTagToImage` uses `tagRecord.name` (DB-confirmed, line 155), `batchAddTags` uses `cleanName` (explicitly sanitized, line 265), and `updateTag` uses `trimmedName` (sanitized, line 73). If a user submits a tag name containing control characters, the raw unsanitized value would be written to the `audit_log` metadata column. While the `stripControlChars` fix (C42-02) ensures the DB lookup uses the sanitized `cleanName`, the audit log still records the original unsanitized input, creating an inconsistency where the audit record doesn't match the actual DB operation.
- **Concrete scenario**: Admin calls `removeTagFromImage(42, "foo\tbar")`. The `cleanName` is `"foobar"` (stripped), which is used for the DB lookup and removal. But the audit log records `{ tag: "foo\tbar" }` — containing a tab character that could cause log parsing issues or MySQL truncation.
- **Fix**: Change `{ tag: tagName }` to `{ tag: cleanName }` at line 195, matching the pattern used in `batchAddTags` (line 265).
- **Cross-reference**: Same class as C41/C42 tag sanitization fixes.

## Deferred Items (No Change)

All previously deferred items from cycles 5-42 remain deferred with no change in status. See `.context/reviews/_aggregate-cycle42.md` for the full list.

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
