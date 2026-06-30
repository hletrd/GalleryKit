# Cycle 28 Tracer Review

Date: 2026-06-30
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD inspected: `9d7f7f74`
Mode: Prompt 1 review only. No fixes implemented.

## Inventory Examined

Documentation and prior context:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/tracer.md` prior cycle baseline
- `.context/reviews/architect.md`, `.context/reviews/critic.md`, `.context/reviews/debugger.md`, `.context/reviews/document-specialist.md`, and `.context/reviews/perf-reviewer.md` were present as pre-existing/concurrent dirty files and were not modified
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- Review-relevant plan history under `plan/` and `plan/done/` was inventoried for migration/restore/queue/search context, not treated as current code

Restore, backup, migrations, deploy:
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/restore-maintenance-durable.ts`
- `apps/web/scripts/restore-maintenance-recovery.ts`
- `apps/web/scripts/restore-maintenance-recovery.mjs`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/migration-add-column.ts`
- `apps/web/scripts/migrate-admin-auth.ts`
- `apps/web/scripts/migrate-capture-date.js`
- `apps/web/scripts/migrate-titles.ts`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql` through `apps/web/drizzle/0027_analytics_retention_indexes.sql`
- `apps/web/src/db/schema.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/nginx/default.conf`

Upload, image processing, queue, backfill:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-alt-text.ts`
- `apps/web/scripts/backfill-cicp-recheck.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Analytics, public reads, data access:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/view-retention.ts`
- Public route files under `apps/web/src/app/[locale]/(public)/`, including home, topic, photo, share, shared group, map, timeline, year, collection, feed, uploads, layout, privacy, and loading pages
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/manifest.ts`

Auth, session, admin actions, API auth:
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/password-hashing.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/proxy.ts`

Search, semantic search, CLIP:
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/clip-inference.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-model-id.ts`
- `apps/web/src/lib/clip-paths.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/scripts/download-clip-models.ts`
- `apps/web/scripts/clip-model-manifest.ts`

Service worker and asset serving:
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`
- `apps/web/scripts/build-sw.ts`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`

Focused tests/contracts checked:
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/restore-upload-lock.test.ts`
- `apps/web/src/__tests__/image-queue-quiesce.test.ts`
- `apps/web/src/__tests__/image-queue-permanent-failure.test.ts`
- `apps/web/src/__tests__/upload-processing-contract-lock.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/migration-journal.test.ts`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`
- `apps/web/src/__tests__/sw-template-contract.test.ts`
- `apps/web/src/__tests__/sw-cache.test.ts`
- `apps/web/src/__tests__/nginx-config.test.ts`
- `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/semantic-scan-limit-source.test.ts`
- `apps/web/src/__tests__/similar-route.test.ts`
- `apps/web/src/__tests__/semantic-search-route.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/public.spec.ts`

Repository-wide sweeps:
- Inventoried tracked source/config/test/docs with `find` and `rg --files`, excluding generated/vendor/runtime artifacts: `node_modules`, `.git`, `apps/web/.next`, `test-results`, `apps/web/test-results`, `.omx/logs`, `.omc`, and `apps/web/.omc`.
- Ran targeted grep sweeps for restore/maintenance, upload/queue, analytics/views, auth/session, search/semantic/embedding, service worker, migration/journal, deploy/docker/nginx, write operations, fire-and-forget promises, timers, and queue side effects.
- No review-relevant source/config/test/doc file in the active repository was intentionally skipped. Auxiliary `.claude/worktrees/**` files were inventoried but excluded from current findings because they are separate worktree/archive material, not the active app under review.

## Findings

### TRC28-01 - Likely - Public analytics insert promises can cross the restore boundary

Severity: Medium
Confidence: High
Status: Likely issue

Evidence:
- `apps/web/src/app/actions/public.ts:416-441` (`recordPhotoView`)
- `apps/web/src/app/actions/public.ts:444-473` (`recordTopicView`)
- `apps/web/src/app/actions/public.ts:476-509` (`recordSharedGroupView`)
- `apps/web/src/app/[locale]/admin/db-actions.ts:491-499` restore preparation drains only shared-group count buffer and image queue
- `apps/web/src/lib/image-queue.ts:1060-1087` queue quiescence drains queue side effects only
- `apps/web/src/__tests__/public-actions.test.ts:241-254` explicitly locks current behavior as "without blocking on the insert promise"

