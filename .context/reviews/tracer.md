# Cycle 12 Tracer Review

Mode: read-only causal tracing review. I did not implement fixes. This report is the only intended write.

## Scope And Method

I traced the requested flows end to end and validated competing failure hypotheses against code rather than sampling:

- upload -> processing -> DB -> serving
- auth -> actions/routes
- public sharing/revocation -> cache/service worker
- migrations -> deploy
- settings -> backfill/cache
- backup/restore -> schema

Validation evidence run during the review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `node --check apps/web/scripts/migrate.js` passed.

## Review-Relevant Inventory

Upload, processing, DB persistence, retry, and serving:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/uploads/[...path]/route.ts`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`

Auth, admin actions, admin routes, and public mutations:

- `apps/web/src/proxy.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/action-origin.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`

Public sharing, revocation, cache, service worker, and public data shape:

- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/lib/analytics-data.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

Settings, color pipeline, backfill, and cache invalidation:

- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/lib/settings-hash.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-core.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/public/sw.template.js`

Backup, restore, migration, schema, and deploy:

- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/advisory-locks.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/src/db/schema.ts`
- `apps/web/deploy.sh`
- `apps/web/scripts/deploy-remote.sh`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/docker-compose.yml`
- `apps/web/Dockerfile`

## Confirmed Findings

### C12-TRC-01 - Service worker serves deleted image derivatives from stale cache after the server has removed the files

Severity: Medium
Confidence: High
Status: Confirmed

Code region:

- `apps/web/src/app/actions/images.ts:673-697`
- `apps/web/src/app/actions/images.ts:706`
- `apps/web/public/sw.template.js:176-183`
- `apps/web/public/sw.template.js:195-205`
- `apps/web/public/sw.template.js:237-267`
- `apps/web/public/sw.template.js:364-372`

Concrete failure scenario:

1. A visitor loads a shared page or public gallery page, causing a derivative URL under `/uploads/{avif,webp,jpeg}/...` to be cached by the service worker. Image derivatives are explicitly routed through `staleWhileRevalidateImage()` (`apps/web/public/sw.template.js:364-367`).
2. An admin deletes the image. The server removes the DB row and then best-effort deletes original and all derivative variants (`apps/web/src/app/actions/images.ts:673-697`), followed by path revalidation including share paths (`apps/web/src/app/actions/images.ts:706`).
3. The same browser later requests the previously cached derivative URL. The service worker finds a cached entry (`apps/web/public/sw.template.js:176-183`) and sends a `HEAD` probe with the cached ETag (`apps/web/public/sw.template.js:237-244`).
4. If the server now returns `404` or `410`, the code does not evict the cached image. It only treats `304` as fresh and `head.ok` as a possible changed-ETag refresh (`apps/web/public/sw.template.js:245-257`). Non-ok statuses fall through.
5. The background GET revalidation also returns the non-ok response without deleting the cache entry (`apps/web/public/sw.template.js:195-205`), and the handler returns the stale cached bytes to the user (`apps/web/public/sw.template.js:262-267`).

Why this survives the existing revoke/delete cache protections:

- Revocable share HTML is correctly bypassed from HTML caching (`apps/web/public/sw.template.js:370-372`), so revoked share pages do not live in the HTML cache.
- The derivative cache is independent. Once a viewer has the opaque derivative URL, deletion/revocation does not cause the service worker to forget the cached bytes when the server starts returning not found.

Suggested fix:

Teach `staleWhileRevalidateImage()` to treat authoritative `404` and `410` as cache invalidation events. On `HEAD` `404/410`, delete the image cache entry and its LRU metadata, then return a not-found response or a fresh GET result instead of `cached`. In `startRevalidate()`, if the GET returns `404/410`, also delete the cache entry and metadata. Preserve stale fallback for transient network failures and probably for `5xx`, but do not stale-serve after an authoritative deletion response.

### C12-TRC-02 - Public shared-group view recording is bound only to numeric group id, not to the share key

Severity: Low
Confidence: High
Status: Confirmed

Code region:

- `apps/web/src/db/schema.ts:141-149`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:101-131`
- `apps/web/src/app/actions/public.ts:413-439`
- `apps/web/src/lib/data.ts:1323-1328`

