# Cycle 15 Tracer Review

Mode: current-HEAD causal tracing review only. I did not modify production source code. This report is the only intended write.

HEAD reviewed: `d401dd680e43faec35ea697d2f13326ee242a774`.

## Scope And Method

I loaded `AGENTS.md`, `CLAUDE.md`, and the code-review skill, then inventoried the request-to-DB and background-flow surfaces before tracing cross-file interactions. The review focused on:

- request -> DB paths for public pages, public actions, admin actions, and admin APIs
- browser upload and Lightroom upload -> original file -> queue -> derivatives -> processed row
- share/search/semantic/similar/OG rate-limit posture
- restore maintenance, queue quiescence, migration reconciliation, and post-restore migration
- semantic-search embedding writes and reads
- cache/revalidation, service-worker bypasses, and derivative serving
- public/admin UI action flows

## Trace Inventory

Upload, original-file, queue, derivative, and retry paths:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/scripts/backfill-clip-embeddings.ts`

Public request, share, search, rate-limit, and analytics paths:

- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`

Restore, migration, maintenance, and cache paths:

- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/public/sw.template.js`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`

Auth/admin API and UI action surfaces:

- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`

## Findings

No confirmed, likely, or risk-level tracer findings in current HEAD.

## Negative Findings By Flow

Upload -> queue -> derivatives:

- Browser uploads take restore maintenance, same-origin, auth, upload-quota, topic, and upload-processing-contract gates before saving/inserting/enqueueing (`apps/web/src/app/actions/images.ts:114-242`, `apps/web/src/app/actions/images.ts:267-324`, `apps/web/src/app/actions/images.ts:349-523`).
- Lightroom uploads mirror the same body-size, quota, topic, contract-lock, HDR/GPS, late-maintenance, insert, enqueue, audit, and revalidation flow (`apps/web/src/app/api/admin/lr/upload/route.ts:67-148`, `apps/web/src/app/api/admin/lr/upload/route.ts:222-329`, `apps/web/src/app/api/admin/lr/upload/route.ts:330-545`).
- The queue claims rows with an advisory lock, verifies source and derivative files, marks `processed=true` only with a conditional update, and cleans derivatives if the row was deleted mid-processing (`apps/web/src/lib/image-queue.ts:489-560`, `apps/web/src/lib/image-queue.ts:622-676`).
- Permanent-failure retry handles `enqueueImageProcessing()` rejection by restoring a visible failed state, avoiding hidden unprocessed rows on manual retry (`apps/web/src/app/actions/images.ts:1163-1273`).

Share/search rate limits and visibility:

- Shared photo/group metadata stays generic and does not do unthrottled key lookups; the page body validates base56 and pre-increments the share lookup limiter before DB lookup (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:35-101`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:40-115`).
- Public text search and load-more actions validate, rate-limit, and roll back only on the intended low-cost error branches (`apps/web/src/app/actions/public.ts:116-230`, `apps/web/src/app/actions/public.ts:232-312`).
- Semantic search applies same-origin, maintenance, content-type, body-size, mode, and pre-increment gates before embedding/scanning, then enriches only `images.processed=true` rows (`apps/web/src/app/api/search/semantic/route.ts:106-205`, `apps/web/src/app/api/search/semantic/route.ts:248-359`).
- Similar search now joins the target embedding to `images` and requires `images.processed=true`; this fixes the older cycle-14 low-confidence target-visibility risk (`apps/web/src/app/api/search/similar/[id]/route.ts:115-140`, `apps/web/src/app/api/search/similar/[id]/route.ts:145-211`).
- Search enrichment uses the shared compile-guarded select (`apps/web/src/lib/search-enrichment-fields.ts:29-46`).

Restore, migrations, and maintenance:

- Restore acquires the DB restore lock, upload-processing contract lock, and color-backfill lock before `beginRestoreMaintenance()`, then flushes shared-group view buffers and quiesces the queue before import (`apps/web/src/app/[locale]/admin/db-actions.ts:288-393`).
- On success, restore runs post-restore migrations before reporting success and revalidating (`apps/web/src/app/[locale]/admin/db-actions.ts:588-613`, `apps/web/src/app/[locale]/admin/db-actions.ts:650-676`).
- Failed imports/post-restore migration failures intentionally keep maintenance active; this behavior is source-locked by tests and is not reported as a bug (`apps/web/src/app/[locale]/admin/db-actions.ts:397-405`, `apps/web/src/__tests__/restore-upload-lock.test.ts:57-77`).
- Queue quiescence uses `pause -> clear -> onIdle`, drains tracked side effects, and resets bootstrap state for post-restore discovery (`apps/web/src/lib/image-queue.ts:1036-1090`).
- Migration bootstrap/reconcile baselines every journal hash and asserts post-migrate hash coverage, addressing the non-monotonic journal cursor hazard (`apps/web/scripts/migrate.js:704-808`).

Cache, revalidation, and serving:

- Dynamic public pages use `revalidate = 0` where fresh DB state matters (`apps/web/src/app/[locale]/(public)/page.tsx:15-16`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:15`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:20`).
- Mutation paths revalidate affected page/admin/share paths or the full app layout as appropriate (`apps/web/src/app/actions/images.ts:595-596`, `apps/web/src/app/actions/images.ts:707`, `apps/web/src/app/actions/images.ts:858-868`, `apps/web/src/app/actions/sharing.ts:337-380`, `apps/web/src/lib/revalidation.ts:30-64`).
- The service worker bypasses `/admin/*`, locale-prefixed `/[locale]/admin/*`, and `/api/admin/*`, and the pure helper mirrors that logic (`apps/web/public/sw.template.js:42-47`, `apps/web/src/lib/sw-cache.ts:54-63`).
- Upload derivative routes pass request abort signals for GET and avoid opening streams for HEAD (`apps/web/src/app/uploads/[...path]/route.ts:4-22` and the locale-prefixed mirror).

Public/admin UI:

- Public analytics writes validate target visibility, rate-limit per IP, and skip during restore maintenance (`apps/web/src/app/actions/public.ts:365-455`).
- Admin DB restore UI performs a client-side restore-size check before invoking the server action and shows result state without bypassing server-side guards (`apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:65-101`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:177-235`).
- Admin API routes are covered by `withAdminAuth`, and token upload uses scoped PAT auth while cookie auth keeps same-origin enforcement (`apps/web/src/lib/api-auth.ts:55-141`, `apps/web/src/app/api/admin/lr/upload/route.ts:67-72`).

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- --run src/__tests__/similar-route.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/rate-limit.test.ts src/__tests__/public-actions.test.ts` - passed: 5 files, 89 tests.

I also ran targeted `rg` sweeps for `TODO`, `FIXME`, `HACK`, race/TOCTOU/orphan/stale/cache/revalidate/processed terms and line-reviewed the cited route/action/library regions.

## Final Missed-Issues Sweep

I specifically re-checked:

- upload acceptance vs queue enqueue rejection
- restore maintenance interleavings with browser/LR upload
- delete-during-processing cleanup
- similar-search target visibility
- semantic result enrichment visibility and privacy
- share-key metadata lookup leakage
- public route/action rate-limit order
- admin API wrapping and same-origin enforcement
- restore failure/maintenance lifecycle
- migration journal coverage
- service-worker admin bypass and offline cache shape
- derivative route cache/revalidation behavior

No trace-relevant source files in the inventory were intentionally skipped. I did not line-review generated assets, screenshots, runtime upload/data directories, or unrelated static media. Residual risk remains operational rather than code-confirmed: the documented single-web-instance topology is required for process-local maintenance and public rate-limit buckets, and DB restore still needs a matching filesystem backup for full rollback.
