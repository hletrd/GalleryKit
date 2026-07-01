# Cycle 61/100 Aggregate Review

Start HEAD: `7e85644e21a048c41279092f1ac1d29cc20e74e9` (`7e85644e`), identified by the Cycle 61 invocation as the current deployed `master` HEAD.

## Review Lanes

- `security-reviewer.md` - security/privacy and local secret-file posture.
- `code-reviewer.md` - correctness and maintainability.
- `perf-reviewer.md` - performance and UX/accessibility.
- `test-engineer.md` - test coverage and verification gaps.
- `architect-debugger-tracer.md` - restore, upload, OG, queue, sharing, semantic, and analytics flow tracing.
- `document-specialist.md` - deploy/docs/ledger drift.

## Findings

### C61-01 - OG routes bypass restore-maintenance

- Severity: Medium
- Confidence: High
- Cross-agent agreement: Architect/debugger/tracer flagged this; local source review confirmed the gap against existing public-page and semantic-route maintenance contracts.
- File/line: `apps/web/src/app/api/og/route.tsx:92`, `apps/web/src/app/api/og/photo/[id]/route.tsx:59`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts:27`
- Problem: `/api/og` and `/api/og/photo/[id]` can do DB/config/image work during restore maintenance while public pages and semantic routes short-circuit.
- Failure scenario: crawlers hit OG routes during a DB restore, racing table import/reconcile with DB reads and Satori/Sharp work instead of receiving a clean maintenance response.
- Fix: add `isRestoreMaintenanceActive()` guards before rate-limit charging and DB/config/image work; return `503` with no-store headers and add focused tests.

### C61-02 - Lightroom upload can query topic DB after restore starts but before the upload contract lock

- Severity: Low
- Confidence: Medium-High
- Cross-agent agreement: Architect/debugger/tracer flagged this; existing LR source-contract tests confirmed the entry and post-save guards but not the pre-topic-select lock ordering.
- File/line: `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:256`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`
- Problem: The PAT upload route can spend time parsing multipart after the entry maintenance guard, then query the topic table before acquiring the upload-processing contract lock.
- Failure scenario: restore begins after parse starts; the route can issue a DB `SELECT` during restore and return a generic upload error instead of restore-in-progress.
- Fix: after form validation, re-check restore maintenance and acquire the upload contract lock before the topic `SELECT`.

### C61-03 - Orphan migration SQL files can pass tests but never deploy

- Severity: Medium
- Confidence: High
- Cross-agent agreement: Test-engineer flagged this; local journal/file inventory confirmed current files happen to match, but the reverse invariant is not tested.
- File/line: `apps/web/src/__tests__/migration-journal.test.ts:37`, `apps/web/src/__tests__/migration-journal.test.ts:108`, `apps/web/scripts/migrate.js:787`
- Problem: The journal test only proves every journal entry has a SQL file; it does not prove every SQL file is journaled.
- Failure scenario: a developer commits `NNNN_*.sql` but forgets `_journal.json`; an already-baselined production DB never sees a missing journal hash, so the SQL never runs.
- Fix: add a reverse assertion for every top-level `drizzle/*.sql` basename.

### C61-04 - Cycle 60 terminal evidence is stale after signed/pushed/deployed fix commit

- Severity: Medium
- Confidence: High
- Cross-agent agreement: Documentation/deploy lane flagged this; `git log` and the Cycle 61 invocation confirmed `7e85644e` is current deployed `master`.
- File/line: `.context/plans/cycle-60-2026-07-01-plan.md:38`, `.context/plans/cycle-60-2026-07-01-plan.md:39`, `.context/plans/README.md:7`, `.context/reviews/_aggregate.md:3`
- Problem: Cycle 60 remains marked active/incomplete in committed ledgers after the fix commit was signed, pushed, and deployed.
- Failure scenario: later cycles repeat closed ledger work or treat the deployed baseline as uncertain.
- Fix: close Cycle 60 terminal progress and advance the active plan index/latest aggregate pointer to Cycle 61.

### C61-05 - Local runtime env file is group/world-readable

- Severity: Medium
- Confidence: High
- Cross-agent agreement: Security lane flagged this; local stat confirmed `apps/web/.env.local` mode was `-rw-r--r--`.
- File/line: `apps/web/.env.local` local metadata, `apps/web/deploy.sh:39`
- Problem: The ignored local runtime env file is readable by group/world, contrary to deploy policy.
- Failure scenario: local users or broad backup/sync scopes can read runtime secrets; deploy would refuse unsafe runtime env modes.
- Fix: tighten the local file mode to `0600`. Rotate contained secrets if this checkout is in a shared trust domain.

### C61-06 - Shared-group view-count flush race logic lacks behavioral coverage

- Severity: Medium
- Confidence: High
- Cross-agent agreement: Test-engineer flagged this as a test gap; no active source defect was confirmed.
- File/line: `apps/web/src/__tests__/data-view-count-flush.test.ts:13`, `apps/web/src/lib/data.ts:75`, `apps/web/src/lib/data.ts:111`, `apps/web/src/lib/data.ts:186`
- Problem: Current tests inspect source shape instead of behavior for swap/drain/re-buffer/re-arm timing.
- Failure scenario: a refactor preserves matched strings while dropping increments under DB slowness.
- Fix: add behavioral tests with mocked DB update chains and fake timers.

### C61-07 - Lightroom upload route remains mostly source-contract covered

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: Test-engineer flagged this as a test gap; no active source defect beyond C61-02 was confirmed.
- File/line: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:488`
- Problem: The route owns several high-risk behaviors but most tests are source-contract checks.
- Failure scenario: route integration can regress while regex checks still pass.
- Fix: add handler-level unit coverage for token scope, GPS-strip failure, HDR-disabled rejection, and success insert/enqueue.

## Deferred Findings

Cycle 61 defers only broad test-coverage gaps, recorded in `.context/plans/cycle-61-2026-07-01-deferred.md` with preserved severity and exit criteria. `C61-01`, `C61-02`, `C61-03`, `C61-04`, and `C61-05` are scheduled.

Carry-forward deferred items remain unchanged: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`.
