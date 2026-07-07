# Cycle 17 Tracer Review

Role: tracer subagent, cycle 17/100.
Scope: whole-repository causal tracing of cross-file data/control flows. No fixes implemented.
Validation: static tracing with line-level source inspection across the upload, processing queue, DB/migration/restore, admin guard, public data/privacy, semantic search, image serving/cache, deployment, docs, and test-contract surfaces listed below.

## Trace-Relevant Inventory

Context and operational contracts:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- Prior review ledger/history in `.context/reviews/tracer.md` before this update

Upload, processing, and storage:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/upload-contract.ts`
- `apps/web/src/lib/upload-quota.ts`
- `apps/web/src/lib/disk-space.ts`
- `apps/web/src/lib/file-utils.ts`
- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/src/__tests__/settings-backfill-required-action.test.ts`

Admin actions, guards, audit, and revalidation:
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`

Public route/data/cache/privacy:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- Public page/API consumers under `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/app/api/og/**`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`

Restore, maintenance, migration, and DB durability:
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/background-db-writes.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/drizzle/**/*.sql`
- `apps/web/drizzle/meta/_journal.json`

Semantic search and embeddings:
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/lib/clip-embeddings.ts`
- `apps/web/src/lib/clip-inference.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- Embedding write paths in `apps/web/src/lib/image-queue.ts`

Image serving, cache headers, and deployment:
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/uploads/[...path]/route.ts`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/src/instrumentation.ts`

## Confirmed Issues

### T17-TRC-01: CLI color backfill snapshots processing settings before acquiring the backfill lock

Severity: High
Confidence: High
Status: Confirmed

Code regions:
- `apps/web/scripts/backfill-color-pipeline.ts:317-340` reads `getGalleryConfig()` and builds `backfillSettings` before lock acquisition.
- `apps/web/scripts/backfill-color-pipeline.ts:342-365` acquires `LOCK_COLOR_PIPELINE_BACKFILL` only after that snapshot.
- `apps/web/scripts/backfill-color-pipeline.ts:453-480` later stamps successful rows with the current `IMAGE_PIPELINE_VERSION`.
- `apps/web/src/app/actions/settings.ts:227-250` uses the same advisory lock to block settings saves while a backfill is already running.
- `apps/web/src/app/actions/settings.ts:259-265` invalidates the detached config cache after settings commits.
- `apps/web/src/lib/admin-backfill-runner.ts:675-714` shows the safer in-app pattern: settings are read inside the lock-owned run.
- `apps/web/src/lib/admin-backfill-runner.ts:873-920` acquires the backfill lock before handing work to the runner.

Why this is a problem:
The cycle 16 fix closed the in-app race where byte-impacting gallery settings could change during a color pipeline backfill. The standalone sidecar script still has a stale-snapshot window: it reads quality, sizes, gamut/HDR, AVIF effort, chroma, and max-pixel settings before it owns the `gallery_color_pipeline_backfill` lock. The settings action can acquire the lock, commit new byte-impacting settings, and release it between the script's config read and lock acquisition. The script then obtains the lock and re-encodes derivatives using stale settings while marking rows with the current pipeline version.

Concrete failure scenario:
1. Operator starts `apps/web/scripts/backfill-color-pipeline.ts`; it passes the restore check and reads old settings at lines 325-340.
2. Before the script reaches or wins `GET_LOCK`, an admin saves a color-impacting setting such as `wide_gamut_jpeg_chroma` or `avif_effort`.
3. The settings action acquires `LOCK_COLOR_PIPELINE_BACKFILL`, commits the new value, invalidates the detached config cache, and releases the lock.
4. The sidecar then acquires the lock and processes candidates using the old `backfillSettings`.
5. Successful rows are updated with `pipeline_version = IMAGE_PIPELINE_VERSION`, so future pipeline-version backfills treat stale derivative bytes as current.

Suggested fix:
Move the sidecar's config read and `backfillSettings` construction until after the script has successfully acquired `LOCK_COLOR_PIPELINE_BACKFILL` and after the post-lock restore-maintenance assertion. Prefer `getGalleryConfigStrict()` or a direct non-React detached/strict accessor for this write path, because fallback defaults would be unsafe for derivative generation. Add a source-contract or unit test that pins the ordering: `GET_LOCK` must occur before `getGalleryConfig`/settings snapshot in `backfill-color-pipeline.ts`.

## Likely Issues

None found in this cycle after tracing the required flows.

## Risks Needing Manual Validation

### T17-TRC-R01: Live proxy topology still determines whether per-IP rate limits are real-client scoped

Severity: Medium
Confidence: Medium
Status: Manual-validation risk, already documented in config comments

Code regions:
- `apps/web/nginx/default.conf:20-28` documents that `$binary_remote_addr` rate-limit zones need real-IP configuration in LB-fronted deployments.
- `apps/web/nginx/default.conf:59-71` documents that overwriting `X-Forwarded-For` with `$remote_addr` is correct only when the TCP peer is the real client.
- `apps/web/docker-compose.yml:15-23` runs the app on host networking with `TRUST_PROXY=true`.
- `apps/web/src/lib/rate-limit.ts:175-205` trusts proxy headers only when enabled and otherwise collapses requests to the `unknown` bucket.

Why this matters:
The repository-level configuration contains clear warnings and the app-side parser is defensively implemented. The missing piece cannot be proven from the repository: whether production nginx receives the actual client IP, whether a TLS/LB hop is present, and whether `ngx_http_realip_module` or PROXY protocol is configured outside this repo. If production is LB-fronted but leaves the checked-in overwrite behavior unchanged, app and nginx rate limits collapse all visitors behind the LB into shared buckets.

Concrete failure scenario:
A CDN or load balancer connects to host nginx from one source IP. Nginx uses `$remote_addr` for `X-Forwarded-For` and `$binary_remote_addr` for all limiter zones. Five failed login attempts or a high public-page request rate from one client can consume the shared bucket for unrelated visitors.

Suggested validation:
On the live host, confirm the actual edge chain and real-IP module/proxy-protocol configuration. Send two requests through the public edge from distinct client networks and verify both nginx access logs and app-side `getClientIp()` observe distinct client addresses. If nginx is behind an LB, switch `X-Forwarded-For` to append mode, configure trusted real-IP sources for nginx limiter zones, and set `TRUSTED_PROXY_HOPS` to the real trusted suffix length.

## Flows Traced Without New Findings

Upload -> processing -> queue -> DB:
Browser uploads in `apps/web/src/app/actions/images.ts:129-653` and Lightroom uploads in `apps/web/src/app/api/admin/lr/upload/route.ts:84-612` both gate restore maintenance, origin/admin auth where applicable, quota/disk checks, upload contract locks, strict settings snapshots, original file writes, HDR/GPS policy, DB insert, queue enqueue, audit, and revalidation. `apps/web/src/lib/image-queue.ts:722-1096` rechecks restore shutdown, claims per-image processing, resolves original paths, applies persisted settings snapshots, verifies derivative output, updates processed fields, handles delete-mid-processing cleanup, and writes caption/embedding side effects with current mode checks.

Admin actions -> guards -> audit/revalidation:
Mutating admin actions inspected use restore-maintenance checks, same-origin/admin guards, admin mutation slots, audit logging, and `revalidateAllAppData()` or localized revalidation as appropriate. The lint surfaces in `apps/web/scripts/check-action-origin.ts` and `apps/web/scripts/check-api-auth.ts` enforce those contracts for future route/action additions.

Public route -> data -> cache/privacy:
`apps/web/src/lib/data.ts:368-488` derives public field sets from admin fields and compile-guards sensitive keys. Public listings/feed/share/group/map/timeline/search routes use those field sets or guarded mirrors (`apps/web/src/lib/data-timeline.ts:20-67`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`). Public server actions in `apps/web/src/app/actions/public.ts:132-329` validate input and rate-limit expensive load-more/search paths before DB work. React `cache()` uses are request-scoped data-access dedupe, and mutations revalidate the app layout via `apps/web/src/lib/revalidation.ts:59-64`.

