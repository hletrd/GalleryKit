# Aggregate Review — Cycle 10 R2 (2026-04-19)

## Summary

Cycle 10 R2 deep review of the full codebase found **8 new actionable issues** (2 MEDIUM, 6 LOW) and confirmed previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

The review focused on recently added features: admin settings, SEO settings, storage backend abstraction, configurable gallery parameters, and their integration with the existing pipeline.

## New Findings (Deduplicated)

### C10-01: `OUTPUT_SIZES` in `process-image.ts` is hardcoded — admin `image_sizes` setting has no runtime effect [MEDIUM] [HIGH confidence]
- **Files:** `apps/web/src/lib/process-image.ts` line 152; `apps/web/src/lib/gallery-config.ts` lines 77, 90
- **Flagged by:** code-reviewer, architect
- **Cross-agent agreement:** 2 agents
- **Description:** The admin settings page exposes `image_sizes` as configurable (default "640,1536,2048,4096"). `getGalleryConfig()` reads it from the DB. However, `processImageFormats()` and `deleteImageVariants()` both use a hardcoded `const OUTPUT_SIZES = [640, 1536, 2048, 4096]`. The `saveOriginalAndGetMetadata` function (blur generation) and frontend srcSet generation also hardcode these sizes. An admin changing `image_sizes` sees "Settings saved" but nothing changes in the processing pipeline. Quality settings ARE correctly passed through — only `image_sizes` remains broken.
- **Fix:** Pass `imageSizes` from `getGalleryConfig()` into `processImageFormats()` and `deleteImageVariants()`. Document that changing `image_sizes` only affects future uploads.

### C10-02: `strip_gps_on_upload` setting has no runtime effect — GPS coordinates are always stored [MEDIUM] [HIGH confidence]
- **Files:** `apps/web/src/app/actions/images.ts` lines 141-161; `apps/web/src/lib/gallery-config.ts` line 82; `apps/web/src/lib/process-image.ts` lines 425-458
- **Flagged by:** security-reviewer, code-reviewer
- **Cross-agent agreement:** 2 agents
- **Description:** The admin settings page has a "Strip GPS on Upload" toggle (`strip_gps_on_upload`). The setting is stored in the DB and read by `getGalleryConfig()`. However, `extractExifForDb()` always extracts and returns latitude/longitude. `uploadImages()` spreads the full `exifDb` result into the INSERT, including GPS coordinates, without checking `strip_gps_on_upload`. The setting is a privacy feature that doesn't actually work. Public queries correctly exclude lat/lon via `publicSelectFields`, but the data is still in the DB.
- **Fix:** In `uploadImages()`, after calling `extractExifForDb()`, check `getGalleryConfig().stripGpsOnUpload` and null out `latitude`/`longitude` before the INSERT if the setting is true.

### C10-03: `createAdminUser` missing rate limiting — brute-force account creation possible [MEDIUM] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/admin-users.ts` lines 25-60
- **Flagged by:** security-reviewer
- **Cross-agent agreement:** 1 agent
- **Description:** While login and password change have both in-memory and DB-backed rate limiting, `createAdminUser` has none. A compromised admin session could create unlimited admin accounts. The Argon2 hash computation (~100ms) also makes this a CPU DoS vector.
- **Fix:** Add rate limiting to `createAdminUser` using the existing `checkRateLimit`/`incrementRateLimit` pattern.

### C10-04: `image-manager.tsx` batch tag dialog uses `AlertDialog` instead of `Dialog` — misleading UX semantics [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/components/image-manager.tsx` lines 224-262
- **Flagged by:** designer, code-reviewer
- **Cross-agent agreement:** 2 agents
- **Description:** Adding a tag is a non-destructive, reversible action — using `AlertDialog` conveys false urgency and misleads assistive technology users (screen readers announce "alert" unexpectedly).
- **Fix:** Replace `AlertDialog` with `Dialog` for the batch tag input, matching the edit dialog pattern.

### C10-05: `deleteImage` audit log fires even when concurrent deletion causes 0 affected rows [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/images.ts` lines 320-321
- **Flagged by:** code-reviewer
- **Cross-agent agreement:** 1 agent
- **Description:** Audit event is logged before the transaction, meaning the audit log can contain false positive deletion records.
- **Fix:** Move audit log after the transaction and check `affectedRows` before logging.

### C10-06: `g/[key]/page.tsx` uses `dynamic(() => import(...))` for PhotoViewer — loses SSR benefits [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` line 12
- **Flagged by:** perf-reviewer, designer
- **Cross-agent agreement:** 2 agents
- **Description:** PhotoViewer is loaded via `next/dynamic` on shared group page but NOT on main photo page. This causes layout shift and worse LCP on shared group photo views.
- **Fix:** Use direct import like the main photo page, or add proper suspense fallback.

### C10-07: `seo-client.tsx` uses `useLocale()` instead of `useTranslation()` locale — inconsistent [LOW] [LOW confidence]
- **Files:** `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx` line 31
- **Flagged by:** code-reviewer
- **Cross-agent agreement:** 1 agent
- **Fix:** Use `const { t, locale } = useTranslation()` consistently, matching `settings-client.tsx`.

### C10-08: Admin nav and NavClient lack `aria-current="page"` for active navigation item [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/components/admin-nav.tsx`, `apps/web/src/components/nav-client.tsx`
- **Flagged by:** designer
- **Cross-agent agreement:** 1 agent
- **Description:** No `aria-current="page"` on the currently active nav link. Screen reader users lack orientation cue.
- **Fix:** Add `aria-current="page"` to the active nav link.

### C10-F01 (from prior cycle 10 review): `batchAddTags` returns success on silent FK failures [LOW] [MEDIUM confidence]
- **Files:** `apps/web/src/app/actions/tags.ts:222`
- **Already tracked in prior review.** Carried forward.

### C10-F02 (from prior cycle 10 review): Duplicated tag-filter subquery logic in `getImageCount` [LOW] [LOW confidence]
- **Files:** `apps/web/src/lib/data.ts:206-220 vs 230-243`
- **Already tracked in prior review.** Carried forward.

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
- C9R2-04: `queue_concurrency` setting has no effect on live queue

## Agent Failures

None — comprehensive single-agent review completed successfully.

## Review Coverage

All server actions (auth, images, topics, tags, sharing, admin-users, public, settings, seo), middleware (proxy.ts), data layer (data.ts, cache deduplication, view count buffering), image processing pipeline (process-image.ts, image-queue.ts), storage abstraction (storage/index.ts, local.ts, minio.ts, s3.ts, types.ts), gallery config (gallery-config.ts, gallery-config-shared.ts), auth and session management, rate limiting, upload security, DB schema, admin pages (dashboard, db, password, users, categories, tags, settings, seo), public pages (photo, shared group, shared photo, topic, home), API routes, frontend components (photo-viewer, image-manager, home-client, nav-client, search, info-bottom-sheet, admin-user-manager, settings-client, seo-client, admin-nav), SQL restore scanning, robots.ts, layout.tsx.
