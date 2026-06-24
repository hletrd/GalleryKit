# Cycle 3 Deep Review — Document Specialist

Date: 2026-06-24
HEAD: 1d5545cb (run-9 cycle-8 convergence)

## Summary

This is a comprehensive documentation audit of the GalleryKit repository. The documentation (CLAUDE.md, AGENTS.md, README.md) is exceptionally thorough and largely accurate, but several gaps, stale JSDoc blocks, undocumented features, and minor imprecisions were found. No critical documentation bugs that would cause operational failures were identified.

## Findings by Category

### Category A: Confirmed Mismatches (doc claims != code reality)

#### A1 — Stale JSDoc in `process-image.ts:595-633` (resolveAvifIccProfile behavior) — CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts:595-633`
- **Type:** Stale comment / incorrect documentation

**Claim:** The JSDoc block at line 595 (above `resolveColorPipelineDecision`) describes the OLD behavior where wider-than-P3 gamuts (Adobe RGB / ProPhoto / Rec.2020) were "falsely mapped to 'p3'" and claims "The encode chain now performs an explicit .toColorspace('srgb') for non-P3 sources, so the right downstream tag is 'srgb' too."

**Reality:** The actual `resolveAvifIccProfile` function at line 766 maps Adobe/ProPhoto/Rec.2020 to `'p3-from-wide'`, NOT `'srgb'`. The correct, up-to-date JSDoc already exists at line 729 (above the actual function). The block at line 595 is an orphaned stale comment from a refactor.

**Fix:** Remove the stale JSDoc block at lines 595-633. The correct documentation at line 729 is sufficient.

---

#### A2 — `detectColorSignals` JSDoc mislabels parameter — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:297-316`
- **Type:** Incorrect JSDoc

**Claim:** JSDoc says `@param metadata` for the second parameter.

**Reality:** Actual signature is `(filepath: string, _image: unknown, metadata: Metadata)`. The second parameter is `_image` (unused, voided at line 323), and the third is `metadata`. The JSDoc swaps the parameter names.

**Fix:** Correct the `@param` tags: `@param filepath`, `@param _image`, `@param metadata`.

---

#### A3 — `deleteImageVariants` JSDoc missing parameters — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts:493-510`
- **Type:** Incomplete JSDoc

**Claim:** JSDoc only documents `@param sizes`.

**Reality:** Function signature is `deleteImageVariants(dir: string, baseFilename: string, sizes: number[] = DEFAULT_OUTPUT_SIZES)`. Missing `@param dir` and `@param baseFilename`.

**Fix:** Add missing `@param` tags for `dir` and `baseFilename`.

---

#### A4 — `color-detection.ts` module JSDoc references stale feature ID — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:1-20`
- **Type:** Stale reference

**Claim:** "True HDR AVIF delivery requires CICP signaling (deferred to US-CM12)"

**Reality:** CLAUDE.md uses "WI-09" for the HDR AVIF delivery feature. "US-CM12" is an old feature ID from an earlier planning cycle. Also, the claim that HDR detection is "ICC description only" is wrong — NCLX is the primary source (precedence: NCLX > ICC chromaticity > ICC name).

**Fix:** Update to "WI-09" and correct the HDR detection description to mention NCLX primary precedence.

---

