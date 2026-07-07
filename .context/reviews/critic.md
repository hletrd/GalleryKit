# Cycle 22 Critic Review

Date: 2026-07-08 KST
Role: `critic`
Review HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Scope: multi-perspective critique of the whole current change surface and residual assumptions. Review-only: no fixes implemented.

## Inventory

Guidance and lineage inspected first:
- `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.
- Prior top-level review reports and aggregate.
- Current Cycle 21 implementation/deferred/carry-forward ledgers.
- Cycle 21 commit metadata and current `origin/master` status.

Repository categories examined:
- Product/runtime source: 81 app files, 115 lib files, 61 component files.
- Verification source: 364 unit/source-contract tests and 12 E2E files.
- Operational source: 29 scripts, 34 migration/schema files, Docker/deploy/nginx configs.
- Public/admin workflows: upload, LR/PAT upload, delete/cleanup, restore/backup, image processing, backfill, semantic/similar search, map/timeline/shared group, admin dashboard/settings/tokens.
- Docs/ledger surfaces: `CLAUDE.md`, `README.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, and current plan/deferred files.

Validation evidence:
- Current HEAD is `8b795862079b0e5318242a09390b4cdff1dc2058`.
- Custom security lint gates passed: API auth, action-origin/mutation-barrier, public route rate-limit.
- `npm run typecheck --workspace=apps/web` passed.
- Focused tests passed for pending-file-deletion source contracts, MySQL datetime parsing, action-origin scanner, and public-route scanner.

## Fixed Prior Findings

- Cycle 21's mutation-barrier scanner gap is fixed and gate-verified.
- Cycle 21's permanent-failure cap bypass is fixed by routing add sites through `markPermanentlyFailed`.
- Cycle 21's backfill candidate index and deterministic datetime parser landed.
- Cycle 21's docs/i18n/a11y small defects landed.
- The suspected `pending_file_deletions` restore allowlist gap is not current: `APP_BACKUP_TABLES` includes it (`apps/web/src/lib/sql-restore-scan.ts:12-32`), with a schema-superset test (`apps/web/src/__tests__/sql-restore-scan.test.ts:163-190`).

## Current Critique Findings

### CRIT22-01 - Durable cleanup state is not yet an actual cleanup system

- Severity: High
- Confidence: High
- Status: Confirmed
- Region: `apps/web/src/lib/pending-file-deletions.ts:70-90`; `apps/web/src/app/actions/images.ts:714-727`, `864-907`; `apps/web/src/lib/maintenance-scheduler.ts:34-45`; `apps/web/src/components/image-manager.tsx:142-148`, `171-179`.
- Critique: Cycle 21 turned file-delete failures from pure log loss into durable DB rows, but stopped before the important product invariant: "deleted photos stop being served." The current system records an orphan cleanup failure, warns the admin, and then has no replay worker, no admin table, and no operator command.
- Failure scenario: a transient filesystem error leaves a public derivative in `public/uploads` after the image row is gone. The ledger row remains, but known static URLs continue serving bytes until a human manually notices logs and writes cleanup tooling.
- Concrete fix: make `pending_file_deletions` a real outbox: scheduled replay, backoff/attempt policy, admin visibility, and behavioral tests. Consider serving-layer tombstones if public derivative privacy is the invariant.

### CRIT22-02 - Cycle 21 release/deploy evidence is still internally inconsistent

- Severity: Medium
- Confidence: High
- Status: Confirmed ledger issue
- Region: `.context/plans/cycle-21-2026-07-08-plan.md:1-6`, `221-240`; `.context/plans/README.md:34-37`; commit `8b795862` trailer `Not-tested: Production deploy pending until after signed commit is pushed per DEPLOY_MODE=per-cycle`.
- Critique: The plan index says Cycle 21 includes gates, push, and per-cycle deploy, but the authoritative plan still says commit/push/deploy pending and WP9 is in progress. The commit trailer also says production deploy is pending. That is acceptable as an honest state, but it means Cycle 21 is not complete under the repo's per-iteration deploy policy.
- Failure scenario: Cycle 22 planning assumes the source is deployed because HEAD is pushed and the index says "per-cycle deploy," while production is still at an older commit. Review findings then mix source-state and deployed-state assumptions.
- Concrete fix: update the Cycle 21 ledger with push/deploy/smoke evidence or explicitly mark deploy supersession by the next successful deploy. Add a mechanical check that terminal plan status cannot say completed/deployed unless the current commit appears in deploy evidence.

### CRIT22-03 - Upload parity remains a structural defect class, not a one-off bug

