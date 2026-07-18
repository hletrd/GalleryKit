# Cycle 11 — debugger

Reviewed HEAD: `7e40e95c` (2026-07-18)

## Inventory and coverage

I used the complete implementation/script/migration/test inventory and traced failure paths rather than sampling files. The pass covered upload admission and original cleanup, queue claim/retry/permanent failure, three-format encode/rollback, backfill success/detection-failure/delete-mid-reencode branches, delete/pending cleanup, restore drain/resume, detached-config invalidation, responsive rendering/fallback, parser bounds, timers, shutdown, and DB/filesystem partial-commit windows. I inspected all new code and tests since Cycle 10 and tested competing hypotheses against source.

## Finding DBG-C11-01 — large sources deterministically produce a false persisted maximum

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed, deterministic; same root as CODE-C11-01**
- Regions: `apps/web/src/lib/process-image.ts:1044-1046,1214-1219,1366-1377,1462-1465`; persistence sites `apps/web/src/lib/image-queue.ts:880-923`, `apps/web/src/lib/admin-backfill-runner.ts:552-665`, and `apps/web/scripts/backfill-color-pipeline.ts:234-315,507-530`; incomplete helper-only coverage `apps/web/src/__tests__/image-url.test.ts:110-159`.
- Competing hypotheses: (a) the base file may preserve the full source width — disproved at lines 1366-1377, where it is linked from the largest configured sized output; (b) Sharp may upscale/retain width — disproved by `resizeWidth=min(processingBaseWidth,size)`; (c) the return may cap elsewhere — disproved by the direct `processingBaseWidth` return and three direct persistence paths; (d) tests may inspect the producer result — the new tests exercise helper literals and a 1,200 px browser fixture, not a source wider than the largest configured size.
- Concrete failure: a 10,000 px input with a largest configured size of 7,680 returns and stores 10,000 although decoding every largest/base output yields 7,680. The bad value survives successful upload and both re-encode entry points.
- Fix: cap the returned maximum to the last normalized size, add a real wide-source encode regression, and assert all three persistence paths store the inspected maximum.

## Migration validation risk

The new column is present in migration, journal, schema, and reconcile source, so I did not claim a current migration runtime failure. However, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` explicitly cannot verify structural convergence, and the prior High/High trigger at `.context/plans/cycle-19-2026-07-08-deferred.md:19` has fired. The architect/tracer files record this as a confirmed validation obligation requiring disposable-MySQL execution.

## Final missed-issue sweep

I retraced encode rollback after sibling failure, base-link fallbacks, detection failure after successful bytes, zero-row updates after deletion, queue retry bookkeeping, WI-15 legacy null fallback, cache invalidation, restore marker races, and pending cleanup. The detached-config alias removal is safe because ownership is now promise-identity based. No second reproducible runtime bug met the filing threshold.
