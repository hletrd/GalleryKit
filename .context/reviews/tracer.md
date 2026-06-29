# Cycle 14 Tracer Review

Mode: current-HEAD causal tracing review only. I did not modify production code. This report is the only intended write.

HEAD reviewed: `c2da917d0fe9620bcbef3897570591080445592c` (`master`).

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then built a trace inventory before inspecting implementation files. The inventory covered 297 repository files under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/components`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, and `apps/web/public`, with emphasis on the requested causal paths:

- uploads/originals/processing/backfills/deletes
- auth/session/admin actions/admin APIs
- public share/search/OG/routes/rate limits
- restore/migrations/deploy
- privacy field flow
- UI state flows

I reviewed current HEAD only. I did not use historical diffs as evidence except to note when an older report's hypothesis is no longer true in current HEAD.

## Trace-Relevant Inventory

Upload, original-file, processing, backfill, and delete paths:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-alt-text.ts`
- `apps/web/scripts/backfill-colors.ts`
- `apps/web/scripts/backfill-embeddings.ts`
- `apps/web/scripts/backfill-image-metadata.ts`

Auth, sessions, admin actions, and admin APIs:

- `apps/web/src/proxy.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/action-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`

Public share, search, OG, analytics, and rate-limit paths:

- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/lib/analytics-data.ts`

Restore, migration, schema, deployment, and runtime locks:

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

Privacy-shaped reads and UI state flows:

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/register-service-worker.tsx`
- `apps/web/src/lib/sw-cache.ts`
- `apps/web/public/sw.template.js`
- `apps/web/public/sw.js`

## Confirmed Issues

None found.

The highest-risk older tracer concern, service-worker caching of unlocalized admin routes, is fixed in current HEAD. `apps/web/public/sw.template.js:42-47`, `apps/web/public/sw.js:42-47`, and `apps/web/src/lib/sw-cache.ts:54-63` all now bypass `/admin/*`, locale-prefixed `/[locale]/admin/*`, and `/api/admin/*`.

## Likely Issues

None found.

The upload and processing path has the expected causal gates: same-origin and admin checks before writes, restore-maintenance checks before and after original-file persistence, upload preclaim rollback, DB insert rollback/cleanup, queue transition only after derivative verification, and delete-during-processing cleanup. Key regions reviewed include `apps/web/src/app/actions/images.ts:114-614`, `apps/web/src/app/actions/images.ts:616-854`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-360`, and `apps/web/src/lib/image-queue.ts:600-805`.

The auth/admin path is also coherent: server actions use same-origin checks, admin APIs are wrapped by `withAdminAuth`, PAT use is scoped and rate-limited, session tokens are HMAC-bound, and proxy admin route handling is current. Key regions reviewed include `apps/web/src/app/actions/auth.ts:23-281`, `apps/web/src/lib/session.ts:1-151`, `apps/web/src/lib/api-auth.ts:55-140`, `apps/web/src/lib/admin-tokens.ts:1-242`, and `apps/web/src/proxy.ts:52-129`.

Public search/share/OG routes have the intended pre-increment rate-limit posture and privacy-shaped result enrichment. Key regions reviewed include `apps/web/src/app/api/search/semantic/route.ts:106-359`, `apps/web/src/app/api/search/similar/[id]/route.ts:60-236`, `apps/web/src/app/api/og/route.tsx:33-224`, `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:34-132`, and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:39-240`.

## Risks Needing Manual Validation

### RISK-TRC14-01 - Similar-search target visibility is inferred from embedding existence

Severity: Low
Confidence: Low
Status: Risk needing manual validation, not a confirmed bug

Code region:

- `apps/web/src/app/api/search/similar/[id]/route.ts:115-139`
- `apps/web/src/app/api/search/similar/[id]/route.ts:198-205`
- `apps/web/src/db/schema.ts:280-287`
- `apps/web/src/lib/image-queue.ts:653-742`

Failure scenario:

`/api/search/similar/[id]` loads the target vector directly from `image_embeddings` and checks only `image_id` plus `model_version` at `apps/web/src/app/api/search/similar/[id]/route.ts:118-125`. Result enrichment later filters returned neighbors through `images.processed = true` at `apps/web/src/app/api/search/similar/[id]/route.ts:198-205`, but the target image itself is not joined back to `images` to prove it is currently public/processed before doing the scan.

Under normal application flow this appears safe: embeddings are written after `processed=true` is committed (`apps/web/src/lib/image-queue.ts:653-742`), and the schema declares `image_embeddings.image_id` as a foreign key to `images.id` with `onDelete: 'cascade'` (`apps/web/src/db/schema.ts:280-287`). The risk would require schema drift, manual DB surgery, disabled constraints, or a future backfill that writes embeddings for rows that are not public-visible. In that state, a same-origin public request for an otherwise hidden target id could still use that hidden target vector to find public neighbors.

Concrete fix:

Make the target lookup use the same public-visibility invariant as the result lookup. Join `image_embeddings` to `images` and require `images.processed = true` before accepting the target embedding. This is a small defense-in-depth change and should be paired with a regression test that a non-processed image id with an embedding row returns `404`.

