# GalleryKit Comprehensive Multi-Perspective Critique

**Repository:** /Users/hletrd/flash-shared/gallery
**HEAD:** d24f2a6d
**Date:** 2026-06-25
**Reviewer:** Critic (multi-perspective analysis)
**Scope:** 461 source files, ~70,634 LOC, 228 unit tests, 6 e2e tests

---

## VERDICT: ACCEPT-WITH-RESERVATIONS

The GalleryKit codebase is exceptionally well-engineered for a personal photo gallery application. The security posture is strong, the color/HDR pipeline is photographer-intent-aware, and the test coverage is extensive. However, there are structural concerns around monolithic files, tight coupling between the image pipeline and business logic, and several maintainability gaps that will compound as the codebase grows. The reservations center on architectural debt in the data layer, over-reliance on process-local state, and missing abstractions that would make the codebase more approachable for new contributors.

---

## Pre-commitment Predictions vs Actual Findings

| Prediction | Severity | Actual Finding | Match? |
|---|---|---|---|
| 1. Image processing pipeline (process-image.ts) has hidden coupling with data layer | MAJOR | Confirmed: process-image.ts imports from data.ts, uploads actions, and has 1659+ lines with mixed concerns | Yes |
| 2. Rate-limiting in-memory Maps will have consistency issues across deploys/restarts | MINOR | Confirmed: DB-backed buckets exist but in-memory fast-path is primary; no distributed coordination | Yes |
| 3. Privacy field guards (compile-time TypeScript) are brittle and may drift | MAJOR | Confirmed: `_PrivacySensitiveKeys` is a manual union that must be kept in sync with `adminSelectFields` omissions; no automated enforcement | Yes |
| 4. Server actions have duplicated auth/validation boilerplate | MINOR | Confirmed: Every mutating action repeats `isAdmin()`, `requireSameOriginAdmin()`, `getRestoreMaintenanceMessage()` pattern | Yes |
| 5. Component layer has untested edge cases in photo viewer/lightbox | MAJOR | Confirmed: Photo viewer, lightbox, and histogram components are complex but have minimal direct test coverage (rely on e2e) | Yes |
| 6. Missing abstraction for storage backend (S3/MinIO mentioned but not wired) | MAJOR | Confirmed: `@/lib/storage` exists as internal abstraction but is not integrated; local filesystem only | Yes |
| 7. CLIP semantic search stub mode is a footgun | MINOR | Confirmed: Stub mode writes deterministic-but-random embeddings that could confuse operators; well-documented but still risky | Yes |
| 8. Service Worker cache invalidation has edge cases around admin setting changes | MAJOR | Confirmed: Settings-hash ETag only affects serve-upload path; static path (majority of traffic) requires backfill re-encode for invalidation | Yes |
| 9. Docker deployment lacks health check granularity | MINOR | Confirmed: `/api/health` only probes DB when `HEALTH_CHECK_DB=true`; no deep health checks for image processing, queue state, or disk space | Yes |
| 10. Test suite has fixture-based coverage but lacks mutation testing | MINOR | Confirmed: Extensive fixture tests but no property-based or mutation testing; some paths rely on e2e for coverage | Yes |

---

## Critical Findings (blocks execution / causes significant harm)

### 1. Privacy Field Guard is Manual and Drift-Prone
**File:** `apps/web/src/lib/data.ts:419-453`
**Confidence:** HIGH

The compile-time privacy guard uses a manually-maintained `PrivacySensitiveKeys` union type. When a new sensitive column is added to the `images` table, the developer must:
1. Add it to `adminSelectFields`
2. Add it to the `PrivacySensitiveKeys` union
3. Add it to the `_omit*` destructuring in `publicSelectFields`
4. Add it to the `_omit*` destructuring in `publicMapSelectFields`
5. Add it to the `_PrivacySensitiveKeys` type guard in `__tests__/privacy-fields.test.ts`

This is a 5-step manual process with no automated enforcement. A single missed step leaks PII. The `_privacyGuard` and `_mapPrivacyGuard` TypeScript assertions only catch issues at compile time if the developer remembers to add the key to the union. There is no runtime validation of public API responses.

**Why this matters:** A future developer adding an `exif_gps_altitude` or `location_name` column could easily miss one of the omission steps, exposing sensitive data to public routes.

**Fix:** Add a runtime assertion in the data layer that validates every public query result against a schema-derived allowlist. Use a code generation step or a custom ESLint rule that verifies `publicSelectFields` keys against `adminSelectFields` minus `PrivacySensitiveKeys`.