#### A5 — `inferTransferFunction` JSDoc says "will be added" for NCLX — CONFIRMED STALE
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/color-detection.ts:74-95`
- **Type:** Stale comment

**Claim:** "true CICP transfer signaling will be added via nclx parsing (US-CM05)"

**Reality:** NCLX parsing IS already implemented (the `parseCicpFromHeif` function exists at line 222, and NCLX_TRANSFER_MAP at line 209 handles transfer codes including 16=PQ and 18=HLG). The "will be added" language is stale.

**Fix:** Change to "NCLX transfer signaling is implemented via parseCicpFromHeif; this heuristic is a fallback for non-HEIF sources."

---

#### A6 — `gamma18` documentation incomplete — LIKELY MISMATCH
- **Severity:** Low
- **Confidence:** Medium
- **File:** CLAUDE.md line 134
- **Type:** Documentation imprecision

**Claim:** "`gamma18` comes only from ICC name heuristics (AGG-D3)"

**Reality:** `gamma18` is emitted from TWO sources: (a) ICC name heuristic when `desc.includes('gamma 1.8')` or `name.includes('gamma18')` (`color-detection.ts:99`), AND (b) ProPhoto ICC name path (`color-detection.ts:107`). The claim is directionally correct (NCLX never emits `gamma18`) but omits the ProPhoto path.

**Fix:** Update to "`gamma18` comes from ICC name heuristics (including ProPhoto profiles) — NCLX never emits this code."

---

#### A7 — Security docs conflate serving-path and upload-path protections — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md "File Upload Security" section
- **Type:** Documentation imprecision

**Claim:** "Path traversal prevention: SAFE_SEGMENT regex + ALLOWED_UPLOAD_DIRS whitelist + resolvedPath.startsWith() containment" and "Symlink rejection: Both upload routes use lstat() and reject isSymbolicLink()"

**Reality:** `SAFE_SEGMENT`, `ALLOWED_UPLOAD_DIRS`, and `resolvedPath.startsWith()` ARE in `serve-upload.ts` (the file serving path), NOT in the upload routes (`images.ts`, `lr/upload/route.ts`). The upload routes use UUID filenames via `crypto.randomUUID()` and controlled directories for security. The symlink check (`lstat` + `isSymbolicLink`) is also in `serve-upload.ts`, not upload routes.

**Fix:** Clarify in CLAUDE.md that these are **serving-path** protections (in `serve-upload.ts`), not upload-route protections. The upload path uses UUID filenames and `getSafeUserFilename()` for security.

---

### Category B: Missing Documentation (features exist but are undocumented)

#### B1 — Environment Variables: ~20 vars in `.env.local.example` NOT in CLAUDE.md — CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **File:** CLAUDE.md "Environment Variables" section, `apps/web/.env.local.example`
- **Type:** Missing documentation

CLAUDE.md's Environment Variables section only lists 7 variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`). The `.env.local.example` contains 25+ variables. Missing from CLAUDE.md:

- `DB_SSL` — Auto-enabled for non-localhost; set false to disable
- `BASE_URL` — Public URL for sitemap/metadata
- `IMAGE_BASE_URL` — Optional CDN origin for uploaded assets
- `E2E_ADMIN_PASSWORD` — Plaintext for Playwright when ADMIN_PASSWORD is hashed
- `E2E_ADMIN_ENABLED` — Opt-in for Playwright admin flows
- `E2E_ALLOW_REMOTE_ADMIN` — Opt-in for remote admin E2E
- `SHARP_CONCURRENCY` — Upper bound for Sharp/libvips threads
- `QUEUE_CONCURRENCY` — Background image-processing jobs concurrency
- `IMAGE_MAX_INPUT_PIXELS` — Decompression bomb protection (default 256M)
- `IMAGE_MAX_INPUT_PIXELS_TOPIC` — Separate cap for topic images (default 64M)
- `AUDIT_LOG_RETENTION_DAYS` — Default 90 days
- `UPLOAD_MAX_TOTAL_BYTES` — Default 2 GiB
- `UPLOAD_MAX_FILES_PER_WINDOW` — Default 100
- `TRUST_PROXY` — Required for per-IP rate limiting behind nginx
- `TRUSTED_PROXY_HOPS` — Default 1 for nginx-only deployment
- `HEALTH_CHECK_DB` — Set true for DB readiness probe on /api/health
- `SEMANTIC_SEARCH_ALLOW_PRODUCTION` — Operator-only opt-in for production CLIP
- `CLIP_MODELS_ROOT` — Bind-mount path for CLIP model weights

Also used in code but NOT in `.env.local.example`:
- `NEXT_UPLOAD_BODY_MAX_BYTES` — Next.js server action body size limit (default 266MB)
- `ADMIN_BACKFILL_CONCURRENCY` — In-app backfill concurrency (default 1)
- `BACKFILL_CONCURRENCY` — Sidecar backfill concurrency (default 2)
- `VIEW_RETENTION_DAYS` — Analytics retention (default 395 days)
- `UPLOAD_ORIGINAL_ROOT` — Private original uploads directory

**Fix:** Expand CLAUDE.md Environment Variables section to include all operational env vars, at minimum the non-E2E ones that affect production behavior.

---

#### B2 — Admin settings missing from tunables table — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md "Admin tunables (color/HDR)" table
- **Type:** Missing documentation

The table lists 10 settings. The codebase has 13 gallery settings in `gallery-config-shared.ts`. Missing from the table:

