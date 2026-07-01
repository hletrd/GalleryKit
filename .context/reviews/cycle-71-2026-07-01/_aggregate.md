# Cycle 71/100 Aggregate Review

Start HEAD: `bf86f7c176ecb1ed542d851bfa0e76e2b9d73cd5`.

## Review Inputs

- `code-quality-security.md`
- `perf-concurrency.md`
- `docs-config-deploy.md`
- `architecture-tracing.md`
- `test-verifier.md`
- `ui-photographer.md`
- Main-lane review of Cycle 70 plan/index drift, durable restore-maintenance sidecar coverage, public-route/admin-route scanner siblings, and Cycle 70 source fixes.

Native subagent capacity allowed five concurrent review lanes. The sixth requested UI/photographer lane hit the environment thread limit, so that scope was covered in the main lane.

## Deduplicated Findings

### C71-01 - Sidecar backfills can mutate the DB while durable restore maintenance is active

- Severity/confidence: Medium / High.
- Cross-agent agreement: architecture/tracing lane; main-lane verification.
- File/line:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:508-539`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:731-746`
  - `apps/web/scripts/backfill-clip-embeddings.ts:115-123`, `:160-214`
  - `apps/web/scripts/backfill-color-pipeline.ts:335-352`, `:365-371`, `:437-473`
- Evidence: failed restore import or post-restore migration keeps the durable marker active, but the restore finally path releases advisory locks. The color and CLIP sidecar backfills only check their advisory locks and can continue into row selection / writes while the durable marker is active.
- Failure scenario: a partially restored database is intentionally frozen for recovery, then a manual or scheduled sidecar writes embeddings or color-pipeline columns into that partial state.
- Fix direction: expose a script-safe durable restore-maintenance assertion and call it before lock acquisition, after lock acquisition, and before sidecar batch writes/upserts.

### C71-02 - Disk-recovery runbook hardcodes the deploy SSH target

- Severity/confidence: Medium / High.
- Cross-agent agreement: docs/config/deploy lane; main-lane verification.
- File/line: `CLAUDE.md:469`, `CLAUDE.md:481-483`; policy context `AGENTS.md:18`.
- Evidence: the runbook states deploy target is config-owned by `.env.deploy`, but the emergency disk-recovery snippet uses `ssh ubuntu@atik.kr`.
- Failure scenario: a future configured deploy host/user/key diverges from the documentation, and an operator uses the wrong SSH target during a disk-full recovery.
- Fix direction: replace the hardcoded host/user with config-derived instructions using `DEPLOY_USER`, `DEPLOY_HOST`, and optional `DEPLOY_KEY`.

### C71-03 - Runtime env template omits `DB_SSL_CA`

- Severity/confidence: Low / High.
- Cross-agent agreement: docs/config/deploy lane; main-lane verification.
- File/line: `apps/web/.env.local.example:9`; supporting docs `README.md:148`, `apps/web/README.md:50`, behavior `apps/web/src/lib/mysql-cli-ssl.ts:18-20`.
- Evidence: docs describe the non-local DB TLS CA requirement, but the copied env template only shows the `DB_SSL=false` escape hatch.
- Failure scenario: backup/restore fails closed for a non-local DB because the operator copied the example without seeing the CA variable.
- Fix direction: add a commented `DB_SSL_CA=/path/to/ca.pem` example adjacent to `DB_SSL`.

### C71-04 - Semantic embedding snapshot contract is stale and mostly source-string based

- Severity/confidence: Medium / High.
- Cross-agent agreement: test/verifier lane; main-lane verification.
- File/line:
  - `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:23-35`
  - `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:57-61`
  - `apps/web/src/app/actions/images.ts:543-546`
  - Runtime behavior: `apps/web/src/lib/image-queue.ts:738-752`
- Evidence: runtime embedding writes resolve current semantic mode, but upload action comments still claim the worker reuses the upload-time semantic snapshot to avoid a DB read. The test coverage is mainly source-string based.
- Failure scenario: future refactor reintroduces stale snapshot use with different syntax and the existing source-string guard still passes.
- Fix direction: update stale wording and add focused behavior coverage proving a `production` job snapshot cannot call the real encoder when the current runtime gate heals production to disabled.

### C71-05 - Cycle 70 plan/index still mark a completed pushed/deployed cycle as active

- Severity/confidence: Low / High.
- Cross-agent agreement: main-lane review.
- File/line:
  - `.context/plans/cycle-70-2026-07-01-plan.md:42-79`
  - `.context/plans/README.md:5-11`
- Evidence: HEAD `bf86f7c1` is the signed Cycle 70 commit and the user supplied it as the deployed master HEAD, but the Cycle 70 plan still has commit/deploy checkboxes unchecked and the plan index still lists Cycle 70 as active.
- Failure scenario: later cycle workers treat completed Cycle 70 work as open or misread the deployment baseline.
- Fix direction: mark Cycle 70 commit/push/deploy complete and update the plans index so Cycle 71 is active and Cycle 70 is recent/completed.

## Scheduled This Cycle

`C71-01` through `C71-05` are scheduled. No new security, correctness, or data-loss source finding is deferred.

## Deferred / Not Scheduled

No new Cycle 71 finding is deferred. Carry-forward deferred items remain tracked in `.context/plans/cycle-71-2026-07-01-deferred.md`.

## Agent Failures / Deviations

- Requested reviewer-role agents such as `code-reviewer`, `security-reviewer`, `perf-reviewer`, and `designer` were not exposed as callable native roles in this environment. Available roles were `default`, `explorer`, and `worker`, so review slices ran through `default` lanes.
- The sixth review lane spawn hit the native thread limit. Its UI/photographer scope was covered in the main lane.
- Browser UI review was not run because the repo's configured browser flows can mutate DB-backed analytics/admin state; source-level UI review and existing touch-target/unit gates cover this narrow cycle.

## Disposition

Five new findings, all scheduled. No new deferred security/correctness/data-loss item.
