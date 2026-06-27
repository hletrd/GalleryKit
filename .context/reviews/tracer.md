# Trace Report — GalleryKit Cycle 16

**Agent:** Tracer · **HEAD:** 1f5fb245 · **Date:** 2026-06-27

---

## Framing

Six candidate flows were traced end-to-end. The repo's two recurring bug classes drove the selection:

- *NaN survives a relational comparison* (cycle-14 bavail mock, cycle-15 GPS NaN)
- *Fix one sibling, miss the next* (recurring: touch-target scanner, advisory-lock placement, color-key omissions)

Each flow was treated as a distinct trace with competing hypotheses before synthesis.

---

## Flow 1 — EXIF Numeric Ingest: NaN-Class Hazard

### Observation

`extractExifForDb` (process-image.ts:1430) writes `iso`, `f_number`, `focal_length`, `exposure_time`, `latitude`, `longitude`, `exposure_compensation`, and `flash` to MySQL. Prior cycles found NaN surviving into GPS columns. Whether the remaining numeric fields carry a similar residual risk is the question.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All numeric EXIF paths properly sanitize via `cleanNumber` / `normalizeExposureTime` / explicit `isFinite` guards | High | Strong (direct code read) | No counter-evidence found |
| 2 | `iso` column receives a float from `cleanNumber` creating a silent DB type mismatch | Medium | Moderate (schema + code) | `cleanNumber` returns `number`, `iso` schema is `int("iso")` |
| 3 | `cleanString(val)` in the `normalizeExposureTime` fallback path coerces unsafe values into varchar | Low | Moderate | `cleanMetadataString` calls `String(value)` before stripping |

### Evidence For / Against

**H1 (all guards in place):**

- `cleanNumber` (process-image.ts:1423–1425): `const n = Number(v); return !Number.isFinite(n) ? null : n;` — NaN or Infinity returns null, binding as SQL NULL.
- `normalizeExposureTime` (process-image.ts:1382–1411): the array branch at line 1407 guards `val[1] !== 0 && Number.isFinite(val[0]) && Number.isFinite(val[1])` before returning the rational string. Non-finite or zero-denominator inputs fall through to `cleanString(val)`.
- `convertDMSToDD` GPS guard: fixed in cycle-15 at process-image.ts:1455 with an explicit `Number.isFinite` check.
- `exposure_compensation` (process-image.ts:1512–1519): `!Number.isFinite(val)` → null.
- `flash` (process-image.ts:1530–1542): `!Number.isFinite(val)` → null.
- All six numeric DB columns pass through these guards before the DB write.

**H2 (iso float→int mismatch):**

- `iso: int("iso")` in schema.ts:39.
- `cleanNumber` returns `number` (TypeScript), which could be `100.5` if exif-reader emits a malformed rational for ISO.
- MySQL `INT` silently truncates float on write; mysql2 does not raise an error.
- No evidence of exif-reader returning non-integer ISO in practice. Risk is theoretical and non-breaking — MySQL truncation is safe.

**H3 (cleanString coercion):**

- `cleanMetadataString` (process-image.ts:648–656) calls `String(value)` on any type, then strips Unicode formatting chars, NUL bytes, and trims.
- `String(NaN) = "NaN"`, which is valid varchar. Stored in `exposure_time` if `normalizeExposureTime` falls through with a pathological `[NaN, NaN]` input — visible but not a relational-comparison hazard because `exposure_time` is never used in a numeric inequality in the application.

### Rebuttal Round

Strongest challenge: *Could `normalizeExposureTime` receive `[NaN, NaN]` from exif-reader, bypass the guards, and return a non-null string?*

Counter: The array branch at line 1407 tests `Number.isFinite(val[0]) && Number.isFinite(val[1])`. `Number.isFinite(NaN)` is `false`. The guard catches this case and falls through to `cleanString([NaN, NaN])`, which produces the string `"NaN,NaN"` via `String([NaN, NaN])`. This is stored as a varchar string, not a number — it cannot participate in a relational comparison hazard.

### Current Best Explanation

All numeric EXIF paths are correctly guarded. The NaN-survives-relational-comparison class that affected GPS in cycle-15 has no analogous survivor in the remaining EXIF fields. The only residual is the theoretical `iso float→int` silent MySQL truncation (not a hazard) and the `exposure_time` receiving `"NaN,NaN"` from a pathological EXIF array — a display oddity, not a relational hazard.

