# Cycle 11 — tracer

Reviewed HEAD: `7e40e95c` (2026-07-18)

## Inventory and coverage

Starting from the full tracked inventory, I traced these end-to-end chains across all relevant files and tests: (1) image-size settings/normalization → upload snapshot → queue/backfill → encoder aliases/base file; (2) source/WI-15 dimensions → encoder result → schema/migration → public/timeline projection → every responsive sink; (3) migration journal cursor → reconcile/baseline → post-condition tests; (4) settings commit → detached invalidation → background readers; (5) session/PAT request → origin/scope/rate/restore gates → mutation; (6) image delete/restore → durable pending cleanup and background drains; and (7) signed git publication → active plan/carry-forward frontier. Historical findings were followed to their authoritative current status before being classified.

## Finding TRC-C11-01 — the width value changes meaning at the encoder return boundary

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed causal-chain break; cross-agent agreement with code/architecture/debugger**
- Regions: processing ceiling `apps/web/src/lib/process-image.ts:1087-1115`; configured render widths `apps/web/src/lib/process-image.ts:1214-1219`; base-file selection `apps/web/src/lib/process-image.ts:1366-1377`; return `apps/web/src/lib/process-image.ts:1462-1465`; public serialization `apps/web/src/lib/image-url.ts:106-145`.
- Trace: `processingBaseWidth` means “largest width the source/WI-15 intermediate permits.” The format loop then intersects that with the configured ladder, so “largest width actually delivered” is `min(processingBaseWidth,max(sortedSizes))`. At the return boundary the first meaning is relabeled `derivativeMaxWidth` and persisted as though it were the second. The serializer independently applies the ladder, which masks the inconsistency in current HTML but does not repair the stored/public contract.
- Concrete failure: source 10,000 → processing ceiling 10,000 → configured maximum 7,680 → base/sized bytes 7,680 → DB/public value 10,000. The causal chain contains no later correction.
- Fix: compute the delivered maximum once at the producer boundary, return/persist that exact value, and assert it against decoded files in an integration test.

## Finding TRC-C11-02 — the schema-safety trace ends at source-text presence

- Severity: **High (validation infrastructure; manual/runtime DB proof required)**
- Confidence: **High**
- Status: **Confirmed fired carry-forward exit criterion, not confirmed schema drift**
- Regions: migration `apps/web/drizzle/0031_derivative_max_width.sql:1-2`; journal `apps/web/drizzle/meta/_journal.json:222-227`; reconcile `apps/web/scripts/migrate.js:433-475`; source test `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19,95-103`; trigger `.context/plans/cycle-19-2026-07-08-deferred.md:19`.
- Trace: schema change → journal entry → reconcile name mirror → comment-stripped source test all succeed. The chain stops before executing either a fresh or legacy database and comparing `information_schema`. The authoritative deferred record explicitly said the next schema authoring cycle reopens this work; 0031 satisfies that condition.
- Concrete failure: name-presence remains green if executable DDL carries the wrong type/default/nullability or if baseline/reconcile ordering produces a different live schema. Such drift is only discovered later by application behavior or a manual operator inspection.
- Fix: add/record a disposable-MySQL convergence run for fresh and legacy starts and make it the schema-authoring proof; then close the fired carry-forward rows with that evidence.

## Final missed-issue sweep

I retraced every `sizedImageSrcSet` caller, both custom projections, all three persistence sites, queue and backfill failure branches, migration cursor monotonicity, detached config ownership, auth/restore barriers, privacy field derivation, and deploy persistence assumptions. No alternative later-stage width correction exists. Other historical chains remain either fixed or behind explicit unfired operator/product thresholds and were not repeated.
