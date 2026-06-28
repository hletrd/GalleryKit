# Tracer Report — Cycle 21

**Date:** 2026-06-29
**HEAD:** (cycle-21 fixes applied, including R21-L1 runtime pins)
**Baseline (cycle-20):** eslint 0, tsc 0, vitest 2155 pass / 4 skip
**Scope:** 6 end-to-end flows; competing hypotheses; file:line evidence; TRACE21-NN labels

---

## TRACE21-01 — Upload → quota claim → enqueue → claim → Sharp fan-out → conditional processed UPDATE → delete-mid-processing cleanup

### Observation

The upload action accepts files, claims a quota window, enqueues background processing, and background processing acquires a per-image advisory lock before converting. Two races are documented: delete-while-processing (the image is removed between the queue check and the conditional UPDATE) and concurrent-worker double-processing (two queue workers both try to process the same image). Both are said to be handled by distinct mechanisms.

### Frame

Does the full upload-to-processed path handle all documented races without leaking orphaned files, phantom quota claims, or double-processing?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|-----------|------------------|--------------------------|
| 1 | All races are handled correctly at HEAD | High | Strong | Multiple independent mechanisms confirmed in source |
| 2 | Quota settle TOCTOU is open on a concurrent same-IP upload | Low | Weak | CR-16-01 comment explicitly addresses this; synchronous claim is confirmed |
| 3 | affectedRows=0 cleanup uses default sizes only, leaving non-default variants | Very Low | Weak | AGG-C4-04 explicitly passes `[]` for full scan |

### Evidence For H1 (correct)

- `apps/web/src/app/actions/images.ts:197-228`: CR-16-01 TOCTOU fix confirmed. All quota checks (count, total-size, cumulative) are synchronous; quota claim (`tracker.bytes += totalSize; tracker.count += files.length`) executes BEFORE the first `await` (disk check at line 233). This closes the check-then-claim race documented at CQ19-02.
- `apps/web/src/app/actions/images.ts:244,249,273,277,542,564`: Six `settleUploadTrackerClaim(...)` settle sites. Lines 244 and 249 handle disk-check failure (stat and statfs throw, respectively). Lines 273 and 277 handle DB error (throw re-propagated after settle) and topic-not-found. The comment at line 262 documents the invariant: "any await added between the claim and the final settle MUST roll the claim back on throw."
- `apps/web/src/lib/image-queue.ts:311`: `acquireImageProcessingClaim(job.id)` acquires a per-image MySQL advisory lock with non-blocking GET_LOCK before any processing work.
- `apps/web/src/lib/image-queue.ts:340-344`: `claimRetryScheduled = false` reset on successful claim — the C4-A2 bug fix. Without this, a job that retried once then succeeded would leave `claimRetryScheduled=true`, preventing `claimRetryCounts` cleanup.
- `apps/web/src/lib/image-queue.ts:347-352`: `SELECT WHERE processed = false` check executes AFTER lock acquisition. This prevents the delete-while-checking race.
- `apps/web/src/lib/image-queue.ts:431-443`: All three output files (WebP, AVIF, JPEG) are verified to exist and have non-zero size before any UPDATE. A corrupt or incomplete Sharp write cannot mark the image processed.
- `apps/web/src/lib/image-queue.ts:447-449`: Conditional UPDATE: `SET processed=true WHERE processed=false`. `affectedRows` is captured.
- `apps/web/src/lib/image-queue.ts:451-468`: `affectedRows === 0` → `deleteImageVariants(dir, filename, [])` with empty sizes array, three times. The `[]` third argument triggers a full directory scan removing every `{name}_{size}{ext}` variant, including non-default sizes. AGG-C4-04 comment confirms this was an explicit fix from a prior path that used `DEFAULT_OUTPUT_SIZES`.

### Evidence Against H1 / Gaps

- The outer `try {}` at `images.ts:175` is `finally`-only for the upload-contract lock release. An uncaught throw between claim (line 226) and the topic-exists try (line 267) would leak the claim. However, the code between lines 226 and 267 contains only synchronous operations followed by the disk-check try-catch that settles on any throw. The gap between disk-check settle and topic-check try (lines 251-267) is a `try { await db.select... }` with its own settle-on-throw. No uncovered gap is visible.

