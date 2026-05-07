# Comprehensive Review — Cycle 34 (2026-04-19)

## Summary

Cycle 34 deep review of the full codebase found **2 new actionable issues** (1 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. Prior C34-01 (sitemap slice) and C34-02 (notFound return) have been confirmed fixed.

## New Findings

### C34R2-01: `deleteTopicAlias` does not apply `stripControlChars` to alias parameter before validation [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/app/actions/topics.ts` lines 278-297
- **Description**: `deleteTopicAlias(topicSlug, alias)` validates the `alias` parameter with `isValidTopicAlias(alias)` at line 287 but does NOT apply `stripControlChars` before the validation check or DB lookup. This is inconsistent with `createTopicAlias` (line 243) which applies `stripControlChars(alias)` before `isValidTopicAlias()`. The `isValidTopicAlias` regex `[^/\\\s?\x00#<>"'&]+` does reject whitespace and NUL, but `stripControlChars` covers the full C0 range (0x00-0x1F, 0x7F) including control characters like ESC (0x1B), SUB (0x1A), and other non-whitespace C0 codes that the regex does not explicitly reject. Without `stripControlChars`, these edge-case control characters could pass validation and be used in the DB lookup. More importantly, the inconsistency between create and delete paths for the same entity type is a code smell — the create path sanitizes, the delete path should match.
- **Fix**: Apply `stripControlChars(alias) ?? ''` before `isValidTopicAlias()`, matching the `createTopicAlias` pattern at line 243. Pass the sanitized alias to the DB query and audit log.

### C34R2-02: `createAdminUser` username not sanitized with `stripControlChars` before validation [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/actions/admin-users.ts` line 94
- **Description**: In `createAdminUser()`, the username is extracted from formData and validated with `!/^[a-zA-Z0-9_-]+$/.test(username)`. This regex already rejects control characters (they are not in `[a-zA-Z0-9_-]`). However, every other user-facing text input in the codebase now follows the pattern of `stripControlChars` before validation as defense in depth (tags, topic labels, SEO settings, gallery settings, search queries, image metadata, topic aliases). The username field is the only text input that skips this preprocessing step. While the regex provides effective protection, adding `stripControlChars` would make the pattern consistent across all inputs and guard against any future relaxation of the username regex.
- **Fix**: Apply `stripControlChars(username)` before the length and regex validation checks, matching the defense-in-depth pattern used everywhere else.

## Previously Fixed (Confirmed)

- C34-01 (sitemap slice): Fixed — `images.slice()` removed, DB query passes `MAX_SITEMAP_IMAGES` directly
- C34-02 (notFound return): Fixed — `return notFound()` now used at line 70

## Previously Deferred Items (No Change)

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

## Files Reviewed

- `apps/web/src/app/actions/tags.ts` — tag sanitization patterns (all correct post-C41/C42/C43 fixes)
- `apps/web/src/app/actions/images.ts` — upload flow, tag validation, image CRUD
- `apps/web/src/app/actions/topics.ts` — topic CRUD, alias management, sanitization
- `apps/web/src/app/actions/auth.ts` — login, logout, password change, rate limiting
- `apps/web/src/app/actions/sharing.ts` — share link creation, rate limiting
- `apps/web/src/app/actions/public.ts` — search, load-more, rate limiting
- `apps/web/src/app/actions/admin-users.ts` — user creation, deletion, rate limiting
- `apps/web/src/app/actions/seo.ts` — SEO settings, sanitization
- `apps/web/src/app/actions/settings.ts` — gallery settings, storage backend switch
- `apps/web/src/lib/sanitize.ts` — stripControlChars implementation
- `apps/web/src/lib/validation.ts` — validators (isValidSlug, isValidTagName, etc.)
- `apps/web/src/lib/serve-upload.ts` — file serving, path traversal prevention
- `apps/web/src/lib/data.ts` — data access layer, view count buffering, privacy guards
- `apps/web/src/lib/gallery-config-shared.ts` — setting keys, validators
- `apps/web/src/lib/image-queue.ts` — processing queue, claim locks, retry logic
- `apps/web/src/lib/storage/index.ts` — storage backend singleton, credential validation
- `apps/web/src/app/[locale]/admin/db-actions.ts` — backup, restore, CSV export
- `apps/web/src/app/sitemap.ts` — sitemap generation (C34-01 confirmed fixed)
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — shared photo page (C34-02 confirmed fixed)