**Severity: no confirmed defect. Minor observation: `iso` float→int coercion is unguarded at the type level but MySQL-silent.**

### Critical Unknown

Whether exif-reader ever emits a non-integer rational for the ISO field in real HEIC/AVIF files.

### Discriminating Probe

Log `typeof exifResult.ISOSpeedRatings, exifResult.ISOSpeedRatings` on a sample iPhone HEIC upload; if array or float, add `Math.round` before passing to `cleanNumber`.

---

## Flow 2 — Image-Processing Queue: Claim → Conditional UPDATE → Orphan Cleanup

### Observation

`image-queue.ts` acquires a per-image MySQL advisory lock before processing, does a conditional `WHERE processed = false` UPDATE after encoding, and calls `deleteImageVariants(dir, filename, [])` when `affectedRows === 0` (delete-during-processing race). The in-app runner (`admin-backfill-runner.ts`) and the sidecar (`backfill-color-pipeline.ts`) both re-encode `processed=TRUE` images. Whether the two locks interact correctly with the queue is the question.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Lock scoping and row-set partitioning prevent queue/sidecar races | High | Strong (direct code + explicit comments) | Different predicates (`processed=false` vs `processed=true`) |
| 2 | Sidecar lacks per-image lock; `retryFailedImage` + sidecar could race | Low | Strong disconfirmation | `retryFailedImage` requires `processed=false`, sidecar requires `processed=true` |
| 3 | `deleteImageVariants([], ...)` with full scan catches non-default-size variants | High | Strong | Empty array argument triggers full directory scan |

### Evidence For / Against

**H1 (partitioning prevents races):**

- Queue worker: `WHERE id = job.id AND processed = false` (image-queue.ts:339, 435). Only claims un-processed rows.
- Sidecar: `WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)`. Only claims already-processed rows.
- `retryFailedImage` (images.ts:1127): `WHERE id = id AND processed = false AND processing_error IS NOT NULL`. Only operates on failed (never-successfully-processed) images. These are a subset of `processed=false` — the sidecar never touches this set.
- Advisory lock registry (advisory-locks.ts:40–44): `getImageProcessingLockName(jobId)` = `gallerykit:image-processing:{jobId}`. Shared by queue worker and in-app runner. Sidecar explicitly documents it does NOT acquire this lock (backfill-color-pipeline.ts:37–38).

**H2 (retryFailedImage + sidecar race):**

- `retryFailedImage` requires `processed = false`. Sidecar requires `processed = TRUE`. These predicates are mutually exclusive at the DB level. An image cannot simultaneously satisfy both. No race window exists.

**H3 (full-scan deleteImageVariants):**

- `deleteImageVariants(dir, filename, [])` with the empty array triggers a full directory scan for any file matching the base filename prefix. This catches variants at non-default sizes written before the delete-during-processing race is detected.

### Rebuttal Round

Strongest challenge: *The sidecar's batch UPDATE (backfill-color-pipeline.ts:423) uses `WHERE id = ${item.id}` with no `processed=TRUE` guard. Could a future application path that resets `processed=true→false` cause the sidecar to overwrite queue-worker results?*

Counter: No current application code path resets `processed=true→false`. The queue worker only sets `processed=true` (never reverses it). `retryFailedImage` only selects `processed=false AND processing_error IS NOT NULL` rows. DB restore is guarded by `gallerykit_db_restore`. This is a future-proofing concern, not a current defect.

### Current Best Explanation

Queue/backfill races are prevented by row-set partitioning and by the per-image advisory lock shared between the queue worker and in-app backfill runner. The sidecar's missing per-image lock is safe because its candidate set (`processed=true`) and the queue/retryFailed candidate sets (`processed=false`) are disjoint.

**Severity: no confirmed defect.**

### Critical Unknown

Whether a future feature adds an admin "requeue" path that resets `processed=true→false` without acquiring the per-image advisory lock.

### Discriminating Probe

`grep -rn "processed.*=.*false\|SET processed\|update.*processed" apps/web/src/` for any new write path that could reverse the `processed=true` invariant.

---

## Flow 3 — Shared-Group View-Count Buffer: SIGTERM Flush

### Observation

