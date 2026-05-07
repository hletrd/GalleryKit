# Comprehensive Code Review -- Cycle 10 R3 (2026-04-20)

## Summary

Deep review of the full GalleryKit codebase after 45+ prior review cycles. The codebase is well-hardened with extensive defense-in-depth measures. This review found **4 new actionable issues** (1 MEDIUM, 3 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public, settings, seo), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), storage abstraction (storage/index.ts), gallery config (gallery-config.ts, gallery-config-shared.ts), auth and session management, rate limiting, upload security, DB schema, admin pages, public pages, API routes, frontend components (nav-client, admin-nav, image-manager), OG route, health route, db-actions (backup/restore/CSV), SQL restore scanning, robots.ts, instrumentation.ts, serve-upload.ts, test files, and revalidation logic.

## New Findings

### C10R3-01: `og/route.tsx` renders unsanitized `topic` parameter directly into OG image [MEDIUM] [MEDIUM confidence]

**File:** `apps/web/src/app/api/og/route.tsx` lines 9, 81

**Description:** The `topic` query parameter is extracted from the URL (line 9) and rendered directly into the JSX for the OG image (line 81) with only a length truncation (`topic.slice(0, 50)`). While the Edge runtime's `ImageResponse` uses Satori (which renders to SVG/PNG, not raw HTML), Satori has had CSS injection vulnerabilities in the past. More concretely, the `topic` value is not validated against the `isValidSlug` pattern used everywhere else. An attacker could craft an OG image URL with an arbitrary `topic` string (e.g., containing script-like content or very long Unicode) to generate misleading social preview images that appear to be from the gallery but display attacker-controlled text.

The impact is limited because:
- Satori renders to an image, not executable HTML
- The endpoint has `Cache-Control: public, max-age=3600`, so repeated requests are cached
- No authentication is required to hit this endpoint

However, the lack of validation is inconsistent with the defense-in-depth approach used throughout the rest of the codebase (every other user-facing input is validated against `isValidSlug` or `isValidTagName`).

**Fix:** Validate `topic` against `isValidSlug` (or at least a similar alphanumeric+hyphen pattern). If invalid, return 400 instead of rendering. This matches the pattern used in all public-facing data queries.

**Confidence rationale:** Medium because Satori's current implementation prevents HTML injection, but the lack of input validation is inconsistent with the codebase's own security posture and could become a real issue if the rendering backend changes.

### C10R3-02: `og/route.tsx` tag list is not sanitized [LOW] [LOW confidence]

**File:** `apps/web/src/app/api/og/route.tsx` lines 10, 16, 95-109

**Description:** The `tags` query parameter is split into a list (line 16) and rendered directly into the OG image (lines 95-109). Each tag is truncated to 100 chars but not validated against `isValidTagName`. Same concern as C10R3-01 but lower impact because tags are rendered inside small pill elements.

**Fix:** Validate each tag against `isValidTagName` or at minimum strip non-alphanumeric characters before rendering.

### C10R3-03: `deleteAdminUser` audit log fires even when concurrent deletion causes 0 affected rows [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/admin-users.ts` lines 168-196

**Description:** The `deleteAdminUser` function logs the audit event at line 183 (`logAuditEvent(currentUser.id, 'user_delete', ...)`) AFTER the transaction completes. If a concurrent deletion causes the `tx.delete(adminUsers)` to affect 0 rows (because the user was already deleted by another admin between the SELECT and DELETE inside the transaction), the transaction still succeeds (no error thrown), and the audit log records a `user_delete` event for a user that was not actually deleted by this request. This is the same class of issue as C10-05 (now fixed for `deleteImage` and `deleteTag`), where `affectedRows` should be checked before logging.

The existing `USER_NOT_FOUND` check inside the transaction (lines 175-177) prevents this for the case where the user was deleted BEFORE the SELECT. But if the deletion happens AFTER the SELECT but BEFORE the DELETE (a very narrow window), the SELECT finds the user, the DELETE affects 0 rows, and no error is thrown.

**Fix:** After `tx.delete(adminUsers).where(eq(adminUsers.id, id))`, check the result's `affectedRows`. If 0, throw an error (e.g., `USER_NOT_FOUND`) to prevent the audit log from recording a phantom deletion. This matches the pattern now used in `deleteImage`, `deleteTag`, and `deleteTopic`.

### C10R3-04: `getImageCount` has duplicated tag-filter subquery logic instead of using `buildTagFilterCondition` [LOW] [LOW confidence]

**File:** `apps/web/src/lib/data.ts` lines 211-235 vs 238-251

**Description:** Already tracked as a previously deferred item (C10-F02). `getImageCount` has its own implementation of the tag-filter subquery logic while `buildTagFilterCondition` implements the same logic. This is a known, deferred item -- no new finding, just confirming the status.

**Status:** Already deferred. No change.

## Previously Fixed Items Confirmed

The following items from prior reviews have been confirmed as fixed in this review cycle:

- **C10-01** (`OUTPUT_SIZES` hardcoded): Fixed -- `processImageFormats()` accepts `sizes` parameter, `deleteImageVariants()` accepts optional `sizes`, `deleteImage`/`deleteImages` pass configured sizes.
- **C10-02** (`strip_gps_on_upload` has no effect): Fixed -- `uploadImages()` checks `getGalleryConfig().stripGpsOnUpload` and nulls latitude/longitude.
- **C10-03** (`createAdminUser` missing rate limiting): Fixed -- has both in-memory and DB-backed rate limiting.
- **C10-04** (batch tag dialog uses `AlertDialog`): Fixed -- now uses `Dialog`.
- **C10-05** (`deleteImage` audit log on 0 affected rows): Fixed -- audit log fires only when `deletedRows > 0`.
- **C10-06** (`g/[key]` uses `next/dynamic` for PhotoViewer): Fixed -- now uses direct import.
- **C10-08** (admin nav and NavClient lack `aria-current`): Fixed -- both set `aria-current={isActive ? "page" : undefined}`.
- **C46-01** (`tagsString` not sanitized before length check): Fixed -- `stripControlChars` applied before validation.
- **C46-02** (`searchImagesAction` query not sanitized before length check): Fixed -- sanitization moved before length check.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-46 remain deferred with no change in status. See prior cycle deferred documents for full details.

## Recommended Priority for Implementation

1. C10R3-01 -- Validate `topic` parameter in OG route against `isValidSlug`
2. C10R3-03 -- Check `affectedRows` in `deleteAdminUser` before audit log
3. C10R3-02 -- Validate `tags` parameter in OG route against `isValidTagName`

## TOTALS

- **1 MEDIUM** finding
- **3 LOW** findings
- **0 CRITICAL/HIGH** findings
- **4 total** unique findings (2 new actionable, 2 already deferred)