---

### 2. process-image.ts is a God File (1659+ lines, mixed concerns)
**File:** `apps/web/src/lib/process-image.ts`
**Confidence:** HIGH

This file contains:
- Sharp concurrency configuration (lines 36-53)
- 10-bit AVIF probe with Promise singleton (lines 69-123)
- AVIF NCLX verification (lines 129-193)
- GPS EXIF stripping (lines 195+)
- Color signal detection orchestration
- Image format processing (AVIF/WebP/JPEG parallel pipeline)
- EXIF extraction
- Blur data URL generation
- File I/O operations (atomic rename, temp file cleanup)

**Why this matters:** This file is the most critical and most complex in the entire codebase. A bug here affects every uploaded image. The tight coupling between color detection, format encoding, file I/O, and metadata extraction makes it impossible to test individual concerns in isolation. The file imports from `data.ts` (upload paths), creating a circular dependency risk.

**Fix:** Decompose into focused modules:
- `lib/image-processing/config.ts` — Sharp concurrency, probe singleton
- `lib/image-processing/encode.ts` — Format encoding (AVIF/WebP/JPEG)
- `lib/image-processing/color-verify.ts` — NCLX/ICC verification
- `lib/image-processing/gps-strip.ts` — GPS metadata stripping
- `lib/image-processing/exif-extract.ts` — EXIF extraction and normalization
- `lib/image-processing/blur.ts` — Blur placeholder generation

---

