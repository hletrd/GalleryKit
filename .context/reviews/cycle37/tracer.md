# Cycle 37 Tracer Review

Date: 2026-07-08
Scope: `/Users/hletrd/flash-shared/gallery`
Mode: read-only product tracer review. No product code edits, no commit, no push.

## Result

Confirmed findings:

- TRC37-01: Lightroom upload holds the restore foreground mutation barrier while parsing multipart body. Severity: Medium. Confidence: High.
- TRC37-02: Upload processing queue and in-app re-encode backfill use independent DB/CPU budgets and can oversubscribe the shared single-process resource envelope. Severity: High. Confidence: High.

Likely findings: none.

Risk-only findings: none beyond the confirmed scenarios above.

## Inventory Built Before Review

Inventory sources:

- Read first: `AGENTS.md`, then `CLAUDE.md`.
- Read review workflow: `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Used `omx explore` for a read-only flow map, then verified with direct source reads.
- Focused inventory with `rg --files` and symbol sweeps for `acquireAdminMutationSlot`, `request.formData`, `isRestoreMaintenanceActive`, `withAdminAuth`, `enqueueImageProcessing`, `processImageFormats`, `serveUploadFile`, `record*View`, `semantic`, `embedding`, `backfill`, `COLOR_IMPACTING_KEYS`, `staleWhileRevalidate`, and `networkFirstHtml`.

Observed inventory counts excluding dependency/build/upload-data directories:

- 939 review-relevant repository files.
- 633 files under `apps/web/src`.
- 81 files under `apps/web/src/app`.
- 115 files under `apps/web/src/lib`.
- 368 files under `apps/web/src/__tests__`.

Current worktree note:

- The worktree already had unrelated modified product files: `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/lib/gallery-config-shared.ts`, and `apps/web/src/lib/gallery-config.ts`.
- The worktree also already had `.context/reviews/cycle37/critic.md` untracked.
- I did not touch or revert those files.

## Files Examined

Instruction and prior-cycle context:

- `AGENTS.md` lines 1-54.
- `CLAUDE.md` lines 1-765, with specific attention to restore, upload, semantic search, cache, service worker, and deployment sections.
- `.context/plans/archive/84-deferred-cycle37.md` lines 1-48.
- `.context/reviews/cycle37/code-reviewer.md`, `.context/reviews/cycle37/security-reviewer.md`, and `.context/reviews/cycle37/perf-reviewer.md` as context only.

Upload -> processing -> serve:

- `apps/web/src/app/actions/images.ts:87-135`, `apps/web/src/app/actions/images.ts:210-285`, `apps/web/src/app/actions/images.ts:385-520`, `apps/web/src/app/actions/images.ts:545-611`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:85-230`, `apps/web/src/app/api/admin/lr/upload/route.ts:260-320`, `apps/web/src/app/api/admin/lr/upload/route.ts:536-647`.
- `apps/web/src/lib/image-queue.ts:121-150`, `apps/web/src/lib/image-queue.ts:650-770`, `apps/web/src/lib/image-queue.ts:860-970`, `apps/web/src/lib/image-queue.ts:1123-1265`.
- `apps/web/src/lib/process-image.ts:1388-1424`.
- `apps/web/src/lib/serve-upload.ts:1-80`, `apps/web/src/lib/serve-upload.ts:150-220`, `apps/web/src/lib/serve-upload.ts:229-385`.
- `apps/web/src/app/uploads/[...path]/route.ts:1-30`.
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-26`.
- `apps/web/next.config.ts:55-125`.

Restore -> mutation barrier -> queue:

- `apps/web/src/lib/admin-mutation-barrier.ts:1-141`.
- `apps/web/src/lib/restore-maintenance.ts:1-60`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:600-700`.
- `apps/web/src/lib/background-db-writes.ts:1-112`.
- `apps/web/src/app/actions/admin-backfill.ts:34-80`.
- `apps/web/src/lib/admin-backfill-runner.ts:20-50`, `apps/web/src/lib/admin-backfill-runner.ts:120-145`, `apps/web/src/lib/admin-backfill-runner.ts:545-580`, `apps/web/src/lib/admin-backfill-runner.ts:715-738`.

