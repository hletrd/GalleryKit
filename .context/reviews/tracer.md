# Tracer Report — Run-6 Cycle-10

**HEAD verified:** `0502ae86`
**Date:** 2026-06-17
**Agent:** oh-my-claudecode:tracer

---

## Trace Report

### Observation

All four mandated end-to-end paths were traced from producer to consumer at HEAD 0502ae86. No prior-cycle finding was re-examined without independent re-verification against current source. The `git log -40` confirms 9 prior cycles of hardening with no outstanding open items in the commit stream.

---

## Path 1 — Upload → Process → Serve

### blur_data_url (producer → write → consumer)

- Producer: `apps/web/src/lib/process-image.ts` lines 862–895. `sharp().clone().resize(16).blur(2).toColorspace('srgb').jpeg({quality:40}).toBuffer()` → `data:image/jpeg;base64,…` → passed through `assertBlurDataUrl()` before assignment to `blurDataUrl`.
- Write: `apps/web/src/app/actions/images.ts` line 352: `blur_data_url: assertBlurDataUrl(data.blurDataUrl)` — second validation gate at the DB write boundary.
- Both gates use the same `assertBlurDataUrl` / `isSafeBlurDataUrl` validator from `lib/blur-data-url.ts` with MIME allowlist and `MAX_BLUR_DATA_URL_LENGTH = 4096` cap. Symmetric producer+consumer validation — any MIME drift in the blur builder surfaces at produce-time.
- Contract locked by `__tests__/process-image-blur-wiring.test.ts` and `__tests__/images-action-blur-wiring.test.ts`.
- **Result: clean.**

### Color/HDR audit columns (detectColorSignals → DB write → admin UI)

- `detectColorSignals()` resolves primaries via NCLX → ICC chromaticity → ICC name allowlist.
- `resolveColorPipelineDecision()` maps signals to the `COLOR_PIPELINE_DECISIONS` enum.
- Upload path writes: `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit`, `pipeline_version = IMAGE_PIPELINE_VERSION`.
- Backfill path (both in-app runner and sidecar script) writes the identical column set on re-encode. No version bump on detection failure. Version bump only on full success.
- Admin UI (`<ColorDetailsSection>`) reads these columns via `adminSelectFields` behind the `_PrivacySensitiveKeys` guard.
- **Result: clean.**

### serve-upload.ts ETag

