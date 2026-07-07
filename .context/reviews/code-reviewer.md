# Run-10 Cycle 5/100 — Code-Reviewer Lane

Date: 2026-07-07  
Scope: code quality, logic bugs, maintainability, coupling, invalid assumptions, edge cases, and error handling.  
Mode: read-only review except this artifact. No source files modified.

## Inventory First

Repository inventory built before reviewing:

- `apps/web/src`: 592 TypeScript/TSX files total, including 13 server-action files, 8 API route files, 58 app route/layout files, 60 component files, 110 `lib/` modules, 3 `db/` files, and 336 unit/fixture test files.
- Other review-relevant groups: 29 `apps/web/scripts` files, 28 Drizzle SQL migrations plus journal metadata, 12 e2e/fixture files, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, `next.config.ts`, `public/sw.template.js`, and generated `public/sw.js`.
- Current context read: `AGENTS.md`, `CLAUDE.md`, current root review artifacts, cycle-4 aggregate/plan/deferred register, current git log/status.

## Findings Summary

- Confirmed issues: 1
- Likely issues: 0
- Risks needing manual validation: 0
- Critical/High findings: 0

## Confirmed Issues

### CQR5-01 — Retention and cleanup scheduler is coupled to successful image-queue bootstrap

Severity: LOW-MED  
Confidence: High  
Location: `apps/web/src/lib/image-queue.ts:1117-1274`, `apps/web/src/instrumentation.ts:7-8`

Problem:
`instrumentation.ts` starts background work by awaiting `bootstrapImageProcessingQueue()` during Node startup. Inside that image-queue bootstrap, after the pending-image scan and embedding retry kick, the module also runs and arms unrelated maintenance jobs: expired sessions, stale rate-limit buckets, audit-log retention, and anonymous view-event retention. The hourly timer is stored as `ProcessingQueueState.gcInterval` and is created only in the successful bootstrap path.

Why this is a problem:
These retention sweeps are not image-processing concerns. They bound growth in `sessions`, `rate_limit_buckets`, `audit_log`, and the analytics view tables, but their lifecycle depends on an unrelated queue bootstrap path that can return early or stay retrying. The code has explicit early returns before the timer path when the queue is already bootstrapped, shutting down, restore maintenance is active, or a continuation is scheduled (`image-queue.ts:1117-1119`). If image bootstrap is skipped during restore maintenance or remains stuck on DB/queue startup errors, the maintenance scheduler never gets an independent owner.

Concrete failure scenario:
The app boots while restore maintenance is active, or a queue-bootstrap DB read keeps failing before the timer-arm block. Image processing correctly waits or retries, but session purge, rate-limit bucket purge, audit-log retention, and `purgeOldViewEvents()` also stop starting. On a host that keeps serving after partial recovery, view/audit/rate-limit rows can grow until the next successful image-queue bootstrap, even though those retention jobs should not depend on pending image work.

Suggested fix:
Extract a small `lib/maintenance-scheduler.ts` with `startMaintenanceScheduler()` / `stopMaintenanceScheduler()` that owns:

- `purgeExpiredSessions()`
- `purgeOldBuckets()`
- `purgeOldAuditLog()`
- `purgeOldViewEvents()`
- any retry-map pruning that truly belongs to queue state can remain queue-owned or be passed as an optional callback

Start it from `instrumentation.ts` alongside, not inside, image-queue bootstrap. Add a unit/source-contract test proving retention starts even when `bootstrapImageProcessingQueue()` is skipped or rejects.

## Likely Issues

None at actionable confidence.

## Risks Needing Manual Validation

None from this pass. The remaining cycle-4 deferred rows I re-checked are design/performance trade-offs or already documented operational boundaries, not code-quality defects at this lane's confidence threshold.

## Non-Findings / Closed Stale Candidates

These looked relevant from older artifacts but are already fixed at current HEAD:

- Processing-error retry now uses delayed escalating backoff (`image-queue.ts:974-989`) instead of immediate synchronous re-enqueue.
- Defensive queue-state re-init now clears stale `gcInterval` and tracked retry timers before replacing malformed state (`image-queue.ts:417-434`), with tests in `image-queue-gc-timer-reinit.test.ts`.
- Missing-embedding bootstrap scans are now capped by `SEMANTIC_SCAN_LIMIT` and persist a within-process cursor (`image-queue.ts:570-576`), with model-version reset state present.
- The SEO fallback in `Nav` now uses `buildSeoSettingsFallback()` instead of an inline partial object using the wrong `siteConfig` field (`components/nav.tsx:10-13`).
- `reconcileLegacySchema` drift coverage is no longer unguarded: `migrate-reconcile-coverage.test.ts` checks tables, columns, indexes, FKs, drops, and the `processed` default mirror.
- The storage abstraction remains quarantined by `storage-quarantine.test.ts`; no production code imports `@/lib/storage`, so I did not file its unwired backend API as a live maintainability defect.

## File Groups Examined

Deep/current reads:

- Queue and lifecycle: `image-queue.ts`, `queue-shutdown.ts`, `instrumentation.ts`, `single-writer-guard.ts`
- Backfill/reprocessing: `admin-backfill-runner.ts`, `actions/admin-backfill.ts`, settings UI status wiring
- Migration/schema drift: `scripts/migrate.js`, `migrate-reconcile-coverage.test.ts`, `migrate-pending-migrations.test.ts`, `db/schema.ts` references
- Data/privacy/config: `data.ts`, `settings-hash.ts`, `gallery-config.ts`, `nav.tsx`, `site-config.json`
- Storage quarantine: `lib/storage/*`, `storage-local.test.ts`, `storage-quarantine.test.ts`
- Mutation/API guard sweep: `app/actions/**`, `app/api/**`, `check-action-origin.ts`, `check-api-auth.ts`, `check-public-route-rate-limit.ts`

Static sweeps:

- `parseInt`, `JSON.parse`, `as any`, `@ts-ignore`, `eslint-disable`, bare catches, timers/listeners, `Promise.all`, rate-limit/origin/auth wrappers, privacy guard names, migration mirror names, and review/deferred-register references.

## Final Sweep

Commonly missed issue classes checked: retry tight loops, orphaned timers, process-global reset obligations, stale config fallbacks, migration mirror drift, public/admin mutation guard drift, privacy-select leakage, uncaught async side effects, JSON parsing without guards, parse-int truncation, stale source-text tests, and dead abstraction wiring.

I found no material CRITICAL/HIGH/MED logic or maintainability defects beyond CQR5-01. The queue/backfill/migration fixes from cycle 4 are present on current HEAD and should not be re-opened from stale review text.