Auth/session/token:

- `apps/web/src/lib/session.ts:1-151`.
- `apps/web/src/lib/admin-tokens.ts:53-175`.
- `apps/web/src/lib/api-auth.ts:66-152`.
- `apps/web/src/app/actions/auth.ts` symbol sweep for login/logout/password/session barrier coverage.

Public share/view count:

- `apps/web/src/app/actions/public.ts:430-559`.
- `apps/web/src/lib/data.ts:13-63`, `apps/web/src/lib/data.ts:75-176`, `apps/web/src/lib/data.ts:222-249`, `apps/web/src/lib/data.ts:1239-1413`.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:1-180`.
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:1-152`.

Semantic search/backfill:

- `apps/web/src/app/api/search/semantic/route.ts:107-310`, `apps/web/src/app/api/search/semantic/route.ts:313-369`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-210`, `apps/web/src/app/api/search/similar/[id]/route.ts:220-286`.
- `apps/web/src/app/actions/embeddings.ts:1-238`.
- `apps/web/scripts/backfill-clip-embeddings.ts:110-260`.
- `apps/web/src/lib/clip-model.ts:1-180`.

Settings -> reencode/cache:

- `apps/web/src/app/actions/settings.ts:1-50`, `apps/web/src/app/actions/settings.ts:65-125`, `apps/web/src/app/actions/settings.ts:150-285`.
- `apps/web/src/lib/settings-hash.ts:1-180`.
- `apps/web/src/lib/gallery-config-shared.ts:1-95`.

Service worker/static upload serving:

- `apps/web/public/sw.template.js:1-75`, `apps/web/public/sw.template.js:300-430`, `apps/web/public/sw.template.js:446-568`.
- `apps/web/public/sw.js` spot-checked against the template flow.
- `apps/web/src/lib/sw-cache.ts` inventoried as the unit-test reference for cache logic.

## Findings

### TRC37-01: Lightroom upload holds the restore foreground mutation barrier while parsing multipart body

Status: Confirmed
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/api/admin/lr/upload/route.ts:85-105` acquires `acquireAdminMutationSlot()` immediately after token/cookie attribution and before cheap request validation has completed.
- `apps/web/src/app/api/admin/lr/upload/route.ts:165-201` then acquires the multipart parse slot and awaits `request.formData()` while that restore mutation slot is still held.
- `apps/web/src/app/api/admin/lr/upload/route.ts:267-294` re-checks restore maintenance and acquires the upload-processing contract lock only after multipart parsing and validation.
- `apps/web/src/lib/admin-mutation-barrier.ts:94-117` gives restore drains a default 30 second budget.
- `apps/web/src/app/[locale]/admin/db-actions.ts:625-669` aborts restore if the `admin-mutations` drain does not settle.

Concrete failure scenario:

A Lightroom/PAT client starts a valid 200 MB upload over a slow connection. The route authenticates, gets a mutation slot at line 99, and then spends more than 30 seconds inside `request.formData()` at line 194 before any DB row insert, file write, queue enqueue, or upload-processing contract lock. If an admin starts DB restore during that parse, restore maintenance blocks new entrants, but the drain sees this still-parsing upload as an in-flight foreground mutation. After 30 seconds, the restore aborts at the `admin-mutations` stage even though the upload has not entered the write window the barrier is meant to protect.

Suggested fix:

Move `acquireAdminMutationSlot()` to just before the first fenced mutation window, after content-length checks, rate-limit/tracker preclaim, multipart parsing, file validation, and pure metadata validation. After acquiring the slot, immediately re-check `isRestoreMaintenanceActive()` before taking the upload-processing contract lock and before topic DB lookup/file writes/DB insert. Keep the upload-processing contract lock over topic verify -> save original -> insert image -> enqueue/revalidate, as it does today.

Competing hypotheses traced:

