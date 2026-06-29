# Debugger Review - review-plan-fix cycle 3

Date: 2026-06-29
Role: `debugger`
Scope: current HEAD only (`3d3b78167360b9c66070619c0734c97dc49653f8`). The HEAD commit itself is review-doc-only over `3f24038b`, so the live app code reviewed here is unchanged from that app-code HEAD.
Status: report-only pass; no application code edited.

## Inventory And Method

Required context read first:
- `AGENTS.md`
- `CLAUDE.md`

History checked to avoid stale fixed claims:
- `.context/reviews/_aggregate.md`
- `.context/reviews/code-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/verifier.md`
- relevant `.context/plans` hits for service-worker stamps, semantic scan limits, timezone claims, direct-exposure fixes, and deferred CLIP/search risks

Inventory covered:
- 294 tracked app/deploy/migration/e2e files across `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/e2e`, `apps/web/drizzle`, `apps/web/nginx`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/package.json`, and service-worker assets.
- Focused debugger sweeps over async/background work, fire-and-forget promises, timers, global/process-local state, env parsing, date/time handling, route runtime pins, upload/restore cleanup, filesystem streaming, raw SQL/process execution, semantic search, service-worker/deploy behavior, and prior-cycle rejected/fixed claims.

Validation evidence:
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- Static line-numbered inspection was performed for each cited region below.

## Findings

### DBG-C3-01 - Runtime `public` bind mount can serve a stale service worker instead of the build-generated one

Severity: Medium
Confidence: High
Risk type: Confirmed production/deploy failure mode

Evidence:
- `apps/web/package.json:10-11` runs `scripts/build-sw.ts` during `prebuild`.
- `apps/web/scripts/build-sw.ts:28-56` stamps `public/sw.js` with `<git-short-sha>-p<IMAGE_PIPELINE_VERSION>`.
- `apps/web/Dockerfile:71-75` runs `npm run build`, so the image build regenerates `sw.js`.
- `apps/web/docker-compose.yml:23-26` bind-mounts host `./public` over `/app/apps/web/public` at runtime.
- `apps/web/public/sw.js:21-29` is currently stamped `2051bb87-p7`, while current HEAD is `3d3b7816`.

Failure scenario:
The deploy image contains a freshly generated service worker, but the running container serves the host-mounted committed `apps/web/public/sw.js`. If a service-worker logic fix, cache namespace fix, or image-pipeline cache invalidation change lands without a matching host artifact refresh, clients keep using the old `gk-images-*`, `gk-html-*`, and `gk-meta-*` cache namespaces. This is production-only because local builds see the regenerated working-tree artifact, while compose runtime masks the image copy.

Concrete fix:
Mount only mutable public data, for example `./public/uploads`, and serve generated immutable assets from the image. If the full `public` bind mount must remain, regenerate `apps/web/public/sw.js` on the host as part of deploy before `docker compose up`, and add a static test/deploy check that fails when `SW_VERSION` does not match the intended build stamp.

### DBG-C3-02 - Semantic and similar search can never see older relevant embeddings outside the newest-first scan window

Severity: Medium
Confidence: High
Risk type: Confirmed product-correctness/scaling defect once the corpus exceeds the cap

Evidence:
- `apps/web/src/app/api/search/semantic/route.ts:240-249` selects embeddings ordered by `updated_at DESC` and limits to `SEMANTIC_SCAN_LIMIT`.
- `apps/web/src/app/api/search/semantic/route.ts:262-281` scores only that scanned window.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` repeats the same newest-first capped production-embedding scan for similar-photo results.
- `apps/web/src/lib/clip-embeddings.ts:32-40` allows `SEMANTIC_SCAN_LIMIT` to default to 2000 and be raised as high as 1,000,000.
- `apps/web/src/db/schema.ts:282-285` has a recency scan index, not a vector/ANN or recall-preserving nearest-neighbor index.

Failure scenario:
A gallery has 15,000 embedded photos. A visitor searches for, or asks for similar photos to, an old image whose best matches are outside the newest 2000 embedding rows. The route returns weaker newer matches or no matches even though the correct embeddings exist. Raising `SEMANTIC_SCAN_LIMIT` trades the recall bug for request-path DB transfer, synchronous decode/scoring, and event-loop pressure.

Concrete fix:
Move retrieval to a recall-preserving vector index/ANN backend or a worker-maintained candidate index. Until then, surface an operator warning when eligible embedding count exceeds `SEMANTIC_SCAN_LIMIT`, make UI/operator copy honest about the scanned window, and keep a strict production ceiling. If the cap grows, replace full-array `sort()` in `topK()` with bounded heap selection and move scoring off the request thread.

### DBG-C3-03 - Production CLIP embedding work escapes the image-processing queue's backpressure

Severity: Medium
Confidence: High
Risk type: Confirmed production concurrency/resource risk