Problem:
The three public analytics recorders perform a restore-maintenance check before validation and again immediately before `db.insert(...).values(...)`, but the insert itself is launched as an untracked promise and not awaited. Restore preparation waits for `flushBufferedSharedGroupViewCounts()` and `quiesceImageProcessingQueueForRestore()`, but it has no registry/drain for these public analytics insert promises. Once the insert promise is created, a restore can begin, import a backup, and complete while the old request's insert is still pending.

Concrete failure scenario:
1. A visitor opens `/p/123`, `/s/<key>`, `/g/<key>`, or a topic page.
2. The server action validates that the target exists and reaches `db.insert(imageViews|topicViews|sharedGroupViews).values(...)`.
3. Before MySQL executes that insert, an admin starts a DB restore.
4. Restore enters maintenance, drains the image queue and shared-group buffer, imports the backup, and exits maintenance.
5. The stale analytics promise resolves after the import and writes a view event into the restored database for an event from the pre-restore timeline. If the referenced row id now points to a different restored object, the analytics event is attached to the wrong object; if the FK no longer exists, the write fails and is silently swallowed.

Suggested fix:
Create a small tracked analytics side-effect registry, mirroring the queue side-effect pattern in `image-queue.ts`, and have restore preparation drain it before invoking `runRestore()`. Alternatively, make these recorders await the insert after the late maintenance check and keep the server-render fire-and-forget at the page call site only if it is registered and drainable. Add a regression test that starts a recorder, holds its insert promise, invokes restore quiescence, and asserts restore waits until the insert settles.

Notes:
The shared-group denormalized `view_count` buffer is explicitly drained by `flushBufferedSharedGroupViewCounts()`, but these normalized event tables are separate writers and are not covered by that drain.

### TRC28-02 - Likely - Fire-and-forget audit writes are not part of restore quiescence

Severity: Medium
Confidence: Medium
Status: Likely issue