`viewCountBuffer` (data.ts) accumulates increments in a module-level `Map`. A periodic timer calls `flushGroupViewCounts`. On SIGTERM, `instrumentation.ts` calls `flushBufferedSharedGroupViewCounts`. Whether the flush correctly drains all buffered counts before process exit is the question.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | `flushBufferedSharedGroupViewCounts` correctly awaits an in-progress flush before draining | High | Strong (direct code read) | `currentFlushPromise` pattern is correctly sequenced |
| 2 | SIGTERM handler does not await the flush before calling `process.exit` | Low | Strong disconfirmation | instrumentation.ts:36–42 shows `await Promise.race([Promise.all([..., flushBufferedSharedGroupViewCounts()]), timeout])` |
| 3 | A double-flush path produces stale or duplicated DB increments | Low | Strong disconfirmation | Timer re-arm and cancellation logic examined; `isFlushing` guard prevents re-entry |

### Evidence For / Against

**H1 (correctly sequenced):**

- `flushGroupViewCounts` (data.ts:74): sets `isFlushing = true`, sets `currentFlushPromise` at line 104, swaps buffer atomically at lines 110–111. In `finally`: `isFlushing = false` (line 156), then (after back-off/retry logic) `currentFlushPromise = null` (line 210), then `resolveDrain()` (line 211).
- `flushBufferedSharedGroupViewCounts` (data.ts:215): cancels timer, awaits `currentFlushPromise.catch(() => {})`, cancels any re-armed timer, checks `viewCountBuffer.size > 0`, then calls `flushGroupViewCounts()` directly.
- `currentFlushPromise = null` is set synchronously before `resolveDrain()` schedules the microtask resumption. The awaiting code therefore sees `null` when it resumes. No ordering hazard.
- `isFlushing = false` is reset before `currentFlushPromise` is cleared, so `flushGroupViewCounts` called by `flushBufferedSharedGroupViewCounts` cannot hit the early-return guard unexpectedly.

**H2 (SIGTERM handler):**

- instrumentation.ts:36–42: `await Promise.race([Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()]).then(() => { completed = true; }), shutdownTimeout])`.
- Both queue drain and view-count flush are awaited in parallel with a 15-second timeout.
- `shutdownTimer.unref?.()` (line 31) prevents the timeout timer from keeping the event loop alive.
- `process.exit(exitCode)` at line 65 is called after the `Promise.race` resolves.
- H2 is **disconfirmed**.

**H3 (double-flush):**

- If the timer fires while `flushGroupViewCounts` is running, `isFlushing` is `true` and the timer callback returns immediately without a second flush.
- After `resolveDrain()`, `flushBufferedSharedGroupViewCounts` resumes, cancels any re-armed timer, and calls `flushGroupViewCounts` only if `viewCountBuffer.size > 0`. Single additional drain, not a double-flush.
- H3 is **disconfirmed**.

### Rebuttal Round

Strongest challenge: *If `flushGroupViewCounts` is mid-transaction when SIGTERM fires, the MySQL connection could be killed before the `UPDATE … SET view_count` commits, losing in-flight counts.*

Counter: This describes the SIGKILL path (not SIGTERM). For SIGTERM, the flush is awaited within a 15-second grace period. A clean drain completes the DB write before `process.exit`. If SIGKILL arrives before the flush completes, buffered counts are lost. CLAUDE.md documents this as "best-effort approximate analytics" — SIGKILL-path loss is acceptable by design.

### Current Best Explanation

The SIGTERM flush is correctly wired: `flushBufferedSharedGroupViewCounts` is awaited inside a 15-second timeout before `process.exit`. Double-flush and re-entrancy are prevented by the `isFlushing` guard and `currentFlushPromise` sequencing. SIGKILL-path loss is documented and acceptable.

**Severity: no confirmed defect.**

### Critical Unknown

The maximum expected flush duration for large `viewCountBuffer` sizes at production scale — relevant to assessing whether the 15-second timeout is sufficient during a traffic spike.

### Discriminating Probe

Add `console.time('[Shutdown] flush duration')` / `console.timeEnd` around `flushBufferedSharedGroupViewCounts()` in instrumentation.ts to characterize real flush latency in production.

---

## Flow 4 — Settings-Hash ETag Invalidation

### Observation