Concrete failure scenario:

1. Shared groups have a secret `key`, but also an auto-increment integer `id` (`apps/web/src/db/schema.ts:141-149`).
2. The shared group page correctly resolves access by secret key through `getSharedGroupCached(key, ...)` (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:101-107`).
3. After successful lookup, the page records durable analytics by passing only `group.id` to the public server action (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-131`).
4. The public action validates only that the numeric id exists, is unexpired, and has at least one processed image (`apps/web/src/app/actions/public.ts:413-439`). It does not require or verify the share key.
5. A client that can call the server action can forge view events for guessed valid group ids without knowing the share key. This does not expose images, because `getSharedGroup` still needs the key, but it pollutes `sharedGroupViews` durable analytics. The denormalized view counter path in `getSharedGroup` is key-gated (`apps/web/src/lib/data.ts:1323-1328`), so the issue is isolated to durable event rows.

Suggested fix:

Change `recordSharedGroupView` to accept the group key, or `{ groupId, key }`, and verify `shared_groups.id`, `shared_groups.key`, expiry, and processed-image existence in the same query before inserting `sharedGroupViews`. An even tighter option is to make durable recording server-side after the already-successful `getSharedGroupCached(key, ...)` lookup, avoiding a public id-only action for shared groups.

### C12-TRC-03 - Sidecar color backfill warning is stale about admin retry overlap

Severity: Low
Confidence: High
Status: Confirmed

Code region:

- `apps/web/scripts/backfill-color-pipeline.ts:36-43`
- `apps/web/scripts/backfill-color-pipeline.ts:335-344`
- `apps/web/src/app/actions/images.ts:1180-1201`

Concrete failure scenario:

The sidecar header warns operators not to trigger admin Retry while the sidecar runs because the script does not claim the per-image processing lock (`apps/web/scripts/backfill-color-pipeline.ts:36-43`). The warning no longer matches the current retry candidate set. The sidecar processes `processed = TRUE` rows, or all processed rows with `--force-reencode` (`apps/web/scripts/backfill-color-pipeline.ts:335-344`), while `retryFailedImage` selects only `processed = false` rows with a non-null processing error (`apps/web/src/app/actions/images.ts:1180-1201`). The documented overlap is therefore not currently reachable through admin Retry.

This is not a runtime data-loss bug by itself, but it is operational drift in a high-risk script header. It can send future operators and reviewers toward the wrong race model and away from the actual sidecar constraint: sidecar DB updates remain decoupled from per-row encode work and are not protected by the same per-image lock as in-app processing.

Suggested fix:

Update the script header to reflect the current invariant: admin Retry does not overlap because it targets failed unprocessed rows, while the sidecar targets processed rows. Keep a warning that the sidecar still lacks per-image locking and should remain serialized against other processed-row re-encode paths, or restructure the batching so a per-image lock covers the update window.

## Likely Findings

None. I did not find an unconfirmed-but-probable failure beyond the confirmed issues above and the topology risk below.

## Risks

### C12-TRC-RISK-01 - Restore and queue safety still depends on the documented single web-process topology

Severity: Medium
Confidence: Medium
Status: Risk

Code region:

- `apps/web/src/lib/restore-maintenance.ts:1-56`
- `apps/web/src/lib/image-queue.ts:489-506`
- `apps/web/src/lib/image-queue.ts:1035-1089`
- `apps/web/src/app/[locale]/admin/db-actions.ts:291-399`

Concrete failure scenario:

The restore flow is robust within one process: it acquires DB-level restore/upload/backfill locks, enters restore maintenance, quiesces the local processing queue, runs restore, then resumes in finally blocks (`apps/web/src/app/[locale]/admin/db-actions.ts:291-399`). The maintenance flag itself is process-local global state (`apps/web/src/lib/restore-maintenance.ts:1-56`), and queue enqueue/quiesce decisions consult that local flag and local queue state (`apps/web/src/lib/image-queue.ts:489-506`, `apps/web/src/lib/image-queue.ts:1035-1089`).

