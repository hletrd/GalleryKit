# Cycle 61 Test Engineer / Verifier Review

Reviewed migration tests, restore/source contracts, route source contracts, high-risk source-grep fixtures, and gate wiring at HEAD `7e85644e`.

## Findings

### C61-03 - Orphan migration SQL files can pass tests but never deploy

- Severity: Medium
- Confidence: High
- File/line: `apps/web/src/__tests__/migration-journal.test.ts:37`, `apps/web/src/__tests__/migration-journal.test.ts:108`, `apps/web/scripts/migrate.js:787`
- Problem: The journal integrity test asserts every journal tag has a matching SQL file, but explicitly does not assert the reverse direction. A new `apps/web/drizzle/*.sql` file omitted from `meta/_journal.json` can pass tests while never being applied by Drizzle or the hash-baseline path.
- Failure scenario: a developer adds a migration SQL file and updates schema/reconcile, forgets `_journal.json`, and production already has all known journal hashes. Deploy sees no missing journal hash, so the new SQL never runs.
- Fix: add a reverse test that every top-level `drizzle/*.sql` basename appears in `_journal.json`.

### C61-06 - Shared-group view-count flush race logic lacks behavioral coverage

- Severity: Medium
- Confidence: High
- File/line: `apps/web/src/__tests__/data-view-count-flush.test.ts:13`, `apps/web/src/lib/data.ts:75`, `apps/web/src/lib/data.ts:111`, `apps/web/src/lib/data.ts:186`
- Problem: Current tests inspect source-shape invariants rather than exercising swap/drain/re-buffer/re-arm timing.
- Failure scenario: a refactor preserves matched strings while changing promise timing or retry behavior, stranding or dropping shared-group view increments under DB slowness.
- Fix: add behavioral tests with mocked `db.update(...).set(...).where(...)`, fake timers, in-flight drains, and failed-write re-buffer assertions.

### C61-07 - Lightroom upload route remains mostly source-contract covered

- Severity: Medium
- Confidence: Medium
- File/line: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:384`, `apps/web/src/app/api/admin/lr/upload/route.ts:488`
- Problem: The route owns PAT auth, quota settlement, GPS stripping, HDR rejection, DB insert, and enqueue behavior, but the focused route tests are mostly source-contract checks.
- Failure scenario: a route-level integration regression leaks GPS originals, fails to settle upload quotas, or accepts a wrong-scope token while regex checks still pass.
- Fix: add handler-level unit coverage with mocked token auth, save/GPS helpers, DB insert, and enqueue for wrong-scope, GPS-failure, HDR-disabled, and success cases.

## Validation Notes

The lane reported the guard scripts and 15 targeted Vitest files passing (`356` tests). Full cycle gates still need to run after implementation.
