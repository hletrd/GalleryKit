# Aggregate Review -- Cycle 11 RPL (2026-04-20)

## Summary

Cycle 11 deep review of the full codebase found **0 new actionable issues** (no CRITICAL, HIGH, MEDIUM, or LOW findings). All previously identified issues from C46-01 and C46-02 have been confirmed as fixed in the codebase. The codebase continues to be well-hardened after 46+ prior review cycles.

## Files Reviewed

- `apps/web/src/app/actions/images.ts` -- upload, delete, batch delete, metadata update
- `apps/web/src/app/actions/topics.ts` -- CRUD, aliases, sanitization
- `apps/web/src/app/actions/tags.ts` -- CRUD, batch operations, sanitization
- `apps/web/src/app/actions/sharing.ts` -- share link creation, rate limiting
- `apps/web/src/app/actions/auth.ts` -- login, logout, password change
- `apps/web/src/app/actions/admin-users.ts` -- user management, rate limiting
- `apps/web/src/app/actions/settings.ts` -- gallery settings, storage backend switch
- `apps/web/src/app/actions/seo.ts` -- SEO settings
- `apps/web/src/app/actions/public.ts` -- search, load more
- `apps/web/src/app/[locale]/admin/db-actions.ts` -- DB backup/restore, CSV export
- `apps/web/src/app/api/admin/db/download/route.ts` -- authenticated backup download
- `apps/web/src/app/api/og/route.tsx` -- OG image generation
- `apps/web/src/app/api/health/route.ts` -- health check
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts` -- file serving
- `apps/web/src/lib/process-image.ts` -- Sharp pipeline, EXIF extraction
- `apps/web/src/lib/data.ts` -- data access layer, privacy guards, view count buffering
- `apps/web/src/lib/session.ts` -- HMAC session tokens, timing-safe verification
- `apps/web/src/lib/sanitize.ts` -- stripControlChars
- `apps/web/src/lib/rate-limit.ts` -- in-memory + DB-backed rate limiting
- `apps/web/src/lib/serve-upload.ts` -- secure file serving
- `apps/web/src/lib/validation.ts` -- slug, filename, tag name validation
- `apps/web/src/lib/api-auth.ts` -- API route auth wrapper
- `apps/web/src/lib/audit.ts` -- fire-and-forget audit logging
- `apps/web/src/lib/revalidation.ts` -- ISR cache revalidation
- `apps/web/src/lib/image-queue.ts` -- PQueue-based processing, claim locks, GC
- `apps/web/src/lib/process-topic-image.ts` -- topic image processing, temp file cleanup
- `apps/web/src/lib/gallery-config.ts` -- centralized config from DB
- `apps/web/src/lib/upload-limits.ts` -- upload size limits
- `apps/web/src/proxy.ts` -- i18n middleware + admin auth guard
- `apps/web/src/db/schema.ts` -- Drizzle ORM schema

## Previously Fixed Issues (Confirmed)

### C46-01: `tagsString` in `uploadImages` -- FIXED
The `tagsString` field is now sanitized with `stripControlChars` before the length check (line 62). The duplicate validation on line 74 operates on the already-sanitized value. Confirmed fixed.

### C46-02: `searchImagesAction` query -- FIXED
The `sanitizedQuery` is now computed with `stripControlChars` before the length check (line 29). The belt-and-suspenders `.slice(0, 200)` on line 98 operates on the already-sanitized value. Confirmed fixed.

## Areas of Strength (No Issues Found)

1. **Sanitization pattern consistency**: All user-facing string inputs now follow the "sanitize before validate" pattern. The `stripControlChars` function is applied uniformly across all server actions before length/format checks.

2. **Rate limiting**: All rate-limited operations use the pre-increment-then-check pattern with both in-memory Map (fast cache) and DB-backed counters (survives restarts). Rollback logic is correct on success and failure paths.

3. **Privacy guards**: The `publicSelectFields` / `adminSelectFields` split with compile-time `_privacyGuard` assertion prevents accidental PII leakage. All public-facing queries correctly use `publicSelectFields`.

4. **Path traversal prevention**: File serving in `serve-upload.ts` uses multiple layers of defense: segment validation, extension-to-directory matching, path containment check, symlink rejection, and `SAFE_SEGMENT` regex.

5. **TOCTOU protections**: Concurrent operations are handled with transactions, conditional WHERE clauses, `INSERT IGNORE`, and advisory locks where appropriate.

6. **Audit logging**: All admin actions are logged with proper deduplication (checking `affectedRows` before logging). Fire-and-forget pattern with `.catch(console.debug)` prevents audit failures from blocking operations.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-46 remain deferred with no change in status. See `.omc/plans/plan-deferred-items.md` for the full list.
