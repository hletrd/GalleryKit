# Plan 118 — Cycle 10 R2 Fixes

**Created:** 2026-04-19 (Cycle 10 R2)
**Status:** IN PROGRESS

---

## Issue Tracker

| ID | Description | Severity | Status |
|----|------------|----------|--------|
| C10-01 | `OUTPUT_SIZES` hardcoded — `image_sizes` setting has no effect | MEDIUM | PENDING |
| C10-02 | `strip_gps_on_upload` setting has no runtime effect | MEDIUM | PENDING |
| C10-03 | `createAdminUser` missing rate limiting | MEDIUM | PENDING |
| C10-04 | `image-manager.tsx` batch tag dialog uses AlertDialog instead of Dialog | LOW | PENDING |
| C10-05 | `deleteImage` audit log fires before transaction | LOW | PENDING |
| C10-06 | `g/[key]/page.tsx` uses dynamic import for PhotoViewer — SSR loss | LOW | PENDING |
| C10-07 | `seo-client.tsx` uses `useLocale()` instead of `useTranslation()` | LOW | PENDING |
| C10-08 | Admin nav and NavClient lack `aria-current="page"` | LOW | PENDING |
| C10-F01 | `batchAddTags` returns success on silent FK failures | LOW | PENDING |
| C10-F02 | Duplicated tag-filter subquery logic in `getImageCount` | LOW | PENDING |

---

## Implementation Plan

### C10-01: Pass `imageSizes` from gallery config into processing pipeline

**Files to modify:**
- `apps/web/src/lib/process-image.ts` — Change `OUTPUT_SIZES` from `const` to a function parameter in `processImageFormats()` and `deleteImageVariants()`. Keep the existing hardcoded values as the default fallback.
- `apps/web/src/lib/image-queue.ts` — Read `imageSizes` from `getGalleryConfig()` and pass it to `processImageFormats()`.
- `apps/web/src/app/actions/images.ts` — Read `imageSizes` from `getGalleryConfig()` and pass it to `deleteImageVariants()`.

**Approach:**
1. Add `sizes?: number[]` parameter to `processImageFormats()` and `deleteImageVariants()`.
2. Default to `[640, 1536, 2048, 4096]` when not provided (backward compatible).
3. In `image-queue.ts`, pass `config.imageSizes` from `getGalleryConfig()`.
4. In `images.ts` delete functions, pass `config.imageSizes` from `getGalleryConfig()`.
5. Document that `image_sizes` setting only affects future uploads.

### C10-02: Implement `strip_gps_on_upload` in upload pipeline

**Files to modify:**
- `apps/web/src/app/actions/images.ts` — After `extractExifForDb()`, check `stripGpsOnUpload` from gallery config and null out `latitude`/`longitude` in `exifDb` if true.

**Approach:**
1. After line 141 (`const exifDb = extractExifForDb(data.exifData);`), add:
   ```ts
   // Strip GPS coordinates if the privacy setting is enabled
   if (await shouldStripGps()) {
       exifDb.latitude = null;
       exifDb.longitude = null;
   }
   ```
2. Add a helper function or inline the check using `getGalleryConfig().stripGpsOnUpload`.
3. Use React `cache()` for the config read to avoid duplicate DB queries within the same request.

### C10-03: Add rate limiting to `createAdminUser`

**Files to modify:**
- `apps/web/src/app/actions/admin-users.ts` — Add in-memory and DB-backed rate limiting similar to the share rate limit pattern.

**Approach:**
1. Add an in-memory rate limit Map for user creation (per admin IP, per window).
2. Use `checkRateLimit`/`incrementRateLimit` for DB-backed rate limiting.
3. Limit: 10 creations per 60 minutes per IP.
4. Add pruning and hard cap for the in-memory Map.

### C10-04: Replace AlertDialog with Dialog for batch tag input

**Files to modify:**
- `apps/web/src/components/image-manager.tsx` — Replace `AlertDialog` (lines 224-262) with `Dialog` for the batch tag dialog.

**Approach:**
1. Replace `AlertDialog`/`AlertDialogTrigger`/`AlertDialogContent`/etc with `Dialog`/`DialogTrigger`/`DialogContent`/etc.
2. Keep the existing `Dialog` import already used for the edit dialog (line 431).
3. Preserve the same visual layout and behavior.

### C10-05: Move deleteImage audit log after transaction

**Files to modify:**
- `apps/web/src/app/actions/images.ts` — Move audit log call from before the transaction (line 320-321) to after, and only log if the transaction deleted at least 1 row.

**Approach:**
1. Move the `logAuditEvent` call after the transaction.
2. Check if the image was actually deleted (the transaction succeeded) before logging.
3. The image data is already fetched before the transaction, so we have the metadata needed for logging.

### C10-06: Replace dynamic import with direct import in g/[key]/page.tsx

**Files to modify:**
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — Replace `dynamic(() => import(...))` with a direct import of PhotoViewer.

**Approach:**
1. Replace `const PhotoViewer = dynamic(() => import('@/components/photo-viewer'));` with `import PhotoViewer from '@/components/photo-viewer';`.
2. Remove the `dynamic` import from `next/dynamic`.
3. This matches the pattern used in `p/[id]/page.tsx`.

### C10-07: Fix seo-client.tsx locale usage

**Files to modify:**
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` — Replace `useLocale()` with `useTranslation()` locale.

**Approach:**
1. Remove the `import { useLocale } from 'next-intl';` import.
2. Change `const locale = useLocale();` to get `locale` from `const { t, locale } = useTranslation();`.
3. Remove the now-unused `useLocale` import.

### C10-08: Add aria-current="page" to admin nav and NavClient

**Files to modify:**
- `apps/web/src/components/admin-nav.tsx` — Add `aria-current="page"` to the active nav link.
- `apps/web/src/components/nav-client.tsx` — Add `aria-current="page"` to the active topic link.

**Approach:**
1. Read both files to understand the current nav structure.
2. Determine the active state (likely using `usePathname()` or a similar approach).
3. Add `aria-current="page"` prop to the active link.

### C10-F01: batchAddTags success on FK failures

**Already handled:** The `batchAddTags` function in `tags.ts` already has the `existingIds` check (lines 236-243) that verifies image IDs exist before inserting. The `INSERT IGNORE` on imageTags only drops rows that fail the unique constraint (already-linked tags), not FK failures. This finding is less severe than described — the pre-validation step already catches deleted images. Marking as low priority / no action needed beyond documenting.

### C10-F02: Duplicated tag-filter subquery logic

**Files to modify:**
- `apps/web/src/lib/data.ts` — Refactor `getImageCount` to use `buildTagFilterCondition`.

**Approach:**
1. Modify `getImageCount` to use `buildTagFilterCondition` instead of duplicating the tag filter logic.