Restore/maintenance -> migration:
Restore in `apps/web/src/app/[locale]/admin/db-actions.ts` obtains DB restore, upload contract, color backfill, and semantic/index locks before setting durable maintenance, draining shared-group views, queue jobs, background writes, maintenance sweeps, and admin mutations. SQL restore scanning and migration postconditions are layered through `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, and `apps/web/scripts/migrate.js`. No additional restore/migration race was confirmed.

Semantic search -> embeddings -> results:
`apps/web/src/app/api/search/semantic/route.ts:107-368` enforces same-origin, restore guard, content-type/body-size checks, rate-limit pre-increment, active semantic mode, model-version filtering, bounded scan, embedding decoding, and no-store responses. `apps/web/src/app/api/search/similar/[id]/route.ts:68-286` applies the same origin/maintenance/rate-limit posture and serves only production model rows. Embedding helpers in `apps/web/src/lib/clip-embeddings.ts:41-48` clamp scan/topK environment values and `apps/web/src/lib/clip-embeddings.ts:188-205` centralizes legacy/current blob decoding. Result enrichment is shared and compile-guarded in `apps/web/src/lib/search-enrichment-fields.ts:29-47`.

Image serving -> cache headers:
`apps/web/src/lib/serve-upload.ts` confines derivative serving to allowed upload subdirectories, rejects symlink/path traversal, and builds ETags from pipeline version, mtime, size, and settings hash. Upload routes delegate GET/HEAD to that helper. `apps/web/next.config.ts` and `apps/web/nginx/default.conf:210-226` align derivative cache policy at `public, max-age=3600, must-revalidate`, while originals are blocked by `apps/web/nginx/default.conf:206-208` and legacy public originals are asserted at startup by `apps/web/src/instrumentation.ts`.

## Final Missed-Issues Sweep

Reviewed current dirty state before writing: other review lanes already modified `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/test-engineer.md`, and `.context/reviews/verifier.md`; this tracer pass did not inspect or alter their content.

No trace-relevant source file in the inventory above was intentionally skipped. Generated/runtime artifacts and dependency output (`node_modules`, `.next`, screenshots, logs, build caches, uploaded binary assets) were not reviewed because the task is causal source/config tracing and those artifacts do not define repository behavior. No test suite was executed; this is a static review artifact.
