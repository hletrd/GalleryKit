# Cycle 22 Code Reviewer Report

Date: 2026-07-08 KST
Role: `code-reviewer`
Review HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Scope: repository-wide code quality, logic, maintainability, SOLID, edge cases, shared-state hazards, error handling, state consistency, and test gaps. Review-only: no fixes implemented.

## Inventory

Guidance and review context read first:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `code-review` skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- Current Cycle 21 plan/deferred/carry-forward ledgers and prior top-level review reports.

Review-relevant inventory built before findings:
- App routes/actions: 81 files under `apps/web/src/app`.
- Core libraries: 115 files under `apps/web/src/lib`.
- Components: 61 files under `apps/web/src/components`.
- Unit/source-contract tests: 364 files under `apps/web/src/__tests__`.
- Playwright E2E: 12 files under `apps/web/e2e`.
- Scripts: 29 files under `apps/web/scripts`.
- Drizzle migrations/schema metadata: 34 files under `apps/web/drizzle`.
- Config/docs/messages/deploy surfaces: root/app `package.json`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.context/plans/*`, `apps/web/next.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/playwright.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, and `apps/web/messages/{en,ko}.json`.

Cross-file interactions inspected:
- Browser upload Server Action, Lightroom/PAT upload route, original-file persistence, image queue, failed-image retry, durable deletion ledger, and admin image-manager UI feedback.
- DB schema, migration SQL, journal, `reconcileLegacySchema`, restore scanner allowlists, backup/restore flow, and migration tests.
- Action origin/mutation-barrier scanner, admin API auth scanner, public route rate-limit scanner, and their fixtures.
- Timeline/on-this-day datetime parsing and display grouping after Cycle 21 changes.
- Background queue/backfill pool budgeting, semantic/similar vector scans, public search/map/shared-group data paths.
- Source-contract tests versus behavioral coverage for high-risk restore/migration/search/upload contracts.

Validation evidence:
- `git rev-parse HEAD` -> `8b795862079b0e5318242a09390b4cdff1dc2058`.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- Targeted tests passed: `npm test --workspace=apps/web -- --run src/__tests__/pending-file-deletions-source.test.ts src/__tests__/mysql-datetime.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts` (4 files, 215 tests).
- I did not run full `npm run lint`, `npm run build`, full `npm test`, or Playwright in this review lane.

## Fixed Prior Findings

- Fixed from Cycle 21: mutation-barrier acquired checks are now scanner-enforced before mutations (`apps/web/scripts/check-action-origin.ts`; gate passed).
- Fixed from Cycle 21: direct `permanentlyFailedIds.add(...)` bypass is now centralized through `markPermanentlyFailed` (`apps/web/src/lib/image-queue.ts:374-387`).
- Fixed from Cycle 21: backfill candidate index exists in schema/migration/reconcile (`apps/web/src/db/schema.ts:127`, `apps/web/drizzle/0030_pending_file_deletions.sql:19`, `apps/web/scripts/migrate.js` coverage).
- Fixed from Cycle 21: timeline/on-this-day grouping uses deterministic MySQL datetime parsing (`apps/web/src/lib/mysql-datetime.ts:31-69`, `apps/web/src/lib/data-timeline.ts:15`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:18`).
- Fixed from Cycle 21: `pending_file_deletions` is included in restore scanner app-table allowlist (`apps/web/src/lib/sql-restore-scan.ts:12-32`) and guarded by schema-superset tests (`apps/web/src/__tests__/sql-restore-scan.test.ts:163-190`).

## Current Findings

### CR22-01 - Pending file-deletion ledger has no replay consumer

- Severity: High
- Confidence: High
- Status: Confirmed
- Region: `apps/web/src/lib/pending-file-deletions.ts:70-90`; `apps/web/src/app/actions/images.ts:714-727`; `apps/web/src/app/actions/images.ts:864-907`; `apps/web/src/lib/maintenance-scheduler.ts:34-45`; `apps/web/src/instrumentation.ts:7-10`; `apps/web/src/components/image-manager.tsx:142-148`, `171-179`.
- Problem: Cycle 21 added durable `pending_file_deletions` rows and retains them on cleanup failure, but the only caller of `cleanupPendingFileDeletion()` is the same delete request that just failed. Startup, hourly maintenance, admin UI, and operator scripts never select pending rows for retry. The admin warning says only to check server logs.
- Failure scenario: deleting a photo during transient NAS/read-only/permission failure removes DB rows and leaves public derivatives/originals on disk. The row in `pending_file_deletions` records the failure, but no code ever replays it, so known `/uploads/...` URLs can continue serving orphan bytes indefinitely until manual SQL/script work.
- Concrete fix: add a bounded maintenance/startup worker that selects old `pending_file_deletions` ordered by `updated_at`, calls `cleanupPendingFileDeletion`, backs off or caps attempts, and exposes pending/failing rows in admin status. Add behavioral tests for one failed cleanup being retried and cleared on the next sweep. Keep the UI warning, but include an actionable retry-state message instead of only "check server logs."

### CR22-02 - Browser and PAT upload paths still duplicate one ingest transaction contract

- Severity: High
- Confidence: High
- Status: Confirmed recurring architecture risk
- Region: `apps/web/src/app/actions/images.ts:87-227`, `325-445`; `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`, `254-631`.
- Problem: The two upload adapters independently implement config snapshotting, quota settlement, topic validation, disk precheck, original save, HDR/GPS gates, metadata insert, processing snapshot, queue payload, audit, cleanup, and revalidation. The LR route comments document multiple prior parity misses, which confirms this is not theoretical.
- Failure scenario: the next upload-time invariant, such as a new privacy scrub, metadata column, color/HDR setting, or queue payload field, lands in one adapter and silently misses the other. Browser uploads and external publish-client uploads then produce different persisted metadata or derivative bytes.
- Concrete fix: extract a shared `ingestUploadedImage` service that owns the transactional domain contract. Keep only auth, multipart parsing, and response formatting in the Server Action/Route Handler. Add parity tests that feed the same fake file/metadata through both adapters and assert identical insert values and queue jobs.

### CR22-03 - Large upload and restore ingress still materializes framework multipart bodies

- Severity: High
- Confidence: Medium-High
- Status: Risk, source-confirmed; live impact needs RSS traces
- Region: `apps/web/src/app/actions/images.ts:87-106`; `apps/web/src/app/api/admin/lr/upload/route.ts:174-188`; `apps/web/src/app/[locale]/admin/db-actions.ts:409-420`, `717-729`; `apps/web/next.config.ts:111-119`; `apps/web/src/lib/upload-limits.ts:1-35`.
- Problem: large browser uploads, LR uploads, and DB restore arrive as `FormData`/`File` after framework multipart parsing. App-level size checks and disk streaming run after that materialization boundary.
- Failure scenario: valid near-limit 200 MiB photo uploads or 250 MiB restores can spike RSS/temp usage before domain code controls the stream, competing with Sharp, CLIP, public SSR, and DB work in the single Node process.
- Concrete fix: move large binary ingress to streaming Route Handlers with pre-parse `Content-Length` enforcement, per-part caps, temp-file handoff, and a process-wide large-body semaphore. Keep Server Actions for metadata-only mutations.

### CR22-04 - Queue and admin backfill reserve the same DB/CPU headroom independently

- Severity: Medium
- Confidence: High
- Status: Confirmed design risk
- Region: `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `716-727`; `apps/web/src/db/index.ts:21-45`.
- Problem: image processing and in-app color backfill each compute a safe concurrency cap against the same 10-connection pool and each reserves about half for live traffic. Neither subtracts the other background consumer, and both can run under different advisory locks.
- Failure scenario: active uploads plus admin re-encode can pin most pool connections and oversubscribe Sharp/libvips while both lanes believe they preserved live headroom. Public pages/search/admin requests can queue behind background encode work.
- Concrete fix: introduce a process-wide background resource budget shared by image queue, color backfill, semantic bootstrap, and heavy side effects. Acquire DB/CPU tokens before long-lived advisory locks and Sharp work; expose token usage in admin status.

### CR22-05 - Cached shared-group reader still performs a view-count side effect

- Severity: Medium
- Confidence: Medium
- Status: Risk
- Region: `apps/web/src/lib/data.ts:1392-1407`; `apps/web/src/lib/data.ts:1830-1834`; `apps/web/src/app/actions/public.ts:517-559`.
- Problem: `getSharedGroupCached = cache(getSharedGroup)` wraps a reader that can buffer a denormalized `view_count` increment. A comment warns not to call the cached wrapper with different count semantics, which means the API boundary is already side-effect-shaped.
- Failure scenario: a metadata/layout/preload path calls the cached reader before the page call with different options. React cache deduplication can then decide whether the buffered counter increments, while durable analytics are recorded by a separate action path.
- Concrete fix: split shared-group data access into a pure cached reader plus an explicit `bufferSharedGroupViewCount` orchestration call owned by the page/action layer. Add a test proving repeated cached reads are side-effect-free.

## Test Gaps

- `pending-file-deletions-source.test.ts` proves row creation/retention but not replay, scheduling, or UI remediation (`apps/web/src/__tests__/pending-file-deletions-source.test.ts:25-45`).
- Migration/reconcile and restore/child-process contracts remain heavily source-pinned; the current tests catch missing names and ordering strings, not executable MySQL/schema convergence or child-process edge behavior.
- Playwright remains a limited browser matrix relative to touch/PWA/service-worker/browser-specific code paths.

## Final Sweep

Commonly missed areas swept: raw SQL and `.query()` use, `dangerouslySetInnerHTML` sites, server-action guard coverage, public route rate-limit coverage, schema/migration/journal/reconcile parity, restore app-table allowlist, upload quota settlement, queue permanent-failure state, datetime parsing, cleanup warnings, and prior Cycle 21 findings.

Uninspected categories: `node_modules`, `.next` build/cache artifacts, binary screenshots/images, uploaded runtime data stores, live MySQL contents, live nginx config, CLIP model weights, production host state, and exhaustive line-by-line historical review archives. Full build/test/e2e were not rerun in this lane.