- `slideshow_interval_seconds` — Slideshow interval in seconds (2-30, default 5)
- `auto_alt_text_enabled` — Auto alt-text via Florence-2 ONNX stub (default false)
- `semantic_search_mode` — CLIP semantic search mode (disabled/stub/production, default disabled)

**Fix:** Add these three settings to the admin tunables table.

---

#### B3 — `smart_collections` feature entirely undocumented — CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **File:** CLAUDE.md "Database Schema" section
- **Type:** Missing documentation

The `smart_collections` table exists in schema (`schema.ts:293-302`), has a public route (`app/[locale]/(public)/c/[slug]/`), admin management UI (`app/[locale]/admin/(protected)/categories/`), and query compiler (`lib/smart-collections.ts`). It is NOT mentioned anywhere in CLAUDE.md.

**Fix:** Add `smart_collections` to the schema table list and document the feature (public route `/c/[slug]`, admin UI, query AST).

---

#### B4 — `admin_tokens` / Lightroom Classic publish plugin partially undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md
- **Type:** Missing documentation

The `admin_tokens` table is mentioned as a bullet in the schema section ("Lightroom Classic publish-plugin PATs"), but:
- The `/api/admin/lr/upload` API route is NOT documented
- The admin token management UI (`/admin/tokens`) is NOT documented
- The PAT authentication flow (`X-GalleryKit-Token` header) is NOT documented
- The `lr-tokens.ts` server action is NOT documented

**Fix:** Add a brief section on the Lightroom Classic publish plugin integration.

---

#### B5 — API routes undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md
- **Type:** Missing documentation

These API routes exist but are not documented in CLAUDE.md:
- `/api/admin/lr/upload` — Lightroom Classic publish plugin upload endpoint
- `/api/search/semantic` — Semantic search (natural language)
- `/api/search/similar/[id]` — Similar photos (image-to-image)

**Fix:** Add these routes to the API route documentation.

---

#### B6 — Schema tables undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md "Database Schema (Key Tables)"
- **Type:** Missing documentation

These tables exist in schema.ts but are NOT in CLAUDE.md's schema table list:
- `topic_aliases` — Alias slugs that redirect to canonical topic
- `rate_limit_buckets` — MySQL-backed persistent rate limit storage
- `audit_log` — Audit log for admin actions

**Fix:** Add these tables to the schema documentation.

---

#### B7 — `AUDIT_LOG_RETENTION_DAYS` entirely undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md
- **Type:** Missing documentation

Exists in `.env.local.example`, implemented in `lib/audit.ts:57-75`, has safety guards and unit tests (`__tests__/audit-retention.test.ts`), but NOT mentioned in CLAUDE.md.

**Fix:** Add `AUDIT_LOG_RETENTION_DAYS` to the Environment Variables section and the operational playbook.

---

#### B8 — Rate limit constants undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/rate-limit.ts`, CLAUDE.md
- **Type:** Missing documentation

All rate limit constants are hardcoded in `rate-limit.ts` and `auth-rate-limit.ts` but not documented:
- Login: 5 attempts / 15 min (per-IP and per-account)
- Search: 30 requests / 1 min
- OG image: 30 requests / 1 min
- Share key lookup: 60 requests / 1 min
- Semantic search: 30 requests / 1 min

**Fix:** Add a brief section on rate limit defaults to the Security Architecture section.

---

#### B9 — EXIF columns in `images` table undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md "images color/HDR columns" table
- **Type:** Missing documentation

These columns exist but are not in the color/HDR columns table:
- `white_balance`, `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`
- `original_format`, `original_file_size`
- `processing_error`, `failed_at`
- `alt_text_suggested`

**Fix:** Add a separate table for non-color EXIF/admin columns, or expand the existing table.

---

#### B10 — `NEXT_UPLOAD_BODY_MAX_BYTES` env var undocumented — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/upload-limits.ts:17`
- **Type:** Missing documentation

Used to control Next.js server action body size limit. Default is `max(200MB, 250MB) + 16MB = 266MB`. Not in `.env.local.example` or CLAUDE.md.

**Fix:** Add to `.env.local.example` with comment, and document in CLAUDE.md.

---

### Category C: Version Imprecisions (minor version number mismatches)

#### C1 — Next.js version: "16.2" vs actual `^16.2.9` — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 11, README.md badge
- **Type:** Version imprecision

CLAUDE.md says "Next.js 16.2" but `package.json` has `"next": "^16.2.9"`. The patch version is higher.

**Fix:** Use "Next.js ^16.2.9" or "Next.js 16.2.x" in documentation.