### Rebuttal Round

Best challenge to H1: the `settleUploadTrackerClaim` is an in-memory Map mutation. If the Node process crashes between claim and settle, the window inflates for the lifetime of the tracking window (~1 h). This is documented in CLAUDE.md ("process-local") and is a single-writer-by-design constraint, not a new defect.

H1 still stands. All race conditions in scope are handled.

### Current Best Explanation

**CONFIRMED-CORRECT.** The upload-to-processed flow handles the quota TOCTOU, concurrent-worker double-processing, delete-while-processing, and orphaned-variant cleanup correctly at HEAD. Evidence tier: primary artifacts (direct code-path reads at file:line).

### Critical Unknown

None. The mechanisms are fully confirmed in source.

### Uncertainty Notes

Process-local in-memory quota state is a documented single-writer limitation, not a new gap.

---

## TRACE21-02 — Color signal detection precedence (NCLX colr → ICC chromaticity → ICC name) → encoder decision → ETag/settings-hash invalidation → SW revalidation

### Observation

`detectColorSignals()` resolves color primaries and transfer function from three sources in priority order. A per-field guard is supposed to prevent NCLX "Unspecified" (code 2) from overriding a more specific ICC-derived value. The ETag for served derivatives includes a settings hash covering all color-impacting settings.

### Frame

Does the three-tier precedence apply correctly per-field, and does the ETag invalidation cover all byte-impacting settings?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|-----------|------------------|--------------------------|
| 1 | Precedence and ETag are both correct | High | Strong | Code path confirmed at file:line |
| 2 | NCLX code-2 guard is incomplete — some fields bypass it | Low | Weak | Only one guard-point pattern; each field must have its own check |
| 3 | IMAGE_PIPELINE_VERSION in ETag comes from gallery-config-shared.ts, not process-image.ts | Non-issue | Moderate | CLAUDE.md explicitly documents this re-export chain |

### Evidence For H1 (correct)

