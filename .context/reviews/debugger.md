# Debugger Review — review-plan-fix cycle 1 / prompt 1

Scope: latent bug, failure-mode, and regression-surface review from the debugger lane. I focused on edge cases likely to pass existing tests but fail at runtime: stale client state, route/input parsing, queue retry behavior, backup/restore coordination, image cleanup, and semantic search failure paths.

Repo constraints honored: read-only source review; no source edits, no commits, no pushes, no deploy.

## Inventory

Primary surfaces reviewed:

- Restore and backup: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Image queue and cleanup: `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/scripts/backfill-color-pipeline.ts`.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Client state/navigation: `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/home-client.tsx`.
- Route and param parsing spot-checks: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`.
- Existing regression tests sampled for coverage boundaries: `apps/web/src/__tests__/similar-route.test.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/__tests__/image-queue-quiesce.test.ts`, `apps/web/src/__tests__/search-stale-response.test.ts`, `apps/web/src/__tests__/search-short-query-guard.test.ts`.

## Findings

### 1. Late caption/embedding hooks can write into a restored database

Severity: High
Confidence: High
Type: Confirmed issue

Code regions:

- `apps/web/src/lib/image-queue.ts:413-430` starts caption generation after `processed=true` and does not await or track it in queue state.
- `apps/web/src/lib/image-queue.ts:432-498` starts the semantic embedding writer as a detached async IIFE and upserts `image_embeddings` by `job.id`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:331-340` prepares restore by flushing shared-group view counts and awaiting `quiesceImageProcessingQueueForRestore()`, then immediately runs the restore.
- `apps/web/src/lib/image-queue.ts:753-805` quiesces only the `PQueue`; it does not know about the detached caption/embedding promises.

Why this is a problem:

The restore path waits for active queue jobs to finish, but a queue job can finish and then leave post-commit async work running outside the queue. During a DB restore, those detached hooks can write after the old job's row has been dropped/recreated from the backup. If the restored database reuses the same numeric image id for a different image, the caption update can write `alt_text_suggested` to the wrong restored row, and the embedding upsert can create or overwrite `image_embeddings` for the wrong image. The schema has `image_embeddings.image_id` as a primary key/FK (`apps/web/src/db/schema.ts:271-278`), so the wrong write succeeds whenever that id exists after restore.

Concrete failure scenario:

1. Image `id=42` finishes Sharp processing in production mode and starts `embedImageReal(originalPath)` from the detached IIFE.
2. Admin starts DB restore. `quiesceImageProcessingQueueForRestore()` sees the queue as idle and restore proceeds.
3. Restore imports a backup where `id=42` exists but refers to an older/different photo.
4. The old embedding promise resumes and upserts `PRODUCTION_MODEL_VERSION` bytes for the pre-restore original into restored row `42`.
5. Semantic search / similar photos now rank the restored photo using an embedding for a different image.

Suggested fix:

Track post-commit hooks in `ProcessingQueueState`, e.g. `postCommitTasks: Set<Promise<void>>`, add each caption/embedding promise to it, remove in `finally`, and have restore quiesce await the set after `queue.onIdle()`. Add a restore generation token as belt-and-suspenders: capture it before starting the hook and re-check before writing. For caption/embedding writes, also verify the current row still matches the expected `filename_original` or model input before updating/upserting.

### 2. Semantic search rolls back rate limits after expensive failure paths

Severity: Medium
Confidence: High
Type: Confirmed issue

Code regions:

- `apps/web/src/app/api/search/semantic/route.ts:207-215` pre-increments the semantic-search rate-limit bucket.
- `apps/web/src/app/api/search/semantic/route.ts:238-245` calls the real/stub text encoder and rolls back the rate-limit token on encoder failure.
- `apps/web/src/app/api/search/semantic/route.ts:247-260` scans embeddings and rolls back on DB scan failure.
- `apps/web/src/lib/rate-limit.ts:292-309` documents rollback as intended only for early returns before expensive work.
- `apps/web/src/lib/clip-model.ts:76-105` clears the cached model-load promise after a load failure, so every later request retries the failing load.
- `apps/web/src/__tests__/semantic-search-route.test.ts:281-297` currently locks rollback on DB scan failure, so tests would not catch this operational failure mode.

