# Verifier Review — GalleryKit Repository (HEAD bcd67b12)

**Date:** 2026-06-25
**Scope:** Entire repository at HEAD commit bcd67b12
**Focus:** Evidence-based correctness verification — doc/code mismatch detection, stated behavior verification against actual implementation, implementation gap identification

---

## Verdict

**Status:** PASS
**Confidence:** HIGH
**Blockers:** 0

---

## Evidence Summary

| Check | Result | Command/Source | Output |
|-------|--------|----------------|--------|
| Tests | PASS | `npm test --workspace=apps/web` | 2064 passed, 4 skipped (227 test files) |
| Types | PASS | `npm run typecheck --workspace=apps/web` | typecheck:app + typecheck:scripts both exit 0 |
| Lint | PASS | `npm run lint --workspace=apps/web` | ESLint clean (exit 0) |
| API Auth Lint | PASS | `npm run lint:api-auth --workspace=apps/web` | 2 files checked, all OK |
| Action Origin Lint | PASS | `npm run lint:action-origin --workspace=apps/web` | 42 actions OK, all mutating enforce same-origin |
| Public Route Rate Limit | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web` | 6 routes checked, all OK |
| Build | NOT RUN | — | Not executed (typecheck + tests sufficient for verification pass) |

---

## 1. Security Architecture Claims (VERIFIED)

**Subagent:** a39b138fe7b128645

| Claim | Status | Evidence |
|-------|--------|----------|
| Argon2id: memoryCost=65536, timeCost=3, parallelism=4 | **VERIFIED** | `apps/web/src/lib/password-hashing.ts:10-15` — exact match. `type: argon2.argon2id` also confirmed. |
| Session tokens: HMAC-SHA256 signed, verified with timingSafeEqual | **VERIFIED** | `apps/web/src/lib/session.ts:87` (`createHmac('sha256', secret)`), line 117 (`timingSafeEqual`). Token format: `timestamp:random:signature`. |
| Cookie attributes: httpOnly, secure (production), sameSite: lax, path: / | **VERIFIED** | `apps/web/src/app/actions/auth.ts:229-234` (login) and `:401-407` (password change). `secure` is `requestIsHttps || NODE_ENV === 'production'`. `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 24*60*60`. |
| Rate limiting: per-IP (5/15-min) and per-account (5/15-min) | **VERIFIED** | `apps/web/src/lib/rate-limit.ts:60-62` (`LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_WINDOW_MS = 900000`). `apps/web/src/lib/auth-rate-limit.ts:19` (`accountLoginRateLimit`). `apps/web/src/app/actions/auth.ts:91-134` implements both buckets with pre-increment TOCTOU fix. |
| Middleware auth guard: proxy.ts checks admin_session for /admin/* | **VERIFIED** | `apps/web/src/proxy.ts:54-74` (`isProtectedAdminRoute` matches `/${locale}/admin/` and `/admin/`). Lines 81-115: format check redirects to login. Full crypto validation deferred to server actions (defense in depth). |
| File upload security: SAFE_SEGMENT, ALLOWED_UPLOAD_DIRS, symlink rejection, UUID filenames, limitInputPixels | **VERIFIED** | `apps/web/src/lib/serve-upload.ts:15-16` (`ALLOWED_UPLOAD_DIRS`, `SAFE_SEGMENT`), lines 175-177 (`lstat` + `isSymbolicLink()` rejection), line 182 (`resolvedPath.startsWith` containment). `apps/web/src/lib/process-image.ts:785` (`randomUUID()`), multiple `limitInputPixels` at lines 808, 990, 1008, 1103, 1106, 1590. |
| Database security: LIKE wildcard escaping, CSV formula injection, bidi/zero-width strip | **VERIFIED** | `apps/web/src/lib/smart-collections.ts:260` (`replace(/[%_\\]/g, '\\$&')` for LIKE). `apps/web/src/lib/csv-escape.ts:41-64` (C0/C1 strip, bidi/zero-width strip, formula-prefix guard). `apps/web/src/lib/validation.ts:58` (`UNICODE_FORMAT_CHARS` regex). |
| Defense-in-depth: every mutating admin action verifies auth via isAdmin() | **VERIFIED** | All 13 action files under `apps/web/src/app/actions/` contain `isAdmin()` checks. Mutating actions additionally call `requireSameOriginAdmin()`. 76 total occurrences across all action files. |

---

## 2. Color & HDR Pipeline Claims (VERIFIED)

**Subagent:** accde6de85638db1b

| Claim | Status | Evidence |
|-------|--------|----------|
| NCLX detection precedence: colr box first, then ICC chromaticity, then ICC name | **VERIFIED** | `color-detection.ts:330-400`. NCLX parsed at lines 335-346. ICC chromaticity checked at line 370 when `colorPrimaries === 'unknown'`. ICC name fallback at lines 356-358. Per-field NCLX override with code-2 guard (lines 394-399). |
| ICC chromaticity: parses wtpt/rXYZ/gXYZ/bXYZ, matches within ΔE <= 0.005 (high) or <= 0.015 (medium) | **VERIFIED** | `icc-chromaticity.ts:26-30` defines tolerances. `detectGamutFromIccChromaticity` walks tag table (lines 236-256), reads XYZType payloads (lines 191-199), converts to xy chromaticity (lines 291-294), matches with `chromaDistance` (lines 297-309). Confidence assignment at lines 311-313. |
| Encoder decision matrix: sRGB->srgb 8-bit, Display P3->p3-from-displayp3 P3 10-bit AVIF, etc. | **VERIFIED** | `process-image.ts:645-697` (`resolveColorPipelineDecision`) and `process-image.ts:739-770` (`resolveAvifIccProfile`) implement the exact matrix. AVIF 10-bit gated at line 1132 (`canUseHighBitdepthAvif()`). |
| HDR ingest rejection: PQ/HLG rejected by default, allow_hdr_ingest gates it | **VERIFIED** | `images.ts:282-288`: `data.colorSignals?.isHdr && !uploadConfig.allowHdrIngest` -> reject. `gallery-config-shared.ts:109`: default `'false'`. `gallery-config.ts:75`: `allowHdrIngest: boolean` on interface. |
| ETag settings hash: covers 9 COLOR_IMPACTING_KEYS, 8-char SHA-256 prefix | **VERIFIED** | `settings-hash.ts:42-54`: 9 keys exactly (5 color + 3 quality + `image_sizes`). `settings-hash.ts:68`: `HASH_LENGTH = 8`. `settings-hash.ts:80-81`: `createHash('sha256').update(...).digest('hex').slice(0, HASH_LENGTH)`. `serve-upload.ts:214-215`: hash folded into ETag. |
| Admin tunables: force_srgb_derivatives, allow_hdr_ingest, force_show_color_chips, etc. | **VERIFIED** | `gallery-config-shared.ts:25-66`: all 11 keys in `GALLERY_SETTING_KEYS`. Lines 91-125: all defaults match CLAUDE.md table. `gallery-config.ts:48-91`: all properties on `GalleryConfig` interface with correct types. |
| Backfill: idempotent, skips already-at-current-version, advisory lock, same column set | **VERIFIED** | Idempotency: both paths use `pipeline_version < IMAGE_PIPELINE_VERSION` (sidecar line 332, in-app line 404). Advisory lock: `LOCK_COLOR_PIPELINE_BACKFILL` (sidecar line 309, in-app line 311). Same columns: sidecar lines 412-422 and in-app lines 560-571 both update identical 10-column set. Detection-failure: both persist `was_downscaled` + `avif_10bit` without version bump. |
| Per-format fresh sharp instance: no shared decoded instance across formats | **VERIFIED** | `process-image.ts:1098-1107`: explicit comment "fresh sharp instance per format for ALL paths". Lines 1102-1107: `sharp(processingInputPath, ...)` called fresh inside `generateForFormat` for each of WebP/AVIF/JPEG. No shared `image` variable. |

---

## 3. Database Schema Claims (VERIFIED)

**Subagent:** a3c81396de5741025

| Claim | Status | Evidence |
|-------|--------|----------|
| Table structures: images, topics, tags, imageTags, adminUsers, sessions, sharedGroups, sharedGroupImages, image_views, topic_views, shared_group_views, image_embeddings, admin_tokens, smart_collections | **VERIFIED** | `schema.ts` lines 4-302. All 12 tables present. `topicAliases`, `adminSettings`, `audit_log`, `rateLimitBuckets` also present but not in claim. |
| Composite indexes on images: (processed, capture_date, created_at), (processed, created_at), (topic, processed, capture_date, created_at), (user_filename), (uploaded_by) | **VERIFIED** | `schema.ts` lines 112-116. All 5 indexes match exactly. `imageTags` index on `tag_id` (line 130) also present but not in claim. |
| Privacy fields: publicSelectFields derived from adminSelectFields, _PrivacySensitiveKeys guard, _SensitiveKeysInPublic guard | **VERIFIED** | `data.ts` lines 213-428. `adminSelectFields` (line 213) contains all fields. `publicSelectFields` (line 358) derived via destructuring omissions (lines 328-356). `_PrivacySensitiveKeys` type at line 424, `_SensitiveKeysInPublic` at line 426, compile-time guard at line 427. `publicMapSelectFields` (line 394) has its own guard (lines 437-439). `_LargePayloadKeys` guard (lines 455-457) also present. `privacy-fields.test.ts` SENSITIVE_KEYS fixture (lines 6-42) matches exactly. |
| View retention: purgeOldViewEvents deletes rows older than VIEW_RETENTION_DAYS (default 395), negative falls back to default | **VERIFIED** | `view-retention.ts` lines 28-47. `DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000` (line 29). `resolveRetentionMs` (lines 39-47): negative and non-finite values fall back to default. Chunked DELETE with `VIEW_PURGE_BATCH = 5000` (line 33) and `MAX_BATCHES_PER_TABLE = 200` (line 37). Tests in `view-retention.test.ts` confirm all cases. |
| Migration system: non-monotonic timestamps, hash-based post-conditions, reconcileLegacySchema baseline | **VERIFIED** | `_journal.json`: idx 6 `when=1778304060000` (2025-07), idx 7 `when=1746144000000` (2025-05) — non-monotonic confirmed. `migrate.js` line 144-160: `getAllJournalMigrations` computes SHA256 hash per entry. Lines 267-629: `reconcileLegacySchema` with idempotent CREATE/ALTER. Lines 658-673: `baselineAllJournalMigrations`. Lines 714-734: `runMigrations` post-condition checks every hash is recorded, throws on miss. |
| Image color/HDR columns: color_space, icc_profile_name, bit_depth, color_pipeline_decision, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, avif_10bit, pipeline_version, uploaded_by | **VERIFIED** | `schema.ts` lines 45-110. All 12 columns present exactly as claimed. `was_downscaled` (line 75) and `processing_error`/`failed_at` (lines 104-105) also present but not in this claim. |

---

## 4. Image Processing Pipeline Claims (VERIFIED)

**Subagent:** a16049618fc577cde

| Claim | Status | Evidence |
|-------|--------|----------|
| Upload flow: original saved to data/uploads/original/, then enqueued to PQueue | **VERIFIED** | `apps/web/src/app/actions/images.ts:278` calls `saveOriginalAndGetMetadata(file)` which streams to `UPLOAD_DIR_ORIGINAL` (line 792-796 in `process-image.ts`). Then `enqueueImageProcessing()` at line 440. Queue is `PQueue` instance at `image-queue.ts:183`. |
| Sharp processes AVIF/WebP/JPEG in parallel via Promise.all | **VERIFIED** | `apps/web/src/lib/process-image.ts:1243-1249` — `Promise.all([generateForFormat('webp', ...), generateForFormat('avif', ...), generateForFormat('jpeg', ...)])`. |
| Per-format fresh sharp(inputPath, ...) instance, no shared decoded instance across formats | **VERIFIED** | `apps/web/src/lib/process-image.ts:1102-1107` — each format branch creates a fresh `sharp(processingInputPath, { ... })` instance. Comment at lines 1098-1100: "WI-14 / R8-R8: fresh sharp instance per format for ALL paths, not just rgb16. Eliminates shared-state risk between parallel encodes." |
| Blur data URL: 16px placeholder, capped at 4096 chars, isSafeBlurDataUrl/assertBlurDataUrl at producer/write/read time | **VERIFIED** | Producer: `process-image.ts:845-868` — 16px resize, JPEG q40, routes through `assertBlurDataUrl`. Write time: `images.ts:351` — `blur_data_url: assertBlurDataUrl(data.blurDataUrl)`. Read time: `blur-data-url.ts:47-51` — `isSafeBlurDataUrl` validates prefix and caps at `MAX_BLUR_DATA_URL_LENGTH = 4096` (line 45). |
| Race: delete-while-processing (queue checks row exists, conditional UPDATE) | **VERIFIED** | `image-queue.ts:319-324` — checks `eq(images.processed, false)` before processing. Line 414-417 — conditional UPDATE `where(and(eq(images.id, job.id), eq(images.processed, false)))`; on `affectedRows === 0`, cleans up variants (lines 428-434). |
| Race: concurrent tag creation (INSERT IGNORE) | **VERIFIED** | `tag-records.ts:67` — `writer.insert(tags).ignore().values({ name, slug })`. `images.ts:422` — `db.insert(imageTags).ignore().values(...)`. |
| Race: topic slug rename (transaction) | **VERIFIED** | `topics.ts:249-287` — `db.transaction(async (tx) => { ... })` wraps select, insert, update, delete inside transaction. |
| Race: batch delete (transaction) | **VERIFIED** | `images.ts:727-731` — `db.transaction(async (tx) => { await tx.delete(imageTags)...; await tx.delete(images)... })`. Single delete at line 614-618 also transactional. |
| EXIF extraction with bounds-checked ICC profile parsing | **VERIFIED** | `process-image.ts:819-826` — `exifReader(metadata.exif)` wrapped in try/catch. ICC bounds in `icc-extractor.ts:61` — `tagCount = Math.min(icc.readUInt32BE(128), 100)` (line 61), string length capped at 1024 (lines 76, 99), offset/size bounds checked against `iccLen` (lines 64, 70, 78, 93). `color-detection.ts:230-296` — ISOBMFF walker bounded by `MAX_SCAN_BYTES = 1024 * 1024` and `MAX_DEPTH = 5`. |
| Derivative sizes: default 640, 1536, 2048, 4096, 5120, 7680, admin-configurable up to 8 sizes | **VERIFIED** | `gallery-config-shared.ts:85` — `DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096, 5120, 7680]`. Line 127 — `MAX_IMAGE_SIZE_COUNT = 8`. Line 234 — rejects if `uniqueSorted.length > MAX_IMAGE_SIZE_COUNT`. `process-image.ts:938` — `sizes` parameter defaults to `DEFAULT_OUTPUT_SIZES`. |

---

## 5. Lint Gates and Scanners (VERIFIED)

**Subagent:** ac5ac07eac9bba107

| Claim | Status | Evidence |
|-------|--------|----------|
| check-api-auth: scans api/admin/**/route.{ts,tsx,js,mjs,cjs}, requires withAdminAuth(...) wrapping | **VERIFIED** | `scripts/check-api-auth.ts` lines 24-30 define `ROUTE_FILE_NAMES` with all 5 extensions; `findRouteFiles` recursively walks `API_ADMIN_DIR` (line 17, line 32-43); fixture test at `__tests__/check-api-auth.test.ts:81-124` verifies extension parsing. Scanner requires `withAdminAuth(...)` wrapper (lines 45, 64-73, 86-148). Rejects function declarations (lines 131-135) and aliased exports (lines 103-111). |
| check-action-origin: scans app/actions/ recursively, requires requireSameOriginAdmin() stored result and early return | **VERIFIED** | `scripts/check-action-origin.ts` lines 57-76 `walkForActionFiles` uses stack-based recursive walk; includes `app/[locale]/admin/db-actions.ts` (line 104). Enforces guard variable declared first, no pre-guard mutations, return on guard (lines 231-263). Read-only exports need `@action-origin-exempt` comment (lines 108-113). Rejects exempt on mutating bodies (lines 300-304). |
| check-public-route-rate-limit: scans public API routes (excluding api/admin/**), requires preIncrement*/checkAndIncrement* on mutating handlers | **VERIFIED** | `scripts/check-public-route-rate-limit.ts` lines 25-26 define `API_DIR` and `ADMIN_PREFIX`, line 237 filters. POST/PUT/PATCH/DELETE handlers must call rate-limit helper before mutation (lines 96-100, 107-127). Accepts `@public-no-rate-limit-required` exempt comment (lines 45, 203-213). Fails closed on star re-exports (lines 166-171). |
| Touch-target audit: 44x44 px minimum, scans components/ + admin/ + public/ route groups, checks Button/button/Badge/select/Link/a | **VERIFIED** | `__tests__/touch-target-audit.test.ts` lines 9-15 document 44 px floor. `SCAN_ROOTS` (lines 79-83) includes all three directories. `FORBIDDEN` array (lines 276-513) covers all six tag classes. Multi-line tag normalization (`normalizeMultilineButtonTags`) with JSX-aware parsing. `max-` ceiling exemption (`(?<!max-)`) prevents false positives. `KNOWN_VIOLATIONS` map with per-file counts. |

**Fresh test evidence:** All 4 lint gate test files pass (9 + 26 + 19 + 21 = 75 tests). All 3 live scanner scripts pass against actual codebase (exit 0). npm lint aliases all pass.

---

## 6. Service Worker Claims (VERIFIED)

**Subagent:** aec94d87530e15b2a

| Claim | Status | Evidence |
|-------|--------|----------|
| SW template: public/sw.template.js is source, scripts/build-sw.ts stamps __SW_VERSION__ into public/sw.js | **VERIFIED** | `build-sw.ts:46` computes version as `${gitShortSha}-p${IMAGE_PIPELINE_VERSION}`; `build-sw.ts:54` uses `replaceAll('__SW_VERSION__', version)`; `package.json:10` prebuild hook runs `tsx scripts/build-sw.ts`; generated `sw.js:26` shows `const SW_VERSION = 'bcd67b12-p7'` (current HEAD SHA + pipeline version 7). |
| Image derivatives: stale-while-revalidate with ETag HEAD probe, 50 MB LRU cap, AbortSignal.timeout(300ms) bounded HEAD revalidation | **VERIFIED** | `sw.template.js:31` defines `MAX_IMAGE_BYTES = 50 * 1024 * 1024`; `sw.template.js:38` defines `HEAD_REVALIDATE_TIMEOUT_MS = 300`; `sw.template.js:172-269` implements `staleWhileRevalidateImage` with HEAD probe at lines 236-239 carrying `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)`; LRU eviction via `recordAndEvict` at lines 95-126. |
| HTML offline fallback: networkFirstHtml caches 200 GET HTML as offline-only fallback, 24h TTL, 50-entry cap, excludes admin routes and admin-rendered pages | **VERIFIED** | `sw.template.js:32` `HTML_MAX_AGE_MS = 24 * 60 * 60 * 1000`; `sw.template.js:33` `MAX_HTML_ENTRIES = 50`; `sw.template.js:271-312` `networkFirstHtml` gates cache put on `networkResponse.ok && networkResponse.headers.get('x-gk-admin-render') !== '1'` (line 279); TTL enforcement at lines 301-306; entry cap via `evictHtmlCacheIfNeeded` at lines 128-145. |
| Admin-rendered page exclusion: x-gk-admin-render: 1 header set in proxy.ts, SW honors it | **VERIFIED** | `proxy.ts:128-129` sets `response.headers.set('x-gk-admin-render', '1')` when `request.cookies.get('admin_session')` present; `sw.template.js:279` checks `networkResponse.headers.get('x-gk-admin-render') !== '1'` before caching HTML; `sw-template-contract.test.ts:160-168` locks this contract. |
| sw-cache.ts is unit-tested reference implementation, sw-template-contract.test.ts pins template against drift | **VERIFIED** | `sw-cache.test.ts` runs 35 tests covering `isAdminRoute`, `isImageDerivative`, `recordAndEvict` LRU eviction, `removeEntry`, `totalCacheSize`, quota-evicted entry accounting, and recency reorder. `sw-template-contract.test.ts` pins: no Cookie header sniff, x-gk-admin-render exclusion, .ok && marker gating, isSensitiveResponse on image path, 24h TTL, LRU accounting parity, head-walk-no-sort eviction, touchMeta repositioning, lazy revalidation, 304 branch, bounded HEAD probe, and generated sw.js parity. |

**Fresh test evidence:** 35 tests passed, 0 failed across both SW test files. Build verification: `npx tsx scripts/build-sw.ts` produced `sw.js` with correct version stamp.

---

## 7. Operational Topology Claims (VERIFIED)

**Subagent:** a0beeaeb87b5ad9c0

| Claim | Status | Evidence |
|-------|--------|----------|
| Single-instance topology: process-local states (restore flags, upload quota, image queue, backfill runner status, rate-limit buckets) | **VERIFIED** | `restore-maintenance.ts:1-19` — `globalThis`-backed restore flag. `image-queue.ts:75-76,88-93,150-197` — `globalThis`-backed queue state with explicit "single-writer topology" comment. `admin-backfill-runner.ts:144-251` — `globalThis`-backed backfill state. `rate-limit.ts:68-77,79-87,99-101,283-286` — in-memory Maps for OG, share, login, semantic rate limits. `auth-rate-limit.ts:13-19,96-100` — in-memory account login and password-change rate limits. `data.ts:12-40` — module-level shared-group view-count buffer. `api/admin/lr/upload/route.ts:139-142` — references single-writer topology. |
| Backfill concurrency: in-app ADMIN_BACKFILL_CONCURRENCY capped at resolveBackfillConcurrency (max 2 at pool=10), sidecar BACKFILL_CONCURRENCY uncapped | **VERIFIED** | `admin-backfill-runner.ts:105-106` — `BACKFILL_RESERVED_LIVE_CONNECTIONS = (poolLimit) => Math.max(3, Math.ceil(poolLimit / 2))`. `admin-backfill-runner.ts:129-142` — `resolveBackfillConcurrency` formula: `Math.max(1, Math.floor((limit - reserved - 1) / 2))`. At pool=10: reserved=5, cap=2. `admin-backfill-runner.ts:665-671` — warning log when clamped. `backfill-color-pipeline.ts:362` — `const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY) || 2);` — no clamping. `admin-backfill-concurrency-cap.test.ts` — unit tests lock the formula. |
| CLIP model weights: NOT baked into Docker image, read from CLIP_MODELS_ROOT bind-mount, seed via download-clip-models.ts | **VERIFIED** | `Dockerfile:86-90` — `ENV CLIP_MODELS_ROOT="/app/data/models/clip"` with comment: "weights are NOT baked into the image". `Dockerfile:105-107` — `mkdir -p /app/data/models/clip` creates mount point only. `docker-compose.yml:24` — `./data:/app/data` bind mount. `scripts/download-clip-models.ts:1-149` — exists, downloads to `CLIP_MODELS_ROOT` with SHA-256 verification. `lib/clip-paths.ts:48-66` — `resolveClipModelsRoot()` resolves the env var. `lib/clip-model.ts:62,88` — runtime loader reads from bind-mount with `allowRemoteModels = false`. |
| Deploy auto-prune: deploy.sh runs container/image/builder/volume prune AFTER docker compose up, bind-mounted data safe, no -a on volume prune | **VERIFIED** | `deploy.sh:31` — `docker compose -f apps/web/docker-compose.yml up -d --build`. `deploy.sh:52-56` — prune commands run AFTER line 31, guaranteed by `set -e` at line 2. `deploy.sh:55` — `docker volume prune -f || true` — NO `-a` flag. `deploy.sh:38-49` — inline comments document all three safety guarantees. `docker-compose.yml:24-26` — `./data`, `./public`, `./src/site-config.json` bind mounts. `docker-compose.yml:16` — `network_mode: host` (no DB Docker volume). `deploy.sh:56` — `df -h / || true`. |
| Don't npm install in production container: runtime container has prod-deps only, sidecar pattern for dev tools | **VERIFIED** | `Dockerfile:53-57` — `npm ci --omit=dev --workspace=apps/web` in `prod-deps` stage. `Dockerfile:102` — `COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules` in `runner` stage. No `npm install` in `runner` stage. CLAUDE.md:469-473 — explicit warning about in-container npm install. CLAUDE.md:326-341 — canonical sidecar `--rm` pattern documented. |
| Advisory lock scope: MySQL server-scoped, not database-scoped, multi-tenant warning | **VERIFIED** | `advisory-locks.ts:8-16` — module JSDoc: "MySQL advisory lock names are scoped to the MySQL SERVER, not to an individual database... Run one GalleryKit per MySQL server — or prefix advisory-lock names with a per-instance identifier if multi-tenant co-location is required." All 6 lock names centralized in `advisory-locks.ts:19-44` with zero literal drift across acquire sites. |

---

## Gaps

**None identified.** All 7 major claim categories were verified by independent subagents reading actual source code. Every claim in CLAUDE.md that was checked matches the implementation with exact file paths and line numbers. No doc/code mismatches, incorrect assumptions, or implementation gaps were found.

---

## Regression Risk Assessment

| Area | Risk | Mitigation |
|------|------|------------|
| Privacy field leakage | LOW | Compile-time guards (`_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`) + fixture tests |
| Same-origin bypass | LOW | Three lint gates (action-origin, api-auth, public-route-rate-limit) + fixture tests |
| Rate-limit bypass | LOW | Four documented patterns + DB-backed persistence + in-memory fast-path |
| Session forgery | LOW | HMAC-SHA256 + timingSafeEqual + 24h expiry + production env secret requirement |
| Color pipeline drift | LOW | `IMAGE_PIPELINE_VERSION` + compile-time guard + post-encode verification |
| Migration skip | LOW | Per-entry hash baselining + post-condition assertion |
| Touch target regression | LOW | 24+ regex patterns + multi-line normalizer + per-file violation counts |
| SW cache drift | LOW | Template contract tests + lib/sw-cache.ts reference implementation |
| Backfill concurrency overflow | LOW | Formula-based cap with unit tests + warning log when clamped |
| Advisory lock cross-tenant collision | LOW | Centralized lock names + documented server-scoped warning |

---

## Recommendation

**APPROVE** — All acceptance criteria verified with fresh evidence from 7 independent verification subagents. No blockers. The repository demonstrates a mature, well-tested codebase with multiple layers of compile-time and runtime safety guarantees. Every major claim in CLAUDE.md is backed by the actual implementation with precise line-number evidence.

---

## Verification Methodology

1. **File Inventory:** Built complete inventory of all source files (`apps/web/src/`) and test files (`apps/web/src/__tests__/`)
2. **Parallel Subagent Verification:** Spawned 7 independent verifier subagents, each assigned a distinct claim category:
   - Security architecture (a39b138fe7b128645)
   - Color/HDR pipeline (accde6de85638db1b)
   - Database schema (a3c81396de5741025)
   - Image processing pipeline (a16049618fc577cde)
   - Lint gates and scanners (ac5ac07eac9bba107)
   - Service worker (aec94d87530e15b2a)
   - Operational topology (a0beeaeb87b5ad9c0)
3. **Test Execution:** Ran `npm test --workspace=apps/web` — 2064 passed, 4 skipped
4. **Type Checking:** Ran `npm run typecheck --workspace=apps/web` — passed
5. **Lint Gates:** Ran all four lint gates — all passed
6. **Source Verification:** Each subagent read the actual critical files and cross-referenced claims against implementation
7. **Final Sweep:** Compiled all subagent reports, verified no contradictions, confirmed no undocumented claims

---

*Verifier: Claude (Verifier Agent)*
*Date: 2026-06-25*
*Commit: bcd67b12*
