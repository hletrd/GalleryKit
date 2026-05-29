# Test Engineer Review — Run-2 Cycle 1 (HEAD eaee58dc)

Baseline: 154 files / 1478 tests passing. Angle: coverage gaps tied to real risk.

## TST-01 — No test asserts the backfill UPDATE column set, so ARCH-01 `avif_10bit` drift went undetected (MED, High confidence)

**File:** `apps/web/src/__tests__/backfill-color-pipeline.test.ts` has ZERO `avif_10bit` assertions (grep count 0). The script's `reprocessRow` / `flushBatch` omit `avif_10bit` (ARCH-01 / CR-01) and nothing catches it. The in-app runner persists it. **The right test:** a fixture test that asserts BOTH backfill paths persist the SAME column set as the normal upload path (`image-queue.ts:368`) — i.e. `pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit`. This is the test that would have caught the drift and prevents recurrence (mirrors the existing `data-tag-names-sql.test.ts` contract-locking pattern). Add after the ARCH-01 fix lands.

## TST-02 — `getTopSharedGroupsByViews` has no test at all (LOW, High confidence)

**File:** `src/__tests__/analytics.test.ts` exists but does not reference `getTopSharedGroupsByViews` / `TopSharedGroupRow` (grep: NONE). The function is untested: window boundaries (30d/90d/all → `windowStart` null vs date), the `bot=false` filter, the `groupId → key` join, empty-result mapping, and `Number(viewCount)` bigint coercion. **The right test:** mirror the existing `getTopTopicsByViews` test (if present) with a mocked `db.select` chain asserting the where-clause shape per window and the row mapping. LOW because the query is simple and structurally identical to tested siblings, but it's net-new public API with zero coverage.

## TST-03 — Runner detection-failure version-bump behavior is untested (MED, High confidence — pairs with DBG-01)

**File:** `admin-backfill-runner-leak.test.ts` covers the leak/early-throw paths well, but NOT the per-row `reprocessOne` detection-failure branch (lines 253-263) that strands `pipeline_version = 7` with stale color columns (DBG-01 / CVT-01). **The right test:** mock `processImageFormats` to succeed and `detectColorSignals` to throw, then assert the UPDATE issued does NOT advance `pipeline_version` (after the DBG-01 fix) — i.e. lock the corrected resume semantics so a future change can't re-introduce the stranding. Add alongside the DBG-01 fix.

## Clean / well-covered
- `icc-chromaticity.test.ts`: chad path well covered (19 refs to chad/invert3x3/readChadMatrix) including malformed-tag and preset-match cases. Good.
- `admin-backfill-runner-leak.test.ts`: getGalleryConfig-throw leak path + state-poisoning recovery both asserted. Strong.
- `process-image-post-encode-verification.test.ts`: covers `verifyAvifNclxInBuffer` / `verifyWebpIccInBuffer` including the matrix-mismatch branch.
- `touch-target-audit.test.ts`: extended to the (public) route group this cycle; multi-line Button normalization in place.
- `privacy-fields.test.ts`: SENSITIVE_KEYS fixture matches `_PrivacySensitiveKeys`; `avif_10bit` correctly NOT listed (intentional public field).