Evidence:
- `apps/web/src/lib/image-queue.ts:204-212` bounds the main image-processing queue with `QUEUE_CONCURRENCY`.
- `apps/web/src/lib/image-queue.ts:414-429` runs Sharp derivative generation inside that queue.
- `apps/web/src/lib/image-queue.ts:512-567` starts embedding generation in a detached `void (async () => { ... })()` after `processed=true` is committed.
- `apps/web/src/lib/image-queue.ts:535-537` calls `embedImageReal(originalPath)` in production semantic mode.
- `apps/web/src/lib/image-queue.ts:569` marks the queue job complete before the detached embedding work finishes.
- `apps/web/src/lib/clip-model.ts:151-186` performs Sharp decode/resize, raw pixel conversion, and model inference.

Failure scenario:
During bulk uploads with production semantic search enabled, each completed queue job can leave CLIP inference running while the next Sharp job starts. Operators see `QUEUE_CONCURRENCY=1` and expect one heavy image task, but the process can run Sharp encode, Sharp CLIP resize, JS pixel packing, and model inference concurrently. This can spike CPU/RSS, increase GC pressure, and hurt public request latency in the single web process.

Concrete fix:
Route embeddings through a bounded queue such as `EMBEDDING_CONCURRENCY=1`, or await production embeddings inside the existing queue if immediate search availability is required. Longer term, persist embedding jobs and drain them through a separate worker with queue depth, active count, latency, and failure metrics.

### DBG-C3-04 - Timeline and On-This-Day public queries remain non-sargable, and one comment claims the opposite

Severity: Medium
Confidence: High
Risk type: Confirmed public-route performance failure mode

Evidence:
- `apps/web/src/lib/data-timeline.ts:88-94` says the `MONTH() + DAY()` query stays within the `(processed, capture_date)` index prefix and avoids a full table scan.
- `apps/web/src/lib/data-timeline.ts:95-114` filters On-This-Day with `MONTH(capture_date)` and `DAY(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:127-140` computes distinct timeline years with `YEAR(capture_date)`.
- `apps/web/src/lib/data-timeline.ts:184-205` filters timeline pages with `YEAR(capture_date)` and optional `MONTH(capture_date)`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:14,60-82` renders dynamically and calls those helpers on request.
- `apps/web/src/db/schema.ts:111-117` has no generated date-part columns or functional indexes for those predicates.

Failure scenario:
As the gallery grows, home/timeline/year pages evaluate date functions over the processed image set on every dynamic render. The `LIMIT` caps returned rows, not rows examined. The misleading comment makes the risk easier to miss during future tuning because it states the query is already index-friendly.

Concrete fix:
Fix the comment first so it accurately says the predicates are non-sargable. Then use half-open range predicates for year/month pages, and add generated/stored `capture_year`, `capture_month`, and `capture_day` columns with covering indexes for On-This-Day and year discovery. Add migration, Drizzle schema, legacy reconcile coverage, and query-plan regression tests.

### DBG-C3-05 - Calendar features rely on server-local date semantics for timezone-less capture dates

Severity: Low
Confidence: Medium
Risk type: Likely/manual-validation date-time risk

Evidence:
- `apps/web/src/components/on-this-day-widget.tsx:14-23` defines "today" from `new Date()` in the Node process timezone before querying `MONTH()`/`DAY()`.
- `apps/web/src/components/on-this-day-widget.tsx:51-52` derives the displayed capture year with `new Date(photo.capture_date).getFullYear()`.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:87-97` groups photos by `new Date(photo.capture_date).getMonth() + 1`.
- `apps/web/src/lib/data-timeline.ts:237-245` repeats the same grouping in year-in-review.
- `apps/web/src/lib/process-image.ts:507-520` intentionally stores EXIF strings as timezone-less `YYYY-MM-DD HH:mm:ss` literals.

Failure scenario:
This is not confirmed wrong under the current Docker/server-local deployment, and prior history correctly rejected a blanket "use UTC getters" fix. The latent risk is that the product has no explicit contract for whether calendar features mean server-local today, gallery-local today, viewer-local today, or pure stored-date parts. If the server timezone changes, or if a future runtime parses space-separated MySQL `DATETIME` strings differently, anniversaries and month grouping can shift around midnight or become implementation-defined.

Concrete fix:
Define the calendar contract explicitly. For stored capture dates, avoid `new Date()` when only date parts are needed: parse `YYYY-MM-DD` substrings or expose normalized date-part columns/helpers. For "today", use one named helper that implements the chosen timezone, with tests around midnight boundaries and non-UTC `TZ`.

### DBG-C3-06 - Restore maintenance, upload quotas, and public limiter state are process-local despite DB-wide effects

Severity: Medium
Confidence: High
Risk type: Manual-validation operational risk under unsupported scale-out

