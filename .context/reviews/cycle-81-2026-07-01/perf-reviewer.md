# Cycle 81/100 Performance Reviewer

Review HEAD: `4733d475` (`fix(review): preserve cycle-80 operational invariants`).
Scope: DB query shapes/indexes, image-processing concurrency, caches, service worker behavior, runtime memory/CPU, request-path synchronous I/O, shutdown/drain behavior, frontend responsiveness, bundle/Next build risks, and deploy performance.

## Findings

No new non-deferred performance finding confirmed.

Confidence: High. I re-read `AGENTS.md` and `CLAUDE.md`, then inspected the current hot paths rather than inheriting the Cycle 80 result. The one Cycle 80 performance/concurrency defect is fixed in current HEAD: `apps/web/src/lib/background-db-writes.ts:28` now exposes `drainBackgroundDbWrites()`, and graceful shutdown imports and races it with the existing queue/view-count drains at `apps/web/src/instrumentation.ts:36`, `apps/web/src/instrumentation.ts:39`, and `apps/web/src/instrumentation.ts:41`.

Failure scenario reviewed: deploy/container `SIGTERM` while audit or public analytics writes are still in flight. Current fix: `trackBackgroundDbWrite()` tracks promises in `apps/web/src/lib/background-db-writes.ts:3` and removes them in `apps/web/src/lib/background-db-writes.ts:20`; shutdown drains those writes before `process.exit()` through `apps/web/src/instrumentation.ts:39-45`. The behavior is source-locked by `apps/web/src/__tests__/instrumentation-sigterm.test.ts:44-49`.

## Inventory Evidence

- DB/listing shapes: masonry listing uses shared `tagNamesAgg` at `apps/web/src/lib/data.ts:650-662`, keyset cursor predicates at `apps/web/src/lib/data.ts:744-767`, and bounded page sizes at `apps/web/src/lib/data.ts:668-670`. Smart-collection load-more skips the count window on cursor pages at `apps/web/src/lib/data.ts:1463-1487`; first pages keep the known `COUNT(*) OVER()` shape at `apps/web/src/lib/data.ts:1495-1509`.
- Index alignment: gallery order indexes remain `processed,capture_date,created_at`, `processed,created_at`, and `topic,processed,capture_date,created_at` at `apps/web/src/db/schema.ts:118-120`; analytics/retention indexes remain at `apps/web/src/db/schema.ts:236-240`, `apps/web/src/db/schema.ts:251-253`, and `apps/web/src/db/schema.ts:264-266`; embeddings use `model_version,updated_at` at `apps/web/src/db/schema.ts:298`.
- Image processing CPU/RSS: Sharp global concurrency is divided by format fan-out and capped by CPU count at `apps/web/src/lib/process-image.ts:36-57`; uploads stream originals to disk instead of buffering large files at `apps/web/src/lib/process-image.ts:905-910`; wide-gamut sources are downscaled before rgb16 fan-out at `apps/web/src/lib/process-image.ts:1092-1145`; three format encodes settle together at `apps/web/src/lib/process-image.ts:1433-1449`.
- Queue/backfill concurrency: queue concurrency is clamped against the DB pool at `apps/web/src/lib/image-queue.ts:87-108`, with retry maps capped at `apps/web/src/lib/image-queue.ts:198-224`; in-app backfill reserves live DB capacity at `apps/web/src/lib/admin-backfill-runner.ts:96-120`; sidecar backfill remains the known all-candidate deferred shape at `apps/web/scripts/backfill-color-pipeline.ts:383-400`, not re-raised without new corpus/memory evidence.
- Caches/service worker: serving-path settings hash uses 5s TTL plus single-inflight SWR at `apps/web/src/lib/serve-upload.ts:46-83`; HEAD/304 avoid body streams at `apps/web/src/lib/serve-upload.ts:239-273`. The service worker image cache is capped at 50 MB at `apps/web/public/sw.template.js:31`, uses recency-preserving LRU metadata at `apps/web/public/sw.template.js:108-140`, bounds cached-image HEAD probes to 300 ms at `apps/web/public/sw.template.js:307-314`, and caps HTML cache entries at `apps/web/public/sw.template.js:143-159`.
- Request-path synchronous I/O: grep found no `readFileSync`/`writeFileSync`/`existsSync` request-path hits. The synchronous marker reads/writes are restore lifecycle/script surfaces in `apps/web/src/lib/restore-maintenance-durable.ts:36-71`, reached from startup/script/admin restore paths (`apps/web/src/instrumentation.ts:3-4`, `apps/web/scripts/backfill-alt-text.ts:54-102`, `apps/web/src/app/[locale]/admin/db-actions.ts:26`), not public hot requests.
- Frontend responsiveness: masonry resize is rAF-debounced at `apps/web/src/components/home-client.tsx:30-67`; eager/high-priority image loading is limited to above-fold columns at `apps/web/src/components/home-client.tsx:296-365`; histogram CPU work downsizes to 256px and moves binning to a worker at `apps/web/src/components/histogram.tsx:169-228`, with resize redraws rAF-gated at `apps/web/src/components/histogram.tsx:440-466`.
- Bundle/Next/deploy: heavy native server packages stay external at `apps/web/next.config.ts:45-50`; static derivative cache policy is centralized at `apps/web/next.config.ts:55-73`; runtime native Sharp is smoke-checked in prod-deps at `apps/web/Dockerfile:71-80`; signal ownership is preserved via `NEXT_MANUAL_SIG_HANDLE=true` at `apps/web/Dockerfile:116-128`; deploy health-checks before Docker prune at `apps/web/deploy.sh:57-77` and prunes only after a healthy `up -d` at `apps/web/deploy.sh:79-104`.

## Deferred Not Re-Raised

- First-page `COUNT(*) OVER()` listing work, feed/sitemap updated-time indexes, sidecar all-candidate color-backfill materialization, semantic request-thread vector scoring, and the service-worker 300 ms cached-image HEAD budget remain covered by prior deferred records. I found no new latency trace, corpus-size trigger, or changed exit criterion that would justify re-filing them in Cycle 81.
- Cycle 80 `C80-06` (`site-config.json` runtime/build-time contract) remains a deferred operator-contract decision, not a new performance finding in this lane.

## Validation

- `git diff --check` passed.
- `npm test --workspace=apps/web -- --run src/__tests__/instrumentation-sigterm.test.ts src/__tests__/image-queue-concurrency-cap.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sw-cache.test.ts src/__tests__/check-public-route-rate-limit.test.ts` passed: 5 files, 132 tests.

No source files were modified; this artifact is the only intended write for this lane.