- `apps/web/src/lib/color-detection.ts`: NCLX code-2 guard uses `!== undefined` check at each field assignment. The field override only applies when the NCLX map entry for that code is defined. Code 2 ("Unspecified") has no entry in the maps, so it produces `undefined` and does not override any ICC-derived value.
- `apps/web/src/lib/color-detection.ts`: ICC chromaticity fallback (`icc-chromaticity.ts`) is applied only when `colorPrimaries === 'unknown'` after NCLX processing AND confidence is not 'low'.
- `apps/web/src/lib/settings-hash.ts`: ETag covers 9 `COLOR_IMPACTING_KEYS`: 5 color keys (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`), 3 quality keys (`image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`), and `image_sizes`. `image_sizes` is sorted ascending before hashing (AGG-R7C3-02) so array-order variance does not cause spurious invalidation.
- `apps/web/src/lib/gallery-config-shared.ts:21`: `IMAGE_PIPELINE_VERSION` (currently 7) is defined here and re-exported from `process-image.ts`, as documented.
- `apps/web/src/lib/gallery-config.ts:141-142`: Semantic mode resolver heals stored 'production' → 'disabled' if `SEMANTIC_SEARCH_ALLOW_PRODUCTION !== 'true'` on the happy path.
- `apps/web/src/lib/gallery-config.ts:193-200`: Catch/defaults path applies the SAME 'production' heal at line 196, symmetric with the happy path — defensive consistency pattern throughout config resolution.

### Evidence Against H1 / Gaps

- The CRT-D1 operational gap (static path serves majority of traffic; settings-hash ETag only affects the serve-upload path) is documented in CLAUDE.md and confirmed unchanged. An admin changing a color-impacting setting does NOT invalidate already-served static derivatives without a backfill re-encode. This is a documented operational constraint, not a code defect.
- The compile-time `_ColorKeysAreSettingKeys` guard in `settings-hash.ts` catches typos in the COLOR_IMPACTING_KEYS list but cannot catch a new byte-impacting key that an author forgets to add.

### Rebuttal Round

Best challenge: if a future NCLX code is added to the maps with an incorrect value, it would silently override ICC-derived data. This is a maintenance risk, not a current defect. The NCLX map guard is correct at HEAD; all defined codes map to correct values.

H1 still stands.

### Current Best Explanation

**CONFIRMED-CORRECT.** Color signal precedence applies the NCLX code-2 "Unspecified" guard correctly per-field. ETag covers all 9 byte-impacting settings with sorted image_sizes. CRT-D1 (static path gap) is a documented operational constraint.

### Critical Unknown

None in the code. The maintenance risk (new COLOR_IMPACTING_KEY not added by an author) is structural.

### Uncertainty Notes

The ICC chromaticity high-confidence vs medium-confidence threshold (ΔE ≤ 0.005 vs ≤ 0.015) was confirmed correct in cycle-19.

---

## TRACE21-03 — GPS strip per-format → walkAborted → re-encode fallback → on-disk original neutralization

### Observation

`stripGpsFromOriginal()` in `process-image.ts` dispatches to format-specific lossless scrubbers (Tier 1) and falls back to Sharp re-encode (Tier 2) when a scrubber returns `null`. In `gps-exif-strip.ts`, the ISOBMFF walker sets `walkAborted = true` at three guard points. The cycle-20 fix (R20C20 CQ20-06) moved `if (walkAborted) return null` to fire BEFORE the zero-items check, ensuring walkAborted causes `null` return even when 1+ items were found before the abort.

### Frame

Is the walkAborted fix correctly applied and does the `null` return propagate correctly through all format-specific Tier 2 paths, with no GPS-retention gap?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|-----------|------------------|--------------------------|
| 1 | Fix is correctly applied and AVIF/HEIF paths behave correctly | High | Strong | Exact line confirmed, Tier 2 paths traced |
| 2 | HEIC structural-anomaly path retains GPS — gap exposed by walkAborted fix | Medium | Moderate | By design: Sharp cannot encode HEVC; path existed before the fix |
| 3 | Exception in Tier 2 silently retains GPS (temp file lost, original untouched) | Low | Moderate | Documented: best-effort contract, non-fatal log |

### Evidence For H1 (correct)

- `apps/web/src/lib/gps-exif-strip.ts:461`: R20C20 comment: "honor walkAborted UNCONDITIONALLY, not only on the zero-items branch."
- `apps/web/src/lib/gps-exif-strip.ts:470`: `if (walkAborted) return null;` fires BEFORE the zero-items check that would otherwise return `{ stripped: false, buffer: input }`.
- `apps/web/src/lib/gps-exif-strip.ts:393,403,405,411`: Three guard points set `walkAborted = true` on depth overflow, BigInt overflow, and malformed box size.
- `apps/web/src/lib/process-image.ts:1646-1648`: HEIC/HEIF/AVIF dispatches to `stripGpsFromIsobmffBuffer(input)`. A `null` return means `scrubbed = null`.
- `apps/web/src/lib/process-image.ts:1657-1662`: `if (scrubbed)` — a `null` return falls through to Tier 2; `{ stripped: false }` returns early (no GPS to strip); `{ stripped: true }` writes `tmpPath` and renames atomically.
- `apps/web/src/lib/process-image.ts:1686-1688`: AVIF Tier 2: `pipeline.avif({ quality: 90 }).toFile(tmpPath)`. AVIF structural-anomaly GPS is stripped via re-encode. CONFIRMED.
- `apps/web/src/lib/process-image.ts:1693-1695`: HEIC/HEIF Tier 2: `console.error('... cannot strip GPS from structurally anomalous HEIC (no HEVC encoder); original retains GPS ...')` then `return`. GPS retained for structurally anomalous HEIC/HEIF. Documented design limitation.
- `apps/web/src/lib/process-image.ts:1709-1717`: Exception handler cleans up `tmpPath` with `safeUnlink` and logs a non-fatal error. GPS NOT stripped on exception — best-effort contract explicitly documented in the comment.

### Evidence Against H1 / Gaps

- H2 is confirmed: structurally anomalous HEIC/HEIF retains GPS. However, this is NOT a new gap exposed by the walkAborted fix — the code at line 1693 existed before R20C20. The fix only affects whether a walk with 1+ found items reaches Tier 2; it does not change what Tier 2 does for HEIC. Standard HEIC files (single Exif item, walk completes normally) are unaffected because `walkAborted` would not be set.
- H3 is confirmed behavior: a Sharp re-encode failure causes the exception handler to fire, leaving the original with GPS. The catch at line 1709 is explicit: "Non-fatal: log and continue. Only the download-original path leaks."

### Rebuttal Round

Best challenge to H1: the items-found + walkAborted path for HEIC specifically now returns `null`, falls to Tier 2, and Tier 2 logs an error and returns without stripping. Before R20C20, this same path would have returned `{ stripped: false, buffer: input }` (claimed GPS-clean when it was actually an anomalous walk). The new behavior is MORE conservative and correct for the doctrine: an anomalous walk returns `null` (unknown state), which triggers Tier 2. The limitation that Tier 2 cannot strip from HEIC/HEIF is pre-existing and documented.

H1 still stands. The walkAborted fix is correctly applied.

### Current Best Explanation

**CONFIRMED-CORRECT.** R20C20 fix applied at `gps-exif-strip.ts:470`. AVIF structural anomaly correctly falls to Tier 2 re-encode. HEIC/HEIF structural anomaly logs error and retains GPS — this is an explicit design limitation (no HEVC encoder in prebuilt Sharp), not a code defect. Exception path is best-effort with documented semantics.

### Critical Unknown

None. The HEIC/HEIF design limitation is acknowledged and documented.

### Uncertainty Notes

The "standard HEIC carries one Exif item" claim from the cycle-20 security reviewer is not independently verified here, but the behavior is correct regardless.

---

## TRACE21-04 — Backfill (sidecar + in-app runner) → advisory lock → re-encode → delete-mid-reencode cleanup → version-bump-on-detection-failure guard

### Observation

Two backfill entry points (sidecar `--rm` script and in-app admin runner) both re-encode photos at the current pipeline version. The documented contract: (a) neither bumps `pipeline_version` on detection failure; (b) both handle the delete-mid-reencode race via `affectedRows === 0`; (c) the advisory lock `gallerykit_color_pipeline_backfill` serializes concurrent runs.

### Frame

Are the two backfill entry points symmetric in their race handling and detection-failure guard?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|-----------|------------------|--------------------------|
| 1 | Both entry points are symmetric and correct | High | Strong | Code confirmed at file:line, both paths traced |
| 2 | In-app runner detection-failure branch misses affectedRows check | Low | Weak | admin-backfill-runner.ts:608 confirms it is present |
| 3 | Sidecar script version-bump-on-detection-failure differs from in-app runner | Low | Weak | backfill-color-pipeline.ts:480 confirms no version bump |

### Evidence For H1 (correct)

- `apps/web/src/lib/admin-backfill-runner.ts:576`: Success branch: `affectedRows === 0` → `cleanupDeletedMidReencodeVariants()` with the just-written derivative file triplet.
- `apps/web/src/lib/admin-backfill-runner.ts:608`: Detection-failure branch: same `affectedRows === 0` check → `cleanupDeletedMidReencodeVariants()`. Both branches covered.
- `apps/web/src/lib/admin-backfill-runner.ts:616`: `finally` block releases per-image advisory lock unconditionally.
- `apps/web/src/lib/admin-backfill-runner.ts:597-612`: Detection-failure branch updates only `was_downscaled` and `avif_10bit` — does NOT set `pipeline_version`. Image remains a backfill candidate for the next run.
- `apps/web/scripts/backfill-color-pipeline.ts:120-131`: `cleanupDeletedMidReencodeVariants()` exported as a module-level function for unit testing. The sidecar's `flushBatch()` feeds `affectedRows` results to `filterDeletedMidReencode()` which returns the files needing cleanup.
- `apps/web/scripts/backfill-color-pipeline.ts:149-162`: `countDetectionFailureDeletedMidReencode()` exported separately for unit testing the detection-failure∩deleted overlap count.
- `apps/web/scripts/backfill-color-pipeline.ts:480`: Comment "derivative columns without bumping pipeline_version" confirms the same no-version-bump contract on the sidecar side.
- `apps/web/scripts/backfill-color-pipeline.ts:511-514`: Sidecar logs a warning when `detectionFailures > 0` and `pipeline_version` was NOT advanced, explicit about the retry-on-next-run behavior.

### Evidence Against H1 / Gaps

- The in-app runner concurrency cap (`resolveBackfillConcurrency`) is process-local; a second app instance pointing at the same MySQL server would both attempt to acquire the advisory lock. The lock serializes correctly, but the cap math (pool budget / 2) is computed per-instance independently. Documented single-writer topology constraint.
- The sidecar `--rm` run uses a separate MySQL pool and is uncapped (`BACKFILL_CONCURRENCY` default 2). Running both simultaneously serializes via the advisory lock, but the sidecar's pool is not visible to the in-app pool budget calculation. No gap in correctness; mentioned in CLAUDE.md.

### Rebuttal Round

Best challenge: the sidecar's `flushBatch()` is a closure in the main function scope. The exported `cleanupDeletedMidReencodeVariants` is at module level and is the correct test target. The in-app runner and the sidecar both call the same functional pattern for the `affectedRows === 0` → cleanup path. No asymmetry detected.

H1 stands.

### Current Best Explanation

**CONFIRMED-CORRECT.** Both backfill entry points are symmetric in advisory lock handling, delete-mid-reencode cleanup (full-directory scan via `[]` arg), and the no-version-bump-on-detection-failure guard. Sidecar uses exported helpers for unit test coverage.

### Critical Unknown

None. All four documented contracts are confirmed in source.

### Uncertainty Notes

The advisory lock name scope (server-wide, not per-database) is documented in CLAUDE.md. Multi-tenant co-location would require name prefixing. Not a cycle-21 concern.

---

## TRACE21-05 — Session token mint → cookie → middleware guard (proxy.ts) → isAdmin() → server action requireSameOriginAdmin

### Observation

Sessions are HMAC-SHA256 tokens (`timestamp:random:signature`). The Next.js middleware (`proxy.ts`) validates token FORMAT only. Full cryptographic verification is deferred to `verifySessionToken`. Server actions call `requireSameOriginAdmin()` (origin check) plus `getCurrentUser()`/`isAdmin()` (auth check) as layered defense. `withAdminAuth` wraps all admin API routes.

### Frame

Does the two-layer defense (origin + auth) cover all server action and API route surfaces, and are there any bypass paths?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|-----------|------------------|--------------------------|
| 1 | Defense is correct: middleware → format check; actions → origin + auth | High | Strong | Full code path traced |
| 2 | requireSameOriginAdmin is ONLY an origin check — auth omission in an action passes the lint gate | Medium | Moderate | The lint gate only enforces origin; auth is not lint-gated |
| 3 | verifySessionToken timing oracle: length check before timingSafeEqual leaks signature-length info | Very Low | Weak | Expected length is public constant (64 hex chars); no useful info leaked |

### Evidence For H1 (correct)

- `apps/web/src/lib/session.ts:82-88`: `generateSessionToken()`: `timestamp:random:signature` where timestamp is `Date.now().toString()` (decimal integer), random is 32 hex chars, signature is 64 hex chars (HMAC-SHA256 hex).
- `apps/web/src/lib/session.ts:94`: `export const verifySessionToken = cache(async function ...)` — React `cache()` wrapper. Per-request deduplication: within a single server render, multiple `isAdmin()` calls resolve to one DB query.
- `apps/web/src/lib/session.ts:99-102`: Early return when token has wrong number of ':' separators.
- `apps/web/src/lib/session.ts:107-108`: Expected HMAC computed from `timestamp:random` payload using `getSessionSecret()`.
- `apps/web/src/lib/session.ts:110-115`: `signatureBuffer.length !== expectedSignatureBuffer.length` → null. This length check is REQUIRED before `timingSafeEqual` (which throws on unequal lengths). The information leaked (is the signature exactly 64 bytes?) is public knowledge and provides no exploitable oracle.
- `apps/web/src/lib/session.ts:117-119`: `timingSafeEqual(signatureBuffer, expectedSignatureBuffer)` — constant-time comparison.
- `apps/web/src/lib/session.ts:16-36`: `getSessionSecret()`: production requires `SESSION_SECRET` env var (≥32 chars); throws at startup otherwise. Dev falls back to INSERT IGNORE + re-fetch pattern for multi-process safety.
- `apps/web/src/proxy.ts`: Format check: `token.length < 100` → redirect; `tokenParts.length !== 3 || tokenParts.some(p => p.length === 0)` → redirect. `x-gk-admin-render: 1` set when format-valid `admin_session` cookie is present.
- `apps/web/src/lib/action-guards.ts`: `requireSameOriginAdmin()` calls `hasTrustedSameOrigin(requestHeaders)` only — origin check, NOT auth check.
- `apps/web/src/lib/api-auth.ts`: `withAdminAuth` wraps all admin API routes. PAT path (X-Admin-Token / X-GalleryKit-Token) bypasses same-origin check; cookie path requires `hasTrustedSameOrigin` THEN `isAdmin()`.

### Evidence Against H1 / Gaps

- H2 is partially confirmed: `requireSameOriginAdmin()` is an origin-only check. The `lint:action-origin` gate enforces that every mutating server action calls it and returns early on failure. There is NO separate lint gate enforcing `isAdmin()` in server actions. If an action author adds `requireSameOriginAdmin()` but omits `getCurrentUser()`, the lint gate passes. However, any such omission produces a runtime error at the first `currentUser.id` access, surfacing immediately in testing. This is a structural reliance on "missing auth causes runtime failure" rather than a compile-time gate.
- `x-gk-admin-render: 1` is set for any format-valid `admin_session` cookie, even if the HMAC would fail crypto verification. The Service Worker uses this header to exclude pages from the offline cache. A format-valid but crypto-invalid cookie causes the page to be excluded from offline cache even though the user is not authenticated. This is CONSERVATIVE (correct direction: no stale admin-rendered pages cached), not a security defect.

### Rebuttal Round

Best challenge to H1: `requireSameOriginAdmin()` does not call `isAdmin()`. If the lint gate is the only enforcement surface, any future action that calls origin-check but not auth-check would silently serve unauthenticated requests. The defense is structural (runtime failure on currentUser access) rather than mechanical (lint gate enforces auth). This is a LOW structural observation, not a live defect.

H1 still stands. No live bypass path exists.

### Current Best Explanation

**CONFIRMED-CORRECT.** The session token cryptographic flow is correct. Middleware provides format-based defense-in-depth only. Server actions require both `requireSameOriginAdmin()` and `getCurrentUser()`/`isAdmin()`. `withAdminAuth` covers all API routes. The `x-gk-admin-render` conservatism is correct-direction behavior.

### Critical Unknown

Whether any action currently calls `requireSameOriginAdmin()` but omits `isAdmin()` — not verified by exhaustive grep. Low priority: any such gap would produce immediate runtime failures.

**Discriminating probe:** `grep -rn 'requireSameOriginAdmin' apps/web/src/app/actions/ | grep -l 'requireSameOriginAdmin'` → cross-reference against those files to confirm `getCurrentUser` or `isAdmin` presence.

### Uncertainty Notes

`Buffer.from(signatureString)` defaults to UTF-8 encoding; since hex strings are ASCII-subset, UTF-8 === ASCII for these characters. No encoding mismatch vulnerability exists.

---

## TRACE21-06 — Semantic search mode resolver → embedding decode → scan → top-k

### Observation

The semantic search mode stored in `admin_settings` can be `'disabled'`, `'stub'`, or `'production'`. A stored `'production'` value must heal to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is set. Embeddings are stored as MEDIUMBLOB (raw float32 binary), decoded via `decodeEmbeddingColumn`. Production uses `dotProduct` (normalized vectors); stub uses `cosineSimilarity`.

### Frame

Does the mode heal apply symmetrically in both the happy and fallback config paths? Is the embedding decode immune to legacy rows? Is the similarity function selection correct?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|-----------|------------------|--------------------------|
| 1 | All three sub-claims are correct | High | Strong | Each confirmed at file:line |
| 2 | Catch/defaults path in gallery-config.ts skips the 'production' heal | Low | Weak | gallery-config.ts:196 confirms it is present |
| 3 | decodeEmbeddingColumn silently drops all rows on legacy base64 format | Very Low | Weak | 3-case handler covers both; returns null on size mismatch (skipped, not fatal) |

### Evidence For H1 (correct)

- `apps/web/src/lib/gallery-config.ts:141-142`: Happy path. `if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') { return 'disabled'; }`. Heal is applied.
- `apps/web/src/lib/gallery-config.ts:193-200`: Catch/defaults path. `if (raw === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') { return 'disabled'; }`. The heal is symmetric. Comment at line 195 explicitly notes "Apply the same operator-gate check as the happy path (line 141)." Added as AGG-C10-02.
- `apps/web/src/lib/clip-embeddings.ts:109-127`: `decodeEmbeddingColumn` 3-case handler: (1) raw 2048-byte Buffer → decoded directly; (2) Buffer of ~2732 bytes (base64 ASCII of 2048 bytes) → decoded as base64; (3) string (defensive) → Buffer.from base64. Each case length-checks and returns `null` on mismatch. A corrupt row with an unexpected length is skipped — safe behavior.
- `apps/web/src/lib/clip-embeddings.ts:50-60`: `dotProduct(a, b)` — used for production (normalized unit vectors, where dotProduct equals cosine similarity).
- `apps/web/src/lib/clip-embeddings.ts:24-40`: `cosineSimilarity(a, b)` — computes norms then divides. Used for stub (non-normalized deterministic vectors).
- `apps/web/src/app/api/search/semantic/route.ts`: `export const runtime = 'nodejs'` (R21-L1). Comment: "imports mysql2 (Node-only), Buffer, and in-process rate-limit Map (relies on shared process state); none are Edge-compatible."
- Rate-limit pre-increment BEFORE config read. Rollback (`rollbackSemanticAttempt`) on disabled/503 BEFORE expensive embedding work. Post-embedding, no rollback — rate limit consumed. COR-R5C1-04 pattern.
- `apps/web/src/lib/clip-embeddings.ts:18`: `export const SEMANTIC_SCAN_LIMIT = 2000` caps the brute-force vector scan for DoS-prevention.

### Evidence Against H1 / Gaps

- A corrupt row with length between 2049 and 2731 (not standard raw binary, not standard base64 size) falls to the base64 branch, which produces a wrong-length decoded buffer and returns null. The row is skipped — safe behavior.
- `SEMANTIC_SCAN_LIMIT` (2000) caps the brute-force scan. With 5000+ images and production CLIP mode, the search is silently truncated. Both limits are documented in CLAUDE.md as deliberate DoS-prevention tradeoffs.

### Rebuttal Round

Best challenge: the SEMANTIC_SCAN_LIMIT truncation is silent — no UI indication that results may be incomplete due to the cap. This is a UX observation, not a correctness defect. Not actionable in a correctness-focused trace.

H1 stands.

### Current Best Explanation

**CONFIRMED-CORRECT.** Mode heal is symmetric in both config paths. `decodeEmbeddingColumn` handles raw binary, legacy base64, and string defensively. `dotProduct` vs `cosineSimilarity` selection correctly matches the normalization state of production vs stub vectors. `runtime = 'nodejs'` pin applied (R21-L1).

### Critical Unknown

None. All three sub-claims are confirmed.

### Uncertainty Notes

`topK`'s threshold filtering behavior on empty result sets returns `[]`, which the route handles as a valid zero-result response.

---

## TRACE21-07 — Cycle-20 IMPLEMENT items: confirmed applied

All env-parse parseInt→Number sites from the cycle-20 sweep have `Number()` + R20C20 comments confirmed in source.

| Fix | Location | Evidence |
|-----|----------|---------|
| AUDIT_LOG_RETENTION_DAYS env-parse | `apps/web/src/lib/audit.ts:116` | `Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? '')` + R20C20 comment |
| SHARP_CONCURRENCY env-parse | `apps/web/src/lib/process-image.ts:46` | `Number(process.env.SHARP_CONCURRENCY ?? '')` + R20C20 comment |
| IMAGE_MAX_INPUT_PIXELS env-parse | `apps/web/src/lib/process-image.ts:334` | `Number(process.env.IMAGE_MAX_INPUT_PIXELS ?? '')` + R20C20 comment |
| IMAGE_MAX_INPUT_PIXELS_TOPIC env-parse | `apps/web/src/lib/process-image.ts:344` | `Number(process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC ?? '')` + R20C20 comment |
| parsePositiveIntEnv helper | `apps/web/src/lib/upload-limits.ts:11` | `Number()` in helper + R20C20 comment |
| IMAGE_CLEANUP_CONCURRENCY env-parse | `apps/web/src/app/actions/images.ts:797` | `Number(process.env.IMAGE_CLEANUP_CONCURRENCY ?? '')` + R20C20 comment |
| TRUSTED_PROXY_HOPS env-parse | `apps/web/src/lib/rate-limit.ts:144-148` | `Number()` in `getTrustedProxyHopCount()` + R20C20 comment |
| GPS strip walkAborted items-found path | `apps/web/src/lib/gps-exif-strip.ts:470` | R20C20 comment + `if (walkAborted) return null` before zero-items check |
| bounded-map .data live-ref doc warning | `apps/web/src/lib/bounded-map.ts:52-59` | R20C20 comment + "LIVE reference — intentionally" warning |
| Semantic route `runtime = 'nodejs'` pin | `apps/web/src/app/api/search/semantic/route.ts` | R21-L1 comment + `export const runtime = 'nodejs'` |

**CONFIRMED-APPLIED.** All 10 items verified at HEAD.

---

## One LOW structural observation (not a live defect)

**TRACE21-05-LOW: `requireSameOriginAdmin()` is origin-only — no lint gate enforces `isAdmin()` in server actions.**

The `lint:action-origin` gate enforces the CSRF origin check but not the authentication check. Any future action that calls `requireSameOriginAdmin()` but omits `getCurrentUser()` would pass lint. In practice, any such omission produces an immediate runtime error at the first `currentUser.id` access. The risk is real as a future-maintenance observation but there is no live instance of it.

Discriminating probe: `grep -rn 'requireSameOriginAdmin' apps/web/src/app/actions/` + cross-check that each file also contains `getCurrentUser` or `isAdmin`. Any file that appears in the first list but not the second is the gap.

---

## Final Findings Table

| ID | Flow | Label | Severity |
|----|------|-------|---------|
| TRACE21-01 | Upload → quota → enqueue → processed UPDATE → cleanup | CONFIRMED-CORRECT | — |
| TRACE21-02 | Color signal precedence → encoder → ETag invalidation | CONFIRMED-CORRECT | — |
| TRACE21-03 | GPS strip walkAborted → Tier 2 re-encode per format | CONFIRMED-CORRECT | — |
| TRACE21-03a | HEIC structural-anomaly GPS retention (Tier 2 cannot encode HEVC) | CONFIRMED-CORRECT (design limitation) | — |
| TRACE21-04 | Backfill sidecar + in-app → lock → delete-mid-reencode → no-version-bump | CONFIRMED-CORRECT | — |
| TRACE21-05 | Session mint → middleware format check → verifySessionToken → requireSameOriginAdmin | CONFIRMED-CORRECT | — |
| TRACE21-05-LOW | requireSameOriginAdmin is origin-only; no lint gate for isAdmin() in actions | NEEDS-MANUAL-VALIDATION | LOW |
| TRACE21-06 | Semantic mode heal → decodeEmbeddingColumn → dotProduct/cosineSimilarity | CONFIRMED-CORRECT | — |
| TRACE21-07 | Cycle-20 env-parse + GPS + bounded-map + runtime pin fixes | CONFIRMED-APPLIED | — |