`settings-hash.ts` defines `COLOR_IMPACTING_KEYS` (9 keys). The `serve-upload.ts` ETag embeds a hash of these keys' current values. Whether all byte-impacting admin settings are in the set is the question — particularly whether `sdrJpegChroma` (added in a recent cycle) is actually wired to the encoder.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | `COLOR_IMPACTING_KEYS` is complete; all 9 keys provably change derivative bytes | High | Strong (end-to-end code trace) | `sdrJpegChroma` confirmed wired at process-image.ts:1003 and 1098 |
| 2 | `sdrJpegChroma` is in the hash but not actually passed to the encoder | Low | Strong disconfirmation | process-image.ts:1003, 1098 confirms it is a real encoder parameter |
| 3 | Static-path ETag gap silently serves stale bytes after a settings change | High (for static path) | Strong (documented CRT-D1) | Known operational caveat, not a code bug |

### Evidence For / Against

**H1 (keys complete):**

- `COLOR_IMPACTING_KEYS` (settings-hash.ts:42–54): `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` — 9 keys.
- `sdrJpegChroma`: declared as a parameter to `processImageFormats` at process-image.ts:1003 and assigned to `effectiveSdrChroma` at line 1098: `const effectiveSdrChroma: JpegChromaSubsampling = sdrJpegChroma ?? '4:2:0'`. Applied to the SDR JPEG encode path (lines 1240–1255 region). Changing this setting changes JPEG chroma subsampling — changes bytes.
- `wide_gamut_max_source_pixels`: controls downscale before the rgb16 pipeline at process-image.ts:1050–1054. A lower cap produces different output dimensions and pixel content — changes bytes.
- `image_sizes`: sorted ascending before hashing so `[640, 1536]` and `[1536, 640]` hash identically (AGG-R7C3-02).
- ETag formula in serve-upload.ts: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`.
- Compile-time guard `_ColorKeysAreSettingKeys` in settings-hash.ts catches typo'd or removed keys at `tsc`.

**H2 (sdrJpegChroma not wired):**

- Directly disconfirmed by process-image.ts:1003 (parameter declaration) and :1098 (assignment to `effectiveSdrChroma`).

**H3 (static-path ETag gap):**

- The static serving path (Next.js `public/` filesystem) uses `W/"{size-hex}-{mtime-hex}"` — no settings hash. A settings change does not invalidate cached static derivatives until the files are re-encoded (mtime change).
- Documented as CRT-D1 in CLAUDE.md: "flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives … the static path serves the overwhelming majority of real traffic."
- Not a code bug — a documented operational gotcha requiring a backfill re-encode after settings change.

### Rebuttal Round

Strongest challenge: *Could a new color/byte-impacting admin setting be added in the future and forgotten from `COLOR_IMPACTING_KEYS`?*

Counter: The compile-time guard catches only key *removal* or *misspelling* — it cannot catch a new valid key that was never added. CLAUDE.md explicitly documents this gap: "it CANNOT catch a forgotten new byte-impacting key." This is a systemic gap but not a current defect.

### Current Best Explanation

`COLOR_IMPACTING_KEYS` is complete for the current admin setting surface. All 9 keys are confirmed wired to encoder parameters that change derivative bytes. The static-path ETag gap is documented and by design. No missing key defect.

**Severity: no confirmed defect. Documented operational gap (CRT-D1) remains by design.**

### Critical Unknown

Whether a future byte-impacting admin setting will be added without a matching `COLOR_IMPACTING_KEYS` entry (compile-time guard cannot catch this case).

### Discriminating Probe

Add `// COLOR_IMPACTING_KEYS — add this key if it changes derivative bytes` as a required comment block next to every `admin_settings` key that is byte-impacting, so code reviewers have a visible checklist anchor during review.

---

## Flow 5 — Backfill Advisory Lock and Delete-During-Reencode Parity

### Observation

Two backfill entry points exist: the sidecar `backfill-color-pipeline.ts` and the in-app `admin-backfill-runner.ts`. Both must update the same DB column set and handle delete-during-reencode identically. Whether the two implementations are in sync is the question.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Both paths update the same 10 columns, use the same backfill lock, and handle delete-mid-reencode identically | High | Strong (both code paths read line-by-line) | Column sets compared directly |
| 2 | In-app runner per-image lock asymmetry vs sidecar could cause a concurrent-write race | Low | Strong disconfirmation | Sidecar processes `processed=true`; queue processes `processed=false` |
| 3 | Detection-failure branch in sidecar leaves `pipeline_version` un-bumped (preventing future retry) | Low (by design) | Strong | This is the documented AGG2-01 behavior |

### Evidence For / Against

**H1 (column parity):**