Under the current documented single-instance deployment this is acceptable. If the app is accidentally or intentionally scaled to multiple web processes, another process will not see `beginRestoreMaintenance()`. Uploads are still constrained by the DB upload-processing contract lock, but pre-existing queue work on another process can continue through a restore window unless that process is also explicitly quiesced or checks a shared restore-maintenance state.

Suggested fix:

Before any scale-out, move restore maintenance to shared DB/Redis state or have queue workers acquire/check a DB-scoped restore guard before processing. Alternatively, add a startup/runtime guard that fails fast when more than one web instance is configured, making the single-process assumption executable.

## Flow Trace Notes And Ruled-Down Hypotheses

Upload -> processing -> DB -> serving:

- Browser upload validates restore maintenance, same-origin admin, admin user, file metadata, rate limits, disk space, topic existence, save, metadata extraction, EXIF/GPS cleanup, insert, queue enqueue, audit, and revalidation in a single guarded path (`apps/web/src/app/actions/images.ts:114-612`).
- Lightroom upload mirrors the same protections through token/cookie auth, upload tracker preclaim, topic check before save, upload-processing contract lock, disk precheck, original save, HDR/GPS handling, insert, queue enqueue, and cleanup on post-save failures (`apps/web/src/app/api/admin/lr/upload/route.ts:62-531`).
- Queue processing claims a per-image advisory lock, rechecks the DB row is still unprocessed, reprocesses variants from the original, conditionally marks `processed=true`, and deletes generated variants when the row disappeared mid-processing (`apps/web/src/lib/image-queue.ts:519-675`).
- Serving validates derivative path structure, rejects symlinks/non-files, verifies realpath containment, and builds ETags from pipeline version, file stats, and settings hash (`apps/web/src/lib/serve-upload.ts:127-296`).

Ruled down: upload/settings race. Upload and settings changes share the upload-processing contract lock for byte/privacy-impacting settings (`apps/web/src/app/actions/images.ts:175-190`, `apps/web/src/app/api/admin/lr/upload/route.ts:222-238`, `apps/web/src/app/actions/settings.ts:68-166`).

Ruled down: delete while processing leaves orphan variants. The queue conditionally updates the row and scans/deletes all generated variants when the DB row is gone; admin delete also scans all variant sizes, not just current configured sizes (`apps/web/src/lib/image-queue.ts:653-675`, `apps/web/src/app/actions/images.ts:687-697`).

Auth -> actions/routes:

- Admin API routes passed `lint:api-auth`; both admin API files are wrapped by `withAdminAuth`.
- Mutating server actions passed `lint:action-origin`; admin mutations enforce same-origin provenance or carry explicit public/read exemptions.
- Public mutating API route scan passed `lint:public-route-rate-limit`; public semantic search POST uses a rate-limit helper.
- `withAdminAuth` enforces token scope for token auth and origin checks for cookie auth (`apps/web/src/lib/api-auth.ts:55-139`).
- Middleware/proxy protects admin page rendering but intentionally excludes API routes, leaving API auth to route-local wrappers (`apps/web/src/proxy.ts:52-140`).

Ruled down: obvious admin action/API auth wrapper gap. The repository guard scripts passed and spot tracing matched the route/action protections.

Public sharing/revocation -> cache/service worker:

- Share pages are dynamic and non-indexed (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14-26`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:19-31`).
- Metadata lookup avoids probing share keys, and page lookup rate-limits key enumeration before `getImageByShareKeyCached`/`getSharedGroupCached` (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:34-97`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:39-111`).
- Photo and group revocation revalidate affected public paths (`apps/web/src/app/actions/sharing.ts:306-386`).
- Service worker correctly bypasses revocable share HTML from offline HTML caching (`apps/web/public/sw.template.js:370-372`).

Confirmed issue in this flow: derivative bytes can still stale-serve from service-worker cache after server deletion, described in C12-TRC-01.

Migrations -> deploy:

