# Cycle 83 Performance / Concurrency Review

Reviewer: perf-reviewer
Date: 2026-07-01
HEAD reviewed: `cc46b1d69c11cb175c88df69f17cbe526d23aa0d`
Baseline context: Cycle 82 aggregate, plan, deferred list, and perf lane.

## Verdict

No confirmed performance, concurrency, queueing, CPU/memory, cache, DB query-shape, image-processing/backfill, map/search/share response-path, or UI responsiveness issue found in this pass.

Severity: n/a
Confidence: medium-high. The current source delta since Cycle 82 is small and UI-label focused; I also re-inventoried the main performance surfaces. I did not run production load tests or full gates in this read-only review lane.

## Confirmed Findings

| Severity | Confidence | Citation | Failure scenario | Suggested fix |
| --- | --- | --- | --- | --- |
| n/a | medium-high | n/a | No current performance or concurrency failure was confirmed. | No fix recommended. |

## Delta Review

- Current delta from Cycle 82 start (`c272c521`) to reviewed HEAD (`cc46b1d6`) is limited to review/plan ledgers, `.gitignore`, messages/tests, and four source surfaces: `apps/web/src/lib/photo-title.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, and `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`.
- `getPhotoResultLabel()` adds only bounded per-row `trim()` plus one filename-like regex check before returning title/description/fallback (`apps/web/src/lib/photo-title.ts:85-100`). The helper is called once per visible search row (`apps/web/src/components/search.tsx:69-72`) and once per similar-photo thumbnail result (`apps/web/src/components/similar-photos.tsx:177-184`); both result sets are already server-capped.
- The failed-image dashboard change adds a small per-row label/id computation and localized aria strings (`apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:39-41`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:84-127`). It does not add polling, new network calls, image decoding, or queue work.

## Inventory / Evidence

- Public listing/search/map/share DB paths: masonry listing remains capped and cursor-aware (`apps/web/src/lib/data.ts:668-811`); shared single-photo lookup folds tags into one grouped query (`apps/web/src/lib/data.ts:1230-1267`); shared-group read caps images at 100 and batches tag hydration (`apps/web/src/lib/data.ts:1300-1353`); public search validates length, limits to 100 max internally, short-circuits when full, and only then runs bounded tag/alias queries (`apps/web/src/lib/data.ts:1539-1681`); map markers are hard-capped at 10,000 (`apps/web/src/lib/data.ts:1698-1734`).
- Rate-limited async public paths: search pre-increments in-memory and DB buckets before expensive work (`apps/web/src/app/actions/public.ts:236-306`); analytics view records validate/rate-limit first and track fire-and-forget inserts for drains (`apps/web/src/app/actions/public.ts:330-438`, `apps/web/src/app/actions/public.ts:444-510`).
- Index support: listing/topic indexes exist on processed/date/topic shapes (`apps/web/src/db/schema.ts:117-123`); tag/share joins have composite/secondary indexes (`apps/web/src/db/schema.ts:131-160`); analytics retention and aggregation indexes exist (`apps/web/src/db/schema.ts:235-266`); embedding scans use `modelVersion, updatedAt` (`apps/web/src/db/schema.ts:284-298`).
- Queue and image processing: queue concurrency is capped against DB pool headroom (`apps/web/src/lib/image-queue.ts:88-108`), retry maps are pruned (`apps/web/src/lib/image-queue.ts:198-224`), per-image advisory locks serialize duplicate processing (`apps/web/src/lib/image-queue.ts:469-496`, `apps/web/src/lib/image-queue.ts:536-579`), and bootstrap scans pending rows in bounded batches (`apps/web/src/lib/image-queue.ts:886-995`). Sharp concurrency is CPU-aware and cache is disabled (`apps/web/src/lib/process-image.ts:36-57`); uploads stream to disk (`apps/web/src/lib/process-image.ts:887-914`); wide-gamut intermediates are pixel-capped (`apps/web/src/lib/process-image.ts:1092-1145`); multi-format generation settles before cleanup/verification (`apps/web/src/lib/process-image.ts:1433-1456`).
- Backfill: in-app backfill clamps worker count against pool budget (`apps/web/src/lib/admin-backfill-runner.ts:96-142`, `apps/web/src/lib/admin-backfill-runner.ts:706-718`), fetches candidates in keyset batches of 100 (`apps/web/src/lib/admin-backfill-runner.ts:401-431`), and holds/release per-image processing claims through encode/detect/persist (`apps/web/src/lib/admin-backfill-runner.ts:518-670`).
- Semantic search / similar-photo CPU paths: semantic requests cap body/query size and topK before embedding/scanning (`apps/web/src/app/api/search/semantic/route.ts:96-247`), scan only up to `SEMANTIC_SCAN_LIMIT` (`apps/web/src/app/api/search/semantic/route.ts:263-311`), and the similar route shares the same bounded scan posture (`apps/web/src/app/api/search/similar/[id]/route.ts:164-201`). Real CLIP inference has active/pending/timeout caps (`apps/web/src/lib/clip-model.ts:53-64`, `apps/web/src/lib/clip-model.ts:117-173`).
- Cache and response streaming: upload serving caches the settings hash with stale refresh (`apps/web/src/lib/serve-upload.ts:47-83`), honors conditional requests before body streaming (`apps/web/src/lib/serve-upload.ts:233-267`), and streams file bodies with abort cleanup (`apps/web/src/lib/serve-upload.ts:276-315`). The service worker image cache has a 50 MB LRU cap and 300 ms HEAD revalidation bound (`apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:106-160`, `apps/web/public/sw.template.js:281-356`). Per-photo OG image fetches use bounded internal attempts and byte/time caps (`apps/web/src/lib/og-photo-fetch.ts:34-44`, `apps/web/src/app/api/og/photo/[id]/route.tsx:197-207`).
- UI responsiveness: masonry resize is requestAnimationFrame-debounced and images reserve intrinsic size (`apps/web/src/components/home-client.tsx:30-67`, `apps/web/src/components/home-client.tsx:286-365`); histogram work is downsampled to 256 px and handed to a worker with rAF-debounced canvas resizing (`apps/web/src/components/histogram.tsx:169-228`, `apps/web/src/components/histogram.tsx:440-466`); map popup thumbnails use configured sized derivatives with one-shot fallback (`apps/web/src/components/map/map-client.tsx:40-74`).

## Deferred Items Not Re-Raised

- Cycle 82 deferred carry-forward items remain deferred: `C80-06`, `C77-ARCH-01`, `C76-04`, `C76-05`, `C75-08`, plus historical performance/semantic-search/settings re-encode/shared-view/browser-matrix items. This pass found no new evidence that changes their severity or meets their exit criteria.

## Validation

- Read-only review only; no source edits, no deploy.
- Relevant regression tests were inventoried but not run in this lane: `apps/web/src/__tests__/photo-title.test.ts`, `apps/web/src/__tests__/search-disclaimer.test.ts`, and `apps/web/src/__tests__/failed-image-retry.test.ts`.
- Planned artifact-only check: `git diff --check -- .context/reviews/cycle-83-2026-07-01/perf-reviewer.md`.
