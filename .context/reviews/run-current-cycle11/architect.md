# Cycle 11 — architect

Reviewed HEAD: `7e40e95c` (2026-07-18)

## Inventory and coverage

I mapped the full repository into its architectural boundaries: routes/actions, data projections, 116 library modules, 61 components, 370 unit-test/fixture files, 29 scripts, 16 E2E specs, 35 migration/journal artifacts, and deployment/runtime documentation. Cross-boundary checks covered schema ↔ migration ↔ reconcile ↔ journal, encoder ↔ persisted metadata ↔ public projection ↔ HTML candidates, upload/restore/background writer fencing, admin/public privacy types, setting validation/snapshots/cache invalidation, server/client imports, rate-limit ownership, service-worker/static serving, bind-mounted persistence, and release-plan state. The prior review corpus was indexed and current/open authoritative records were read to distinguish new violations from carry-forward items.

## Finding ARCH-C11-01 — the derivative metadata abstraction conflates source ceiling and delivered maximum

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; agrees with CODE-C11-01**
- Regions: producer `apps/web/src/lib/process-image.ts:1044-1046,1214-1219,1366-1377,1462-1465`; schema `apps/web/src/db/schema.ts:79-85`; query projection `apps/web/src/lib/data.ts:294-302`; consumer `apps/web/src/lib/image-url.ts:96-145`; documented contract `CLAUDE.md:189-190`.
- Evidence: `processingBaseWidth` is the source/WI-15 processing ceiling. The derivative maximum is a different value: the smaller of that ceiling and the largest configured alias. The new column and return name promise the second concept but store the first. Current rendering stays correct only because the consumer independently applies the configured ladder, a hidden two-module invariant.
- Concrete failure: a future API consumer can use the public `derivative_max_width=10000` to promise a 10,000 px download even though the encoder's largest/base output is 7,680 px. A future refactor that emits a terminal candidate directly from the field can recreate the false-descriptor bug Cycle 10 intended to close.
- Fix: model and name the two dimensions separately or persist only the real delivered maximum. Centralize derivation in the encoder result and prove producer-to-file-to-consumer equivalence with an encode-and-inspect test.

## Finding ARCH-C11-02 — migration 0031 fired the deferred DB-convergence trigger without supplying the proof

- Severity: **High (test-infrastructure/schema-safety risk; no current drift confirmed)**
- Confidence: **High**
- Status: **Confirmed open trigger; requires DB-backed validation**
- Regions: trigger record `.context/plans/cycle-19-2026-07-08-deferred.md:13-20` and consolidated register `.context/plans/deferred-carry-forward.md:223-227,252-256`; new migration `apps/web/drizzle/0031_derivative_max_width.sql:1-2`; reconcile mirror `apps/web/scripts/migrate.js:433-475`; existing source-only test `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19,76-103`.
- Evidence: the preserved High/High finding says its exit criterion is the next migration/schema authoring cycle. Migration 0031 is that cycle. The new column is mirrored textually and all unit tests pass, but the test explicitly describes itself as a source tripwire that cannot validate types/defaults or executable convergence. No disposable-MySQL fresh/legacy schema diff was added or recorded.
- Concrete failure: a future or current DDL mismatch can pass because the column name appears in executable `migrate.js` while its nullability/type/default/order or baseline execution differs. The exact historical failure class left fresh/legacy databases green at deploy but structurally incomplete until their first application write.
- Fix: honor the fired trigger now: run `migrate.js` against disposable fresh and representative legacy MySQL schemas, compare `information_schema` (columns, types/defaults/nullability, indexes, and foreign keys) with the Drizzle contract, and make the proof repeatable in CI/nightly or a documented schema-authoring gate. Once green, retire/update `C19-07`/`C20-28` in the carry-forward register rather than silently aging them.

## Final missed-issue sweep

I rechecked persistence mounts and deploy prune ordering, single-writer boundaries, migration journal monotonicity, public/privacy projection symmetry, background connection ownership, restore quiescence, configuration snapshot ownership, and all responsive-delivery sinks. Journal entry 31 is monotonic and the reconcile name mirror is present. No additional architectural drift met the evidence threshold.