- Sidecar `flushBatch` UPDATE (backfill-color-pipeline.ts:412–422): `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit` — 10 columns.
- In-app runner UPDATE (admin-backfill-runner.ts:562–571): same 10 columns.
- Detection-failure branch (sidecar: backfill-color-pipeline.ts:427–433; runner: admin-backfill-runner.ts:597–602): both update only `was_downscaled` and `avif_10bit` without bumping `pipeline_version`. Identical behavior.
- Delete-mid-reencode: both check `affectedRows === 0` and call `cleanupDeletedMidReencodeVariants`. Identical behavior.
- Both use `LOCK_COLOR_PIPELINE_BACKFILL` from advisory-locks.ts (sidecar via import at line 56; runner via `acquireBackfillLock` at line 310).

**H2 (per-image lock asymmetry):**

- Sidecar comment (backfill-color-pipeline.ts:37–38): explicitly states it does not acquire per-image locks.
- In-app runner `acquireImageProcessingClaim` (admin-backfill-runner.ts:343–358): acquires `gallerykit:image-processing:{id}` per row.
- Row-set disjointness (`processed=true` for sidecar, `processed=false` for queue/retryFailed) makes this safe.

**H3 (detection-failure branch):**

- Leaving `pipeline_version` un-bumped on detection failure is intentional (AGG2-01 comment at sidecar:391–393). The row remains in the backfill candidate set for a later retry. Both implementations are consistent.

### Rebuttal Round

Strongest challenge: *The sidecar's batch `UPDATE … WHERE id = ${item.id}` (no `processed=TRUE` guard) could succeed against a row the queue worker is currently re-encoding if some future path resets `processed=true→false`.*

Counter: No application-layer code path currently resets `processed=true→false`. This is a future-proofing concern. The `gallerykit_db_restore` advisory lock blocks all other operations during DB restore. The concern is real but not a current defect.

### Current Best Explanation

Both backfill paths are in complete column-set parity, use the same backfill advisory lock, and handle detection-failure and delete-mid-reencode identically. No fix-one-sibling-miss-the-next gap detected.

**Severity: no confirmed defect.**

### Critical Unknown

Whether the in-app runner's per-image `acquireImageProcessingClaim` (which prevents a backfill + queue-worker race on retried images) is exercised in practice — and whether the `skippedLocked` counter is tested.

### Discriminating Probe

Add a unit test to `__tests__/admin-backfill-runner.test.ts` that mocks `acquireImageProcessingClaim` returning `null` (lock held) and verifies the runner increments `skippedLocked` rather than proceeding to encode.

---

## Flow 6 — Semantic Search Resolver Healing

### Observation

`gallery-config.ts` heals a stored `'production'` value to `'disabled'` when `SEMANTIC_SEARCH_ALLOW_PRODUCTION !== 'true'`. Both semantic search routes must gate on the healed value. Whether every route reads through the healer without bypass is the question.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All routes read `getGalleryConfig()` which returns the healed value | High | Strong (direct code read) | Both route files confirmed |
| 2 | A route reads `semanticSearchMode` from the DB row directly, bypassing the healer | Low | Strong disconfirmation | Neither route uses `db.select` on `admin_settings` directly |
| 3 | Config-load failure path in the similar route returns the wrong mode, allowing production access | Low | Strong disconfirmation | similar/[id]/route.ts:97–103 initializes `semanticMode = 'disabled'` before try |

### Evidence For / Against

**H1 (healer respected):**

- gallery-config.ts:141: `if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') { return 'disabled'; }`
- `/api/search/semantic/route.ts:227`: `if (semanticMode !== 'stub' && semanticMode !== 'production') → 503`. With env flag absent, healer returns `'disabled'`, gate fires.
- `/api/search/similar/[id]/route.ts:97–104`: `semanticMode = config.semanticSearchMode; if (semanticMode !== 'production') → 503` with rate-limit rollback. With healing, `'disabled' !== 'production'` → 503. Fail-closed.

**H2 (bypass healer):**

- Both routes import `getGalleryConfig` from `@/lib/gallery-config`. Neither queries `admin_settings` directly.

**H3 (config-load failure):**

- similar/[id]/route.ts:97–103: `let semanticMode: 'disabled' | 'stub' | 'production' = 'disabled'; try { const config = await getGalleryConfig(); semanticMode = config.semanticSearchMode; } catch { /* fail closed */ }`. The catch keeps the safe `'disabled'` default.
- H3 is **disconfirmed**.