---

#### C2 — React version: "19" vs actual `^19.2.5` — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 11, README.md badge
- **Type:** Version imprecision

CLAUDE.md says "React 19" but `package.json` has `"react": "^19.2.5"`.

**Fix:** Use "React ^19.2.5" or "React 19.x" in documentation.

---

#### C3 — TypeScript version: "6" vs actual `^6` (resolves to 6.3.x) — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** CLAUDE.md line 11, README.md badge
- **Type:** Version imprecision

CLAUDE.md says "TypeScript 6" but `package.json` has `"typescript": "^6"` which resolves to latest 6.x (currently 6.3.x).

**Fix:** Use "TypeScript ^6" or "TypeScript 6.x" in documentation.

---

### Category D: Structural/Tooling Issues

#### D1 — Orphaned migration file `0014_drop_reactions.sql` — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/drizzle/0014_drop_reactions.sql`
- **Type:** Dead file

This SQL file exists in the drizzle directory but is NOT listed in `_journal.json`. It will never be executed by the migration system. It appears to be an orphaned companion to `0014_add_icc_profile_name` that was never journal-registered.

**Fix:** Delete the orphaned file, or add it to `_journal.json` if it was intended to be part of the migration sequence. Given the schema is stable, deletion is the safer path.

---

#### D2 — Root `package.json` missing `lint:public-route-rate-limit` script — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `/Users/hletrd/flash-shared/gallery/package.json`
- **Type:** Missing script

Root `package.json` has scripts for `lint`, `lint:api-auth`, `lint:action-origin`, `typecheck`, `build`, `test`, but NOT `lint:public-route-rate-limit`. The web app `package.json` has it. AGENTS.md claims this is a blocking quality gate.

**Fix:** Add `"lint:public-route-rate-limit": "npm run lint:public-route-rate-limit --workspace=apps/web"` to root `package.json`.

---

#### D3 — Root `build` script uses `--workspaces` not `--workspace=apps/web` — LIKELY MISMATCH
- **Severity:** Low
- **Confidence:** Medium
- **File:** `/Users/hletrd/flash-shared/gallery/package.json`
- **Type:** Potential inconsistency

Root `package.json` has `"build": "npm run build --workspaces"` which builds ALL workspaces. AGENTS.md and CLAUDE.md imply building only `apps/web`. If there are other workspaces in `apps/*`, this could build unintended targets.

**Fix:** Verify if `--workspaces` is intentional. If only `apps/web` should be built, change to `--workspace=apps/web`.

---

### Category E: Missing JSDoc on Complex Functions

#### E1 — `process-image.ts` major functions lack JSDoc — CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **File:** `apps/web/src/lib/process-image.ts`
- **Type:** Missing documentation

These exported functions have NO JSDoc:
- `saveOriginalAndGetMetadata` (line 800) — 157 lines, complex file I/O + metadata extraction
- `processImageFormats` (line 958) — 424 lines, THE main image processing function with 12 parameters
- `extractExifForDb` (line 1382) — 189 lines, EXIF extraction for DB storage

**Fix:** Add JSDoc blocks documenting parameters, return values, and behavior for these critical functions.

---

#### E2 — `data.ts` major functions lack JSDoc — CONFIRMED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/src/lib/data.ts`
- **Type:** Missing documentation

These exported functions have NO JSDoc:
- `getImage` / `getImageCached`
- `getImageByShareKey` / `getImageByShareKeyCached`
- `getSharedGroup` / `getSharedGroupCached`
- `getTopicBySlug` / `getTopicBySlugCached`
- `getTopics` / `getTopicsCached`
- `getTags` / `getTagsCached`
- `searchImages`
- `getMapImages`
- `getAdminImagesLite`
- `getFailedImages`

**Fix:** Add JSDoc blocks to these data access functions.

---

