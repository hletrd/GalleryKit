# Cycle 20 Tracer Review

Scope: comprehensive causal-tracing review of the repository under `/Users/hletrd/flash-shared/gallery`, focused on upload -> process -> DB -> public render, restore/backup, admin mutations, auth/session/logout, public sharing, CLIP semantic search, service worker, analytics, migrations, and deploy. I treated existing dirty files outside this report as concurrent work and did not revert them.

Validation evidence:

- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- --run src/__tests__/restore-drain-checklist.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/data-view-count-flush.test.ts` passed: 3 files, 126 tests.
- The passing tests are evidence of current expectations, not proof against the first two findings. Both findings are about source-contract gaps those tests currently allow.

## Inventory

Review-relevant flows and files examined:

- Upload and processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-contract.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/exif.ts`, `apps/web/src/lib/hdr.ts`.
- DB write barriers, restore, backup, and migrations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/restore-drain-checklist.ts`, `apps/web/src/lib/restore-lock.ts`, `apps/web/src/lib/maintenance-state.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/*`, `apps/web/drizzle/meta/_journal.json`.
- Admin mutations and auth: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/admin-settings.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/selections.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/pending-session-revocations.ts`.
- Public render, sharing, and analytics: `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/share/[key]/page.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/shared-analytics.ts`, public sitemap/feed/manifest routes.
- CLIP semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/semantic-lock.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Service worker and caching: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.js`, `apps/web/src/app/api/sw-cache-manifest/route.ts`.
- Deploy/runtime: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/docker-compose.yml`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`.
- Quality gates and source-contract tests: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/restore-drain-checklist.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/data-view-count-flush.test.ts`, plus adjacent auth, sharing, semantic-search, migration, and service-worker tests.

No requested flow was intentionally sampled or skipped. The final sweep specifically rechecked restore drains, mutation-barrier linting, cached readers with side effects, analytics buffering, CLIP activation gates, service-worker exclusions, and migration/deploy postconditions.

## Confirmed Issues

### TRC20-01 - Restore can wedge indefinitely while flushing shared-group view counts

Severity: High
Confidence: High
Status: Confirmed

Code regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:560-574`
- `apps/web/src/app/[locale]/admin/db-actions.ts:574-611`
- `apps/web/src/lib/data.ts:75-155`
- `apps/web/src/lib/data.ts:222-249`
- `apps/web/src/lib/background-db-writes.ts:84-112`
- `apps/web/src/__tests__/restore-drain-checklist.test.ts:87-99`

Failure scenario:

The restore action enters durable maintenance, marks restore active, acquires the restore lock, and then calls `flushBufferedSharedGroupViewCounts()` before `runRestoreDrainChecklist()`. That flush awaits an existing `currentFlushPromise` and then awaits `flushGroupViewCounts()` without a restore-specific timeout. If the DB update hangs behind a metadata lock, stalled connection, or driver-level wait, restore never reaches the bounded checklist, never imports the backup, and can hold the site in maintenance indefinitely.

The adjacent drain framework already encodes the intended invariant that process-local DB writers must be bounded during restore. `drainBackgroundDbWritesForRestore()` races its drain against `RESTORE_BACKGROUND_DRAIN_TIMEOUT_MS`, and `restore-drain-checklist.ts` says every stage must be bounded. Shared-group view-count flushing is the exception: it is process-local DB writing, but it is performed outside the checklist and has no timeout. The source-contract test currently locks in this ordering by expecting the flush to happen before the checklist, so the gate passes while preserving the wedge.

Concrete fix:

- Add a restore-specific bounded drain, for example `drainSharedGroupViewCountsForRestore(timeoutMs = 15000): Promise<boolean>`, in `apps/web/src/lib/data.ts`.
- Move that drain into `runRestoreDrainChecklist()` as an explicit first stage such as `shared-group-view-counts`.
- If the stage times out, abort restore before import and release all restore/maintenance/admin locks through the existing `finally` path.
- Update `restore-drain-checklist.test.ts` to reject the current unbounded pre-checklist call and add a never-settling flush test proving restore aborts cleanly instead of hanging.

### TRC20-02 - `lint:action-origin` can false-green an admin mutation that does not actually hold the restore barrier

Severity: High
Confidence: High
Status: Confirmed

Code regions:

- `apps/web/scripts/check-action-origin.ts:148-165`
- `apps/web/scripts/check-action-origin.ts:1371-1397`
- `apps/web/src/lib/admin-mutation-barrier.ts:15-29`
- `apps/web/src/lib/admin-mutation-barrier.ts:67-92`
- `apps/web/src/__tests__/check-action-origin.test.ts:618-630`

Failure scenario:

The action-origin scanner treats any call expression named `acquireAdminMutationSlot` as proof that the action participates in the restore barrier. It does not verify that the identifier is imported from `@/lib/admin-mutation-barrier`, that the returned disposable is held with `using`, or that the action returns before mutation when `slot.acquired` is false.

That leaves at least three false-green shapes:

- A local helper or shadowed import named `acquireAdminMutationSlot()` is called before a DB mutation.
- The real function is called as a bare expression and immediately disposed or ignored.
- The real slot is acquired but the action mutates before checking `!slot.acquired`.

The positive test fixture at `check-action-origin.test.ts:618-630` passes an action with `using mutationSlot = acquireAdminMutationSlot(); await db.update(...)` but no import provenance and no `mutationSlot.acquired` early return. This demonstrates that the gate validates the call shape, not the safety contract. Current real actions I inspected generally use the correct pattern, and the lint command passed, but the regression gate can miss the class of bug it is meant to prevent.

Concrete fix:

- In `check-action-origin.ts`, resolve import provenance and only count `acquireAdminMutationSlot` when it comes from `@/lib/admin-mutation-barrier`.
- Require a `using` declaration bound to the approved call.
- Require an early `if (!slot.acquired) return ...` before any mutating DB/filesystem/upload operation in the function body.
- Add negative tests for a shadowed helper, a bare call, a missing acquired check, and an acquired check after mutation.
- Update the current positive fixture to include the real import and early-return shape.

## Likely Issues

### TRC20-03 - Shared-group reads mix React request caching with hidden view-count side effects

Severity: Medium
Confidence: Medium
Status: Likely issue

Code regions:

- `apps/web/src/lib/data.ts:1322-1325`
- `apps/web/src/lib/data.ts:1392-1407`
- `apps/web/src/lib/data.ts:1830-1834`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`
- `apps/web/src/app/actions/public.ts:518-559`

Failure scenario:

`getSharedGroup()` is primarily a reader, but it also calls `bufferGroupViewCount(group.id)` unless `incrementViewCount` is false or a valid `selectedPhotoId` is supplied. The cached wrapper `getSharedGroupCached = cache(getSharedGroup)` explicitly warns not to call it twice with different count semantics in the same render path. The public shared-group page uses the cached reader and then separately calls `recordSharedGroupView()` for durable analytics.

The current page path appears intentional: the denormalized group counter is skipped for selected-photo deep links while durable analytics is recorded only after selection is resolved. The risk is that the reader's hidden mutation is now controlled by React cache call identity and call order. A future metadata, layout, or child component read can accidentally suppress, duplicate, or reorder the denormalized counter independently of durable analytics. This is a tracing smell because one logical public view is split across a cached reader side effect and an explicit action.

Concrete fix:

- Split `getSharedGroup()` into a pure cached reader and an explicit counter/analytics function.
- Keep `getSharedGroupCached` side-effect free.
- Have the route call one explicit post-resolution function that records both the denormalized group counter and durable analytics according to the same selected-photo decision.
- Add a regression test proving repeated cached reads do not increment counters, and one explicit view-record call increments the intended durable and denormalized paths exactly once.

## Manual-Validation Risks

These are not confirmed code defects from this pass, but they remain operationally important because they depend on live host state, process lifetime, or external configuration.

### MVR20-01 - Pending logout revocations during restore are process-local

Code regions:

- `apps/web/src/app/actions/auth.ts:286-315`
- `apps/web/src/lib/pending-session-revocations.ts:4-22`
- `apps/web/src/app/[locale]/admin/db-actions.ts:646-649`

Risk:

Logout during restore deletes the browser cookie and queues server-side session revocation in process memory. If the process exits before restore completes and before `flushPendingSessionRevocations()` runs, the queued DB deletion is lost. The code documents this behavior and the user is logged out client-side, so this is a manual validation/operational risk rather than a newly confirmed bug. Verify acceptable behavior during deploy restarts that overlap restore windows.

### MVR20-02 - CLIP production activation still depends on live model/weight state

Code regions:

- `apps/web/src/app/api/search/semantic/route.ts:189-201`
- `apps/web/src/app/api/search/similar/[id]/route.ts:115-131`
- `apps/web/src/lib/clip-embeddings.ts:237-257`
- `apps/web/scripts/backfill-clip-embeddings.ts:122-247`

Risk:

The code correctly gates production semantic search on configured mode and production embedding version, and the backfill script uses locking plus durable markers. Actual readiness still depends on the deployed env, local model files, seeded weights, and DB embedding coverage. Validate the live host with the CLIP operator runbook before advertising semantic search availability.

### MVR20-03 - Service-worker and edge-cache correctness depends on generated artifact plus host headers

Code regions:

- `apps/web/public/sw.template.js:43-71`
- `apps/web/public/sw.template.js:278-390`
- `apps/web/public/sw.js:26`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/proxy.ts:120-122`

Risk:

The service worker excludes admin, API, share-map, and revocable share routes, and it avoids caching sensitive responses. The generated `sw.js` appears stamped from the template. Remaining correctness depends on the built artifact being regenerated when template policy changes and on host/proxy cache headers matching the documented no-store expectations. Validate after deploy with a real browser session and cache inspection.

## Flow Notes

- Upload -> process -> DB -> public render: browser upload and Lightroom upload both check maintenance/restore state, acquire upload contract locks, reserve upload tracker claims before expensive work, write originals before DB insert, and enqueue processing after commit. Processing rechecks restore state before embedding writes. I did not find a confirmed race in this path.
- Restore/backup: export actions enter the admin mutation barrier and restore actions use durable maintenance, restore locks, queue quiescing, and drain checklists. The unbounded shared-group flush is the main restore mismatch found.
- Admin mutations: current inspected actions generally combine same-origin checks, mutation slots, and acquired early returns. The scanner's proof is weaker than the implementation pattern.
- Auth/session/logout: login and logout enforce same-origin checks and mutation slots. Token auth is limited to approved scopes for Lightroom upload. Pending restore-time revocations are intentionally buffered in memory.
- Public sharing: share-key and group routes validate expiry and processed image state before analytics. Service-worker exclusions cover revocable share/group paths.
- CLIP semantic search: public APIs enforce same-origin, maintenance checks, rate limits, semantic-search mode, embedding version, and result enrichment. Backfill has locking and budget/keyset controls.
- Analytics: durable public analytics writes are tracked through background DB write drains. Shared-group denormalized view counts are buffered separately and drive TRC20-01/TRC20-03.
- Migrations/deploy: migration journal and postcondition checks are present; deploy performs build, health check, then Docker pruning after `up -d` and avoids `volume prune -a`. I did not find a confirmed deploy/migration regression.

## Final Sweep

Commonly missed tracing checks completed:

- Restore drains include background DB writes, maintenance sweeps, image queue side effects, and admin mutation slots; shared-group view counts are the unbounded missing stage.
- Server-action origin and mutation-barrier linting was tested against the current source-contract gate; the gate passes but has a confirmed false-green pattern.
- Cached data readers were checked for side effects; shared-group caching is the remaining suspicious reader/mutation mix.
- Service-worker sensitive-route exclusions were checked against public share/group/admin/API routes.
- CLIP read APIs and backfill scripts were checked for mode/version gates, rate limits, locks, and restore/maintenance interaction.
- Migration and deploy scripts were checked for journal postconditions, health-check ordering, and disk-prune safety.

Findings: 2 confirmed issues, 1 likely issue, 3 manual-validation risks.
