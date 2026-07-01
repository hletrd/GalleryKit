# Cycle 62/100 Deferred Findings

Cycle 62 defers one low-severity UX polish item. No confirmed security, correctness, or data-loss source defect is deferred.

## New Deferred Findings

### C62-04 - Search status text is exposed both in a live region and visible status block

- Original severity/confidence: Low / Medium.
- File/line: `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:473`.
- Deferral reason: The confirmed user-facing outage is `C62-03`, the MariaDB SQL parse failure that makes public search return the generic unavailable state. The duplicate status exposure is a secondary accessibility-polish concern, and changing the live-region model can affect announcement timing for loading, no-results, errors, and result-count changes. It needs a focused accessibility pass rather than a drive-by change in the SQL fix cycle.
- Exit criterion: schedule a search-dialog accessibility review that tests screen-reader/static accessibility snapshots for loading, no-results, error, maintenance, rate-limited, and result-count states; choose one announcement source per state; and prove visible status text remains available to sighted users.

## Carry-forward Deferred Items

- `C61-06` - Shared-group view-count flush race logic lacks behavioral coverage. Exit criterion: schedule a focused test plan that mocks the DB update chain, drives fake timers, covers in-flight buffer swaps, verifies failed writes re-buffer up to retry cap, and proves post-swap increments flush after the active drain.
- `C61-07` - Lightroom upload route remains mostly source-contract covered. Exit criterion: add handler-level unit coverage with mocked `withAdminAuth`/token context, `saveOriginalAndGetMetadata`, `stripGpsFromOriginal`, DB insert, and `enqueueImageProcessing`; assert wrong-scope rejection, GPS-strip failure without insert, HDR-disabled cleanup, and successful `uploaded_by` insert/enqueue.
- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps. Exit criterion: schedule a design-backed change that defines production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.
- `TV-40-03` - JavaScript operational scripts need semantic checking. Exit criterion: migrate the operational script check to semantic `checkJs` or equivalent without masking existing script type errors.
- `PERF-C39-03` - feed and sitemap updated-time indexes. Exit criterion: migration-shaped plan with EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - backfill pipeline-version indexes. Exit criterion: migration-shaped plan with query-plan evidence and write-path impact review.
- `AGG-C38-07` - broad imported-helper side-effect classification. Exit criterion: scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - sidecar keyset pagination. Exit criterion: throughput/memory plan defines keyset cursor semantics and regression coverage.