- `migrate.js` reconciles legacy schema before Drizzle migration, baselines every journal entry by hash, then asserts every committed journal hash is present after migration (`apps/web/scripts/migrate.js:293-785`).
- `reconcileLegacySchema` includes current image color/HDR/pipeline columns, sharing tables, sessions, aliases, embeddings, indexes, and removed legacy tables/columns (`apps/web/scripts/migrate.js:342-678`).
- Deploy pulls with `--ff-only`, builds and starts the compose service, then prunes only after successful `up -d --build`; volume prune is not `-a` (`apps/web/deploy.sh:10-58`).
- The Docker image runs migration before `server.js` (`apps/web/Dockerfile:150`).

Ruled down: non-monotonic historical journal `when` values silently skip committed migrations on fresh DB. The reconcile/baseline path and postcondition are designed to record and verify every journal hash.

Settings -> backfill/cache:

- Color-impacting settings hash is built from the expected color/HDR keys plus normalized image sizes (`apps/web/src/lib/settings-hash.ts:45-104`).
- Settings changes that affect upload-time privacy/byte behavior are locked once images exist (`apps/web/src/app/actions/settings.ts:68-133`).
- In-app backfill holds a global backfill lock, claims per-image locks, updates pipeline/hash fields on success, and cleans generated variants if a row disappears mid-reencode (`apps/web/src/lib/admin-backfill-runner.ts:303-617`).
- Derivative serving ETags include settings hash so server-side color-impacting setting changes can invalidate cached derivative responses (`apps/web/src/lib/serve-upload.ts:191-215`).
- The service worker does a synchronous bounded HEAD probe to avoid serving stale colors after ETag changes (`apps/web/public/sw.template.js:211-267`).

Confirmed issue in this flow: the sidecar script's operator warning is stale about admin Retry overlap, described in C12-TRC-03.

Backup/restore -> schema:

- `dumpDatabase` writes through `mysqldump` with password in environment, private backup directory/file modes, stream cleanup, non-empty output validation, and authenticated download URL creation (`apps/web/src/app/[locale]/admin/db-actions.ts:119-242`).
- `restoreDatabase` acquires restore, upload, and backfill locks; enters maintenance; flushes shared group view counts; quiesces queue work; runs restore; runs post-restore migrations; then releases/resumes in finally blocks (`apps/web/src/app/[locale]/admin/db-actions.ts:266-418`).
- `runRestore` validates file size/header, scans chunks for dangerous SQL, wires process handlers before piping stdin, handles ignorable pipe errors, and keeps maintenance active if post-restore migration fails (`apps/web/src/app/[locale]/admin/db-actions.ts:423-584`, `apps/web/src/lib/db-restore.ts:21-34`).

Ruled down: restore leaves the app serving after failed post-restore migration. The restore result can keep maintenance active when post-restore migration fails (`apps/web/src/app/[locale]/admin/db-actions.ts:559-574`, `apps/web/src/app/[locale]/admin/db-actions.ts:375-383`).

## Final Sweep

Commonly missed issues checked:

- Same-origin guard coverage for mutating server actions: passed via `lint:action-origin`.
- Admin API auth wrapper coverage: passed via `lint:api-auth`.
- Public mutating API rate-limit coverage: passed via `lint:public-route-rate-limit`.
- Original upload exposure: nginx denies `/uploads/original/`, app serving route only allows derivative directories, and original roots are outside public derivative serving.
- Path traversal/symlink serving: `serveUploadFile` validates segments, rejects symlinks/non-files, and checks realpath containment.
- Share HTML cache after revoke/delete/expiry: service worker bypasses revocable share HTML cache; derivative cache invalidation remains the confirmed gap.
- Upload quota claim rollback: preclaim is settled on disk/topic failure paths and reconciled to actual successes after the per-file loop.
- Queue/delete interleave: conditional DB update and variant cleanup handle deleted rows.
- Restore queue deadlock: quiesce clears paused queue before `onIdle`, then drains side effects.
- Migration cursor drift: postcondition checks all committed journal hashes.

Skipped files:

- I did not deep-review presentational-only components, locale JSON copy, or e2e test bodies unless they participated in the traced flows above. No review-relevant flow file in the inventory above was intentionally skipped.
