# Tracer Report — Cycle 11 (HEAD a7de3ebd)

**Date:** 2026-06-17
**Scope:** Four mandatory end-to-end paths. Working tree clean.

---

## Observation

Four paths traced at HEAD a7de3ebd: semantic search POST route, similar-photos GET route, upload-to-processing pipeline, and backfill (in-app runner + sidecar script). No prior cycle-10 items are re-examined; only the four assigned paths.

---

## Path 1 — Semantic Search (POST /api/search/semantic)

**Same-origin gate** (`route.ts` line 100): `hasTrustedSameOrigin` returns 403 before any counter is touched. CLEAN.

**Body guards** (lines 115–163): Content-Type prefix-checked, chunked TE rejected, 8192-byte cap enforced before parse, JSON shape validated. CLEAN.

**Rate-limit pre-increment** (line 209): `preIncrementSemanticAttempt(ip, now)` is called BEFORE the config read. Pattern 2 (rollback on every early-return before expensive work). Rollback call sites:
- Line 228: `semanticMode` resolves to `'disabled'` (including when config throws) — rollback present.
- Line 243: `embedTextReal`/`embedTextStub` throws — rollback present.
- Line 258: DB scan throws — rollback present.

The enrichment `catch` block (line 331) does NOT rollback — and correctly so: it falls through to a 200 response with `enrichedResults = []`, not an error early-return. The rate-limit credit was legitimately consumed for a request that completed real embedding work. A rollback here would allow free embedding scans by deliberately triggering enrichment failures. CLEAN.

**Config fail-closed** (lines 220–233): `semanticMode` initialized to `'disabled'`; the try/catch around `getGalleryConfig()` swallows any throw, leaving the variable at `'disabled'`; the subsequent guard rolls back and returns 503. CLEAN.

**DB scan bound**: `SEMANTIC_SCAN_LIMIT = 5000` (`clip-embeddings.ts` line 18) passed as `.limit(SEMANTIC_SCAN_LIMIT)` at line 256. CLEAN.

**`decodeEmbeddingColumn`** (`clip-embeddings.ts` lines 108–126): handles raw 2048-byte Buffer (case 1), legacy base64-in-Buffer (case 2), string base64 (case 3). Anything else returns null and is skipped by the `.filter` in the scan loop. CLEAN.

**Similarity function gate** (line 271): `dotProduct` for production (unit vectors from `truncateAndNormalize`), `cosineSimilarity` for stub (raw `[-1,1]` vectors not normalized). Gate is `isProd`. CLEAN.

**`capture_date` serialization**: schema declares `capture_date: datetime("capture_date", { mode: 'string' })` (`schema.ts` line 36). Drizzle returns the column as a SQL string. Wire-shape annotation is `capture_date: string | null`. Round-trip is lossless. CLEAN.

**Enrichment SELECT** includes `lens_model` (line 305) and `capture_date` (line 306); both fields appear in the mapped result at lines 327–328. CLEAN.

**Path 1 verdict: CLEAN.**

---

## Path 2 — Similar Photos (GET /api/search/similar/[id])

**Gate order** (lines 62–107):
1. Same-origin → 403, counter untouched.
2. Restore-maintenance → 503, counter untouched.
3. id validation → 400, counter untouched.
4. Rate-limit pre-increment (line 83). Pattern 2 rollback sites confirmed:
   - Line 102: non-production mode → rollback present.
   - Line 122: target embedding row absent → rollback present.
   - Line 129: `decodeEmbeddingColumn` returns null (corrupt) → rollback present.
   - Line 134: target embedding DB query throws → rollback present.
   - Line 149: full scan DB query throws → rollback present.
   Enrichment catch (line 231) is a 200 fallback, not an error return — same reasoning as Path 1, no rollback needed. CLEAN.

**Production-only gate**: `semanticMode !== 'production'` with rollback + 503 (lines 101–107). Stub vectors are random; "similar" is meaningless over random vectors. Stub mode cannot reach the scan. CLEAN.

**Self-exclusion**: `.filter(row => row.imageId !== id)` at line 159. CLEAN.

**Similarity function**: `dotProduct` only — production route cannot reach stub path. CLEAN.

**Wire shape vs SimilarResult interface** (`similar-photos.tsx` lines 14–31):

Route enrichment SELECT (lines 192–212) emits:
`imageId, score, title, description, filename_jpeg, width, height, topic, topic_label, camera_model, lens_model, capture_date`

`SimilarResult` interface declares:
`imageId: number; score: number; title: string | null; description: string | null; filename_jpeg: string; width: number; height: number; topic: string; topic_label: string | null; camera_model: string | null; lens_model: string | null; capture_date: string | null`

Every field present in the route's wire shape maps 1:1 to a field in the interface. `lens_model` at route line 205 / interface line 29. `capture_date` at route line 206 / interface line 30. CLEAN.

**`capture_date` serialization**: same `mode: 'string'` as Path 1. CLEAN.

**Path 2 verdict: CLEAN.**

---

## Path 3 — Upload to Processing

