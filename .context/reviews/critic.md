# Cycle 11 Critic Review

Review target: current `master` HEAD `5fa4a5a6`.

Scope: PROMPT 1 / Cycle 11 critic lane. I did not edit production code. This report is the only intended output.

## Inventory and Evidence

Repository guidance reviewed:
- `AGENTS.md`
- `CLAUDE.md`
- Code-review skill instructions
- Prior top-level critic report at `.context/reviews/critic.md` and recent cycle review history under `.context/reviews/`

Baseline and change surface:
- `git status --short --branch` was clean before writing this report.
- There was no uncommitted diff, so I treated current `master` as the review surface.
- Recent runtime change surface is concentrated in commit `d5d79e17 fix(cycle-10): close review findings`, with changes across upload actions, semantic search, image queue bootstrap, image derivative cleanup, delete cleanup, UI copy, and privacy/footer/shared-group pages.

Inventory built before findings:
- App routes/pages: `apps/web/src/app/**`
- Public/admin actions: `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Public/admin APIs: `apps/web/src/app/api/**`
- Core libraries: `apps/web/src/lib/**`, especially queue, image processing, upload paths, rate limits, semantic search, tags, and data privacy selectors
- Schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`
- Runtime/deploy surfaces: `apps/web/Dockerfile`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/scripts/**`
- Tests and source-contract gates: `apps/web/src/__tests__/**`
- Localization/UI copy: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, changed public/admin components

Focused files examined:
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/clip-model.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/__tests__/image-queue-embed-wiring.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/components/search.tsx`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/__tests__/semantic-search-route.test.ts`
- `apps/web/src/__tests__/cycle-10-source-contracts.test.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/privacy/page.tsx`
- `apps/web/src/components/footer.tsx`

## Findings

### C11-CRIT-01 - Confirmed: missing-embedding bootstrap now schedules an unbounded number of side effects

Severity: High

Confidence: High

Status: Confirmed

Code regions:
- `apps/web/src/lib/image-queue.ts:370-420` changed `bootstrapMissingActiveEmbeddings` from one bounded `limit(50)` retry batch into a cursor loop that keeps selecting batches until every processed row missing the active model embedding has been visited.
- `apps/web/src/lib/image-queue.ts:402-412` launches each row through `trackQueueSideEffect(...)` immediately and does not await the batch before fetching/scheduling the next batch.
- `apps/web/src/lib/image-queue.ts:326-330` only records those promises for drain/shutdown; it is not a concurrency limiter.
- `apps/web/src/lib/image-queue.ts:333-367` each side effect eventually writes to `image_embeddings` through the shared DB pool.
- `apps/web/src/db/index.ts:23-34` the shared MySQL pool has `connectionLimit: 10` and `queueLimit: 20`.
- `apps/web/src/lib/clip-model.ts:53-70` limits real CLIP inference, but the waiter queue is unbounded; in stub mode there is no inference slot before the DB insert.
- `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:45-52` still only source-checks that a `limit(BOOTSTRAP_EMBEDDING_RETRY_BATCH_SIZE)` exists; it does not assert that only one batch is in flight, that side effects are awaited, or that DB writes are bounded.

Failure scenario:
An operator enables stub semantic search on a gallery with hundreds or thousands of processed photos that do not yet have stub embeddings, or production mode after rows are missing the active production model version. On bootstrap, the loop pages through all missing rows and starts one promise per image. In stub mode those promises synchronously create embeddings and then all hit the DB insert path concurrently; with a 10-connection pool and queue limit 20, most writes beyond the first small wave can reject with pool queue exhaustion. The catch at `image-queue.ts:409-410` logs and drops the failure, while the bootstrap state can still be marked complete by the main bootstrap path. The result is a noisy startup and a partially populated embedding table that may not be retried until a later bootstrap/reset.

In production mode, `CLIP_INFERENCE_CONCURRENCY` prevents simultaneous model execution, but the code still creates an unbounded waiter/promise set for every missing image, outside the image-processing queue and outside the backfill concurrency budget described in `CLAUDE.md`. If a model-version bump or table repair makes thousands of rows missing, startup can accumulate thousands of long-lived side-effect promises and duplicate work can be scheduled by later bootstrap passes before earlier side effects finish.

Concrete fix:
Keep the cursor loop, but make the retry work bounded and awaited. For example, process each selected batch with a small concurrency limiter that is no larger than the DB/CLIP budget, `await Promise.allSettled(...)` for that batch, then fetch the next batch. Alternatively, enqueue missing-embedding retries onto the existing queue or a dedicated `PQueue` with explicit concurrency. Add a behavioral test that simulates more than 50 missing rows and asserts the second page is not scheduled until the first page's side effects have settled, and that active embedding writes never exceed the intended concurrency.

### C11-CRIT-02 - Confirmed: pre-body semantic aborts are charged against the public search rate limit

Severity: Medium

Confidence: High

Status: Confirmed

Code regions:
- `apps/web/src/app/api/search/semantic/route.ts:186-200` pre-increments the semantic rate-limit bucket, then returns `499` if `request.signal.aborted` is already true.
- `apps/web/src/app/api/search/semantic/route.ts:202-205` reads the body only after that abort check, so this branch can consume a rate-limit token before the request body, embedding CPU, or vector scan is admitted.
- `apps/web/src/app/api/search/semantic/route.ts:37` imports only `preIncrementSemanticAttempt`, not `rollbackSemanticAttempt`.
- `apps/web/src/lib/rate-limit.ts:340-343` still documents `rollbackSemanticAttempt` for requests that exit before the guarded embedding/vector-scan resource is consumed.
- `apps/web/src/components/search.tsx:181-190` intentionally aborts the prior semantic fetch whenever a newer semantic request starts, and `apps/web/src/components/search.tsx:258-261` aborts on unmount.
- `apps/web/src/__tests__/cycle-10-source-contracts.test.ts:58-66` source-checks that client/server abort handling exists but does not assert refund/charging behavior for a pre-body abort.

Failure scenario:
A visitor uses semantic search and types or toggles quickly enough that the client aborts stale requests. If the server observes the abort at the first check, the route returns 499 before `request.text()`, before embedding, and before the DB scan, but the request still burns one of the 30/min semantic attempts. A normal user can therefore be pushed into 429s by canceled stale searches that the new abort path was supposed to make cheap. This also contradicts the helper contract that exits before the guarded semantic resource can be rolled back.

Concrete fix:
Check `isRequestAborted(request)` before `preIncrementSemanticAttempt`, or call `rollbackSemanticAttempt(ip)` on the specific line-198 pre-body abort branch. Keep later abort branches charged after body admission or embedding/scan admission if that is the intended DoS posture. Add a route test with an already-aborted `NextRequest` that asserts status 499 and either no pre-increment or an explicit rollback before `request.text()` is called.

### C11-CRIT-03 - Risk: upload tag records can be created before any image is accepted

Severity: Low

Confidence: Medium

Status: Risk

Code regions:
- `apps/web/src/app/actions/images.ts:295-323` now resolves and creates requested tag records before entering the per-file processing loop.
- `apps/web/src/app/actions/images.ts:339-360` can then reject the file before any image row is inserted, for example on HDR rejection when `allow_hdr_ingest` is off.
- `apps/web/src/lib/tag-records.ts:66-68` `ensureTagRecord` performs an `insert(tags).ignore().values(...)` before selecting the tag record.
- The normal browser uploader sends one file per action (`apps/web/src/components/upload-dropzone.tsx:219-239`), so this is not a large batch problem in the current UI, but the server action still accepts multiple files and this path is reachable for a single rejected file.
- `apps/web/src/__tests__/images-actions.test.ts:422-458` covers HDR rejection but uses empty tags, so it does not lock the "no tag side effect on rejected upload" contract.

Failure scenario:
An admin submits a file with a new tag, but the file is rejected before image insertion, such as an HDR file while HDR ingest is disabled or a later metadata/save failure. The upload returns an error and no photo exists, but the new tag row can remain in the admin tag list with count 0. That is not data loss, but it is surprising persistent state from a failed upload and differs from the previous per-file/per-success tag creation posture.

Concrete fix:
Resolve existing tags before the loop with `findTagRecordByNameOrSlug`, but defer creation of missing tags until after a file has passed the pre-insert rejection gates or until the image insert transaction. For multi-file server-action callers, create tags lazily on first successful image and reuse the resolved records for later successful files. Add a regression that uploads a rejected HDR file with a new tag and asserts `ensureTagRecord` is not called, or explicitly document that failed uploads may create empty tags if that tradeoff is intentional.

## Missed-Issues Sweep Notes

No additional confirmed findings from the final sweep:
- The Cycle 10 analytics limiter fix is present: `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` now call `headers()` / `buildViewParams()` / `isViewRecordRateLimited()` before public-target DB lookups, and the public-actions tests were updated to expect pre-lookup header reads.
- The derivative re-encode cleanup was changed from `writtenSizedPaths` deletion to backup/restore of pre-existing final paths. I did not find a direct correctness break in the new restore logic, though its source-contract test is mostly string-shape based rather than an end-to-end failure simulation.
- Delete cleanup now surfaces strict unlink failures through `cleanupFailureCount`, and `ImageManager` shows warning toasts for single and bulk deletes.
- The LR upload route comments were corrected away from claiming GalleryKit bundles a Lightroom plugin; the route still reuses upload infrastructure and remains wrapped by `withAdminAuth`.
- Shared-group grid dimensions now guard zero width/height before constructing `aspect-ratio` and `contain-intrinsic-size`.
- The privacy page/footer addition is gated on configured Google Analytics and does not expose admin-only fields.
- Existing lint-gate/source-contract coverage is broad, but several of the newest checks are source-shape assertions rather than behavioral tests; the two highest-risk findings above both pass those current source-shape checks.
