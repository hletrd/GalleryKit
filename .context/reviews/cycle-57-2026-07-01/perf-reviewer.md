# Cycle 57/100 Performance / Deploy Review

Reviewer: perf-reviewer / deploy reviewer
HEAD reviewed: `677a8410` (`master`, even with `origin/master`)
Write scope honored: only this artifact was written.

## Inventory Examined

- Repo instructions and ops context: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/perf-reviewer.md`, `.context/reviews/prompts/common_review_scope.md`.
- Current-cycle and carry-forward context: `.context/reviews/cycle-56-2026-07-01/_aggregate.md`, `.context/reviews/cycle-56-2026-07-01/perf-reviewer.md`, `.context/plans/cycle-56-2026-07-01-deferred.md`.
- Changed Cycle 56/57 surfaces: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/settings-submit-payload.ts`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`, `apps/web/src/__tests__/settings-submit-payload.test.ts`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts`, `apps/web/README.md`.
- Performance/deploy hot paths: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`, semantic/similar search routes, CLIP queue code, rate-limit code.

Validation run:

`npm test --workspace=apps/web -- deploy-script-contract.test.ts settings-submit-payload.test.ts settings-semantic-mode-action.test.ts settings-image-sizes-lock.test.ts cycle-56-source-contracts.test.ts sw-template-contract.test.ts next-config-uploads-headers.test.ts data-tag-names-sql.test.ts admin-backfill-concurrency-cap.test.ts image-queue-bootstrap.test.ts`

Result: 10 files passed, 78 tests passed.

## Confirmed Issues

### PERF-C57-01 - Public photo pages lost `cache()` dedupe and now serialize the main image query behind settings/auth work

Severity: Medium
Confidence: High
Files: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:55`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:59`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:150`, `apps/web/src/lib/data.ts:1200`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/lib/data.ts:1730`, `apps/web/src/lib/data.ts:1731`

`generateMetadata()` fetches the public image through `getImageCached(imageId)` inside its parallel metadata batch (`page.tsx:55`, `page.tsx:59`). The page render now waits for locale, translations, SEO settings, gallery config, and `isAdmin()` first (`page.tsx:143`) and only then starts `getImageForViewerCached(imageId, isAdminUser)` (`page.tsx:150`).

For non-admin public traffic, `getImageForViewer(id, false)` uses the same public select as `getImage(id)` (`data.ts:1200`, `data.ts:1204`), but the two exported React cache wrappers are different functions (`data.ts:1730`, `data.ts:1731`). That means the public page path no longer shares the metadata image lookup. It also starts the image/tags/prev/next query after unrelated settings/auth work instead of in parallel with it.

Failure scenario: a normal public visitor opens `/p/123`. Metadata and page rendering can each execute the same public image lookup path, including tag and prev/next work, while the page's visible render waits for settings/auth completion before the main image query even starts. Under DB latency or pool contention this increases TTFB and burns extra pool capacity on the hottest individual-photo route. The Cycle 56 source contract currently asserts this shape, so tests would not catch the regression.

Suggested fix: keep metadata/OG public-shaped, but preserve the public page fast path. Start `const publicImagePromise = getImageCached(imageId)` immediately; resolve `isAdmin()` in parallel; if `isAdminUser` is true, fetch `getImageForViewerCached(imageId, true)`, otherwise use the public promise so the page shares the metadata cache wrapper. Update `cycle-56-source-contracts.test.ts` to require the non-admin branch to use `getImageCached` and only the admin branch to select admin fields.

### OPS-C57-02 - Cycle 56 release ledger still says the implementation is active and commit/deploy are pending

Severity: Medium
Confidence: High
Files: `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-56-2026-07-01-plan.md:51`, `.context/plans/cycle-56-2026-07-01-plan.md:52`, `.context/reviews/_aggregate.md:3`

The plan index still lists Cycle 56 as the active current-cycle implementation plan (`README.md:7`) and repeats that active status under recent plans (`README.md:12`). The Cycle 56 plan still leaves "Commit, pull --rebase, push" and "Deploy with `npm run deploy`" unchecked (`cycle-56 plan:51`, `cycle-56 plan:52`). The latest aggregate pointer still points at the Cycle 56 review (`_aggregate.md:3`).

Local source state disagrees with that ledger: HEAD is `677a8410`, includes the Cycle 56 implementation commit plus a deploy-stat follow-up, and `master` is even with `origin/master`. The missing evidence is therefore not "work still local"; it is committed operational documentation drift, especially around whether the per-iteration deploy happened after the latest deploy-script fix.

Failure scenario: the next deploy reviewer or operator reads the committed plan index and sees Cycle 56 as still active with commit/push/deploy pending, despite the branch containing follow-up fixes. They cannot tell from the repo whether `30dad6a8` or `677a8410` was deployed, which weakens the per-iteration deploy policy and repeats the release-ledger drift class that Cycle 56 was already meant to close for Cycle 55.

Suggested fix: close the Cycle 56 plan with exact commit, pull-rebase/push, and deploy evidence for the final deployed hash; update `.context/plans/README.md` to mark Cycle 56 completed and create/advance the Cycle 57 pointers; update `.context/reviews/_aggregate.md` once the Cycle 57 aggregate is written.

## Likely Issues

None.

## Risks Requiring Manual Validation

None new. I did not re-file the existing deferred items without new evidence:

- `PA-42-02` production CLIP web-process catch-up locking/caps.
- `TV-40-03` JavaScript operational script semantic checking.
- `PERF-C39-03` feed/sitemap updated-time indexes.
- `PERF-C39-04` backfill pipeline-version indexes.
- `AGG-C38-07` imported-helper side-effect classification.
- `AGG-C38-08` sidecar keyset pagination.

## Positive Evidence / Non-Findings

- Deploy permission portability fix is present in both deploy scripts: GNU `stat -c '%a'` first, BSD `stat -f '%Lp'` only when empty, numeric-mode validation, unsafe-mode `exit 1` before source/Compose. Execution-level tests cover unsafe root env, unsafe runtime env, and empty GNU-stat output.
- Docker deploy safety remains intact: Compose runs before prune, health check gates prune, `volume prune` has no `-a`, mutable data is bind-mounted narrowly, entrypoint avoids recursive `chown`.
- Settings contract filtering now compares normalized current values before upload-claim/advisory-lock paths; focused tests cover unchanged `image_sizes`, changed locked `image_sizes`, and unchanged `strip_gps_on_upload`.
- DB/query shape remains bounded: `tagNamesAgg` is still the shared listing shape, `group_concat_max_len` is initialized per pooled connection, primary listing/semantic/analytics indexes match the inspected query shapes, and semantic/similar scans are model-version filtered and `SEMANTIC_SCAN_LIMIT` capped.
- Image processing cost remains bounded by global Sharp concurrency, disabled Sharp cache, `QUEUE_CONCURRENCY` pool-budget cap, per-image advisory locks, 50 MP wide-gamut downscale gate, and tracked caption/embedding side effects.
- Service worker/cache freshness contracts remain pinned: generated SW version includes pipeline version, image cache is 50 MB LRU, HEAD ETag probe is bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)`, stale derivatives have an expiry path, and upload headers use `public, max-age=3600, must-revalidate`.

## Missed-Issues Sweep

Final sweep covered unbounded `Map`/`Set` patterns, synchronous filesystem APIs in request paths, public route cache/revalidate behavior, deploy-script destructive operations, Docker bind mounts/prune order, image-queue bootstrap continuation, CLIP inference queue limits, backfill concurrency, database indexes against current query shapes, SW/template drift, and current review/plan ledgers. No additional confirmed findings beyond the two above.

Finding count: 2 confirmed.
