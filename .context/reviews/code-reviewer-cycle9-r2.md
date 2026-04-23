# Code Review — Cycle 9 (R2)

## C9R2-01: `gallery-config.ts` duplicates DEFAULTS from `gallery-config-shared.ts` [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/lib/gallery-config.ts` lines 29-44
- **Description:** The `DEFAULTS` object in `gallery-config.ts` duplicates every key/value from `gallery-config-shared.ts`. If someone adds a new setting key to the shared module but forgets the server copy, the server will use a stale default. The `gallery-config-shared.ts` already exports `getSettingDefaults()` which returns a complete, validated defaults map.
- **Fix:** Import `DEFAULTS` from `gallery-config-shared.ts` instead of re-declaring them. Or import `getSettingDefaults` and use its return value.

## C9R2-02: `processImageFormats` ignores admin-configured quality settings [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/lib/process-image.ts` lines 354-358
- **Description:** The new admin settings page allows configuring `image_quality_webp`, `image_quality_avif`, and `image_quality_jpeg`, and `getGalleryConfig()` reads them from the DB. However, `processImageFormats()` uses hardcoded quality values (`webp({ quality: 90 })`, `avif({ quality: 85 })`, `jpeg({ quality: 90 })`). The admin settings for image quality have no effect on actual processing.
- **Fix:** Pass quality values from `getGalleryConfig()` into `processImageFormats()` (or into the queue job), replacing the hardcoded values.

## C9R2-03: `OUTPUT_SIZES` in process-image.ts is hardcoded despite configurable `image_sizes` setting [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/lib/process-image.ts` line 152, `apps/web/src/lib/gallery-config.ts` line 93
- **Description:** `OUTPUT_SIZES = [640, 1536, 2048, 4096]` is a module-level constant. The admin settings page exposes `image_sizes` as a configurable setting, and `getGalleryConfig().imageSizes` reads it. But the processing pipeline, lightbox, photo-viewer, and home-client all use the hardcoded sizes. If an admin changes `image_sizes` to e.g. `640,1024,2048`, no new sizes are generated and the existing size-based URLs would 404.
- **Fix:** Either (a) pass `imageSizes` from config into `processImageFormats()` and propagate to frontend components, or (b) document that `image_sizes` only affects future uploads and the setting is read at queue time. At minimum, add a clear comment in the settings UI that this only applies to new uploads.

## C9R2-04: `queue_concurrency` setting has no effect on the live queue [LOW] [HIGH confidence]

- **File:** `apps/web/src/lib/image-queue.ts` line 59, `apps/web/src/lib/gallery-config.ts` line 94
- **Description:** The queue concurrency is set at module-load time via `new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2 })`. The admin setting `queue_concurrency` is stored in the DB and read by `getGalleryConfig()`, but nothing ever updates the PQueue concurrency when the setting changes.
- **Fix:** After updating `queue_concurrency`, update the live PQueue's concurrency via `state.queue.start({ concurrency: newValue })` or by setting `state.queue.concurrency = newValue`.

## C9R2-05: Settings page missing `force-dynamic` — serves stale settings after update [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- **Description:** All other admin pages (`dashboard`, `categories`, `seo`, `users`, `db`) use `export const dynamic = 'force-dynamic'` to ensure they always fetch fresh data. The settings page does not. After changing a setting, refreshing the page may serve a cached version showing the old values, confusing the admin.
- **Fix:** Add `export const dynamic = 'force-dynamic';` to the settings page.

## C9R2-06: `g/[key]/page.tsx` uses inconsistent `.replace()` for webp filename [LOW] [MEDIUM confidence]

- **File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` line 144
- **Description:** Uses `.replace('.webp', '_1536.webp')` without case-insensitive regex or `$` anchor. All other files use `.replace(/\.webp$/i, ...)`. While UUID-based filenames won't have uppercase extensions, this is an inconsistency that could cause silent failures if the naming convention ever changes.
- **Fix:** Change to `.replace(/\.webp$/i, '_1536.webp')` to match the pattern used everywhere else.

## C9R2-07: `updateSeoSettings` validates length but not content for `seo_title` and `seo_nav_title` [LOW] [LOW confidence]

- **File:** `apps/web/src/app/actions/seo.ts` lines 68-85
- **Description:** The function validates max length for all SEO fields and validates URL format for `seo_og_image_url`. However, `seo_title` and `seo_nav_title` are not sanitized for HTML/script injection. Since Next.js Metadata handles these as plain text (not dangerouslySetInnerHTML), the risk is low — but if a template ever renders these raw in a non-Metadata context, it could be an XSS vector.
- **Fix:** Add a basic HTML-tag strip or escape for `seo_title` and `seo_nav_title` before storing, or at minimum add a comment noting that these are safe because Next.js Metadata API escapes values.
