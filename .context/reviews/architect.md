# Cycle 23 Architect Review

Role: architect
Date: 2026-07-08 KST
Reviewed HEAD: `7054f94f2f2c7b3c339e8fd08fe4990f876e4833`
Status: review-only; no implementation changes.

## Inventory

Relevant architecture/design files and regions inspected:

- Operating and planning context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-22-2026-07-08-plan.md`, `.context/plans/cycle-22-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`, `.context/reviews/_aggregate.md`.
- Restore, recovery, and runtime state ownership: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/pending-session-revocations.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/background-db-writes.ts`.
- Admin route layering and boundary checks: `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, protected admin dashboard/settings/analytics/users/tokens/categories/tags/seo/password/db pages, `apps/web/src/lib/api-auth.ts`.
- Public restore-maintenance behavior: public home/topic/photo/group/share/map/timeline pages, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`.
- Migration/schema contract: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0030_pending_file_deletions.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/sql-restore-scan.ts`.
- Deployment/runtime topology: `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, repository docs describing the single web-instance/single-writer boundary.
- Tests/scanners relevant to the reviewed surfaces: pending deletion/revocation tests, migration reconcile/journal tests, action-origin/API-auth/public-route lint scanners.

Validation run during review:

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- pending-file-deletions pending-session-revocations check-action-origin migration-journal migrate-reconcile-coverage` passed: 7 files, 225 tests.
- `npm run typecheck --workspace=apps/web` passed.

## Findings

### ARCH-C23-01 - Restore clears maintenance before queued logout revocations are proven flushed

Severity: High
Confidence: High
Status: confirmed source-ordering defect; manual race validation not run

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:650-679` releases the admin mutation exclusive flag and calls `endDurableRestoreMaintenance()` at `:654-657`, then resumes the image queue and only afterward calls `flushPendingSessionRevocations()` at `:671`.
- `apps/web/src/lib/pending-session-revocations.ts:62-86` keeps pending hashes only after a successful DB delete, but failures are logged and collapsed to return `0`; callers cannot distinguish "nothing queued" from "flush failed."
- `apps/web/src/app/actions/auth.ts:286-315` queues a pending revocation when logout cannot delete the session row during restore, then clears the local cookie.
- `apps/web/src/lib/session.ts:136-150` treats any restored, unexpired session row as valid after HMAC and age verification.
- `apps/web/src/__tests__/pending-session-revocations.test.ts:101-110` currently pins the risky ordering by asserting the flush happens after the maintenance marker is cleared.

Failure scenario:

An admin logs out during a restore window. The cookie is cleared locally, but the server-side session delete is queued because DB mutation is blocked. The restore then imports a backup containing that session row. In the `finally` path, the app clears durable/process maintenance before flushing the queued revocation. During that gap, or indefinitely if the flush fails, a copied/stale token whose row was restored can authenticate as an admin because the marker no longer blocks normal admin auth and the restored session row still exists.

Suggested fix:

Move `flushPendingSessionRevocations()` to the post-import but pre-marker-clear phase for successful restores. Make the flush result distinguish empty from failed, or throw on failure in the restore path, so restore can fail closed by keeping maintenance active when admin session revocation cannot be proven. Update the source-contract test to assert "after import, before `endDurableRestoreMaintenance()`." Keep `drainPendingFileDeletions()` after marker clear if that filesystem cleanup should remain non-blocking.

### ARCH-C23-02 - Protected admin SSR reads are not restore-maintenance gated

Severity: Medium
Confidence: High for source gap; likely runtime failure; manual browser validation not run
Status: confirmed architecture boundary gap

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17` authenticates with `isAdmin()` and redirects unauthenticated users, but it does not check `isRestoreMaintenanceActive()`.
- Protected pages immediately execute DB-heavy reads: dashboard loads images/topics/tags/settings/SEO/failed images at `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27`; settings loads admin settings and image count at `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:13-17`; analytics loads view breakdowns at `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-35`; users loads admin users at `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:11-13`.
- Public routes explicitly render restore maintenance before DB reads, for example `apps/web/src/app/[locale]/(public)/page.tsx:155-160`, and shared data side effects check the same marker in `apps/web/src/lib/data.ts:49-52`.
- Maintenance/background tasks also skip during restore through `apps/web/src/lib/maintenance-scheduler.ts:26-46`; protected admin SSR reads do not share that boundary.

Failure scenario:

While a restore import is dropping/recreating tables or reconciling schema, an authenticated admin opens `/admin/dashboard`, `/admin/settings`, or `/admin/analytics`. The protected layout verifies auth and then lets child server components query tables whose contents are not authoritative. The result can be a 500, mixed pre/post-restore admin state, or extra DB pressure during the restore window. This also widens ARCH-C23-01 because restored admin sessions can reach protected reads as soon as the marker clears but before post-restore cleanup is complete.

Suggested fix:

Add a restore-maintenance gate to the protected admin layout or to a shared admin route wrapper before child server components run. Render a non-querying maintenance shell for protected admin pages while active, and explicitly exempt only the mounted DB restore UI path if it needs to keep showing local progress. Add tests that protected admin pages do not call data accessors while the restore marker is active.

## Healthy Invariants Not Re-Raised

- The Cycle 22 pending-file-deletion drain now exists in `apps/web/src/lib/pending-file-deletions.ts:105-139`, is included in hourly maintenance at `apps/web/src/lib/maintenance-scheduler.ts:42-46`, and is called after restore at `apps/web/src/app/[locale]/admin/db-actions.ts:672-678`.
- The pending-file-deletion schema is mirrored across `apps/web/src/db/schema.ts`, `apps/web/drizzle/0030_pending_file_deletions.sql`, `apps/web/drizzle/meta/_journal.json`, and `apps/web/scripts/migrate.js`.
- Protected admin routes do have a real server-side auth gate in `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-17`; the final sweep did not carry forward a false middleware-only admin-auth finding.
- Cycle 22 deferred performance/design items remain tracked in `.context/plans/cycle-22-2026-07-08-deferred.md` and `.context/plans/deferred-carry-forward.md`; they were not refiled as new Cycle 23 findings.

## Missed-Issues Sweep

Rechecked restore teardown ordering, admin/public maintenance gates, schema/migration mirrors, action-origin scanner behavior, API auth wrappers, public route rate-limit coverage, deployment topology assumptions, and current deferred registers after drafting the findings. No additional confirmed architecture findings were found in this pass.
