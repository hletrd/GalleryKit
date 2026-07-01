# Cycle 65/100 Deferred Findings

Cycle 65 defers one new finding. No confirmed security, data-loss, or authorization defect is deferred.

## New Deferred Findings

- `C65-02` - Settings-only re-encode obligation disappears after page reload.
  - Original severity/confidence: Medium / High.
  - Citation: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:209`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:284`, `apps/web/src/app/actions/settings.ts:157`.
  - Deferral reason: durable persistence needs a settings-hash/clear contract spanning Settings saves, color backfill sidecar completion, in-app backfill completion, and operator docs. Implementing only a client-state patch would not define when the obligation is safely cleared after a force re-encode.
  - Exit criterion: plan and implement a durable `admin_settings` marker or equivalent last-applied derivative settings hash; update both force re-encode completion paths to clear/advance it; add tests proving reload persistence and clear-on-completion.

## Carry-forward Deferred Items

- `C61-06` - Shared-group view-count flush race logic lacks behavioral coverage. Exit criterion: schedule a focused test plan that mocks the DB update chain, drives fake timers, covers in-flight buffer swaps, verifies failed writes re-buffer up to retry cap, and proves post-swap increments flush after the active drain.
- `C61-07` - Lightroom upload route remains mostly source-contract covered. Exit criterion: add handler-level unit coverage with mocked `withAdminAuth`/token context, `saveOriginalAndGetMetadata`, `stripGpsFromOriginal`, DB insert, and `enqueueImageProcessing`; assert wrong-scope rejection, GPS-strip failure without insert, HDR-disabled cleanup, and successful `uploaded_by` insert/enqueue.
- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps. Exit criterion: schedule a design-backed change that defines production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.
- `TV-40-03` - JavaScript operational scripts need semantic checking. Exit criterion: migrate the operational script check to semantic `checkJs` or equivalent without masking existing script type errors.
- `PERF-C39-03` - feed and sitemap updated-time indexes. Exit criterion: migration-shaped plan with EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - backfill pipeline-version indexes. Exit criterion: migration-shaped plan with query-plan evidence and write-path impact review.
- `AGG-C38-07` - broad imported-helper side-effect classification. Exit criterion: scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - sidecar keyset pagination. Exit criterion: throughput/memory plan defines keyset cursor semantics and regression coverage.
