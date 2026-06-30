# Cycle 28 Debugger Review

Review target: `/Users/hletrd/flash-shared/gallery`
Review role: `cycle-28 debugger`
HEAD reviewed: `9d7f7f74`
Mode: review-only. No fixes were implemented.

## Inventory

Required operating context examined first:

- AGENTS.md instructions provided in the prompt, including the project-doc rules for commits, deploy, schema, and quality gates.
- `CLAUDE.md`, including architecture, upload/processing, restore, migration, CLIP semantic-search, privacy, testing, and deploy runbooks.
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Existing local review state was checked via git status; unrelated review files were already modified before this write: `.context/reviews/architect.md`, `.context/reviews/critic.md`, `.context/reviews/perf-reviewer.md`.

Repository-wide inventory/scanning coverage:

- `apps/web/src`: all 515 TypeScript/TSX/JS/JSON source and test files were inventoried and searched, including App Router pages/routes/actions, DB/schema/data access, client components, service-worker registration/cache helpers, queue/upload/image-processing code, analytics/rate limits, and Vitest fixtures.
- `apps/web/drizzle`: all 31 migration/meta files were inventoried, including every `NNNN_*.sql`, `meta/_journal.json`, and snapshot files.
- `apps/web/scripts`: all 29 scripts were inventoried/scanned, including migrate, restore-maintenance recovery, deployment entrypoint, backfills, seed/init, and lint-gate scripts.
- `apps/web/e2e`: all 8 Playwright files were inventoried.
- `apps/web/public`: service worker files and manifest/favicon assets were inventoried; `sw.template.js` and built `sw.js` were inspected in detail.
- Deployment/config surfaces examined: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `.github/workflows/quality.yml`, `.env.deploy.example`.
- Generated/vendor/runtime artifacts were intentionally excluded: `node_modules`, `.next`, coverage/test-results, `.git`, runtime upload/resource data, and binary/generated caches.

Opened/read in detail for the requested failure-mode areas:

- Restore/import lifecycle: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.ts`, `apps/web/scripts/restore-maintenance-recovery.mjs`, restore/upload lock tests.
- Upload and image queue: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, queue/quiesce tests.
- DB/actions/routes: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, upload-serving routes.
- Client state and service worker: `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/on-this-day-widget.tsx`, `apps/web/src/components/optimistic-image.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts`.
- Migrations/tests/deploy: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, migration SQL files, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/src/__tests__/restore-upload-lock.test.ts`, `apps/web/src/__tests__/upload-processing-contract-lock.test.ts`, `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`, deploy/Docker/nginx files listed above.

Validation evidence collected:

- `npm run lint:api-auth --workspace=apps/web`: passed; both admin API route files reported OK.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating server actions enforce same-origin or have explicit read/public exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating route coverage gate OK.
- `npm run test --workspace=apps/web -- --run src/__tests__/restore-upload-lock.test.ts src/__tests__/upload-processing-contract-lock.test.ts src/__tests__/grid-picture-fallback-boundary.test.ts src/__tests__/sw-template-contract.test.ts`: passed, 4 files / 39 tests.

## Findings

### DBG28-01 - Sidecar CLIP backfill ignores the runtime production-mode env gate

Status: Confirmed
Severity: Medium
Confidence: High
Region: `apps/web/scripts/backfill-clip-embeddings.ts:80-119`, compared with `apps/web/src/lib/gallery-config.ts:123-141` and `apps/web/src/app/actions/embeddings.ts:72-88`

