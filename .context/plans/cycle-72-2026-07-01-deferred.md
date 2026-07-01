# Cycle 72/100 Deferred Findings

Cycle 72 defers two test-depth/browser-coverage findings. No confirmed security, correctness, or data-loss source defect is deferred.

## New Deferred Findings

### C72-04 - Feed conditional tests are stale and do not prove route behavior

- Original severity/confidence: Medium / High.
- File/line: `apps/web/src/__tests__/feed-conditional.test.ts:2`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:63`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:68`, `apps/web/src/app/feed.xml/route.ts:156`, `apps/web/src/app/feed.xml/route.ts:157`.
- Deferral reason: the stale helper test is a real coverage gap, but the current cycle has multiple restore-maintenance and cache correctness fixes with direct production behavior. Replacing the feed tests requires a route-level mocking design for both root and topic feeds, including SEO/config/image feed dependencies and locale/topic failure paths. That is safer as a focused follow-up rather than a drive-by source-test rewrite.
- Exit criterion: add route-level unit tests for root and topic feed `GET` handlers covering 200 with ETag, matching `If-None-Match` 304, changed SEO/config producing a different ETag, topic 404, and invalid locale before data calls; then remove or repurpose the dead `isFeedNotModified` helper/test.

### C72-06 - Browser matrix invariants are mostly mocked, not engine-smoked

- Original severity/confidence: Low / High.
- File/line: `CLAUDE.md:365`, `CLAUDE.md:377`, `apps/web/playwright.config.ts:72`, `apps/web/src/__tests__/use-display-capability.test.ts:4`.
- Deferral reason: this is a browser-matrix quality improvement, not a source correctness defect. Adding Firefox/WebKit projects can materially change local/CI runtime and browser dependency requirements. It needs a scoped e2e plan that keeps the current Chromium suite fast while adding narrow tagged smokes.
- Exit criterion: add a small tagged Playwright matrix for Firefox and WebKit with one or two smoke specs covering home/photo render, no console/Next errors, and display-capability-visible outcomes where engine support permits; document when those smokes should run.

## Carry-forward Deferred Items

- `C65-02` - Settings-only re-encode obligation disappears after page reload. Exit criterion: plan and implement a durable `admin_settings` marker or equivalent last-applied derivative settings hash; update both force re-encode completion paths to clear/advance it; add tests proving reload persistence and clear-on-completion.
- `C61-06` - Shared-group view-count flush race logic lacks behavioral coverage. Exit criterion: schedule a focused test plan that mocks the DB update chain, drives fake timers, covers in-flight buffer swaps, verifies failed writes re-buffer up to retry cap, and proves post-swap increments flush after the active drain.
- `C61-07` - Lightroom upload route remains mostly source-contract covered. Exit criterion: add handler-level unit coverage with mocked `withAdminAuth`/token context, `saveOriginalAndGetMetadata`, `stripGpsFromOriginal`, DB insert, and `enqueueImageProcessing`; assert wrong-scope rejection, GPS-strip failure without insert, HDR-disabled cleanup, and successful `uploaded_by` insert/enqueue.
- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps. Exit criterion: schedule a design-backed change that defines production web bootstrap policy, includes tests/source contracts proving it cannot run concurrent bulk CLIP work beside the sidecar/restore lock, and preserves recent-upload embedding recovery behavior.
- `TV-40-03` - JavaScript operational scripts need semantic checking. Exit criterion: migrate the operational script check to semantic `checkJs` or equivalent without masking existing script type errors.
- `PERF-C39-03` - feed and sitemap updated-time indexes. Exit criterion: migration-shaped plan with EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - backfill pipeline-version indexes. Exit criterion: migration-shaped plan with query-plan evidence and write-path impact review.
- `AGG-C38-07` - broad imported-helper side-effect classification. Exit criterion: scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - sidecar keyset pagination. Exit criterion: throughput/memory plan defines keyset cursor semantics and regression coverage.
