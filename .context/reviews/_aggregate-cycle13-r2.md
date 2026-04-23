# Aggregate Review — Cycle 13 (2026-04-19)

## Summary

Cycle 13 review of the full codebase found **3 new actionable issues** (2 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. The dominant finding this cycle is an unsorted-sizes data flow bug in the gallery config module.

## New Findings (Deduplicated)

### C13-01: `getGalleryConfig` returns unsorted `imageSizes` — breaks base-file selection and srcSet ordering [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/lib/gallery-config.ts` line 77
- **Flagged by**: code-reviewer (CR-13-01, CR-13-02), debugger (DBG-13-01), architect (ARCH-13-01), designer (UX-13-03)
- **Cross-agent agreement**: 4 agents flagged this
- **Description**: `_getGalleryConfig()` manually parses `image_sizes` with inline `.split(',').map().filter()` instead of using the shared `parseImageSizes()` helper from `gallery-config-shared.ts`. The shared function sorts the result ascending and falls back to defaults on invalid input; the config module version does neither. This has two consequences:
  1. **Base file selection**: `processImageFormats` uses `sizes[sizes.length - 1]` as the "largest" size for the base filename link. With unsorted sizes, this picks the last element (not necessarily the largest), creating a wrong base file.
  2. **srcSet ordering**: `home-client.tsx` assumes `imageSizes[0]` is the smallest size for masonry grid thumbnails. Unsorted sizes would load wrong-sized images.
  3. **Histogram source**: `photo-viewer.tsx` hardcodes `_640.jpg` for the histogram, which 404s if 640 is not in the configured sizes.
- **Fix**: Use `parseImageSizes()` from `gallery-config-shared.ts` in `gallery-config.ts`. Additionally, add a defensive `.sort()` at the top of `processImageFormats` and use `findNearestImageSize` for the histogram source.

### C13-02: `getGalleryConfig` does not validate parsed config values — no fallback on corrupted DB rows [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/lib/gallery-config.ts` lines 70-87
- **Flagged by**: security-reviewer (SEC-13-01), architect (ARCH-13-02)
- **Cross-agent agreement**: 2 agents flagged this
- **Description**: All numeric settings in `_getGalleryConfig()` are parsed with bare `Number()` and `as` casts without validation. While writes are validated by `isValidSettingValue()`, the read path has no defense against corrupted or manually-edited DB values. Invalid values (e.g., `queue_concurrency` = "abc") would propagate as `NaN` or wrong types, causing undefined behavior downstream (e.g., `PQueue({ concurrency: NaN })`). The `storageBackend` field uses an unchecked `as` cast that would pass invalid values through.
- **Fix**: After parsing each field, validate against `isValidSettingValue` and fall back to the corresponding `DEFAULTS` entry if invalid. Validate `storageBackend` against `['local', 'minio', 's3']` with fallback to `'local'`.

### C13-03: Photo viewer histogram hardcoded to `_640.jpg` regardless of configured sizes [LOW] [HIGH confidence]
- **Files**: `apps/web/src/components/photo-viewer.tsx` line 500
- **Flagged by**: designer (UX-13-03)
- **Cross-agent agreement**: 1 agent (but directly caused by C13-01)
- **Description**: The Histogram component fetches from `_640.jpg` regardless of what sizes are actually configured. If 640 is not in `imageSizes`, the histogram silently fails to render.
- **Fix**: Use `findNearestImageSize(imageSizes, 640)` to pick the closest configured size.

## Additional Findings (Lower Priority)

### CR-13-04: `seo-client.tsx` double-cast `as unknown as Record<string, string>` [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` line 41
- **Flagged by**: code-reviewer (CR-13-04)
- **Cross-agent agreement**: 1 agent
- **Description**: Uses `as unknown as` double cast to bypass TypeScript. Proper typing would be safer.
- **Fix**: Use `Object.fromEntries(Object.entries(settings))` or type the server action to accept `SeoSettings`.

### DBG-13-02: `settings-client.tsx` `image_sizes` pattern allows spaces [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` line 127
- **Flagged by**: debugger (DBG-13-02)
- **Cross-agent agreement**: 1 agent
- **Description**: The HTML `pattern="[0-9, ]+"` allows spaces but could be tightened for better client-side validation.
- **Fix**: Change pattern to `[0-9]+(,[0-9]+)*` for stricter client-side feedback.

### UX-13-02: Upload dropzone uses native `<select>` inconsistent with shadcn Select elsewhere [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/components/upload-dropzone.tsx` lines 223-232
- **Flagged by**: designer (UX-13-02)
- **Cross-agent agreement**: 1 agent
- **Description**: Visual inconsistency with the rest of the admin UI.
- **Fix**: Replace with shadcn Select component.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status:
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- CR-39-02: `processImageFormats` unlink-before-link race window

## Agent Failures

None — all review agents completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public, seo, settings), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), gallery config (gallery-config.ts, gallery-config-shared.ts), auth & session management (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts), DB schema (schema.ts), admin pages (dashboard, db, password, users, categories, tags, seo, settings), public pages (photo, shared group, shared photo, topic, home), API routes (health, og, db download), instrumentation & graceful shutdown, validation (validation.ts), audit logging (audit.ts), i18n & locale paths, frontend components (photo-viewer, image-manager, home-client, nav-client, upload-dropzone, lightbox, info-bottom-sheet, admin-user-manager, settings-client, seo-client, etc.), SQL restore scanning (sql-restore-scan.ts), storage backend abstraction (storage/index.ts, types.ts, local.ts).
