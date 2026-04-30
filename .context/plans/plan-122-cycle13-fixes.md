# Plan 122 — Cycle 13 Fixes

**Created:** 2026-04-19 (Cycle 13)
**Status:** DONE

---

## Scope

Addresses findings from the Cycle 13 aggregate review (`_aggregate-cycle13-r2.md`).

### C13-01: `getGalleryConfig` returns unsorted `imageSizes` — breaks base-file selection and srcSet ordering [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/gallery-config.ts` line 77
- **Fix:** Replace inline `image_sizes` parsing with `parseImageSizes()` from `gallery-config-shared.ts`. This ensures the result is always sorted ascending and falls back to `DEFAULT_IMAGE_SIZES` on invalid input.
- **Implementation:**
  1. Import `parseImageSizes` from `./gallery-config-shared` in `gallery-config.ts`.
  2. Replace line 77: `imageSizes: getSetting(map, 'image_sizes').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0)` with `imageSizes: parseImageSizes(getSetting(map, 'image_sizes'))`.
  3. The `parseImageSizes` function already handles empty/invalid input and sorts ascending.

### C13-02: `getGalleryConfig` does not validate parsed config values — no fallback on corrupted DB rows [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/lib/gallery-config.ts` lines 70-87
- **Fix:** After parsing each field, validate against `isValidSettingValue` and fall back to `DEFAULTS` if invalid. Validate `storageBackend` against allowed values with fallback to `'local'`.
- **Implementation:**
  1. Import `isValidSettingValue` (already imported in gallery-config.ts).
  2. For each numeric field, wrap the `Number(getSetting(...))` call in a helper that validates and falls back:
     ```ts
     function validatedNumber(map: Map<string, string>, key: GallerySettingKey): number {
         const raw = getSetting(map, key);
         if (!isValidSettingValue(key, raw)) return Number(DEFAULTS[key]);
         return Number(raw);
     }
     ```
  3. For `stripGpsOnUpload`: validate the string is 'true' or 'false', fall back to default.
  4. For `storageBackend`: validate against `['local', 'minio', 's3']`, fall back to `'local'`.
  5. For `imageSizes`: already handled by C13-01 fix (parseImageSizes includes validation).

### C13-03: Photo viewer histogram hardcoded to `_640.jpg` regardless of configured sizes [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/photo-viewer.tsx` line 500
- **Fix:** Use `findNearestImageSize` to pick the closest configured size to 640 for the histogram source.
- **Implementation:**
  1. Compute the histogram size: `const histogramSize = findNearestImageSize(imageSizes, 640)`.
  2. Replace the hardcoded `_640.jpg` with `_${histogramSize}.jpg` in the Histogram `imageUrl` prop.
  3. `findNearestImageSize` is already imported in `photo-viewer.tsx` via `DEFAULT_IMAGE_SIZES, findNearestImageSize` from `@/lib/gallery-config-shared`.

### CR-13-04: `seo-client.tsx` double-cast `as unknown as Record<string, string>` [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` line 41
- **Fix:** Replace `settings as unknown as Record<string, string>` with a clean conversion.
- **Implementation:**
  1. Change `updateSeoSettings(settings as unknown as Record<string, string>)` to `updateSeoSettings(Object.fromEntries(Object.entries(settings)))`.
  2. This is type-safe and doesn't bypass TypeScript's type system.

### DBG-13-02: `settings-client.tsx` `image_sizes` pattern allows spaces [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` line 127
- **Fix:** Tighten the HTML pattern attribute.
- **Implementation:**
  1. Change `pattern="[0-9, ]+"` to `pattern="[0-9]+(,\s*[0-9]+)*"`.
  2. This allows spaces after commas (which `parseImageSizes` handles via `.trim()`) but prevents spaces between digits without commas.

---

## Not In Scope (Deferred)

See Plan 123 (deferred carry-forward) for items not addressed this cycle.

## Gate Checks

After all changes:
- [x] `eslint` passes (0 errors, 3 pre-existing warnings in storage/local.ts)
- [x] `next build` succeeds
- [x] `vitest` passes (66/66 tests)
- [x] `tsc --noEmit` passes

## Completion Notes

All 5 fixes implemented, committed (4 GPG-signed commits), pushed, and deployed.

### C13-01 + C13-02: DONE
- Replaced inline `image_sizes` parsing with `parseImageSizes()` for sorted output and invalid-input fallback.
- Added `validatedNumber()` helper that validates each setting against `isValidSettingValue` and falls back to defaults on corrupted DB values.
- Added `storageBackend` validation against allowed values with `'local'` fallback.
- Commit: `0000000337ddfd588d2718ac6f0aff937d008da0`

### C13-03: DONE
- Changed histogram source from hardcoded `_640.jpg` to `findNearestImageSize(imageSizes, 640)`.
- Commit: `0000000026b0038222400d44fb8f539cadf10f6f`

### CR-13-04: DONE
- Replaced `settings as unknown as Record<string, string>` with `Object.fromEntries(Object.entries(settings))`.
- Commit: `00000002a9b66ddcbd2a8b0624e20c1335a4dac3`

### DBG-13-02: DONE
- Tightened `image_sizes` input pattern from `[0-9, ]+` to `[0-9]+(\s*,\s*[0-9]+)*`.
- Commit: `000000057d5dfcbbaa8328b6c15655e8d85c24a6`
