# Test Engineer — Run-2 Cycle 2 (HEAD 317126cf)

Angle: test coverage gaps, contract locks.

## TST2-01 — No test locks the backfill detection-FAILURE column set on either path (MED-enabling, High) ⭐ bundles with CR2-01

The cycle-1 contract test `backfill-color-pipeline.test.ts:146-196` ("AGG-02:
reprocess signals include avif_10bit") only asserts the SUCCESS path column set.
The detection-failure branch (`reprocessRow :163-168`, returns `processed` with
NO signals) is unguarded — which is exactly how the CR2-01 divergence slipped
in. Mirror the contract-lock pattern (`data-tag-names-sql.test.ts`):
- script: mock `detectColorSignals` to reject after a successful encode; assert
  the reprocess result still carries the derivative-only columns
  (`avif_10bit`, `was_downscaled`) so `flushBatch` persists them.
- runner: an analogous assertion that the detection-failure UPDATE writes the
  same two derivative columns (extends `admin-backfill-runner-detection-failure.test.ts`).

This is the MED-enabling test that, had it existed, would have caught CR2-01.
Bundle it with the CR2-01 fix.

## TST2-02 — `getTopSharedGroupsByViews` still has zero tests (LOW, High) — carryover DEF-08

`analytics-data.ts:142-167`; `analytics.test.ts` has no coverage. Carryover from
cycle-1 DEF-08; query is structurally identical to tested siblings
(`getTopTopicsByViews`, `getCountryBreakdown`). Exit criterion unchanged: add on
any logic change or in a dedicated analytics-test-hardening pass. Not scheduled
this cycle (risk low; priority goes to the MED detection-failure contract).

## Verified clean
- Cycle-1 regression test `admin-backfill-runner-detection-failure.test.ts`
  exists and locks the runner's `pipeline_version`-stays-behind behavior (194
  lines). Working as intended.
- Full suite green: 155 files / 1480 tests.