### Rebuttal Round

Strongest challenge: *Could `getGalleryConfig()` have a cross-request in-process cache that serves a stale `'production'` mode after the env var is removed from a running process?*

Counter: `getGalleryConfig` reads from the DB on each call; the resolver healing evaluation of `process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION']` happens at call time. The React `cache()` deduplication only applies within a single server-render request lifecycle (not across requests). No cross-request memoization was found in the gallery-config module.

### Current Best Explanation

The resolver healing is applied consistently on every `getGalleryConfig()` call. Both routes read through the healer. Fail-closed behavior is preserved even when config load throws.

**Severity: no confirmed defect.**

### Critical Unknown

Whether `getGalleryConfig()` has any cross-request memoization that could carry a stale `'production'` mode across requests in a long-lived Node.js process.

### Discriminating Probe

`grep -n "cache\|memoize\|singleton\|_cached\|module.*config" apps/web/src/lib/gallery-config.ts` to confirm no cross-request memoization layer exists.

---

## Cross-Flow Synthesis

### Convergence / Separation Notes

All six flows were traced independently. None converged to the same root cause. Each flow was found to be sound under the current codebase state.

The two recurring bug classes were not found to have new instances in any of the six flows:

- **NaN-survives-relational-comparison**: `cleanNumber`, `normalizeExposureTime`, and the cycle-15 GPS fix account for every numeric EXIF path. The only residual is the `iso float→int` silent MySQL truncation (not a relational hazard) and the `exposure_time` `"NaN,NaN"` varchar oddity (display-only, not queried numerically).
- **Fix-one-sibling-miss-the-next**: `COLOR_IMPACTING_KEYS` contains `sdrJpegChroma` (confirmed wired end-to-end). Sidecar and in-app runner column sets are in parity. Advisory-lock asymmetry (per-image lock in runner, not in sidecar) is intentional and safe due to row-set disjointness.

### Summary Table

| Flow | Verdict | Severity | Key Evidence Location |
|------|---------|----------|-----------------------|
| 1. EXIF numeric NaN | SOUND | iso float→int coercion: VERY LOW | process-image.ts:1423–1425, :1407, :1455 |
| 2. Queue claim/orphan | SOUND | none | image-queue.ts:339,435; admin-backfill-runner.ts:343–358; backfill-color-pipeline.ts:37–38 |
| 3. View-count flush/SIGTERM | SOUND | none | instrumentation.ts:36–42; data.ts:68–215 |
| 4. Settings-hash ETag | SOUND | static-path gap is documented CRT-D1 | settings-hash.ts:42–54; process-image.ts:1003,1098 |
| 5. Backfill parity | SOUND | none | backfill-color-pipeline.ts:412–422; admin-backfill-runner.ts:562–571 |
| 6. Semantic search healing | SOUND | none | gallery-config.ts:141; similar/[id]/route.ts:97–104 |

### Observations for the Planner

1. **No new defects found.** Cycle 16 enters the plan phase with all six traced flows clean.

2. **Per-image lock coverage test gap** (Flow 5, LOW): `acquireImageProcessingClaim` lock-held path in the in-app runner has no unit-test coverage for the `skippedLocked` increment. Low effort to close.

3. **`exposure_time` can receive `"NaN,NaN"` string** (Flow 1, VERY LOW): pathological `[NaN, NaN]` exif-reader output produces a visible artifact in the admin EXIF display. Not a relational hazard. Can be closed in `normalizeExposureTime` by returning `null` when the result does not match `/^\d+\/\d+$|^\d+(\.\d+)?$/`.

4. **`COLOR_IMPACTING_KEYS` completeness is author-enforced with no checklist anchor** (Flow 4, LOW): the compile-time guard catches typos or removals but cannot catch forgotten new byte-impacting keys. Adding a `// COLOR_IMPACTING_KEYS — must include this key if it changes derivative bytes` comment annotation at each byte-impacting admin setting declaration would surface the obligation at the write site.

5. **15-second SIGTERM timeout adequacy** (Flow 3, LOW): if `viewCountBuffer` is large during a high-traffic moment and the DB write is slow, the timeout fires and exits with code 1. Production monitoring should alert on container exit code 1 (distinct from code 0 clean shutdown).

---

*Tracer agent — cycle 16 complete. Zero confirmed defects in the six traced flows.*