Evidence:
- `apps/web/src/lib/audit.ts:39-92` documents `logAuditEvent` as fire-and-forget and writes `audit_log`
- Representative call sites use `.catch(console.debug)` instead of awaiting:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:157-158` CSV export
  - `apps/web/src/app/[locale]/admin/db-actions.ts:733-740` DB restore success audit
  - `apps/web/src/app/actions/images.ts:604-610` upload audit
  - `apps/web/src/app/actions/images.ts:703-705` delete audit
- Restore preparation and finalization do not drain audit promises: `apps/web/src/app/[locale]/admin/db-actions.ts:491-537`

Problem:
Audit rows are ordinary DB writes, but the restore maintenance contract does not track or drain them. Most admin mutation paths correctly check restore maintenance before doing primary writes, yet their audit writes are intentionally non-blocking. A restore can therefore start after a primary mutation completes but before its audit insert has reached MySQL.

Concrete failure scenario:
1. An admin uploads or deletes an image, changes settings, creates a share, or exports CSV; the primary action commits.
2. The action schedules `logAuditEvent(...).catch(console.debug)` and returns.
3. Another admin/tab immediately starts DB restore.
4. Restore imports the selected backup.
5. The old audit insert resolves after the import, adding a forensic event from the discarded pre-restore timeline to the restored database. Conversely, the restore success audit at `db-actions.ts:737` is not awaited, so a transient DB error can also silently lose the one audit row that should prove the restore occurred.

Suggested fix:
Put audit writes behind the same restore-aware side-effect registry as public analytics, or make security-relevant audit calls awaited at least for DB restore, credential, token, user, and destructive admin actions. If preserving non-blocking UX is required, expose `trackAuditSideEffect()` plus `drainAuditSideEffectsForRestore()` and call the drain before `runRestore()`. Add tests proving restore waits on an in-flight audit insert and that `db_restore` audit failure is surfaced or retried.

Notes:
This is a causal consistency issue, not an authentication bypass. The impact is forensic/timeline pollution and possible loss of the restore audit event.

### TRC28-03 - Risk - Public SSR routes can query the database during restore import

Severity: Low
Confidence: Medium
Status: Risk

Evidence:
- Restore maintenance is exposed through `/api/health`: `apps/web/src/app/api/health/route.ts:7-16`
- Docker liveness remains `/api/live`, which always returns ok: `apps/web/src/app/api/live/route.ts:1-9`
- Proxy/middleware applies CSP/i18n/admin cookie-format checks but no restore-maintenance public-page gate: `apps/web/src/proxy.ts:65-121`
- Public SSR pages fetch DB-backed data without a maintenance pre-check, examples:
  - Home page: `apps/web/src/app/[locale]/(public)/page.tsx:149-167`
  - Topic page: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:141-170`
  - Photo page: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:133-156`
  - Shared group page: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:101-131`
  - Shared photo page: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:93-107`
- Public actions and search routes do have maintenance gates, for contrast: `apps/web/src/app/actions/public.ts:122`, `apps/web/src/app/actions/public.ts:238`, `apps/web/src/app/api/search/semantic/route.ts:113`, `apps/web/src/app/api/search/similar/[id]/route.ts:77-80`

Problem:
The restore maintenance mechanism blocks uploads, admin mutations, search APIs, public load-more/search actions, and queue workers, but initial public page renders are still allowed to run DB queries while the MySQL import may be dropping/recreating tables or loading partially restored data. The service remains live because `/api/live` is liveness-only, and there is no repo-local nginx or proxy rule that converts public HTML requests into a maintenance response.

Concrete failure scenario:
1. An admin starts a DB restore.
2. The durable maintenance marker is active and `/api/health` returns 503, but the container stays live and nginx continues proxying public HTML.
3. A visitor requests the home page, topic page, photo page, shared group, or map while `mysql --one-database` is mid-import.
4. The SSR path runs DB queries against transient schema/data state and can return a 500, `notFound()` for content that will exist after import, or a page assembled from partially restored data. Because service-worker HTML caching only stores `networkResponse.ok`, 500 responses should not be cached, but users still see transient breakage.

Suggested fix:
Add a public HTML maintenance gate that returns a `503` no-store maintenance shell before any DB-backed public SSR work when `isRestoreMaintenanceActive()` is true. Candidate placements: a small helper called at the top of DB-backed public pages, a public layout boundary that can safely check the marker without DB I/O, or edge/proxy logic if the marker is available there. Keep API/search behavior as-is and add tests that representative public pages short-circuit during restore without calling data loaders.

Notes:
This is an availability/consistency risk rather than data corruption. If production infrastructure intentionally removes the instance from rotation based on `/api/health`, this risk is mitigated externally, but the checked-in Docker/nginx path documents `/api/live` as liveness and does not itself stop public traffic.

## Refuted Or Covered Hypotheses

- Restore SQL scanner comment-bypass from the previous tracer cycle is fixed in the current tree. `hasDisallowedRestoreWriteTarget()` now checks both compact and spacing-preserving sanitized forms in `apps/web/src/lib/sql-restore-scan.ts:210-214`, and tests cover schema-qualified/current-schema write targets.
- Restore/upload/image-queue coordination is substantially fenced: restore holds DB restore, upload-processing contract, color backfill, and semantic backfill advisory locks before entering durable maintenance, then drains the shared-group buffer and image queue before import (`apps/web/src/app/[locale]/admin/db-actions.ts:377-499`).
- The image queue has an explicit side-effect registry and restore drain for bootstrap embedding side effects (`apps/web/src/lib/image-queue.ts:338-457`, `apps/web/src/lib/image-queue.ts:1060-1087`).
- Service worker stale revocable-page HTML caching is addressed. `sw.template.js` and generated `sw.js` bypass revocable public object pages before `networkFirstHtml()` (`apps/web/public/sw.template.js:42-64`, `apps/web/public/sw.template.js:380-384`).
- Migration journal/baseline logic is intentionally non-monotonic only for grandfathered entries. `migration-journal.test.ts` documents and guards the live invariant from idx 18 forward, and `migrate.js` baselines per journal hash, then asserts every committed migration hash is recorded.
- Semantic search and similar-image routes gate maintenance before expensive work and rate-limit/content checks before embedding or DB scans. Production CLIP is operator-gated by DB setting plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION`.
- Auth/session mutations gate restore maintenance for login and password change, use same-origin checks, HMAC session tokens, Argon2id password verification, and DB-backed rate-limit rollback semantics where required.
- Deploy scripts preserve the documented disk hygiene ordering: `deploy.sh` updates containers first, then prunes unused Docker resources without `volume -a`; persistent upload/data/config mounts are declared in compose and Dockerfile/runtime comments.

## Missed-Issues Sweep

Final sweep covered all named domains from the prompt: restore, upload/image queue, analytics, auth/session, search/semantic, service worker, migrations, and deploy scripts. Additional cross-cutting searches covered raw writes, fire-and-forget promises, timers, queue side effects, maintenance gates, advisory locks, health/liveness, and route auth wrappers.

No relevant active-repo source/config/test/doc file was intentionally skipped. Generated/vendor/runtime artifacts and archived auxiliary worktrees were excluded from findings because they are not the active application surface.

Tests were not run because this was a review-only prompt with no code changes. Evidence is from static inspection and targeted source/test contract review.
