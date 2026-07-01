# Cycle 84/100 Performance / Concurrency Review

Reviewer: perf-reviewer
Date: 2026-07-01
HEAD reviewed: `023ae28d41ee` (`test(review): preserve cycle 83 review contracts`)
Scope: performance, concurrency, CPU/RSS, DB query/index fit, image-processing throughput, queues/rate limits, UI responsiveness, deploy/runtime resource constraints.

## Verdict

No new confirmed performance or concurrency finding in this pass.

Severity: n/a
Confidence: medium-high. The only runtime-relevant delta since Cycle 83 is none: `HEAD` adds review/plan artifacts, `.gitignore`, and source-contract tests (`apps/web/src/__tests__/cycle-21-source-contracts.test.ts:1-73`, `apps/web/src/__tests__/search-disclaimer.test.ts:1-27`). I still re-checked the current hot paths listed below against HEAD line numbers.

## Confirmed Findings

| Severity | Confidence | File:line citations | Failure scenario | Suggested fix |
| --- | --- | --- | --- | --- |
| n/a | medium-high | n/a | No current performance, concurrency, CPU/memory, DB/index, queue/rate-limit, image-processing, UI responsiveness, or deploy/runtime resource failure was confirmed. | No fix recommended. |

## Delta Review

- Cycle 84 starts from a test/ledger commit. The changed test files use synchronous `readFileSync` only inside Vitest source-contract tests, not request-path runtime code (`apps/web/src/__tests__/cycle-21-source-contracts.test.ts:1-7`, `apps/web/src/__tests__/search-disclaimer.test.ts:1-5`).
- The added assertions preserve existing result-label contracts and do not add browser runtime work, DB work, image processing, queueing, or production bundle surface (`apps/web/src/__tests__/cycle-21-source-contracts.test.ts:9-23`, `apps/web/src/__tests__/search-disclaimer.test.ts:19-26`).

## Inventory / Evidence

- Listing/search DB paths remain bounded and index-aligned: public listing caps at 100 + 1 rows and uses cursor conditions (`apps/web/src/lib/data.ts:664-811`); search rejects empty/oversized queries, caps results to 100, short-circuits after the main query, and bounds tag/alias over-fetch (`apps/web/src/lib/data.ts:1539-1681`); map markers stay capped at 10,000 (`apps/web/src/lib/data.ts:1698-1734`). Supporting indexes exist for processed/date/topic, tags, analytics, and embeddings (`apps/web/src/db/schema.ts:117-123`, `apps/web/src/db/schema.ts:131-160`, `apps/web/src/db/schema.ts:235-298`).
- Image processing still uses CPU/RSS guards: Sharp concurrency is divided by the three-format fan-out and cache is disabled (`apps/web/src/lib/process-image.ts:36-57`); originals stream to disk instead of buffering large uploads (`apps/web/src/lib/process-image.ts:887-914`); wide-gamut rgb16 work is pixel-capped with temp cleanup (`apps/web/src/lib/process-image.ts:1092-1145`); per-format encodes settle before verification and cleanup (`apps/web/src/lib/process-image.ts:1227-1456`).
- Queue/backfill concurrency remains bounded against pool headroom: image queue concurrency is clamped by reserved live DB connections (`apps/web/src/lib/image-queue.ts:87-108`), retry maps are size-pruned (`apps/web/src/lib/image-queue.ts:198-224`), per-image advisory locks guard duplicate processors (`apps/web/src/lib/image-queue.ts:469-496`, `apps/web/src/lib/image-queue.ts:536-579`), and bootstrap scans pending rows in 500-row batches with continuation (`apps/web/src/lib/image-queue.ts:886-995`). In-app backfill reserves roughly half the pool and keyset-fetches 100 candidates per batch (`apps/web/src/lib/admin-backfill-runner.ts:96-142`, `apps/web/src/lib/admin-backfill-runner.ts:401-430`, `apps/web/src/lib/admin-backfill-runner.ts:706-718`).
- Semantic/CLIP CPU paths stay gated: real inference has active/pending/timeout caps (`apps/web/src/lib/clip-model.ts:53-173`), model loading is lazy/offline (`apps/web/src/lib/clip-model.ts:198-230`), image preprocessing is fixed-size and inside the inference slot (`apps/web/src/lib/clip-model.ts:273-324`), semantic search charges rate limit before mode/config work and caps body/query/scan size (`apps/web/src/app/api/search/semantic/route.ts:94-184`, `apps/web/src/app/api/search/semantic/route.ts:238-369`), and similar-photo scans share the same `SEMANTIC_SCAN_LIMIT` posture (`apps/web/src/app/api/search/similar/[id]/route.ts:132-201`).
- Cache/serving paths avoid unbounded request work: upload serving caches the settings hash with stale-while-revalidate (`apps/web/src/lib/serve-upload.ts:46-83`), returns 304/HEAD before opening a body stream when possible (`apps/web/src/lib/serve-upload.ts:225-274`), and streams file bodies with abort cleanup (`apps/web/src/lib/serve-upload.ts:276-312`). The service worker image cache has a 50 MB cap, serialized metadata mutation, and a 300 ms bound on cached-image HEAD revalidation (`apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:98-160`, `apps/web/public/sw.template.js:243-356`).
- UI responsiveness still has bounded client work: masonry resize is rAF-debounced and cleaned up (`apps/web/src/components/home-client.tsx:30-67`), above-fold image priority is limited to the visible column count and intrinsic sizing reserves layout (`apps/web/src/components/home-client.tsx:296-365`), search debounces requests and aborts stale semantic fetches (`apps/web/src/components/search.tsx:166-318`), and histogram work downsamples to 256 px before transferring pixels to a worker with rAF-gated resize redraws (`apps/web/src/components/histogram.tsx:169-227`, `apps/web/src/components/histogram.tsx:440-466`).
- Deploy/runtime constraints match the repo contract: runtime Sharp/native deps are installed and smoke-checked in the production dependency stage (`apps/web/Dockerfile:67-80`), CLIP weights stay on the persistent data bind mount instead of the image (`apps/web/Dockerfile:111-115`), the app owns SIGTERM handling for queue/view-count drains (`apps/web/Dockerfile:116-128`), and deploy prunes Docker only after a healthy `up -d` without `volume prune -a` (`apps/web/deploy.sh:53-104`).

## Deferred Items Not Re-Raised

I did not re-raise the existing deferred/operator-scale items because this pass found no new production measurement, corpus-size trigger, or code change that meets their exit criteria. That includes semantic brute-force scans/global CPU tradeoffs, sidecar backfill candidate/materialization work, first-page count windows, settings-hash/static derivative invalidation, process-local rate-limit topology, Docker resource-limit guidance, and other carry-forward items recorded under `.context/plans/run10-cycle2/deferred.md`.

## Validation

- Read-only source review plus requested artifact write; no implementation changes.
- Did not run full gates in this lane because no runtime code changed and the user requested review-only output.
- Passed: `git diff --check -- .context/reviews/cycle-84-2026-07-01/perf-reviewer.md`.
