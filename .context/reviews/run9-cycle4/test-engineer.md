# Test Engineer Review — Run-9 Cycle-4

**HEAD:** `094842a4`
**Date:** 2026-06-18
**Scope:** Fixture-contract test correctness, flaky-test detection, new untested paths

---

## Summary

**Zero new defects. Convergence.**

All six requested fixture-contract tests were validated against their implementation targets. TE-R9C3-01 (upload-tracker-state isolation) is confirmed fixed. The three previously deferred items are unchanged — no new evidence to close or escalate them. The test suite is fully green.

---

## Gate State

```
npm test --workspace=apps/web
Test Files  224 passed | 2 skipped (226)
     Tests  2054 passed | 4 skipped (2058)
  Duration  26.77s
```

Zero failures. The 4 skipped tests are CLIP offline-load and CLIP semantic-integration tests gated on `CLIP_MODELS_ROOT` availability — expected and correct.

---

## Fixture-Contract Tests Validated

### 1. `upload-tracker-state.test.ts` (TE-R9C3-01 — already fixed)

Confirmed `beforeAll(() => { getUploadTracker().clear(); })` present at line 40, alongside the existing `beforeEach` clear. The docstring correctly explains both pool-model scenarios (cross-file via vmThreads/singleFork, within-file via forks). **FIXED. No issue.**

### 2. `view-retention.test.ts`

Validated the chunk-drain test (line 103-115) against `view-retention.ts` implementation:

- `limitMock` closure increments `n` globally across all 3 tables: n%2==1 → 5000 (full batch, continue), n%2==0 → 10 (partial, stop). This gives 2 batches per table × 3 tables = 6 total `limitMock` calls.
- The test only asserts the total return value `(5000 + 10) * 3 = 15030`, not the call count for the chunk test.
- The separate "bounded DELETE per table" test (line 93-101) asserts `deleteMock/whereMock/limitMock` each called exactly 3 times — using `affectedRowsRef.value=0` (one batch per table, immediately breaks).
- Implementation `view-retention.ts:78` breaks when `affected < VIEW_PURGE_BATCH`, matching test expectations exactly.
- `resolveRetentionMs` guard at line 44: `Number.isFinite(retentionDays) && retentionDays > 0` — correctly handles negative, non-finite (NaN), and zero. Test covers all three guard paths. **CORRECT.**

### 3. `backfill-color-pipeline.test.ts`

The AGG-02 9-column contract (`avif_10bit`, `color_pipeline_decision`, `color_primaries`, `has_gain_map`, `icc_profile_name`, `is_hdr`, `matrix_coefficients`, `transfer_function`, `was_downscaled`) matches `backfill-color-pipeline.ts:241-251` exactly. The `reprocessRow` function returns `signals` with exactly those keys in the success path. **CORRECT.**

### 4. `sanitize-for-og-global.test.ts`

`og-sanitize.ts` imports `stripUnicodeFormatting` from `@/lib/validation` and calls it (not `.replace(UNICODE_FORMAT_CHARS,` directly). The test pins all three consumers (api/og/route.tsx, api/og/photo/[id]/route.tsx, app/[locale]/(public)/p/[id]/page.tsx) importing from `@/lib/og-sanitize` and not calling the raw replacement directly. **CORRECT.**

### 5. `privacy-fields.test.ts`

The symmetric guard (`adminSelectFieldKeys − publicSelectFieldKeys === SENSITIVE_KEYS`) is sound:

- `avif_10bit` is in `adminSelectFields` (data.ts:275) but **NOT** in the omit/destructure block for `publicSelectFields` — so it flows into `publicSelectFieldCore` and is therefore public. It is absent from `SENSITIVE_KEYS` (20 items) in both the test and the `_PrivacySensitiveKeys` type union in data.ts. This matches CLAUDE.md: "avif_10bit ... public-safe (R10-M4)".
- The 20-item SENSITIVE_KEYS set in the test matches the 20-member `_PrivacySensitiveKeys` type union exactly.
- No drift between test and implementation. **CORRECT.**

### 6. `data-tag-names-sql.test.ts`

Pins `tagNamesAgg` GROUP_CONCAT shape, LEFT JOIN + GROUP BY usage in `getImagesLite`/`getImagesLitePage`/`getAdminImagesLite`, and that `getLatestImageForOgCached` is minimal (no tagNamesAgg/GROUP_CONCAT). Test has `{ timeout: 30000 }` on the drizzle-compiled-SQL test to prevent import-graph timeout flake. **CORRECT.**

### 7. `touch-target-audit.test.ts`

`KNOWN_VIOLATIONS` map was reviewed:
- `components/bulk-edit-dialog.tsx` is absent from the map entirely (defaults to 0 violations). The DES-R9C3-01 fix added `aria-label` attributes but did not change any size-class patterns — no KNOWN_VIOLATIONS entry needed. **CORRECT.**
- `components/image-manager.tsx: 1` — matches the documented `batchAddButton` DialogTrigger `size="sm"` without height override at ~:328. The other five historically-budgeted buttons now carry explicit h-11 overrides. Count is accurate.
- `components/admin-user-manager.tsx: 2` — two multi-line buttons (add + delete-user icon). Count consistent with documented rationale.
- All zero-count entries are documentation/visibility entries, not suppressions. **CORRECT.**

---

## Flaky Test Check

No new process-global state contamination vectors found. The only known global-state test was `upload-tracker-state.test.ts`, which is hardened. No time-dependent tests use real clocks; all use `vi.useFakeTimers()` with `afterEach(() => vi.useRealTimers())`.

---

## New Correctness Paths Since c2d3857a

`git diff c2d3857a..HEAD -- apps/web/src` shows **zero production source file changes**. Only two files changed:

1. `apps/web/src/__tests__/upload-tracker-state.test.ts` — test hardening (TE-R9C3-01)
2. `apps/web/src/components/bulk-edit-dialog.tsx` — aria-label additions (DES-R9C3-01)

The aria-label additions in bulk-edit-dialog.tsx are not logic paths and carry no behavioral test gap.

---

## Carried-Forward Deferred Items (unchanged, no new evidence)

| ID | Description | Status |
|----|-------------|--------|
| TE-R7C2-03 | Semantic route malformed-embedding row-skip (`filter((m): m is ... => m !== null)` at semantic/route.ts:279) has no behavioral test | DEFERRED — exit criterion: when semantic route gets a dedicated test file |
| TE-R7C2-04 | `logAuditEvent` metadata-truncation path untested | DEFERRED — low risk, admin-only audit surface |
| TE-R7C2-05 | `apps/web/src/app/actions/embeddings.ts` has no dedicated unit test | DEFERRED — covered by integration path |

---

## Conclusion

The six fixture-contract tests correctly pin their implementation targets. The test suite is fully green (2054 passed). TE-R9C3-01 is confirmed fixed. No new production code was introduced since cycle-3, so there are no new untested correctness paths. **Zero new defects — convergence.**
