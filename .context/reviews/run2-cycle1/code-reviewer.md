# Code-Reviewer Review — Run-2 Cycle 1 (HEAD eaee58dc)

Angle: code quality, logic, error handling, edge cases, maintainability. Faithful-delivery surface — no feature proposals.

## CR-01 — `avif_10bit` not refreshed by the operator backfill script → stale public field (MED, High confidence)

Cross-reference ARCH-01. Concretely in `apps/web/scripts/backfill-color-pipeline.ts`:
- `ReprocessSignals` (lines 66-75) lacks `avif_10bit`.
- `reprocessRow` (line 122) reads `result.wasDownscaled` but discards `result.avif10bit`.
- `flushBatch` UPDATE (lines 267-279) omits `avif_10bit`.

The in-app runner (`admin-backfill-runner.ts:199, 250, 260`) and the upload path (`image-queue.ts:368`) both write it. `avif_10bit` is **public** (`data.ts:252-254`). Result: running the documented sidecar script leaves the public delivered-bit-depth value stale while the in-app button writes it correctly. **Fix:** capture `avif10bit` and add it to the script's signals + UPDATE.

## CR-02 — Runner uses per-row UPDATE; script batches in a transaction — runner is slower and non-atomic but acceptable (LOW, High confidence)

`admin-backfill-runner.ts:238-263` issues one `db.execute(UPDATE …)` per image, while the script batches 100 rows per transaction (`flushBatch`). For a large library (thousands of photos) the runner generates thousands of individual round-trips on the shared 10-connection pool while the live site is serving. Not a correctness bug (each row is independent), but it pressures the pool during the run. Documented concurrency cap (default 1) limits parallelism, mitigating contention. **Note for perf-reviewer** (see PERF-02). No fix required for correctness.

## CR-03 — `reprocessOne` detection-failed branch still advances `pipeline_version` but leaves color columns stale (LOW, Medium confidence)

`admin-backfill-runner.ts:253-263`: when `detectColorSignals` throws, the runner still UPDATEs `pipeline_version = 7` + `was_downscaled` + `avif_10bit`, but leaves `icc_profile_name`/`color_primaries`/`transfer_function`/etc. at their OLD values. The comment acknowledges this ("at least advance the pipeline_version so the next pass doesn't re-pick the row"). The consequence: a row that hit a transient detection failure is now PERMANENTLY at v7 with stale color metadata and will never be re-picked by a future backfill (selection is `pipeline_version < 7`). The script behaves identically (`reprocessRow` returns `{ outcome: 'processed' }` with no signals → no color UPDATE but no version bump either — actually the script does NOT bump version when signals is absent, see below). **This is a real divergence:** the script's detection-failed path returns `{ outcome: 'processed' }` with `signals: undefined`, and `flushBatch` only updates rows that HAVE signals (`if (result.signals) updateBatch.push(...)`), so the script does NOT advance `pipeline_version` on detection failure → the row IS re-picked next run. The runner advances it → the row is NOT re-picked. Confirmed contract drift in the failure path. **Fix:** make both paths consistent — preferably do NOT bump `pipeline_version` when detection failed so a retry can recover the color columns (the encode is idempotent).

## CR-04 — `void path;` dead-import retained with a justifying comment (INFO, High confidence)

`admin-backfill-runner.ts:393-397` imports `path` then `void path` to silence the unused-import lint. The comment justifies keeping it "for symmetry." This is harmless but is exactly the kind of dead code the repo's own anti-slop policy discourages. Low priority; could drop the import. Not blocking.

## CR-05 — Histogram RGB-mode clip math divides max-of-channels by red-channel total (INFO — not a bug, verified)

`histogram.tsx:345-352` and `669-672`: in RGB mode `total` is the red-channel sum and `belowBlack`/`aboveWhite` are `Math.max` across R/G/B bin[0]/bin[255]. Since every pixel contributes exactly one sample to each channel histogram, `sum(r) == sum(g) == sum(b) == pixelCount`, so dividing by the red total is arithmetically correct. Verified non-issue; recorded so a future reader doesn't "fix" it.

## Clean surfaces
- `analytics-data.ts`: window math, NULL handling (columns are NOT NULL DEFAULT), Number() coercion of counts all correct.
- `lightbox.tsx` Escape handler: closes color pip first, then lightbox (unless fullscreen) — correct modal-stack ordering; effect deps include `colorPipOpen` so no stale closure.
- `icc-chromaticity.ts` chad path: bounds-checked, det≈0 guarded, XYZ-sum-zero guarded.