#### E3 — Server actions lack JSDoc — CONFIRMED
- **Severity:** Medium
- **Confidence:** High
- **Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/topics.ts`
- **Type:** Missing documentation

`images.ts` has ZERO `/**` JSDoc blocks. Major functions without documentation:
- `uploadImages` (446 lines)
- `deleteImage`
- `deleteImages`
- `updateImageMetadata`
- `bulkUpdateImages`
- `retryFailedImage`

`topics.ts` has ZERO `/**` JSDoc blocks. Major functions without documentation:
- `createTopic` (91 lines)
- `updateTopic` (162 lines)
- `deleteTopic`
- `createTopicAlias`
- `deleteTopicAlias`

**Fix:** Add JSDoc blocks to these server actions, documenting auth requirements, parameters, and side effects.

---

### Category F: Previously Identified (Still Open from Cycle 2)

#### F1 — AGG-15: Backfill command docs mismatch — STILL OPEN
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/README.md`

README documents backfill with `--production` but `scripts/backfill-clip-embeddings.ts` requires `--force`.

#### F2 — AGG-16: Missing semantic search env examples — PARTIALLY FIXED
- **Severity:** Low
- **Confidence:** High
- **File:** `apps/web/.env.local.example`

`SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT` are still missing from `.env.local.example` despite being identified in cycle 2.

---

## Verified Correct (No Issues Found)

These documentation claims were fully verified against the code and are accurate:

1. **Database schema:** All 14 tables present, all 12 color/HDR columns present, all 8 indexes present
2. **Security architecture:** Argon2id params, HMAC-SHA256 sessions, cookie attributes, middleware auth guard, isAdmin() in actions, rate limiting, GPS stripping, privacy fields, CSV escaping, bidi rejection, OG sanitization
3. **Color/HDR pipeline:** All 13 claims verified (NCLX precedence, ICC chromaticity, ICC name, decision matrix, 9 COLOR_IMPACTING_KEYS, display capability detection, P3 pipeline predicate, wide gamut primaries, ICC extractor, ICC chromaticity, gain map detection, og-sanitize imports)
4. **Migration system:** All 6 claims verified (getAllJournalMigrations, hash-based check, reconcileLegacySchema, baselineAllJournalMigrations, post-condition assertion, non-monotonic timestamps)
5. **Operational playbook:** deploy.sh auto-prune, build-sw.ts SW_VERSION stamping, backfill advisory locks, concurrency clamping, entrypoint.sh
6. **Lint gates:** All 4 lint scripts exist, all 3 fixture test files exist, touch-target audit (44px), privacy-fields test, data-tag-names test, sw-template-contract test, view-retention test, backfill tests, OG sanitize tests, blur wiring tests
7. **Upload limits:** 200MB per file, 2GiB batch, 100 files per window — all match code
8. **Nginx limits:** 2MiB default, 64KiB login, 250MiB restore, 216MiB uploads, 216MiB LR upload — all match
9. **Health routes:** `/api/live` and `/api/health` both exist with correct behavior
10. **README features:** All 12 claimed features are implemented
11. **Service Worker:** Template exists, generated sw.js exists, LRU cache logic matches reference implementation
12. **i18n plural convention:** Correctly documented as intentional asymmetry

---

## Risk Assessment

| Category | Count | Highest Severity | Risk to Operations |
|----------|-------|------------------|-------------------|
| Confirmed Mismatches (A) | 7 | Medium | Low — stale JSDoc misleads developers but doesn't affect runtime |
| Missing Documentation (B) | 10 | Medium | Medium — operators may miss important config options; smart_collections is invisible |
| Version Imprecisions (C) | 3 | Low | Low — cosmetic |
| Structural Issues (D) | 3 | Low | Low — orphaned file is harmless; missing script is minor |
| Missing JSDoc (E) | 3 | Medium | Low — hinders maintenance but no runtime impact |
| Previously Open (F) | 2 | Low | Low — known issues from prior cycles |

**Overall:** No critical documentation bugs. The codebase is exceptionally well-documented. The most impactful gaps are the missing environment variables (B1) and the undocumented `smart_collections` feature (B3).

---

## Recommended Priority Order

1. **Fix stale JSDoc blocks (A1, A4, A5)** — These actively mislead developers
2. **Add missing env vars to CLAUDE.md (B1)** — Operators need these for production config
3. **Document `smart_collections` (B3)** — Feature is completely invisible
4. **Add missing JSDoc to critical functions (E1, E3)** — `processImageFormats` and `uploadImages` are core functions
5. **Fix parameter JSDoc mismatches (A2, A3)** — Minor but confusing
6. **Add missing schema tables and API routes (B5, B6)** — Completeness
7. **Add missing admin settings to tunables table (B2)** — Completeness
8. **Delete orphaned migration file (D1)** — Hygiene
9. **Add missing root package.json script (D2)** — Consistency
10. **Fix version imprecisions (C1-C3)** — Cosmetic
11. **Address cycle 2 open items (F1, F2)** — Backlog
