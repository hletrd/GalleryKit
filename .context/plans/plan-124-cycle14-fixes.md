# Plan 124 — Cycle 14 Fixes

**Created:** 2026-04-19 (Cycle 14)
**Status:** COMPLETE

---

## Scope

Addresses findings from the Cycle 14 aggregate review (`_aggregate-cycle14.md`).

### C14-01: `processImageFormats` unlink-before-link race window on base filename [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/process-image.ts` lines 377-384
- **Fix:** Replace the unlink-then-link sequence with an atomic rename pattern. Write to a `.tmp` file first, then rename over the target. POSIX `rename()` is atomic, eliminating the window where the base filename doesn't exist.
- **Implementation:**
  1. Change lines 378-383 from:
     ```ts
     await fs.unlink(basePath).catch(() => {});
     try {
         await fs.link(outputPath, basePath);
     } catch {
         await fs.copyFile(outputPath, basePath);
     }
     ```
     to:
     ```ts
     const tmpPath = basePath + '.tmp';
     try {
         await fs.link(outputPath, tmpPath);
         await fs.rename(tmpPath, basePath);
     } catch {
         await fs.copyFile(outputPath, tmpPath).catch(() => {});
         try {
             await fs.rename(tmpPath, basePath);
         } catch {
             // Final fallback: direct copy if rename fails (cross-device)
             await fs.copyFile(outputPath, basePath);
         }
     } finally {
         await fs.unlink(tmpPath).catch(() => {});
     }
     ```
  2. This ensures the base filename always exists (old content or new content), never a gap.

### C14-02: `findNearestImageSize` returns `targetSize` when `sizes` is empty [LOW] [HIGH confidence]
- **File:** `apps/web/src/lib/gallery-config-shared.ts` line 95
- **Fix:** Return the largest default size instead of `targetSize` when `sizes` is empty, since an empty array means misconfiguration and `targetSize` won't correspond to any file on disk.
- **Implementation:**
  1. Change `if (sizes.length === 0) return targetSize;` to `if (sizes.length === 0) return DEFAULT_IMAGE_SIZES[DEFAULT_IMAGE_SIZES.length - 1];`
  2. This provides a sensible fallback that matches an actual file on disk.

### C14-03: SEO and settings clients save all fields on every save [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` line 41; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` line 36
- **Fix:** Track initial settings and only send changed fields. Minor optimization to reduce DB transaction size.
- **Implementation:**
  1. In `SeoSettingsClient`: add `initialRef = useRef(initialSettings)` and in `handleSave` compute `const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => v !== initialRef.current[k as keyof SeoSettings]));`
  2. Pass `changed` to `updateSeoSettings` instead of all settings.
  3. Update `initialRef.current` after successful save.
  4. Same pattern for `SettingsClient`.

### C14-04: Lightbox JPEG fallback always loads largest size [LOW] [LOW confidence]
- **File:** `apps/web/src/components/lightbox.tsx` lines 198-221
- **Fix:** Use a medium-sized JPEG variant as the `<img>` fallback instead of the base filename.
- **Implementation:**
  1. In the `useMemo` block, compute `jpegSrc` using a sized variant:
     ```ts
     const jpegSize = imageSizes.length >= 3 ? imageSizes[imageSizes.length - 2] : findNearestImageSize(imageSizes, 1536);
     const jpegSrc = image.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${jpegSize}.jpg`)}`) : undefined;
     ```
  2. This ensures browsers without WebP/AVIF get a reasonably-sized JPEG instead of the full resolution.

---

## Not In Scope (Deferred)

See Plan 125 (deferred carry-forward) for items not addressed this cycle.

## Gate Checks

After all changes:
- [x] `eslint` passes (0 errors, 3 pre-existing warnings)
- [x] `next build` succeeds
- [x] `vitest` passes (66/66 tests)
- [x] `tsc --noEmit` passes

## Commits

1. `0000000a` fix(images): replace unlink-before-link with atomic rename in processImageFormats
2. `0000000c` fix(config): return largest default size in findNearestImageSize when sizes is empty
3. `0000000a` fix(admin): track dirty fields in SEO and gallery settings save
4. `0000000f` fix(lightbox): use medium-sized JPEG fallback instead of base filename

Deployed to production: 2026-04-20