- Hypothesis A: the early slot is required to prevent mid-parse restore corruption. Rejected. The code already performs a late restore check after parsing at `apps/web/src/app/api/admin/lr/upload/route.ts:267-278`, and the actual upload contract lock begins at `apps/web/src/app/api/admin/lr/upload/route.ts:287`.
- Hypothesis B: the early slot is harmless because multipart parsing is bounded. Rejected. The route accepts up to the 200 MB file cap plus overhead (`apps/web/src/app/api/admin/lr/upload/route.ts:130-140`), and the drain budget is fixed at 30 seconds (`apps/web/src/lib/admin-mutation-barrier.ts:94-117`).

### TRC37-02: Upload queue and in-app re-encode backfill can oversubscribe the shared DB/CPU budget

Status: Confirmed
Severity: High
Confidence: High

Evidence:

- `apps/web/src/lib/image-queue.ts:121-134` computes upload queue concurrency from the DB pool but only accounts for queue workers.
- `apps/web/src/lib/admin-backfill-runner.ts:23-44` explicitly says the in-app runner shares Sharp/libheif capacity with the live queue but is invisible to the existing `PQueue`.
- `apps/web/src/lib/admin-backfill-runner.ts:120-142` computes a separate DB-pool cap for backfill workers.
- `apps/web/src/lib/admin-backfill-runner.ts:722-733` applies that backfill cap independently.
- `apps/web/src/lib/image-queue.ts:883-898` and `apps/web/src/lib/admin-backfill-runner.ts:556-571` both call `processImageFormats`.
- `apps/web/src/lib/process-image.ts:1411-1418` fans every image job into WebP, AVIF, and JPEG generation with `Promise.allSettled`.

Concrete failure scenario:

With the default 10-connection pool, the upload queue can run 2 image jobs while the in-app backfill can also run 2 re-encode jobs. Each subsystem independently believes it has reserved about half the pool for live traffic, but together they can hold the color backfill advisory-lock connection plus up to four image workers, each with DB claim/update work and three concurrent Sharp encoder branches. An admin triggering "Re-encode existing photos" during an upload burst can therefore produce four concurrent image-processing jobs and up to twelve active format encoders, while live public pages and admin views still need DB fan-out. This is the same resource envelope the comments are trying to protect, but split across two budget calculators.

Suggested fix:

Add a single process-wide background resource budget used by both live upload processing and in-app backfill. A minimal version can serialize in-app backfill behind active upload processing or lower one subsystem's cap when the other is active. A more durable version is a shared weighted semaphore: one image encode job consumes one background DB unit and one encoder unit regardless of whether it came from upload processing, admin re-encode, bootstrap retry, or a future background path.

Competing hypotheses traced:

- Hypothesis A: the independent caps are safe because each leaves 5 connections free. Rejected. They reserve the same pool capacity independently; `admin-backfill-runner.ts:41-44` confirms the runner is invisible to the upload queue.
- Hypothesis B: this is only a DB issue. Rejected. `process-image.ts:1411-1418` shows every job also fans out to three encoder branches, so the same overlap can saturate CPU/RSS even before DB wait becomes visible.

## Flow Traces And Non-Findings

### Upload -> processing -> serve

Trace:

- Browser upload enters `uploadImages`, checks restore maintenance, same-origin, and admin slot at `apps/web/src/app/actions/images.ts:87-104`.
- The upload quota claim is made before awaited disk/topic work at `apps/web/src/app/actions/images.ts:217-227`, and thrown topic verification rolls it back at `apps/web/src/app/actions/images.ts:265-278`.
- The image row is inserted unprocessed, then queue metadata carries processing settings into `enqueueImageProcessing` at `apps/web/src/app/actions/images.ts:398-520`.
- The queue rejects jobs during restore, validates filenames, and acquires a per-image advisory lock at `apps/web/src/lib/image-queue.ts:737-768`.
- The worker generates derivatives, verifies all three outputs, and conditionally marks `processed=true`; if the DB row disappeared, it deletes variants at `apps/web/src/lib/image-queue.ts:883-936`.
- Serving is path-segment allowlisted, realpath-contained, extension/content-type matched, ETag validated, and fd-stat safe in `apps/web/src/lib/serve-upload.ts:162-385`.
- Existing static derivatives get the same one-hour must-revalidate cache policy through `apps/web/next.config.ts:60-77`; route-handler fallback adds settings-hash ETags at `apps/web/src/lib/serve-upload.ts:240-266`.

