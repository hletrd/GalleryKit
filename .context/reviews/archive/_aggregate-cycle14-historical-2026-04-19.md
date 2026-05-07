# Aggregate Review — Cycle 14 (2026-04-19)

## Summary

Cycle 14 deep review of the full codebase found **4 new actionable issues** (1 MEDIUM, 3 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. The previously-reported C14-01 (tags={[]}) was confirmed as already fixed.

## New Findings (Deduplicated)

### C14-01: `processImageFormats` unlink-before-link race window on base filename can corrupt concurrent reads [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/lib/process-image.ts` lines 377-384
- **Description**: In `generateForFormat()`, when writing the base filename (the largest size), the code does `await fs.unlink(basePath).catch(() => {})` followed by `await fs.link(outputPath, basePath)`. Between the unlink and the link, there is a window where the base filename does not exist. If a concurrent request tries to fetch the base file during this window, it gets a 404. For AVIF files (which take longer to encode), this window can be significant. This was previously noted as CR-39-02 in the deferred list, but the issue is still present and no fix has been applied.
- **Fix**: Write to a temporary file first, then rename atomically: `await fs.link(outputPath, basePath + '.tmp').catch(() => {}); await fs.rename(basePath + '.tmp', basePath);`. The rename is atomic on POSIX filesystems, eliminating the window.
- **Status**: Already deferred as CR-39-02. Promoting to MEDIUM for this cycle because it affects user-facing page loads during image processing.

### C14-02: `findNearestImageSize` returns `targetSize` itself when `sizes` is empty — can produce invalid filenames [LOW] [HIGH confidence]
- **File**: `apps/web/src/lib/gallery-config-shared.ts` line 95
- **Description**: `findNearestImageSize([], 640)` returns `640` (the target). But if no sizes are configured, there won't be a `_640.jpg` file on disk either. This edge case is already guarded upstream by `parseImageSizes` returning `DEFAULT_IMAGE_SIZES` on empty input, so in practice the `sizes` array should never be empty. However, the fallback is misleading — it returns a size that doesn't correspond to any actual file.
- **Fix**: Return `DEFAULT_IMAGE_SIZES[DEFAULT_IMAGE_SIZES.length - 1]` (the largest default size) instead of `targetSize`, or throw an error, since an empty sizes array indicates a configuration error.

### C14-03: `seo-client.tsx` and `settings-client.tsx` save all settings even when only one field changed — no dirty-field tracking [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` line 41; `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` line 36
- **Description**: When the admin changes a single field, the save handler sends ALL settings to the server, triggering a full transactional upsert. While functionally correct, it's wasteful and increases the window for concurrent modification conflicts.
- **Fix**: Track dirty fields and only send changed values. Minor optimization.

### C14-04: `lightbox.tsx` picture element JPEG fallback uses base filename — always loads largest size for browsers without WebP/AVIF [LOW] [LOW confidence]
- **File**: `apps/web/src/components/lightbox.tsx` lines 198-221
- **Description**: The `<img>` `src` uses the base JPEG filename which is a hard link to the largest configured size. Browsers without AVIF/WebP support always get the largest JPEG, potentially wasting bandwidth. The masonry grid in `home-client.tsx` correctly uses sized variants.
- **Fix**: Use a sized JPEG variant as the `<img>` fallback `src`. Low priority since most modern browsers support WebP.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status.

## Previously Fixed — Confirmed Resolved

- C14-01 from previous aggregate (tags={[]}) — confirmed fixed at line 224 of page.tsx (`tags={image.tags ?? []}`)

## Agent Failures

Background agents failed due to socket/connection issues. This aggregate review was produced by direct analysis of all key source files covering: server actions, middleware, data layer, image processing pipeline, gallery config, auth & session management, rate limiting, upload security, DB schema, admin pages, public pages, API routes, validation, audit logging, i18n, frontend components, SQL restore scanning, and storage backend abstraction.