Evidence:
- `apps/web/src/lib/restore-maintenance.ts:1-56` stores restore maintenance on `globalThis`.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores cumulative upload windows in a process-local `Map`.
- `apps/web/src/lib/rate-limit.ts:68-89` stores OG/share limiter maps in memory.
- `apps/web/src/lib/rate-limit.ts:312-335` stores semantic limiter state in memory.
- `apps/web/src/lib/data.ts:12-61` stores shared-group view-count buffers and timers in module/global process state.
- `apps/web/docker-compose.yml:14-21` documents the intended host-networked single web instance, but the app does not enforce that topology at startup.

Failure scenario:
The documented topology is single-instance, so this is not a confirmed defect for the shipped deployment. If an operator starts a second process or future orchestration scales replicas before moving state to shared storage, one process can enter restore maintenance while another accepts uploads, quota windows split by instance, public limiter budgets multiply by replica count, and view counts become more lossy than documented.

Concrete fix:
Make the single-writer contract executable with a startup/deploy guard or DB advisory lease. If scale-out is desired, move maintenance flags, upload claims, public limiter buckets, and view-count buffering into DB/Redis/shared durable state first.

### DBG-C3-07 - Browser upload quota settlement still depends on a hand-maintained invariant across a long awaited region

Severity: Low-Medium
Confidence: Medium
Risk type: Likely future-regression risk; no current leaked claim confirmed

Evidence:
- `apps/web/src/app/actions/images.ts:224-228` pre-claims quota before the first awaited disk/topic/file work.
- `apps/web/src/app/actions/images.ts:233-250` manually rolls the claim back for disk-space failures.
- `apps/web/src/app/actions/images.ts:257-265` documents that every await between claim and final settlement must roll back on throw.
- `apps/web/src/app/actions/images.ts:266-278` manually rolls back topic lookup failures.
- `apps/web/src/app/actions/images.ts:507-522` relies on `deleteOriginalUploadFile()` never rejecting inside the per-file catch.
- `apps/web/src/app/actions/images.ts:540-564` performs the final settlement only after all per-file work.
- `apps/web/src/app/actions/images.ts:590-592` releases only the upload contract lock in the outer `finally`.

Failure scenario:
The current obvious branches are covered by comments and targeted tests, and the Lightroom route has an idempotent settle closure. The browser path still relies on contributors preserving a comment-enforced invariant across many awaited operations. A future validation, cleanup, or DB call added after the pre-claim but before final settlement can throw without calling `settleUploadTrackerClaim()`, inflating the admin/IP quota window for up to an hour after no file was accepted.

Concrete fix:
Replace the manual invariant with a scoped claim object or `try/finally` wrapper that automatically rolls back unless explicitly committed. Add a regression test that injects a post-claim failure and asserts the tracker is restored.

## Rechecked Fixed Or Rejected Claims

- `.claude/` Docker build-context leakage is fixed in current HEAD: `.dockerignore` now excludes `.claude` and `.claude/`.
- Direct container exposure is reduced in current shipped defaults: `apps/web/Dockerfile:80-85` and `apps/web/docker-compose.yml:14-21` bind the app to `127.0.0.1`.
- CLIP pre-enable operator docs now include `--production --force`; the old empty-production-backfill operator-flow defect is not re-filed.
- Similar-route limiter refunds after target DB work are not reintroduced; current code keeps 404/500 after DB lookup charged.
- The cycle-22 "switch timeline grouping to UTC getters" claim remains rejected. The current risk is undocumented semantics, not a blanket UTC conversion.

## Final Missed-Issues Sweep

Security/auth/origin:
- Admin API wrapper lint passed.
- Mutating server-action same-origin lint passed.
- Public mutating route rate-limit lint passed.
- Route runtime pins for Node-bound DB/Sharp/Buffer paths were inspected; no Edge-runtime drift found.

Async/resource cleanup:
- Fire-and-forget caption and embedding hooks catch their own errors, so no unhandled rejection was found.
- `serve-upload` and backup download stream from `realpath` and avoid opening streams for HEAD responses.
- Restore and upload advisory locks release in `finally` blocks on the inspected paths.

Parser/date/env:
- No new unsafe `parseInt`/`Number` route-param issue was found.
- Semantic limit env parsing is bounded, but the operational cap/relevance issue remains DBG-C3-02.
- Calendar semantics remain the main date/time risk (DBG-C3-05).

Deployment/production-only:
- The stale service-worker bind-mount mismatch is the clearest current production-only failure mode (DBG-C3-01).
- Build, typecheck, and full unit tests were not re-run in this debugger pass to avoid regenerating `apps/web/public/sw.js`; other cycle-3 lanes have recent green evidence for those gates.

## Finding Count

Total findings: 7
- Confirmed: 4
- Likely: 2
- Manual-validation operational risk: 1
