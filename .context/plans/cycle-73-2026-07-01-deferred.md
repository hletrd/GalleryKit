# Cycle 73/100 Deferred Findings

Cycle 73 defers two behavior-coverage findings. No confirmed security, data-loss, or currently failing production source defect is deferred.

## New Deferred Findings

### C73-05 - Sidecar derivative write-boundary guard is source-locked, not behavior-proven

- Original severity/confidence: Medium / Medium.
- File/line: `apps/web/src/lib/process-image.ts:1187`, `apps/web/src/lib/process-image.ts:1417`, `apps/web/src/lib/process-image.ts:1472`, `apps/web/src/__tests__/cycle-72-source-contracts.test.ts:17`.
- Deferral reason: the source fix is already present from Cycle 72 and the current cycle schedules a smaller source bug plus route-level public-preview coverage. A robust behavior test must seed real derivative files, drive Sharp processing far enough to cross at least one final-write boundary, force the write guard to throw, and assert all previous final files are restored. That is valuable but larger than this cycle's reviewable scope.
- Exit criterion: add a filesystem/Sharp behavior test for `processImageFormats()` with an injected `writeGuard` that throws after final writes begin, proving rejection, previous-final restoration, and no orphaned new variants for the direct rename path; add fallback-copy path coverage if practical.

### C73-06 - Settings backfill warning persistence is only source-wired at the component boundary

- Original severity/confidence: Low / High.
- File/line: `apps/web/src/lib/settings-backfill-warning.ts:40`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:254`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:10`.
- Deferral reason: the pure helper is covered and no current source defect was confirmed. Proving the live component behavior requires either a new component-test harness or an authenticated admin e2e seed path, which is broader than this cycle's public-preview/cache and ledger fixes.
- Exit criterion: add a component or e2e regression that saves a byte-impacting setting with existing images, verifies the backfill-required banner remains visible after save, triggers the zero-candidate backfill path, and verifies the settings-only toast message.

## Carry-forward Deferred Items

- `C72-06` - Browser matrix invariants are mostly mocked, not engine-smoked. Exit criterion: add a small tagged Playwright matrix for Firefox and WebKit with one or two smoke specs covering home/photo render, no console/Next errors, and display-capability-visible outcomes where engine support permits; document when those smokes should run.
- `C65-02` - Settings-only re-encode obligation disappears after page reload. Exit criterion: plan and implement a durable `admin_settings` marker or equivalent last-applied derivative settings hash; update both force re-encode completion paths to clear/advance it; add tests proving reload persistence and clear-on-completion.
- `C61-06` - Shared-group view-count flush race logic lacks behavioral coverage. Exit criterion: schedule a focused test plan that mocks the DB update chain, drives fake timers, covers in-flight buffer swaps, verifies failed writes re-buffer up to retry cap, and proves post-swap increments flush after the active drain.
- `C61-07` - Lightroom upload route remains mostly source-contract covered. Exit criterion: add handler-level unit coverage with mocked `withAdminAuth`/token context, `saveOriginalAndGetMetadata`, `stripGpsFromOriginal`, DB insert, and `enqueueImageProcessing`; assert wrong-scope rejection, GPS-strip failure without insert, HDR-disabled cleanup, and successful `uploaded_by` insert/enqueue.
- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps. Exit criterion: schedule a design-backed change that defines production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.
- `TV-40-03` - JavaScript operational scripts need semantic checking. Exit criterion: migrate the operational script check to semantic `checkJs` or equivalent without masking existing script type errors.
- `PERF-C39-03` - feed and sitemap updated-time indexes. Exit criterion: migration-shaped plan with EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - backfill pipeline-version indexes. Exit criterion: migration-shaped plan with query-plan evidence and write-path impact review.
- `AGG-C38-07` - broad imported-helper side-effect classification. Exit criterion: scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - sidecar keyset pagination. Exit criterion: throughput/memory plan defines keyset cursor semantics and regression coverage.
