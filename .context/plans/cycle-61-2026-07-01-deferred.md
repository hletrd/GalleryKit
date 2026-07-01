# Cycle 61/100 Deferred Findings

Cycle 61 defers only broad test-coverage gaps. No confirmed security, correctness, or data-loss source defect is deferred.

## New Deferred Findings

### C61-06 - Shared-group view-count flush race logic lacks behavioral coverage

- Original severity/confidence: Medium / High.
- File/line: `apps/web/src/__tests__/data-view-count-flush.test.ts:13`, `apps/web/src/lib/data.ts:75`, `apps/web/src/lib/data.ts:111`, `apps/web/src/lib/data.ts:186`.
- Deferral reason: This is a test-depth gap, not a confirmed active source defect. Adding robust fake-timer/DB-chain behavioral coverage is broader than the route and migration fixes scheduled for this cycle and risks fragile mocking without a dedicated test-design pass.
- Exit criterion: schedule a focused test plan that mocks the DB update chain, drives fake timers, covers in-flight buffer swaps, verifies failed writes re-buffer up to retry cap, and proves post-swap increments flush after the active drain.

### C61-07 - Lightroom upload route remains mostly source-contract covered

- Original severity/confidence: Medium / Medium.
- File/line: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:488`.
- Deferral reason: `C61-02` fixes and source-locks the newly confirmed restore-window ordering issue in this cycle. A full handler-level test harness for PAT auth, multipart `File`, save/GPS helpers, DB insert, enqueue, quota settlement, and failure cleanup is a broader test-infrastructure task.
- Exit criterion: add handler-level unit coverage with mocked `withAdminAuth`/token context, `saveOriginalAndGetMetadata`, `stripGpsFromOriginal`, DB insert, and `enqueueImageProcessing`; assert wrong-scope rejection, GPS-strip failure without insert, HDR-disabled cleanup, and successful `uploaded_by` insert/enqueue.

## Carry-forward Deferred Items

- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps. Exit criterion: schedule a design-backed change that defines production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.
- `TV-40-03` - JavaScript operational scripts need semantic checking. Exit criterion: migrate the operational script check to semantic `checkJs` or equivalent without masking existing script type errors.
- `PERF-C39-03` - feed and sitemap updated-time indexes. Exit criterion: migration-shaped plan with EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - backfill pipeline-version indexes. Exit criterion: migration-shaped plan with query-plan evidence and write-path impact review.
- `AGG-C38-07` - broad imported-helper side-effect classification. Exit criterion: scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - sidecar keyset pagination. Exit criterion: throughput/memory plan defines keyset cursor semantics and regression coverage.