**Blur-wiring**: `assertBlurDataUrl` imported at `images.ts` line 28, called at line 352 on `data.blurDataUrl`. Throws on invalid MIME prefix or payload exceeding `MAX_BLUR_DATA_URL_LENGTH`. Producer-side validation prevents a malformed `blur_data_url` reaching the DB. CLEAN.

**Per-image advisory lock**: `GET_LOCK(gallerykit:image-processing:{id}, 0)` acquired in `image-queue.ts` before encode; non-blocking (0-second timeout); released in `finally`. CLEAN.

**Conditional UPDATE** (`image-queue.ts`): `.where(and(eq(images.id, job.id), eq(images.processed, false)))` — only advances `processed` if still false (row not deleted mid-processing). CLEAN.

**Delete-while-processing race** (`image-queue.ts` line 374): `updateResult.affectedRows === 0` triggers `deleteImageVariants(..., [])` (empty sizes = full directory scan) for all three format directories. Orphaned derivatives are cleaned up regardless of admin-configured `image_sizes`. CLEAN.

**Sharp parallel fan-out**: `processImageFormats` uses `Promise.all` across AVIF/WebP/JPEG. File existence and non-zero size verified before the conditional UPDATE. CLEAN.

**Path 3 verdict: CLEAN.**

---

## Path 4 — Backfill Path

**Advisory lock**: `GET_LOCK(gallerykit_color_pipeline_backfill, 0)` on a dedicated connection, released in the `finally` clause of `runBackfill`. Both the in-app runner and the sidecar script use the same lock name. CLEAN.

**Column set on success — in-app runner** (`admin-backfill-runner.ts` lines 557–570):
`pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit` (10 columns).

**Column set on success — sidecar script** (`backfill-color-pipeline.ts` lines 409–419): same 10 columns. CLEAN.

**Detection failure — no pipeline_version bump (runner)** (`admin-backfill-runner.ts` lines 594–609): when `signals === null` (detection threw after encode succeeded), the UPDATE writes only `was_downscaled` and `avif_10bit`, leaving `pipeline_version` behind current. Row remains a candidate for a later retry. CLEAN.

**Detection failure — sidecar script** (`backfill-color-pipeline.ts` lines 254–262): `derivativeOnly: { was_downscaled, avif_10bit }` UPDATE at lines 426–428 writes only those two columns. Mirrors the runner exactly. CLEAN.

**Delete-mid-reencode** (runner lines 573–576 and 605–608): `affectedRows === 0` on the version-bump UPDATE triggers `cleanupDeletedMidReencodeVariants` with `[]` sizes (full scan), then returns `{ ok: false, reason: 'deleted-mid-reencode' }`. CLEAN.

**Connection-pool budget cap** (`resolveBackfillConcurrency`): reserves `max(3, ceil(POOL/2))` connections for live traffic, caps backfill workers to `floor((POOL - RESERVED - 1) / 2)`. Non-finite pool-limit input falls back to 10 (guard on line 137). CLEAN.

**Path 4 verdict: CLEAN.**

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|------------|------------------|--------------------------|
| 1 | All four paths are correct at HEAD | High | Strong — direct line-level code read, all error branches enumerated | No contradicting evidence found across any path |

## Evidence For

- Path 1: all three pre-200 rollback sites confirmed by line citation; enrichment 200-fallback is not an error return; config fail-closed confirmed by `'disabled'` variable initialization; `capture_date` is `mode:'string'`; enrichment SELECT includes both `lens_model` and `capture_date`.
- Path 2: all five rollback sites confirmed; wire shape matches `SimilarResult` field-by-field including `lens_model` and `capture_date`; self-exclusion filter present; production-only gate holds.
- Path 3: blur `assertBlurDataUrl` enforced at write time; conditional `WHERE processed=false` UPDATE; `affectedRows===0` cleanup passes `[]` sizes for full scan.
- Path 4: both runner and script use the same 10-column UPDATE on success; both leave `pipeline_version` behind on detection failure; both clean up on delete-mid-reencode; pool-budget cap has non-finite guard.

## Evidence Against / Gaps

None found across all four paths at HEAD.

## Rebuttal Round

**Best challenge**: the enrichment catch blocks in both search routes silently drop results on DB error without rollback — could a low-cost enrichment failure allow repeated free embedding scans?

**Why the leader stands**: the enrichment query executes only after the full embedding scan (the expensive operation) has completed and topK results have been computed. The rate-limit credit was legitimately consumed for real work. Rolling back here would create the inverse vulnerability: an attacker could trigger enrichment failures to obtain unlimited free embedding scans. The fallback-to-empty-results posture is correct.

## Convergence / Separation Notes

All four paths are independently clean. No shared root cause across paths. The repo has converged on the four assigned paths.

## Current Best Explanation

All four traced paths are correct at HEAD a7de3ebd. No defects found. Zero findings.

## Critical Unknown

None material. One operational note (not a code defect): `PRODUCTION_COSINE_THRESHOLD = 0.22` was calibrated on synthetic fixtures; the comment at `clip-embeddings.ts` line 162 recommends re-validation on real gallery data post-deploy. This is a tuning recommendation, not a code defect.

## Discriminating Probe

Not applicable — no residual uncertainty requiring a further probe.

## Uncertainty Notes

None. All four paths traced to concrete file and line evidence.