Problem:
The runtime config resolver intentionally heals stored `semantic_search_mode='production'` to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` is set (`gallery-config.ts:123-141`). The in-app backfill action uses `getGalleryConfig()` and therefore obeys that operator gate (`actions/embeddings.ts:72-88`). The canonical sidecar script does not: `checkSemanticModeEnabled()` reads the raw `admin_settings` row directly and only checks that it is not `disabled` (`backfill-clip-embeddings.ts:87-93`), then proceeds in `--production` mode when `PRODUCTION_FLAG` is present (`backfill-clip-embeddings.ts:80-85`, `111-119`).

Concrete failure scenario:
After a restore or manual DB edit leaves `semantic_search_mode='production'` in the DB but the deployment does not set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, the app itself serves semantic search as disabled. An operator running `npm run backfill:clip -- --production` without `--force` will still load the real CLIP path and write production embeddings. That can consume CPU/memory and mutate `image_embeddings` even though the effective runtime contract says production mode is disabled. It also makes the sidecar and the app action disagree on whether production backfill is allowed.

Suggested fix:
Make the sidecar use the same effective config gate as runtime code. Either import/call `getGalleryConfig()` before choosing the target mode, or explicitly require `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` when `--production` is used. Keep `--force` behavior explicit if it is intended to bypass only the DB setting check, not the production safety gate. Add a source or unit test that pins parity between the sidecar and `getGalleryConfig()` for stored `production` with the env flag absent.

### DBG28-02 - CLIP sidecar advances past failed rows and cannot retry them in the same run

Status: Likely
Severity: Low
Confidence: High
Region: `apps/web/scripts/backfill-clip-embeddings.ts:132-167`, `apps/web/scripts/backfill-clip-embeddings.ts:171-215`

Problem:
The sidecar paginates by `images.id > cursor`, sets `cursor` to the last selected row before processing the batch (`backfill-clip-embeddings.ts:145-167`), then increments `failed` for per-image failures without inserting an embedding (`backfill-clip-embeddings.ts:171-207`). Failed rows still match the `notExists(...)` predicate, but they are now behind the cursor and will not be selected again until the operator starts a new process.

Concrete failure scenario:
A transient per-image failure occurs during production backfill, such as a temporary filesystem miss on an original file or a model inference error. The script continues processing later IDs, exits non-zero because `failed > 0` (`backfill-clip-embeddings.ts:214-215`), but the failed image is not retried in that run. In a large operator run, this can leave a small set of images without target-version embeddings until someone notices the non-zero exit and reruns. The behavior is recoverable, but it is a latent completeness failure for unattended/cron-style backfills.

Suggested fix:
Track failed IDs separately and retry them at the end of the run with a small bounded retry count, or move cursor advancement to after per-row processing while maintaining an explicit "already attempted this run" set to avoid infinite loops. At minimum, log the failed image IDs in the final summary so an operator can verify remediation.

### DBG28-03 - OptimisticImage retry logic is stale-state/stale-source fragile when fallbackSrc is used

Status: Risk
Severity: Low
Confidence: Medium
Region: `apps/web/src/components/optimistic-image.tsx:18-54`; current call sites at `apps/web/src/components/home-client.tsx:365-380`, `apps/web/src/components/image-manager.tsx:467-475`, `apps/web/src/components/on-this-day-widget.tsx:65-74`

Problem:
`OptimisticImage` exposes a `fallbackSrc` prop, switches to it on the first error (`optimistic-image.tsx:30-37`), but subsequent retries are computed from the original `src` prop, not the currently failing `imgSrc` or the fallback URL (`optimistic-image.tsx:39-49`). The retry guard also checks React state `retryCount` (`optimistic-image.tsx:41-42`) while the authoritative mutable counter is `retryCountRef` (`optimistic-image.tsx:23-25`, `43-48`), leaving room for duplicate timers if multiple error events fire before state commits.

Concrete failure scenario:
Today the reviewed call sites do not pass `fallbackSrc`, so this is not a live production bug in the current UI. If a future thumbnail uses `fallbackSrc` for the same sized-derivative-to-base-JPEG pattern used elsewhere, a primary 404 will switch to fallback. If that fallback then has a transient network error, the scheduled retry points back to the original failed primary URL with `?retry=N`, not the fallback. The component can display "image unavailable" even though the fallback URL would have succeeded on retry.

Suggested fix:
Base retry URL and local-upload detection on the current failing source (`imgSrc`) rather than the original `src`, or maintain an explicit active-source state. Use `retryCountRef.current` for the retry limit check, clear any existing timer before scheduling a new one, and add a component test that passes `fallbackSrc` and verifies retries stay on the fallback after fallback activation.

## Clean Areas / No Finding

- Restore/upload coordination: restore holds DB restore, upload-processing contract, color backfill, and semantic backfill locks before durable maintenance; targeted restore lock tests passed.
- Browser upload and LR token upload: both paths validate topic/metadata/file size, save originals before DB insert, clean originals on insert failure, snapshot processing settings, and enqueue image processing.
- Image queue: retry maps are bounded/cleaned, permanent failures persist to DB, restore quiesce clears queued state and resumes pending rows, and side effects are tracked for drain/shutdown.
- DB/action/route gates: admin API auth, mutating server-action same-origin, and public mutating route rate-limit lint gates all passed.
- Service worker: admin/API bypass, revocable page bypass, derivative 404/410 eviction, ETag revalidation, cache caps, and template/built-worker contract tests were inspected; targeted SW contract tests passed.
- Migrations: journal monotonicity tripwire, reconcile schema/index/drop coverage tests, and post-restore migration assertions were inspected. No new migration/journal issue was found.
- Privacy/public data: public select-field omissions and search enrichment privacy guards were inspected; no sensitive field leak was found in the reviewed selectors/routes.
- Deployment scripts: deploy helper, Dockerfile, compose, nginx headers/cache policy, and disk-prune policy were inspected; no new deploy failure mode was found.

## Final Missed-Issues Sweep

I performed a final sweep over repository-wide file inventories, state/timer/fetch/localStorage usage, restore/upload/queue/advisory-lock terms, route/action guard coverage, service-worker code, migration tests, and deployment scripts. No review-relevant source, migration, test, service-worker, or deploy/config file was intentionally skipped. The only skipped paths were generated/vendor/runtime artifacts listed in the inventory.

Finding count: 3 total. Severity split: 0 High, 1 Medium, 2 Low.