Conclusion: no confirmed upload-processing-serve correctness failure beyond TRC37-02 resource overlap.

### Restore -> mutation barrier -> queue

Trace:

- Restore's durable/process maintenance flag is in `apps/web/src/lib/restore-maintenance.ts:21-60`.
- Foreground mutation slots increment/decrement a process-local counter at `apps/web/src/lib/admin-mutation-barrier.ts:76-91`; restore exclusive drain uses the 30 second timeout at `apps/web/src/lib/admin-mutation-barrier.ts:102-129`.
- Restore drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations before import at `apps/web/src/app/[locale]/admin/db-actions.ts:612-669`.
- Image queue quiesce waits for queue idle plus tracked side effects with a timeout at `apps/web/src/lib/image-queue.ts:650-669`.
- Background analytics writes are bounded and drained for restore at `apps/web/src/lib/background-db-writes.ts:42-112`.

Conclusion: the barrier/drain model is coherent for the documented single-web-instance topology, but TRC37-01 shows one foreground path holds the barrier too early.

### Auth/session/token flows

Trace:

- Production refuses DB-stored session-secret fallback at `apps/web/src/lib/session.ts:19-35`.
- Session tokens are HMAC-signed, timing-safe compared, age-checked, hash-stored, and DB-expiry checked at `apps/web/src/lib/session.ts:82-151`.
- PATs are prefixed random values, SHA-256 hashed, format-checked, timing-safe compared, expiry-checked, and scope-parsed at `apps/web/src/lib/admin-tokens.ts:53-168`.
- `withAdminAuth` tries scoped token auth first for external publish clients, otherwise requires same-origin cookie auth and applies no-store/nosniff defaults at `apps/web/src/lib/api-auth.ts:66-152`.

Conclusion: no confirmed auth/session/token failure found.

### Public share/view count

Trace:

- Share pages rate-limit the lookup in the page body, not metadata, avoiding double increment and unthrottled key validity lookup: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:49-57`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:96-120`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:44-53`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:90-112`.
- Shared group reads use public select fields and only buffer denormalized `view_count` when processed images exist and the request is not an in-group selected-photo navigation: `apps/web/src/lib/data.ts:1318-1407`.
- Durable view events validate visibility again inside tracked background writes before insert: `apps/web/src/app/actions/public.ts:443-559`.
- The denormalized group counter buffer has size caps, retry caps, failure backoff, and restore/shutdown drains at `apps/web/src/lib/data.ts:13-63`, `apps/web/src/lib/data.ts:75-176`, and `apps/web/src/lib/data.ts:222-249`.

Conclusion: no confirmed public share/view-count failure found. The denormalized counter remains approximate by design, while durable event inserts are separately recorded.

### Semantic search/backfill

Trace:

- Semantic search requires same-origin, restore-open state, JSON/content-length guards, rate pre-increment, mode gating, bounded embedding work, bounded scan, and public enrichment stripping at `apps/web/src/app/api/search/semantic/route.ts:107-310` and `apps/web/src/app/api/search/semantic/route.ts:313-369`.
- Similar-image search is production-only, rate-charged before DB/embedding work, scans only production model rows, and strips score output at `apps/web/src/app/api/search/similar/[id]/route.ts:68-286`.
- The server action backfill holds the admin mutation barrier and semantic advisory lock before selecting/writing embeddings at `apps/web/src/app/actions/embeddings.ts:59-238`.
- The sidecar refuses production without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, acquires the same semantic advisory lock, checks durable restore maintenance repeatedly, and writes target-version embeddings at `apps/web/scripts/backfill-clip-embeddings.ts:110-260`.
- CLIP real inference uses a bounded process-local queue with pending and timeout caps at `apps/web/src/lib/clip-model.ts:53-173`.