- Severity: High
- Confidence: High
- Status: Confirmed recurring risk
- Region: `apps/web/src/app/actions/images.ts:87-227`, `325-445`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`, `254-631`.
- Critique: The LR route contains several comments explaining previous parity misses with the browser upload path. The code now mirrors many details, but that mirroring is manual. The architecture still invites the next drift.
- Failure scenario: a new upload setting or privacy rule is added to browser upload and forgotten in PAT upload. External publisher uploads then bypass the intended invariant.
- Concrete fix: move ingest into a shared service with transport adapters. Treat "two upload paths implement the domain contract" as the smell, not the individual drift instances.

### CRIT22-04 - Source-contract tests are doing too much safety work

- Severity: High
- Confidence: High
- Status: Confirmed test-design risk
- Region: `apps/web/src/__tests__/pending-file-deletions-source.test.ts:25-45`; `apps/web/src/__tests__/sql-restore-scan.test.ts:163-190`; prior source-contract patterns in migration/reconcile/search/restore tests; `apps/web/scripts/migrate.js:348-502`.
- Critique: Source scans are useful tripwires, but many safety-critical guarantees still depend on text presence rather than executable behavior. Cycle 21's pending-deletion test proves the ledger exists and rows are retained, yet it does not prove a retry path exists. Similar patterns exist in schema/reconcile and restore child-process coverage.
- Failure scenario: a refactor keeps expected strings while runtime behavior changes, or a new table/column is mirrored by name but with wrong type/default. The tests stay green until a production migration/restore/delete path hits the mismatch.
- Concrete fix: keep source contracts as lint-like checks, but add behavioral tests for new invariants: disposable MySQL schema convergence, pending cleanup replay, child-process failure ordering, and route-level expensive-work caps.

### CRIT22-05 - Single-process background work has no global budget owner

- Severity: Medium
- Confidence: High
- Status: Confirmed design risk
- Region: `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `716-727`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/db/index.ts:21-45`.
- Critique: The repo repeatedly solves local overload with local caps. Queue, backfill, semantic scans, public SSR, and CLIP all share one process and one DB pool, but there is no central admission control for heavy work.
- Failure scenario: an admin runs backfill while uploads process and visitors hit semantic/similar search. Each component is bounded locally, yet the aggregate workload consumes pool, CPU, and heap headroom.
- Concrete fix: introduce a shared heavy-work budget with named token classes for DB slots, Sharp/libvips work, CLIP inference, and large-body parsing. Make admin UI/status show which subsystem owns the tokens.

### CRIT22-06 - Public dynamic discovery remains request-local and scale-sensitive

- Severity: Medium
- Confidence: High
- Status: Risk
- Region: `apps/web/src/app/actions/public.ts:247-329`; `apps/web/src/lib/data.ts:1574-1816`; `apps/web/src/app/api/search/semantic/route.ts:263-311`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`; `apps/web/src/lib/smart-collections.ts:221-267`.
- Critique: Public keyword search, map payloads, smart collections, semantic search, and similar-photo search all run in the request process with bounded but still linear or scan-heavy work. The limits are pragmatic for a personal gallery, but they are not a durable scaling architecture.
- Failure scenario: a larger corpus or modest traffic burst stays inside rate limits yet degrades normal browsing and background work.
- Concrete fix: move keyword search to full-text/search documents, vector search to ANN/cache/sidecar, map to viewport/clustered APIs, and expensive smart collections to materialized/classified query plans when corpus size justifies it.

### CRIT22-07 - Cached shared-group reads still mix data retrieval and analytics mutation

- Severity: Medium
- Confidence: Medium
- Status: Risk
- Region: `apps/web/src/lib/data.ts:1392-1407`, `1830-1834`; `apps/web/src/app/actions/public.ts:517-559`.
- Critique: The reader name and cached export imply pure data access, but the function can buffer a view-count increment. The comment warns callers not to mix semantics, which is a boundary smell.
- Failure scenario: a metadata/preload/layout path reads the group first and changes whether the page-level view count is buffered. Durable analytics and denormalized counters drift in surprising ways.
- Concrete fix: make cached shared-group reads pure. Move counter buffering into an explicit page/action orchestration call.

### CRIT22-08 - Operator-bound protections still need live-state evidence

- Severity: Medium
- Confidence: Medium-High
- Status: Residual assumption
- Region: `apps/web/nginx/default.conf:1-29`; `apps/web/deploy.sh:51-108`; `.context/plans/README.md:34-37`; `CLAUDE.md` operational nginx/deploy sections.
- Critique: Host nginx limiters, proxy topology, CLIP production weights, deploy status, and production DB mode are intentionally operator-owned. Source review cannot prove they are live.
- Failure scenario: repo says a protection exists, but the host is running stale nginx or semantic search is enabled without the expected preflight/state.
- Concrete fix: record live-state probes in cycle plans: nginx config hash/burst test, deploy commit, proxy IP trace, CLIP preflight, and semantic row counts when those claims matter.

## Fixed vs Current Summary

Fixed Cycle 21 code issues: mutation-barrier order proof, permanent-failure cap helper, deterministic datetime parsing, backfill candidate index, route/script/docs/i18n/a11y small fixes, restore allowlist for the new table.

Current issues: the new deletion ledger lacks replay; upload/large-ingress/background-budget/source-contract/shared-group/public-discovery risks remain; Cycle 21 deploy evidence is still pending/inconsistent.

## Final Sweep / Gaps

Swept commonly missed classes: stale prior findings, schema table allowlists, migration journal tail, restore scanner app-table coverage, direct permanent-failure add sites, cleanup failure UI handling, route/action scanner gates, dangerous HTML sinks, raw SQL surfaces, large-body paths, and live-operator assumptions.

Uninspected categories: binary/image fixtures, `.next` artifacts, `node_modules`, live production host/nginx/MySQL/CLIP state, uploaded runtime data, and full browser matrix behavior. I inspected all review-relevant source categories I could within this lane, but did not line-read every historical review artifact or run full build/e2e.