- `apps/web/src/lib/serve-upload.ts` line 215: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`.
- `settingsHash` is 8 hex chars from `getServingColorSettingsHash()` covering all 5 `COLOR_IMPACTING_KEYS`. `HASH_LENGTH` constant used at the ETag site — no `.slice(0,8)` needed.
- **Result: clean.**

---

## Path 2 — CLIP Semantic Search (Live)

### POST /api/search/semantic — full gate sequence

1. Same-origin: `hasTrustedSameOrigin()` → 403 on failure.
2. Restore-maintenance: `isRestoreMaintenanceActive()` → 503. Checked before the rate-limit pre-increment (line 104), so the counter is not consumed on a maintenance 503.
3. Content-Type: prefix check + sub-type rejection; chunked transfer-encoding rejection; body-size cap (Content-Length + post-read byte cap at `MAX_SEMANTIC_BODY_BYTES = 8192`).
4. `countCodePoints(query) < 3` → 400. Codepoint-aware via `countCodePoints` — correct for multi-byte characters.
5. `preIncrementSemanticAttempt(ip, now)` — Pattern 2. Rolled back on: config-gate fail (line 228), embed failure (line 243), embedding-scan DB error (line 258). Not rolled back on enrichment failure — correct, real work was done.
6. `semanticMode` gate: for `'production'`, resolver in `gallery-config.ts` requires `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` env var; without it a stored `'production'` heals to `'disabled'` (AGG-C10-02). Fail-closed on config throw.
7. Embedding: `isProd ? embedTextReal(query) : embedTextStub(query)`. `embedTextReal` uses lazy-singleton `getModelBundle()` with `env.allowRemoteModels = false` and `env.cacheDir = CLIP_MODELS_ROOT`.
8. DB scan: `WHERE model_version = activeModelVersion ORDER BY updatedAt DESC LIMIT 5000`. Stub and production rows partitioned by `STUB_MODEL_VERSION` vs `PRODUCTION_MODEL_VERSION`.
9. Similarity: `dotProduct` for production (unit vectors — L2-normalized by `truncateAndNormalize`), `cosineSimilarity` for stub (random, non-normalized). Gated on `isProd`.
10. `decodeEmbeddingColumn()` handles raw Buffer (current write path) + legacy base64-in-Buffer + base64 string. Malformed rows return `null` and are skipped.
11. Enrichment: Drizzle ORM `db.select()` with `mode:'string'` on the `capture_date` DATETIME column (`schema.ts` line 36). mysql2 returns `'YYYY-MM-DD HH:mm:ss'` string — not a JS Date object. `NextResponse.json()` receives a plain string; no `.toISOString()` divergence. Consumer (`search.tsx` line 102) passes through `formatStoredExifDate(image.capture_date, locale)` which parses the stored string format correctly.
- **Result: clean.** No serialization mismatch on `capture_date` or `lens_model`.

### GET /api/search/similar/[id]

1–5. Same gate sequence as semantic route plus positive-integer id validation.
6. Production-only mode gate — 503 with rollback for non-production. Stub vectors are random; cosine similarity over random vectors is meaningless.
7. Target embedding lookup: `WHERE imageId = id AND modelVersion = PRODUCTION_MODEL_VERSION LIMIT 1`. Missing → 404 + rollback. `decodeEmbeddingColumn` null → 404 + rollback.
8. Scan: same `SEMANTIC_SCAN_LIMIT` window, same `dotProduct` (production-only).
9. Self-exclusion: `.filter(row => row.imageId !== id)` before scoring.
10. Enrichment: identical SELECT/JOIN shape to semantic route including `capture_date` (mode:'string') and `lens_model`. Consumer (`similar-photos.tsx`) carries both fields in `SimilarResult` interface (AGG-C9-04) matching wire shape.
- **Result: clean.**

### Maintenance mode, corrupt/missing embedding, model_version mismatch

- Maintenance: checked before rate-limit increment in both routes. No counter leak on 503.
- Missing embedding (similar route): `targetRows.length === 0 || !targetRows[0].embedding` → 404 + rollback.
- Corrupt embedding: `decodeEmbeddingColumn` returns null → 404 + rollback.
- Scan rows with malformed embeddings: removed by `.filter(m => m !== null)` — degraded recall at worst, no crash.
- model_version mismatch: each scan uses the `activeModelVersion` / `PRODUCTION_MODEL_VERSION` filter. Rows embedded under a different version are excluded by the WHERE clause. Backfill script (`TARGET_MODEL_VERSION`) confirmed consistent at lines 77, 130, 169–174 of `backfill-clip-embeddings.ts`.
- **Result: clean.**

---

## Path 3 — Backfill

### In-app runner (admin-backfill-runner.ts)

- Advisory lock: `gallerykit_color_pipeline_backfill` acquired non-blocking (GET_LOCK timeout=0). Serializes with sidecar script.
- Per-image processing claim: `gallerykit:image-processing:{id}` non-blocking. Pool-exhaustion on `getConnection()` classified as `locked` skip — not an `errors++` — so no tight error loop under sustained pool exhaustion.
- State counters: reset at run start, mirrored live to `globalThis` state for mid-run status polls, final flush after queue drain.
- Encode failure: no version bump, row remains candidate for next run.
- Detection failure: `was_downscaled` and `avif_10bit` updated (fresh encode reflected), `pipeline_version` NOT bumped (retry contract preserved).
- Full success: complete column set written including `pipeline_version = IMAGE_PIPELINE_VERSION`.
- Deleted-mid-reencode: derivative cleanup via `deleteImageVariants([], …)`, tallied separately, excluded from `hadFailures` flag.
- Width guard (AGG-R8-09): `width <= 0` → `encode-failed` (idempotent), logged distinctly.
- **Result: clean.**

### CLIP model downloader idempotency (scripts/download-clip-models.ts, cycle-9 fix 26609da8)

- Fast-path triggers only when `onnx/model_quantized.onnx` exists.
- Step 1: `verifyAndCleanArtifacts(deleteOnMismatch=false)` checks SHA-256 of manifest entries (`onnx/model_quantized.onnx`, `tokenizer.json`). Inspection only.
- Step 2: `verifyLoaderFatalFiles()` checks all four loader-fatal files (`onnx/model_quantized.onnx`, `tokenizer.json`, `tokenizer_config.json`, `config.json`). JSON files verified by existence + parse. A missing or corrupt `config.json`/`tokenizer_config.json` causes fall-through to re-download — the pre-cycle-9 bug (AGG-C8-02 class) is closed.
- `clipModelArtifactDir()` validates `JINA_CLIP_MODEL_ID` is 2-segment and `JINA_CLIP_REVISION` is a 40-hex SHA; throws on violation.
- Fast-path only exits 0 when BOTH steps pass (`preCheck.ok && fatalCheck.ok`).
- **Result: clean.**

---

## Path 4 — Migration

### migrate.js journal reconciliation + post-condition

- `getAllJournalMigrations()` reads the full journal and computes SHA-256 of each SQL file's content.
- `prepareLegacyDatabaseIfNeeded()`: fresh DB → `reconcileLegacySchema()` + `baselineAllJournalMigrations()`. Pre-existing DB with all hashes → no-op. Pre-existing DB missing some hashes → reconcile + baseline.
- `baselineAllJournalMigrations()`: inserts `(hash, folderMillis)` per missing entry. After baseline, each entry's hash is present → drizzle's `migrate()` short-circuits (no re-apply) for already-baselined entries.
- Non-monotonic journal pair: `0006_admin_tokens when=1778304060000 > 0007_image_reactions when=1746144000000` (verified via Python script). This is the known pre-existing condition, present since before cycle 1. Per-entry baseline inserts both hash rows. Drizzle sees 0007's hash present and short-circuits. New migrations must have `when > 1781687094232` (last entry 0022) to pass drizzle's cursor check — documented in CLAUDE.md.
- Post-condition assertion in `runMigrations()`: checks every journal hash is in `__drizzle_migrations` after `migrate()` completes. Missing hash throws loudly. This is a deploy-time hard gate.
- `image_embeddings` composite index (`idx_image_embeddings_model_version_updated`) present in both migration 0022 and `reconcileLegacySchema()` (migrate.js lines 572–573). Consistent.
- **Result: clean.**

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All traced paths are clean at HEAD | High | Strong (primary artifact inspection at file:line) | Direct producer-to-consumer trace at every boundary; no value arrives malformed at any consumer |

---

## Evidence For

- Path 1: `assertBlurDataUrl` at both producer (process-image.ts:895) and write (images.ts:352) — symmetric contract. Color column set verified identical between upload and backfill.
- Path 2: `capture_date` with `mode:'string'` in schema.ts:36 ensures Drizzle returns strings not Date objects; `NextResponse.json()` serialization is lossless. Rate-limit rollback coverage verified at all pre-embedding early-return paths in both routes.
- Path 3: Detection-failure no-version-bump contract confirmed at admin-backfill-runner.ts:594–609. Downloader fast-path verified to check all 4 loader-fatal files via `verifyLoaderFatalFiles()`.
- Path 4: Per-entry baseline confirmed at migrate.js:646–661. Non-monotonic `when` is handled by hash-based skipping, not cursor math.

## Evidence Against / Gaps

- No disconfirming evidence found for any conclusion.
- One acknowledged design note (not a defect): journal's non-monotonic `when` means new migrations must have `when > 1781687094232`. This is a process constraint, not a runtime defect; it is documented in CLAUDE.md and enforced at deploy time by the post-condition assertion.
- `similar-photos.tsx` carries `lens_model` and `capture_date` in the `SimilarResult` interface but does not render them (AGG-C9-04 — intentional). Wire shape matches API response.

## Rebuttal Round

- Best challenge to "all clean": the semantic route's enrichment failure is caught and returns `enrichedResults = []` without a 500, making a DB failure on the enrichment leg indistinguishable from a no-results query from the caller's perspective. However this is a deliberate design choice (graceful degradation over hard failure). The real work (embedding + cosine scan) succeeded; the enrichment is metadata decoration. Not a data-contract break.
- Why the leader stands: no value arrives at any consumer in an unexpected type or shape; no error that should propagate is swallowed at a security boundary; no advisory lock is released before its protected window ends.

## Convergence / Separation Notes

All four traced paths are independently clean with no shared root cause. The non-monotonic journal pair is a known historical artifact, not an active defect.

## Current Best Explanation

All traced end-to-end paths are clean at HEAD 0502ae86. Nine prior cycles of hardening have closed every known defect in the upload, color detection, backfill, CLIP search, and migration paths. The code operates as documented.

## Critical Unknown

None identified within the traced scope.

## Discriminating Probe

Not applicable — no defect found, no competing hypothesis requiring discrimination. The highest-value operational validation (not a code defect) would be a live integration test of the production CLIP path against a seeded `CLIP_MODELS_ROOT` volume to confirm the offline-load round-trip in the actual deployment environment.

## Uncertainty Notes

- `capture_date` serialization: Drizzle with `mode:'string'` on a MySQL DATETIME column returns `'YYYY-MM-DD HH:mm:ss'` string directly from mysql2. Verified via schema.ts:36. A JS Date object would serialize to ISO-8601 via `JSON.stringify`, which would fail `parseStoredExifDateTime`'s `YYYY:MM:DD HH:mm:ss` format check. The string path is clean.
- Service worker SW_VERSION: `public/sw.js` carries `dd26e742-p7` (not the current HEAD SHA `0502ae86`). This is expected — the stamp is only updated at deploy time via `scripts/build-sw.ts` in the `prebuild` hook. No commits since the last stamp have changed the SW logic. Pre-deploy artifact, not a runtime defect.

---

**Findings: 0. All 4 mandated paths traced clean at HEAD 0502ae86.**
