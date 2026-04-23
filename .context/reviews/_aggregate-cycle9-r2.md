# Aggregate Review — Cycle 9 R2 (2026-04-19)

## Summary

Cycle 9 R2 review of the full codebase found **5 new actionable issues** (2 MEDIUM, 3 LOW) and confirmed previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

The review focused on recently added features: admin settings page, SEO settings page, storage backend abstraction, and configurable gallery parameters.

## New Findings (Deduplicated)

### C9-01: `switchStorageBackend` disposes old backend before verifying new one works [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/lib/storage/index.ts` lines 132-173
- **Flagged by**: security-reviewer (SEC-9R2-01), debugger (DBG-9R2-01)
- **Cross-agent agreement**: 2 agents flagged this
- **Description**: The old backend is disposed (connections destroyed) before the new backend is initialized. If the new backend fails to init, the rollback restores the old backend object — but its connections are already destroyed. For local-to-S3 failures this is safe (LocalStorageBackend has no dispose method), but for S3-to-local or MinIO-to-S3 failures, the destroyed S3Client is restored, causing all subsequent storage operations to fail until server restart.
- **Fix**: Do not dispose the old backend until the new one is confirmed working. Move the dispose call after successful initialization.

### C9-02: `processImageFormats` uses hardcoded quality/size values — admin settings have no effect [MEDIUM] [HIGH confidence]
- **Files**: `apps/web/src/lib/process-image.ts` lines 152, 329, 354-358; `apps/web/src/lib/gallery-config.ts` lines 90-94
- **Flagged by**: code-reviewer (C9R2-02, C9R2-03), architect (ARCH-9R2-02), debugger (DBG-9R2-02)
- **Cross-agent agreement**: 3 agents flagged this
- **Description**: The admin settings page exposes `image_quality_webp/avif/jpeg`, `image_sizes`, and `queue_concurrency` as configurable. `getGalleryConfig()` reads them from the DB. However, `processImageFormats()` uses hardcoded quality values (90/85/90) and a hardcoded `OUTPUT_SIZES` constant. The queue concurrency is set at module-load time. An admin can change these values, see "Settings saved", but nothing actually changes in the runtime.
- **Fix**: For quality: pass quality values from `getGalleryConfig()` into `processImageFormats()`. For sizes: pass `imageSizes` into the pipeline and propagate to frontend components, or document that `image_sizes` only affects future uploads. For concurrency: update the live PQueue's concurrency when the setting changes.

### C9-03: `gallery-config.ts` duplicates DEFAULTS from `gallery-config-shared.ts` [LOW] [HIGH confidence]
- **Files**: `apps/web/src/lib/gallery-config.ts` lines 29-44, `apps/web/src/lib/gallery-config-shared.ts` lines 38-51
- **Flagged by**: code-reviewer (C9R2-01)
- **Cross-agent agreement**: 1 agent
- **Description**: The `DEFAULTS` object in `gallery-config.ts` duplicates every key/value from `gallery-config-shared.ts`. If someone adds a new setting key to the shared module but forgets the server copy, the server will use a stale default.
- **Fix**: Import `DEFAULTS` from `gallery-config-shared.ts` or use `getSettingDefaults()`.

### C9-04: Settings page missing `force-dynamic` — serves stale settings after update [LOW] [HIGH confidence]
- **Files**: `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- **Flagged by**: code-reviewer (C9R2-05)
- **Cross-agent agreement**: 1 agent
- **Description**: All other admin pages use `export const dynamic = 'force-dynamic'` except the settings page. After changing settings, refreshing the page may serve a cached version showing old values.
- **Fix**: Add `export const dynamic = 'force-dynamic';` to the settings page.

### C9-05: `g/[key]/page.tsx` uses inconsistent `.replace()` for webp filename [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` line 144
- **Flagged by**: code-reviewer (C9R2-06)
- **Cross-agent agreement**: 1 agent
- **Description**: Uses `.replace('.webp', '_1536.webp')` without case-insensitive regex. All other files use `.replace(/\.webp$/i, ...)`.
- **Fix**: Change to `.replace(/\.webp$/i, '_1536.webp')`.

### C9-06: Storage backend switch leaks internal error details in admin response [LOW] [MEDIUM confidence]
- **Files**: `apps/web/src/app/actions/settings.ts` lines 80-83
- **Flagged by**: security-reviewer (SEC-9R2-02)
- **Cross-agent agreement**: 1 agent
- **Description**: When `switchStorageBackend` fails, the error message includes the raw error message (e.g., S3 endpoint, bucket name). While admin-only, this is a disclosure risk.
- **Fix**: Log the full error server-side and return a generic user-facing message.

### C9-07: SEO settings page missing back button — inconsistent with settings page [LOW] [LOW confidence]
- **Files**: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- **Flagged by**: designer (UX-9R2-01)
- **Cross-agent agreement**: 1 agent
- **Description**: The settings page has a back button but the SEO page does not. Inconsistent admin page navigation.
- **Fix**: Add a back button to `seo-client.tsx` matching the settings page pattern.

### C9-08: Image sizes input has no client-side format validation [LOW] [LOW confidence]
- **Files**: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` lines 119-128
- **Flagged by**: designer (UX-9R2-03)
- **Cross-agent agreement**: 1 agent
- **Description**: The `image_sizes` input accepts freeform text with only a hint. No `pattern` attribute for basic format validation.
- **Fix**: Add `pattern="[0-9, ]+"` to the input element.

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

All server actions (auth, images, topics, tags, sharing, admin-users, public, settings, seo), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), storage abstraction (storage/index.ts, local.ts, minio.ts, s3.ts, types.ts), gallery config (gallery-config.ts, gallery-config-shared.ts), auth & session management, rate limiting, upload security, DB schema, admin pages (dashboard, db, password, users, categories, tags, settings, seo), public pages (photo, shared group, shared photo, topic, home), API routes, frontend components (photo-viewer, image-manager, home-client, nav-client, search, info-bottom-sheet, admin-user-manager, settings-client, seo-client, admin-nav), SQL restore scanning, robots.ts, layout.tsx.
