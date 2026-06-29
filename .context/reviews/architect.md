# Cycle 15 Architect Review

## Scope and Inventory

Reviewed current HEAD `d401dd68`. I read `AGENTS.md` and `CLAUDE.md` first, inventoried the architecture surfaces, then inspected implementation and tests by subsystem. No source code was modified.

Inventory covered:

- Docs and operating contracts: `AGENTS.md`, `CLAUDE.md`, root/package config, Next/TypeScript config, Docker, Nginx, deploy scripts.
- UI/server contracts: app routes and server actions under `apps/web/src/app`, admin/public layouts, upload route twins, API routes, service-worker registration and generated assets.
- Domain/data layer: `apps/web/src/lib/data.ts`, analytics/search/sharing/settings/gallery config modules, privacy projection guards, public/admin data shapes.
- State and cache ownership: service worker cache modules, upload serving, revalidation, process-local queues, restore maintenance, rate limits, view-count buffering, advisory locks.
- Data model and migrations: `apps/web/src/db/schema.ts`, all committed Drizzle migrations, `_journal.json`, `apps/web/scripts/migrate.js`, reconcile/baseline/postcondition tests.
- Deployment topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, entrypoint and runtime env handling.
- Tests and lint contracts: source tests, E2E inventory, custom lint scripts for admin API auth, action origin, public mutating route rate limits, migration coverage, storage quarantine, service-worker contracts.

Architecture-relevant inventory size was 510 files across `src/app`, `src/lib`, `src/db`, migrations, scripts, tests, E2E, and Nginx. I inspected the active runtime/config/schema/test surfaces by subsystem rather than relying on the previous cycle review. Existing unrelated dirty review files were present before this pass and were not used as current-HEAD evidence.

## Findings

### ARCH-C15-01 - Failed restore maintenance blocks the next in-process restore attempt

- Severity: High
- Confidence: High
- Status: Confirmed
- Area: restore lifecycle, state ownership, recovery topology

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:288`-`293` returns `restoreInProgress` immediately when process-local restore maintenance is active.
- `apps/web/src/app/[locale]/admin/db-actions.ts:393`-`405` records `keepRestoreMaintenance` from `runRestore()` and skips `endRestoreMaintenance()` when a failed restore asks to keep maintenance active.
- `apps/web/src/app/[locale]/admin/db-actions.ts:560`-`568` resolves read/stdin/spawn handoff failures with `keepMaintenance: true`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:600`-`615` also keeps maintenance active when post-restore migrations fail or the `mysql` import exits non-zero.
- `apps/web/src/lib/restore-maintenance.ts:1`-`18` stores maintenance state only on `globalThis`; `apps/web/src/lib/restore-maintenance.ts:21`-`26` exposes only a boolean gate/message; `apps/web/src/lib/restore-maintenance.ts:44`-`55` has no owner, phase, recovery token, or retry path.
- `apps/web/src/__tests__/restore-upload-lock.test.ts:57`-`77` source-locks the decision to keep maintenance active after migration and handoff failures, but there is no corresponding test that a corrective restore can be attempted while other writers stay blocked.

Failure scenario:

An admin restores a bad dump, the `mysql` process partially imports and exits non-zero, or the import succeeds but the post-restore migration/reconcile step fails. The code deliberately keeps restore maintenance active to protect the app from serving or mutating a potentially inconsistent database. In that same Node process, the only UI/API recovery path is another call to `restoreDatabase()`, but that action checks `getRestoreMaintenanceMessage()` before it tries to acquire `LOCK_DB_RESTORE` or validate a new restore file. The corrected dump is rejected as "restore in progress" even though the previous restore process and DB advisory locks are gone. Recovery now requires manual process restart or out-of-band DB repair, exactly when the restore UI is supposed to be the recovery mechanism.

Concrete fix:

Split "writers are blocked because the DB may be inconsistent" from "no restore may start." Let `restoreDatabase()` enter a narrowly authenticated recovery branch when maintenance is active and the DB restore advisory lock is free, while keeping uploads, public writes, analytics writes, image queue work, token mutation, and semantic search blocked. A durable or process-local restore phase/owner token is enough for the single-process topology; if the state moves to shared storage later, store `{active, phase, owner, lastFailure}` and require a new restore to replace the failed owner after lock acquisition. Add regression tests for a failed import/migration followed by a second restore attempt that is allowed, plus tests that unrelated mutating routes remain blocked until a successful restore exits maintenance.