Conclusion: no confirmed semantic search/backfill correctness failure found in the requested trace.

### Settings -> reencode/cache

Trace:

- Byte-impacting settings are listed centrally at `apps/web/src/lib/gallery-config-shared.ts:76-89`.
- Settings updates acquire upload-processing and color-backfill coordination locks for relevant changes, compute `requiresBackfill`, save settings transactionally, revalidate app data, and invalidate detached config at `apps/web/src/app/actions/settings.ts:150-285`.
- Settings hash covers the byte-impacting keys, normalizes `image_sizes`, has typed config mappers, and debounces the DB path at `apps/web/src/lib/settings-hash.ts:44-180`.
- Static serving and route-handler fallback deliberately share must-revalidate cache policy, while route-handler ETags include the settings hash at `apps/web/src/lib/serve-upload.ts:240-266` and `apps/web/next.config.ts:60-77`.

Conclusion: no confirmed settings-cache correctness failure found. The static path still needs an actual re-encode for bytes and mtime to change, which the code and docs treat as an operator-visible contract rather than an automatic cache invalidation promise.

### Service worker/static upload serving

Trace:

- The SW recognizes derivative paths and revocable/public object HTML routes at `apps/web/public/sw.template.js:51-64`.
- Cached image derivatives use a bounded 300 ms HEAD ETag probe, then either return cached bytes, delete missing files, or fetch fresh bytes at `apps/web/public/sw.template.js:312-430`.
- Revocable photo/share/smart-collection/map HTML routes bypass offline HTML cache at `apps/web/public/sw.template.js:555-558`.
- Remaining HTML routes are network-first and offline-fallback only, excluding admin-rendered responses through `x-gk-admin-render` at `apps/web/public/sw.template.js:446-499`.
- Upload route handlers support HEAD without opening a body stream at `apps/web/src/app/uploads/[...path]/route.ts:18-30` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:18-26`.

Conclusion: no confirmed SW/static-upload serving failure found.

## Validation Evidence

Passed from repo root:

- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`

Not run:

- Full lint, typecheck, build, unit tests, and e2e were not run for this read-only tracer artifact. The current task asked for a review report, not product edits.

## Final Missed-Issues Sweep

Final sweep terms and surfaces:

- Upload and serve: `uploadImages`, `Lightroom`, `request.formData`, `settleUploadTrackerClaim`, `enqueueImageProcessing`, `processImageFormats`, `processed = false`, `processed=true`, `serveUploadFile`, `If-None-Match`, `HEAD`.
- Restore and mutation barriers: `getRestoreMaintenanceMessage`, `isRestoreMaintenanceActive`, `beginRestoreMaintenance`, `acquireAdminMutationSlot`, `drainAdminMutationsForRestore`, `quiesceImageProcessingQueueForRestore`, `drainBackgroundDbWritesForRestore`.
- Auth and token: `SESSION_SECRET`, `verifySessionToken`, `withAdminAuth`, `allowTokenScope`, `verifyToken`, `markTokenUsed`.
- Public share/view count: `preIncrementShareAttempt`, `recordPhotoView`, `recordTopicView`, `recordSharedGroupView`, `bufferGroupViewCount`, `flushBufferedSharedGroupViewCounts`.
- Semantic and backfill: `semantic_search_mode`, `PRODUCTION_MODEL_VERSION`, `STUB_MODEL_VERSION`, `LOCK_SEMANTIC_EMBEDDING_BACKFILL`, `SEMANTIC_SCAN_LIMIT`, `embedTextReal`, `embedImageReal`.
- Settings/cache/SW: `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`, `COLOR_IMPACTING_KEYS`, `getColorSettingsHash`, `revalidateAllAppData`, `invalidateDetachedGalleryConfigCache`, `staleWhileRevalidateImage`, `networkFirstHtml`, `isRevocableShareHtmlRoute`.

No additional confirmed, likely, or risk-only tracer findings were identified after the sweep. Remaining environment-dependent checks would require production `EXPLAIN`/profiling, live SW browser traces, and deploy-host nginx/runtime topology verification, which are outside this read-only source review.