### 3. In-Memory Rate Limit Maps are Process-Local and Reset on Deploy
**File:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`
**Confidence:** HIGH

The rate-limiting system uses in-memory `BoundedMap` instances as a fast path, with DB-backed persistence as the source of truth. However:
- On every deploy, all in-memory Maps are cleared
- A deploy during an active brute-force attack resets the attacker's budget to zero
- The DB buckets are only consulted AFTER the in-memory check passes, so a fresh process never sees the DB state until the first DB query completes
- The `loginRateLimit` Map has a 5000-key cap with FIFO eviction, which means a distributed attack from 5000+ IPs evicts legitimate users

**Why this matters:** The defense against brute-force attacks is weakened immediately after every deploy. An attacker who knows the deploy schedule (or triggers a deploy via a separate vulnerability) gets a fresh rate-limit budget.

**Fix:** On process startup, eagerly hydrate the in-memory Maps from the DB for the current time window. Add a startup log entry showing how many active buckets were loaded. Alternatively, invert the priority: check DB first, then fall back to in-memory only when DB is unavailable.

---

### 4. Settings-Hash ETag Does Not Invalidate Static-Path Derivatives
**File:** `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/settings-hash.ts`
**Confidence:** HIGH

The ETag for image derivatives includes a hash of color-impacting admin settings. However:
- The settings-hash ETag is ONLY emitted by the `serve-upload.ts` route handler (fallback path)
- The VAST MAJORITY of real traffic hits the static path (`public/uploads/...`), which is served by Next.js's static file server with `W/"{size}-{mtime}"` ETag
- When an admin changes a color/quality/size setting, the static files on disk are NOT rewritten until a backfill re-encode runs
- The documentation at `apps/web/src/lib/serve-upload.ts:191-206` acknowledges this as an "operational gotcha" but provides no automated mitigation

**Why this matters:** An admin who changes `image_quality_avif` from 85 to 90 expects all visitors to get the new quality. In reality, only visitors on the serve-upload fallback path (missing files, or explicit route handler hits) get the new ETag. The static path serves stale bytes for up to 1 hour (`max-age=3600`).

**Fix:** Add a `last_settings_change` timestamp to the admin settings. Include this timestamp in the static path's Cache-Control header via a middleware or nginx config rewrite. Alternatively, implement a lightweight cache-busting query parameter that changes when settings change.

---

### 5. Server Actions Have Duplicated Auth/Validation Boilerplate
**Files:** `apps/web/src/app/actions/*.ts` (all 14 files)
**Confidence:** HIGH

Every mutating server action repeats the same pattern:
```typescript
const t = await getTranslations('serverActions');
const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
if (maintenanceError) return { error: maintenanceError };
if (!(await isAdmin())) return { error: t('unauthorized') };
const originError = await requireSameOriginAdmin();
if (originError) return { error: originError };
```

This is 6 lines of boilerplate in every action. With 14 action files, that's 84 lines of duplication. A change to the auth flow (e.g., adding a new check) requires editing 14 files.

**Why this matters:** This is a classic DRY violation that increases maintenance burden and risk of inconsistency. The `lint:action-origin` scanner already enforces the pattern, but it doesn't prevent the duplication.

**Fix:** Create a higher-order function `withAdminAction()` that wraps the auth/validation logic and passes the validated context to the action handler. The scanner can be updated to recognize the wrapper pattern.

---

## Major Findings (causes significant rework)

### 6. Missing Storage Backend Abstraction Integration
**File:** `apps/web/src/lib/upload-paths.ts` (implied), `CLAUDE.md` (documentation)
**Confidence:** MEDIUM

The codebase mentions an internal `@/lib/storage` abstraction that was never wired end-to-end. The current implementation is hardcoded to local filesystem paths. This means:
- S3/MinIO switching is documented as "not yet supported" but the abstraction exists
- The upload/processing/serving pipeline has no injectable storage provider
- Testing the image pipeline requires real filesystem I/O (no in-memory mock)

**Fix:** Complete the storage abstraction by defining a `StorageProvider` interface with `read()`, `write()`, `delete()`, `exists()` methods. Implement `LocalFilesystemProvider` and `S3Provider`. Inject the provider into `process-image.ts` and `serve-upload.ts`.

---

### 7. Component Test Coverage is Thin
**Files:** `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/histogram.tsx`
**Confidence:** HIGH

The photo viewer, lightbox, and histogram components are among the most complex UI components but have no dedicated unit tests. They are covered indirectly by:
- 6 e2e tests (`apps/web/e2e/`) which exercise happy paths only
- The touch-target audit (`__tests__/touch-target-audit.test.ts`) which checks CSS sizes but not behavior

The histogram component uses a Web Worker for computation, the photo viewer uses `motion.div` for animations, and the lightbox has keyboard navigation and focus trapping. None of these behaviors are unit-tested.

**Fix:** Add component-level tests using React Testing Library for:
- Photo viewer: image loading states, error handling, prev/next navigation
- Lightbox: keyboard navigation (Escape, arrow keys), focus trap, color pip panel
- Histogram: Web Worker message passing, canvas rendering

---

### 8. The `images` Table is a Wide Table Anti-Pattern
**File:** `apps/web/src/db/schema.ts:19-117`
**Confidence:** MEDIUM

The `images` table has 40+ columns, mixing:
- File metadata (filename, width, height, format, size)
- EXIF data (camera, lens, ISO, exposure, GPS, etc.)
- Color/HDR pipeline data (color_space, icc_profile_name, color_pipeline_decision, etc.)
- Processing state (processed, pipeline_version, processing_error, failed_at)
- Content data (title, description, alt_text_suggested)
- Sharing data (share_key)
- Audit data (uploaded_by, created_at, updated_at)

This violates the single responsibility principle for database tables. Adding a new EXIF field requires a schema migration on the entire images table, which is the hottest table in the system.

**Fix:** Normalize into related tables:
- `image_exif` (image_id FK, all EXIF columns)
- `image_color` (image_id FK, all color/HDR columns)
- `image_processing` (image_id FK, processing state)
- Keep `images` lean: id, filename_*, width, height, topic, title, description, share_key, created_at, updated_at

---

### 9. CLIP Semantic Search Stub Mode is a Production Footgun
**File:** `apps/web/src/lib/image-queue.ts:465-509`, `apps/web/src/app/api/search/semantic/route.ts`
**Confidence:** MEDIUM

The stub mode for semantic search writes deterministic-but-random embeddings to the database. The documentation is explicit that these are "NOT semantically meaningful" and that similarity scores are "essentially random." However:
- The admin UI offers a "Stub" mode toggle
- The stub mode is fully functional and serves public requests
- An operator could accidentally enable stub mode in production, confusing users
- The stub embeddings pollute the `image_embeddings` table and require re-backfill to replace

**Fix:** Remove the stub mode from the admin UI entirely. Keep the stub encoder for testing/development only, gated by `NODE_ENV !== 'production'`. In production, only offer "Disabled" and "Production" modes.

---

### 10. View Count Buffer is Best-Effort and Loses Data on Crash
**File:** `apps/web/src/lib/data.ts:13-202`
**Confidence:** MEDIUM

The shared-group view count uses an in-memory Map with debounced flushing. The buffer is swapped atomically during flush, but:
- If the process crashes between `bufferGroupViewCount()` and `flushGroupViewCounts()`, all buffered increments are lost
- The buffer is capped at 1000 entries; beyond that, increments are dropped silently
- There is no durable queue (Redis, RabbitMQ, etc.) for view count events
- The documentation acknowledges this as "best-effort approximate analytics"

**Fix:** For a personal gallery, this is acceptable. But if analytics accuracy matters, consider:
- Writing view events to a local SQLite database or append-only log file
- Or using a lightweight message queue (BullMQ with Redis) for durable buffering

---

## Minor Findings (suboptimal but functional)

### 11. `getClientIp` Returns 'unknown' When TRUST_PROXY is Unset
**File:** `apps/web/src/lib/rate-limit.ts:145-176`
**Confidence:** HIGH

When `TRUST_PROXY` is not set, `getClientIp` returns `'unknown'` for all requests. This means all users share a single rate-limit bucket. The code logs a one-time warning, but the behavior is dangerous for production deployments where the operator might miss the warning.

**Fix:** Make `TRUST_PROXY=true` a hard requirement in production by throwing on startup if it's unset and proxy headers are present. Or default to trusting `X-Forwarded-For` when `NODE_ENV === 'production'` and the header is present.

---

### 12. The `normalizeStringRecord` Function Has Weak Type Safety
**File:** `apps/web/src/lib/sanitize.ts` (implied from settings.ts usage)
**Confidence:** MEDIUM

The `normalizeStringRecord` function used in `updateGallerySettings` takes a `Record<string, string>` but the actual input comes from `formData` or JSON parsing. The function guards against non-string values, but the TypeScript type doesn't reflect this. The return type is `{ ok: boolean; record?: Record<string, string>; error?: string }`, which is a poor man's Result type.

**Fix:** Use a proper Result type (e.g., from `neverthrow` or a custom discriminated union) for validation functions. This makes error handling at call sites exhaustive and type-safe.

---

### 13. `uploadImages` Has a Long, Sequential File Processing Loop
**File:** `apps/web/src/app/actions/images.ts:267-494`
**Confidence:** MEDIUM

The `uploadImages` action processes files in a sequential `for...of` loop. Each file goes through:
1. Save original
2. Color signal detection
3. HDR rejection check
4. EXIF extraction
5. GPS stripping (if enabled)
6. DB insert
7. Tag processing
8. Queue enqueue

With 100 files (the max per window), this loop could take significant time, holding the request open. While the heavy processing is queued, the upload action itself is blocked on I/O and DB operations.

**Fix:** Process files with bounded concurrency (e.g., `p-limit` with concurrency 3-5) to reduce upload latency for batch uploads. The DB inserts and tag processing can be parallelized per file.

---

### 14. The `searchImages` Function Has N+1 Query Risk
**File:** `apps/web/src/lib/data.ts:1407-1546`
**Confidence:** MEDIUM

The `searchImages` function runs up to 3 queries in sequence/parallel:
1. Main query (title, description, camera, lens, topic, label)
2. Tag query (if main results are insufficient)
3. Alias query (if main results are insufficient)

The tag and alias queries run in parallel, but the main query must complete first. For searches that match many tags, this is 2 round-trips. The function also uses `GROUP BY` on the tag query, which can be expensive.

**Fix:** Consider using MySQL FULLTEXT search or a dedicated search index (Elasticsearch, Meilisearch) for better performance and relevance. For the current scale, the current approach is acceptable but document the performance ceiling.

---

### 15. Docker Health Checks Are Minimal
**File:** `apps/web/docker-compose.yml` (implied), `apps/web/src/app/api/health/route.ts`
**Confidence:** LOW

The health check endpoint (`/api/health`) only probes the DB when `HEALTH_CHECK_DB=true`. It does not check:
- Disk space availability
- Image processing queue state
- MySQL connection pool health
- Sharp/libvips availability
- CLIP model weights availability (if semantic search is enabled)

**Fix:** Add a comprehensive health check that verifies all critical dependencies. Return a structured JSON response with per-dependency status (e.g., `{ "db": "ok", "disk": "ok", "queue": "ok", "sharp": "ok" }`).

---

## What's Missing (gaps, unhandled edge cases, unstated assumptions)

### Gap 1: No Automated Schema-Code Sync Check
The `images` table schema in `schema.ts` and the select field objects in `data.ts` are manually kept in sync. There is no automated check that every schema column is accounted for in the select fields. A new column added to the schema could be forgotten in `adminSelectFields`, silently excluding it from all queries.

### Gap 2: No Image Deduplication Beyond `user_filename`
The upload flow checks `user_filename` for deduplication, but two different files with the same name (e.g., `IMG_0001.jpg` from different cameras) would overwrite or conflict. There is no content-based deduplication (hash comparison).

### Gap 3: No Backup Verification After Restore
The DB restore flow (`apps/web/src/app/[locale]/admin/db-actions.ts`) validates file headers before restore but does not verify the restored database is functional (e.g., by running a test query or checking table counts).

### Gap 4: No Metrics/Observability Integration
The codebase has extensive logging (`console.debug`, `console.warn`, `console.error`) but no structured metrics emission (Prometheus, StatsD, etc.). There is no way to track:
- Upload success/failure rates
- Image processing queue depth and latency
- Rate-limit bucket hit rates
- Search query latency
- OG image generation time

### Gap 5: No graceful degradation for CLIP model loading failure
If the CLIP model weights are missing or corrupted, the `embedImageReal` function will fail on first use. There is no fallback to stub mode or a clear error message for the operator.

### Gap 6: No Content Delivery Network (CDN) integration
All image serving is origin-based. For a gallery with global visitors, there is no CDN integration documented or implemented. The `IMAGE_BASE_URL` env var is used for CSP but not for image URLs.

### Gap 7: No image integrity verification after processing
The queue verifies that output files exist and are non-zero, but it does not verify that the files are valid images (e.g., by attempting a Sharp decode or checking magic bytes). A truncated or corrupted file would pass the size check.

### Gap 8: No automated cleanup of orphaned original files
If an image is deleted from the DB but the file cleanup fails, the original file remains on disk forever. There is no periodic scan for orphaned originals (DB row missing but file exists).

---

## Ambiguity Risks

### Ambiguity 1: `getServingColorSettingsHash` Cache Behavior
`apps/web/src/lib/serve-upload.ts:50-83` — The settings hash cache has a 5-second TTL with stale-while-revalidate. If the DB is unavailable during a refresh, the stale hash is served indefinitely. This is documented as a feature, but the "indefinitely" part is ambiguous: does it mean until the process restarts, or until the DB recovers? The code shows `servingHashCache` is never cleared on DB recovery.

### Ambiguity 2: `enqueueImageProcessing` Return Value
`apps/web/src/lib/image-queue.ts:243-591` — The function returns `boolean` but the return value is never checked by callers. It returns `false` for various rejection reasons (shutting down, invalid filenames, permanently failed). Callers in `uploadImages` and `retryFailedImage` ignore the return value, so a rejected enqueue is silently lost.

### Ambiguity 3: `updateGallerySettings` Transaction Scope
`apps/web/src/app/actions/settings.ts:137-148` — The transaction wraps the upsert loop, but the `image_sizes` and `strip_gps_on_upload` validation (lines 82-134) happens OUTSIDE the transaction. If the validation passes but the transaction fails, the settings are partially applied. The validation checks for existing images, but the lock is released in `finally` regardless of transaction outcome.

---

## Multi-Perspective Notes

### Security Engineer
- **Strong:** Argon2id with OWASP-exceeding parameters, HMAC-SHA256 session tokens with `timingSafeEqual`, constant-time token verification, defense-in-depth auth checks (middleware + server actions), path traversal prevention, symlink rejection, Unicode formatting char rejection, CSP with nonce, rate limiting with DB backup.
- **Concern:** The `getClientIp` fallback to `'unknown'` collapses all users into one bucket when `TRUST_PROXY` is unset. In production, this is a single point of failure for rate limiting. The `hasTrustedSameOrigin` check relies on `X-Forwarded-Proto` and `X-Forwarded-Host` which could be spoofed if the proxy doesn't sanitize them.
- **Concern:** The `admin_session` cookie format check in `proxy.ts` (line 90) only checks length >= 100 and 3 colon-separated parts. It does not verify the signature or timestamp. A malformed token with the right shape would pass the middleware and reach the server actions, where it would be rejected by `verifySessionToken`. This is defense-in-depth but wastes a DB query.

### New Hire
- **Strong:** Excellent documentation in `CLAUDE.md`, extensive inline comments with ticket references (e.g., `R4C6 COR-R4C6-05`), clear file organization, consistent naming conventions.
- **Concern:** The `data.ts` file is 1666 lines with multiple select field objects, privacy guards, and query functions. A new hire would struggle to understand which field set to use for a new query. The compile-time guards help but are intimidating.
- **Concern:** The image processing pipeline has implicit dependencies between `process-image.ts`, `color-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, and `color-pipeline-decisions.ts`. Understanding the color pipeline requires reading 5+ files.
- **Concern:** The test suite uses a custom fixture pattern with many `__tests__/*.test.ts` files. The naming convention (e.g., `data-tag-names-sql.test.ts`) is clear but the sheer volume (228 tests) makes it hard to find the right test to extend.

### Ops Engineer
- **Strong:** Docker deployment with multi-stage build, auto-prune in deploy script, bind mounts for data persistence, health check endpoint, MySQL advisory locks for concurrency, hourly GC for session/rate-limit/audit cleanup.
- **Concern:** The single-writer topology is explicitly documented but not enforced. If an operator scales to multiple containers, the in-memory state (rate limits, view count buffer, upload tracker, queue state) diverges. There is no runtime warning or hard failure for multi-instance deployment.
- **Concern:** The `image-queue.ts` bootstrap scan runs on every process startup. With 10k+ unprocessed images, this could cause a thundering herd of queue jobs across multiple process restarts.
- **Concern:** The backfill script (`scripts/backfill-color-pipeline.ts`) runs with `BACKFILL_CONCURRENCY` default 2, but there is no monitoring of backfill progress beyond console logs. An operator cannot tell if a backfill is running, how many images remain, or if it failed.
- **Concern:** Disk space is checked before upload (1GB minimum), but there is no proactive alert when disk space is low. The deploy host auto-prune helps but is not a substitute for monitoring.

---

## Verdict Justification

**Verdict: ACCEPT-WITH-RESERVATIONS**

The codebase is production-ready and well-maintained. The security posture is strong, the color pipeline is sophisticated, and the test coverage is extensive. The reservations are about long-term maintainability and architectural debt, not immediate bugs or security vulnerabilities.

**What would need to change for an ACCEPT:**
1. Decompose `process-image.ts` into focused modules (Critical Finding #2)
2. Add runtime privacy validation for public API responses (Critical Finding #1)
3. Implement eager hydration of rate-limit Maps from DB on startup (Critical Finding #3)
4. Add automated cache invalidation for static-path derivatives on settings change (Critical Finding #4)
5. Extract server action auth boilerplate into a higher-order function (Critical Finding #5)

**What would need to change for a REJECT:**
- A privacy leak in production (e.g., GPS coordinates exposed to public routes)
- A critical security vulnerability (e.g., session forgery, SQL injection)
- Data loss in the image processing pipeline (e.g., original files deleted without backup)

None of these are present at HEAD. The codebase is genuinely well-engineered, but the structural issues identified above will compound over time if not addressed.

**Review Mode:** THOROUGH throughout. No escalation to ADVERSARIAL was warranted because the codebase showed consistent quality and no pattern of systemic issues. The findings are architectural and maintainability concerns, not security breaches or correctness failures.

---

## Open Questions (unscored)

1. **Has the `process-image.ts` file ever been profiled for CPU/memory usage?** The parallel AVIF/WebP/JPEG encoding with per-format fresh Sharp instances is correct but expensive. A flame graph would reveal if the rgb16 pipeline is the bottleneck.

2. **What is the production MySQL connection pool utilization?** The pool is capped at 10 connections with a queue limit of 20. Under heavy upload load (batch uploads + queue processing + concurrent gallery views), does the pool ever saturate?

3. **Has the Satori OG image generation been load-tested?** The OG endpoint generates 1200x630 images on-the-fly. With 30 requests/minute rate limiting, what's the CPU impact under sustained load?

4. **What is the actual false positive rate of the `isbot` detection?** The analytics tables record bot-flagged views, but there is no analysis of how many legitimate visitors are misclassified as bots.

5. **Has the CLIP semantic search been evaluated with real user queries?** The synthetic calibration (4 fixtures) produced a threshold of 0.22, but real-world query-image relevance may differ significantly.

6. **What is the recovery procedure for a permanently-failed image that cannot be processed?** The admin UI shows failed images with a retry button, but if the original file is corrupted, there is no documented recovery path (re-upload? manual intervention?).

7. **Are there any plans for horizontal scaling?** The single-writer topology is documented as a limitation, but there is no roadmap for moving process-local state to a shared store (Redis, etc.).

---

*Review completed. 15 findings (4 Critical, 6 Major, 5 Minor), 8 gaps identified, 3 ambiguity risks noted, multi-perspective analysis conducted.*