### ARCH-C15-02 - Locale-prefixed upload derivatives bypass the service-worker image cache policy

- Severity: Medium
- Confidence: Medium
- Status: Likely issue
- Area: cache ownership, URL contract, locale routing

Citations:

- `apps/web/src/lib/sw-cache.ts:73`-`81` treats only root `/uploads/avif|webp|jpeg/...` URLs as image derivatives.
- `apps/web/public/sw.template.js:50`-`55` and the shipped generated `apps/web/public/sw.js:50`-`55` repeat the same root-only predicate.
- `apps/web/public/sw.template.js:386`-`389` and `apps/web/public/sw.js:386`-`389` route only predicate matches through `staleWhileRevalidateImage()`.
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4`-`12` serves locale-prefixed upload derivatives through the same `serveUploadFile()` helper.
- `apps/web/nginx/default.conf:173`-`184` proxies optional locale-prefixed derivative paths to Next with the same cache policy as root uploads.
- `CLAUDE.md:296` documents both route handlers and says they execute for `/uploads/...` and `/{locale}/uploads/...` URLs.
- `apps/web/src/__tests__/sw-cache.test.ts:81`-`100` tests only the root `/uploads/...` predicate shape and has no locale-prefixed derivative case.
- `apps/web/src/lib/image-url.ts:32`-`37` and most components generate root `/uploads/...` URLs today, which lowers immediate blast radius but leaves the supported locale-prefixed URL shape outside the service-worker contract.

Failure scenario:

A user reaches or bookmarks a valid locale-prefixed derivative URL such as `/ko/uploads/jpeg/photo_1536.jpg`, or a future localized component/link builder preserves the locale prefix for image paths because the server and Nginx both explicitly support that shape. The service worker does not classify that request as an image derivative, so it skips the image stale-while-revalidate path, LRU accounting, HEAD freshness probe, and image-cache metadata. Equivalent bytes now have different offline and freshness behavior depending on URL shape. After color, quality, size, or pipeline changes, root URLs and locale-prefixed URLs can refresh differently in the PWA even though the server-side route contract says they are equivalent derivative serving paths.

Concrete fix:

Make the derivative predicate canonical across `src/lib/sw-cache.ts`, `public/sw.template.js`, and regenerated `public/sw.js`, for example by matching an optional locale segment before `/uploads/(avif|webp|jpeg)/`. Add unit tests for `/en/uploads/jpeg/foo.jpg` and `/ko/uploads/avif/foo.avif`, keep `/uploads/original/...` excluded, and keep `sw-template-contract.test.ts` pinning the template/generated pair. If the intended architecture is instead "only root upload URLs participate in PWA image caching," remove or narrow the locale-prefixed upload route/support from docs and Nginx so the serving contract has a single cache owner.

## Final Missed-Issues Sweep

I rechecked the highest-risk architectural seams after drafting findings:

- Restore/upload/image-queue coordination: DB restore uses DB advisory locks, upload-processing contract lock, backfill lock, queue quiesce/resume, and maintenance gates across public/admin mutations. The unresolved gap is specifically the failed-restore retry path above.
- Migration strategy: current migrations, `_journal.json`, `migrate.js`, `migrate-reconcile-coverage.test.ts`, and `migration-journal.test.ts` now cover the previously fragile non-monotonic journal/reconcile path. I did not find a new current-HEAD migration drift issue beyond the existing documented operational constraints.
- Public/admin boundaries: admin API auth wrappers, same-origin server-action guards, privacy omit/type tests, and public projection fields are aligned with the documented model in the sampled route/action/data paths.
- Public unauthenticated expensive GETs: OG routes now pre-increment rate limits and have source/tests locking charged failure semantics, so I did not carry a public-GET rate-limit finding.
- Deployment topology: `CLAUDE.md` explicitly treats the single web instance as a correctness boundary for process-local state. I did not repeat that accepted topology constraint as a new finding this cycle.
- Storage abstraction: the storage module remains quarantined by source tests, so the previous cycle's storage-abstraction risks are future integration risks, not current production coupling defects.
- Cache/serving layers: Next static serving, route-handler fallback, Nginx, service-worker cache, and upload route method tests are mostly aligned. The missed contract is the locale-prefixed derivative URL shape in the service worker.

Tests were not run because this was a review-only task and no production source changed. Validation evidence is direct current-HEAD file/line inspection, targeted source/test sweeps, and the artifact written here.
