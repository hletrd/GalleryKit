# Cycle 34 Performance Reviewer Report

Review target: current HEAD `e1f124a265998ea51297d6716df6c03a2056a96c`.
Review role: `performance-reviewer`.
Mode: review-only. Product source, tests, plans, git state, and commits were not changed.

## Inventory

- Required context read first: `AGENTS.md`; `CLAUDE.md` sections covering environment/deploy limits, image upload flow, runtime topology, database indexes, image processing pipeline, Color/HDR pipeline, performance optimizations, service worker/PWA behavior, operational deploy/disk hygiene, and CLIP semantic-search runtime limits.
- Prior-cycle filter read: `.context/reviews/_aggregate.md`, `.context/plans/cycle-33-2026-06-30-plan.md`, `.context/plans/cycle-33-2026-06-30-deferred.md`, and the stale `.context/reviews/perf-reviewer.md` Cycle 33 artifact. I did not re-raise Cycle 33 deferred scale items without new evidence: grouped first-page counts, timeline/date-part non-sargability, GPS full-file stripping, grid JPEG fallback, semantic scan-window recall/cost, process-local limits, feed/Docker CI/deploy scale boundaries.
- Upload and image pipeline inspected: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, relevant LR/upload tests.
- Image delivery and cache inspected: `apps/web/src/lib/serve-upload.ts`, upload route handlers, `apps/web/next.config.ts`, service-worker cache docs/tests, `GridPicture`/masonry image call sites.
- Feed/sitemap/public SSR inspected: `apps/web/src/app/feed.xml/route.ts`, localized topic feed route, `apps/web/src/app/sitemap.ts`, public home/topic/smart collection/photo/timeline/map/share pages, `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`.
- Search and queue surfaces inspected: public keyword search/load-more actions, semantic and similar search routes, `clip-model.ts`, `clip-embeddings.ts`, queue bootstrap/claim/retry/side-effect tracking.
- UI responsiveness inspected: `home-client.tsx`, `load-more.tsx`, `search.tsx`, `similar-photos.tsx`, `grid-picture.tsx`, and surrounding public page render paths.

## Findings

### C34-PERF-01 - LR multipart parse slot leaks on quota rejection

- Location: `apps/web/src/app/api/admin/lr/upload/route.ts:60-74`, `apps/web/src/app/api/admin/lr/upload/route.ts:130-185`.
- Severity: Medium.
- Confidence: High.
- Scenario: The Cycle 33 fix added a single in-process multipart parse slot before `request.formData()` so concurrent 200 MiB Lightroom/PAT uploads cannot all materialize request bodies at once. After acquiring the slot at lines 130-136, the route checks upload tracker quotas at lines 147-158. Both quota-rejection branches return 429 before entering the `try/finally` that releases the slot at lines 177-185. Once a legitimate PAT client exceeds file-count or cumulative-byte quota, `lrMultipartParseInFlight` remains at `1` for the life of the process. Every subsequent LR upload then receives "Another Lightroom upload is being parsed" even though no parse is active.
- Fix: Move the tracker quota checks before `tryAcquireLrMultipartParseSlot()`, or wrap everything after slot acquisition in a `try/finally` that always calls `releaseMultipartParseSlot()`. Add behavior/source coverage specifically for the two early 429 quota branches, not only for the happy `request.formData()` branch.

## Final sweep

- The browser upload path settles quota claims and releases the upload-processing contract lock in `finally`; I did not find the same slot-leak pattern there.
- Image queue processing remains bounded by PQueue concurrency, DB-pool-aware caps, advisory locks, retry map caps, permanent-failure caps, and tracked side effects for caption/embedding shutdown drains.
- Semantic/similar search retains same-origin gates, body caps, rate limits, CLIP inference queue bounds, scan caps, and enrichment caps. Remaining brute-force scan limits are already recorded as Cycle 33 deferred scale work.
- Feed/sitemap and public SSR paths remain intentionally dynamic or ISR-bounded per `CLAUDE.md`; no new narrow performance regression met the reporting bar beyond the LR parse-slot leak.
- No tests were run; this lane was a static read-only performance review.