Why this is a problem:

The implementation refunds requests after expensive work has started. In production mode, a missing/corrupt `CLIP_MODELS_ROOT` or incompatible model bundle makes `embedTextReal()` fail. Because `clip-model.ts` clears `loadPromise` on failure, each new request attempts the expensive model load again. Because the route rolls the rate-limit token back, a caller can repeatedly trigger model-load I/O and initialization with no effective per-IP budget consumption.

Concrete failure scenario:

Production has `semantic_search_mode='production'` and `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, but the model bind mount is missing after a host migration. Public search requests hit `/api/search/semantic`; every request reaches `embedTextReal`, retries the failed Transformers load, returns 503, then refunds the rate-limit attempt. A bot can loop indefinitely and repeatedly thrash CPU/disk without hitting the 30/min semantic limit.

Suggested fix:

Do not call `rollbackSemanticAttempt()` after the encoder or DB scan begins. Keep rollback only for cheap gates: disabled mode, invalid request body, too-short query, missing target embedding before scan, etc. Add a negative model-health cache/backoff for `getModelBundle()` failures so repeated production-mode failures short-circuit for a short window instead of reloading immediately.

### 3. Retrying a failed image ignores restore maintenance and can clear failure state without enqueueing

Severity: Medium
Confidence: Medium
Type: Likely issue

Code regions:

- `apps/web/src/app/actions/images.ts:1085-1090` starts `retryFailedImage()` with same-origin and auth checks, but unlike sibling image mutations it does not call `getRestoreMaintenanceMessage()`.
- `apps/web/src/app/actions/images.ts:1125-1128` clears `processing_error` and `failed_at`.
- `apps/web/src/app/actions/images.ts:1130-1157` then calls `enqueueImageProcessing()`.
- `apps/web/src/lib/image-queue.ts:243-247` drops enqueue requests while restore maintenance is active.

Why this is a problem:

During restore maintenance, most mutating image actions return early. `retryFailedImage()` does not. If an admin triggers retry while restore is active, it can clear the persistent failure columns, then `enqueueImageProcessing()` silently ignores the job because processing is unavailable. That can leave a pending row without the failed-image marker the dashboard relies on, and it also allows a DB write during the restore window.

Concrete failure scenario:

An admin has the dashboard open with a failed image. Another tab starts restore. The admin clicks retry during restore. The action clears `processing_error` / `failed_at`, the queue ignores the job, and the failed image disappears from the failed panel even though no retry actually started. If restore is concurrently importing rows, the update can also target a transient/restored row state.

Suggested fix:

Add the same restore-maintenance guard used by `uploadImages`, `deleteImage`, `deleteImages`, and `updateImageMetadata` at the top of `retryFailedImage()`. Also consider making `enqueueImageProcessing()` return a boolean so callers that require enqueue success do not report success after a maintenance drop.

### 4. Similar photos panel keeps stale results across in-place photo navigation

Severity: Medium
Confidence: High
Type: Confirmed issue

Code regions:

- `apps/web/src/components/photo-viewer.tsx:115-120` keeps a client-side `currentImageId` and updates it as the user navigates inside the same `PhotoViewer` instance.
- `apps/web/src/components/photo-viewer.tsx:767-769` renders `<SimilarPhotos imageId={image.id} ... />` without a key.
- `apps/web/src/components/similar-photos.tsx:64-68` stores `open`, `results`, and one-shot `fetchedRef` state.
- `apps/web/src/components/similar-photos.tsx:70-95` fetches only when opening and `fetchedRef.current` is false; there is no reset on `imageId` changes.

Why this is a problem:

The component treats "fetched once" as a component-lifetime fact, but `PhotoViewer` changes the `imageId` prop without remounting `SimilarPhotos`. Once the panel has fetched for photo A, navigating to photo B leaves `fetchedRef.current = true` and `results` still holding photo A's similar results.

Concrete failure scenario:

In production semantic mode, open a photo, expand "Similar photos", then use the in-viewer next arrow. The sidebar now describes the next photo, but the similar-photo panel state belongs to the previous photo. Reopening the panel does not fetch `/api/search/similar/<newId>` because `fetchedRef` is already true.

Suggested fix:

Reset state on `imageId` changes:

```ts
useEffect(() => {
  fetchedRef.current = false;
  setResults(null);
  setOpen(false);
  setLoading(false);
}, [imageId]);
```

Alternatively key the component at the render site: `<SimilarPhotos key={image.id} ... />`.

### 5. Similar-photo route accepts partially numeric ids

Severity: Low
Confidence: High
Type: Confirmed issue

Code regions:

- `apps/web/src/app/api/search/similar/[id]/route.ts:71-77` uses `parseInt(idStr, 10)` and checks only finite/positive.
- In contrast, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-52` and `apps/web/src/app/api/og/photo/[id]/route.tsx:50-58` require `/^\d+$/` before parsing.
- `apps/web/src/__tests__/similar-route.test.ts:182-193` tests `"abc"` and `"0"` but not `"1abc"` / `"42.json"`.