## Negative Findings By Flow

Uploads/originals/processing/deletes:

- Original uploads are written under the private original root with safe filename validation and strict deletion helpers (`apps/web/src/lib/upload-paths.ts:1-130`).
- Browser upload and Lightroom upload both use tracker preclaim/settle, restore guards, disk checks, topic validation, and cleanup of saved originals on DB failure (`apps/web/src/app/actions/images.ts:114-614`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-360`).
- Queue processing verifies all derivatives before marking `processed=true`, detects delete-during-processing by conditional update, and then removes generated derivatives (`apps/web/src/lib/image-queue.ts:639-675`).
- Delete paths remove queue state, DB rows, original files, all derivative variants, and share revalidation paths (`apps/web/src/app/actions/images.ts:616-854`).

Auth/session/admin actions:

- Login, logout, password update, and user/session management enforce same-origin before mutation (`apps/web/src/app/actions/auth.ts:23-281`, `apps/web/src/app/actions/admin-users.ts`).
- Admin API wrappers fail closed for cookie auth without same-origin and scope PATs for token auth (`apps/web/src/lib/api-auth.ts:55-140`).
- The API-auth lint gate passed and reported both current admin API routes as wrapped.

Public share/search/OG/routes/rate limits:

- Share pages use generic metadata without resolving private share contents during metadata generation, then rate-limit the actual page lookup before fetching shared data (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:34-132`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:39-240`).
- Semantic search checks mode before public budget use, applies same-origin, content-type, body-size, and rate-limit guards, then uses compile-guarded enrichment fields (`apps/web/src/app/api/search/semantic/route.ts:106-359`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`).
- OG routes bound CPU/network work with pre-increment rate limits, input validation, same-origin fallback URL checks, and bounded image fetches (`apps/web/src/app/api/og/route.tsx:33-224`, `apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`, `apps/web/src/lib/og-photo-fetch.ts:64-118`).

Restore/migrations/deploy:

- Restore takes DB restore, upload-processing, and color-backfill locks; begins maintenance; flushes analytics; quiesces the queue; and resumes in `finally` paths (`apps/web/src/app/[locale]/admin/db-actions.ts:1-520`, `apps/web/src/lib/queue-shutdown.ts:16-49`, `apps/web/src/lib/restore-maintenance.ts:1-56`).
- Migrations baseline and reconcile the current schema, then assert committed journal hashes are present in `__drizzle_migrations` (`apps/web/scripts/migrate.js:1-872`).
- Deploy remains env-driven, runs compose up before pruning, and avoids pruning in-use volumes/images (`apps/web/deploy.sh:1-62`, `apps/web/scripts/deploy-remote.sh:1-72`).

Privacy field flow:

- Public selects intentionally omit admin-only fields, privacy-sensitive keys are type-guarded, and search enrichment is compile-guarded against `_PrivacySensitiveKeys` (`apps/web/src/lib/data.ts:375-489`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`, `apps/web/src/__tests__/privacy-fields.test.ts`).
- Public map reads require processed images and topic map visibility before exposing coordinates (`apps/web/src/lib/data.ts:1658-1688`).

UI state flows:

- Search uses abort controllers and request ids to avoid stale responses replacing newer state (`apps/web/src/components/search.tsx:126-360`).
- Load-more resets cursor/query state and guards observer-driven concurrent loads (`apps/web/src/components/load-more.tsx:23-161`).
- Photo viewer/lightbox state cleans up timers, session-storage flags, selected photo params, and keyboard listeners across image changes and unmounts (`apps/web/src/components/photo-viewer.tsx:79-420`, `apps/web/src/components/lightbox.tsx:81-460`).

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- Targeted `rg` sweeps for `TODO`, `FIXME`, `HACK`, security/origin/rate-limit/share/original/delete/restore/privacy/session/admin/processed terms across trace-relevant source paths.
- Line-based inspection with `nl -ba` for the route/action/library regions cited above.

I did not run the full Vitest suite, Next build, Playwright e2e, or a live restore/dump dry run because this was a read-only tracing review and the static/runtime guard scripts plus source tracing were sufficient for the review claim. Those remain residual validation gaps.

## Final Missed-Issues Sweep

I performed a final sweep across the trace inventory for common missed issue classes: stale admin caching, missing same-origin on mutating server actions, unwrapped admin API exports, public mutating routes without rate-limit helpers, private-field select leakage, processed/unprocessed visibility gaps, share-key lookup paths, OG fallback URL validation, restore-vs-upload concurrency, delete-during-processing cleanup, and stale UI async state.

No trace-relevant source files identified in the inventory were intentionally skipped. I did not line-review non-source assets, generated/build output, `node_modules`, runtime upload/data directories, screenshots, or unrelated static media. I also did not treat test fixture files as production causal paths except where they enforce a relevant invariant, such as the privacy-field guard.

Residual risk is concentrated in unsupported or manual-ops states: schema constraints disabled or drifted, multi-web-process restore maintenance despite the documented single-web-instance deployment, and database-only restore without a matching file snapshot. These are operational validation risks, not confirmed current-HEAD code defects.