Why this is a problem:

`parseInt("42abc", 10)` returns `42`, so malformed route params are treated as valid image ids. This is inconsistent with the route's own documented gate ("positive-integer id validation") and the stricter public photo/OG routes.

Concrete failure scenario:

`/api/search/similar/42anything` runs the full same-origin, rate-limit, config, target-embedding, scan, and enrichment path for image 42 instead of returning 400. This is not a direct data leak because the route is already public/same-origin gated, but it expands malformed-input behavior and can hide client-side URL construction bugs.

Suggested fix:

Mirror the other routes:

```ts
if (!/^\d+$/.test(idStr)) return 400;
const id = Number(idStr);
if (!Number.isSafeInteger(id) || id <= 0) return 400;
```

Add a test for `"42abc"` and `"42.json"`.

## Missed-Issues Sweep

I did a final sweep over the requested focus areas:

- Route/input parsing: checked public photo id, OG photo id, shared group `photoId`, year/timeline year, semantic `topK`, and similar-photo id. Only similar-photo partial numeric parsing stood out.
- Queue retry behavior: checked normal enqueue retries, claim retries, permanent-failure persistence, restore quiesce, deletion cleanup, and `retryFailedImage`. The retry action's missing restore guard is the main gap.
- Backup/restore: checked dump/restore subprocess handling, temp-file cleanup, SQL scanning, advisory locks, maintenance state, upload-contract lock, and queue quiesce. The unresolved gap is detached post-queue hooks not included in restore quiescence.
- Image processing cleanup: checked original cleanup on upload failure, derivative cleanup on delete, full variant scans, downscaled intermediate cleanup, `.tmp` cleanup, and backfill deleted-mid-reencode cleanup. I did not find a new cleanup bug in those paths.
- Semantic search failure paths: checked production/stub mode gating, model loading, embedding decode, scan/enrichment fallback, rate-limit rollback, and similar-photo UI. The expensive-failure rollback and stale similar-photo client state are the main semantic issues.
- Stale closure/client state: checked search request-id guards, lightbox refs, photo-viewer navigation guards, and similar-photo state. Search has explicit stale-response guards; similar photos does not reset per image.

Residual risks:

- I did not run the full test suite; this was a source-level review artifact only.
- I did not inspect every admin client component exhaustively; I prioritized components with async fetches, router state, timers, and cross-photo state.
- Existing other-lane review files were already modified in the worktree; I did not read or alter them beyond confirming `.context/reviews/debugger.md` was the target file.
