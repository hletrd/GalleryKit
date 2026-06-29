# Cycle 19 Test-Engineer Review

Date: 2026-06-30 KST
HEAD: `26f1a66d`
Scope: current HEAD of `/Users/hletrd/flash-shared/gallery`
Lane: test-engineer, cycle 19

## Inventory Summary

Read the in-session `AGENTS.md` instructions and `CLAUDE.md`, then inventoried the repository before selecting findings.

- Source/test scale: 499 TS/TSX source files under `apps/web/src`; 262 Vitest files under `apps/web/src/__tests__`; 5 Playwright specs under `apps/web/e2e`.
- Unit gate: `apps/web/vitest.config.ts` includes `src/__tests__/**/*.test.{ts,tsx}`, excludes `.next`, and uses a 15s timeout.
- E2E gate: `apps/web/playwright.config.ts` runs Chromium single-worker; local runs start `scripts/run-e2e-server.mjs`, which runs init, e2e seed, build, then standalone server.
- Custom gates inspected: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, plus their fixture tests.
- High-risk paths inspected: semantic/similar search, CLIP model queueing, bulk edit client/server flow, public timeline/on-this-day surfaces, Lightroom upload route, analytics/view-count paths, migration/reconcile tests, service worker/PWA, and Playwright smoke/visual specs.

Validation performed:

- Read-only inventory/search and line-number inspection.
- Did not run full `lint`, `typecheck`, `build`, `npm test`, or Playwright. This is a review-only artifact; no source files were changed.
- Unrelated worktree changes in other review files were observed during the pass. This report only edits `.context/reviews/test-engineer.md`.

## Confirmed Findings

### TE19-01. CLIP production inference queue is bounded but abort-insensitive and lacks a behavioral test

Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/clip-model.ts:53-71` defines bounded concurrency, max pending waiters, timeout, and the waiter array.
- `apps/web/src/lib/clip-model.ts:94-127` queues waiters with a timeout but accepts no `AbortSignal`; queued waiters are removed only by timeout or slot release.
- `apps/web/src/lib/clip-model.ts:194-202` exposes `embedTextReal(query)` with no cancellation parameter and wraps the model call in `withInferenceSlot`.
- `apps/web/src/app/api/search/semantic/route.ts:249-253` checks `request.signal` only before calling `embedTextReal`, then awaits the encoder.
- `apps/web/src/app/api/search/semantic/route.ts:263-265` checks abort again only after the encoder returns, before the DB scan.
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-39` source-checks queue bound/timeout strings but does not execute the queue.
- `apps/web/src/__tests__/semantic-search-route.test.ts:264-279` covers only an already-aborted request before charging; it does not cover abort while waiting for or running production CLIP inference.

Failure scenario:

Production semantic search runs with `CLIP_INFERENCE_CONCURRENCY=1`. Several clients issue searches and disconnect after their requests enter the CLIP queue. The queue is bounded, so memory cannot grow indefinitely, but disconnected waiters remain until timeout or until a slot opens. If a slot opens first, the server still runs ONNX text inference for a request whose client is gone.

Fix:

Thread `request.signal` through `embedTextReal(query, { signal })` and `withInferenceSlot`. Remove queued waiters immediately on abort, reject with an abort-specific error, and re-check the signal after acquiring a slot but before model execution. Add a focused test with fake timers or injected queue hooks proving an aborted queued waiter is removed/rejected and never invokes the model.

TDD opportunity:

Write the aborting-waiter test first around a small exported/internal queue helper, then implement signal-aware slot acquisition. Keep the existing source contract as a fast guard, but make the behavior test authoritative.

### TE19-02. Bulk edit dialog state can survive a successful close; tests cover only the server action

Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/components/bulk-edit-dialog.tsx:81-90` stores field modes, values, tag lists, and `applyAltSuggested` in component state.
- `apps/web/src/components/bulk-edit-dialog.tsx:92-103` defines `resetState()`.
- `apps/web/src/components/bulk-edit-dialog.tsx:105-109` calls `resetState()` only through `handleClose(false)`, i.e. when the dialog itself receives a close event.
- `apps/web/src/components/bulk-edit-dialog.tsx:155-160` awaits `onSubmit(input)` but does not reset local state after a successful submit.
- `apps/web/src/components/image-manager.tsx:225-232` closes the dialog externally after a successful server action via `setIsBulkEditDialogOpen(false)`.
- `apps/web/src/components/image-manager.tsx:594-600` passes the parent open state and `handleBulkEdit` into `BulkEditDialog`.
- Existing bulk coverage is concentrated on `bulkUpdateImages` server behavior, e.g. auth/validation and diff applier tests in `apps/web/src/__tests__/bulk-update-images.test.ts:175-360`. Repo search found no component or E2E test that opens the bulk edit dialog, submits, reopens it, and asserts the form reset.

Failure scenario:

An admin bulk-edits selected photos with `titleMode = clear` or a destructive tag-removal set. The server action succeeds, the parent closes the dialog, and selection is cleared. Later the admin selects different photos and opens bulk edit again. Because the child state was not reset by the parent-driven close, the previous modes/values can still be selected and can be submitted unintentionally.

Fix:

Reset dialog state whenever `open` transitions to `false`, not only inside `handleClose`, or reset explicitly after `onSubmit` resolves successfully. Add a component-level regression test, or extract a pure `buildBulkUpdateInput` plus a small client test harness, covering submit-success close -> reopen -> defaults restored.

TDD opportunity:

Start with a failing reopen test: render the dialog with selected IDs, choose `clear` for title, submit successfully, rerender with `open=false`, rerender with `open=true`, and assert all modes are `leave` and tag lists are empty.

### TE19-03. Semantic-search rate-limit posture has contradictory docs and incomplete assertions

Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:12-16` says disabled mode returns before body reads or rate-limit charging.
- The implementation charges before the DB-backed mode lookup at `apps/web/src/app/api/search/semantic/route.ts:172-183`, then returns disabled-mode 503 at `apps/web/src/app/api/search/semantic/route.ts:185-200`.
- `apps/web/src/lib/rate-limit.ts:24-30` says semantic text search refunds only pre-work short-query rejections.
- `apps/web/src/lib/rate-limit.ts:374-377` says rollback is used for exits before protected work and gives disabled mode as an example.
- The route imports only `preIncrementSemanticAttempt`, not `rollbackSemanticAttempt`, so short/long query validation at `apps/web/src/app/api/search/semantic/route.ts:237-244` stays charged.
- `apps/web/src/__tests__/semantic-search-route.test.ts:230-242` asserts 400 responses for short and overlong queries but does not assert whether the semantic limiter was charged or refunded.
- `apps/web/src/__tests__/semantic-search-route.test.ts:244-262` now asserts disabled mode is charged and not rolled back, contradicting the stale route/header prose.

Failure scenario:

A future maintainer follows the stale header and moves disabled-mode lookup before charging, reintroducing unmetered DB-backed config probes. Another maintainer could follow the central Pattern 2b prose and add rollbacks for short-query validation, changing current budget semantics without a test failure because those tests assert only status/body.

Fix:

Choose one semantic rate-limit policy and make comments plus tests match it. If current behavior is intended, update the route header and `rate-limit.ts` comments to say disabled-mode config lookup and post-read query-length validation remain charged. Add test assertions to the short-query and overlong-query cases that `preIncrementSemanticAttempt` is called once and `rollbackSemanticAttempt` is not called. If refunds are intended instead, implement the rollback and update the disabled-mode test.

TDD opportunity:

Add a table-driven test for each early-return branch: origin, maintenance, content-type, missing length, already-aborted, disabled mode, invalid JSON, short query, overlong query, over-limit. Assert status and exact charge/rollback calls.

### TE19-04. On-this-day date behavior is source-pinned but not behavior-tested against a clock

Severity: Low-Medium
Confidence: High

Evidence:

- `apps/web/src/components/on-this-day-widget.tsx:14-23` computes month/day from `new Date()` inside the server component, then calls `getOnThisDayImages(month, day)`.
- `apps/web/src/__tests__/data-timeline.test.ts:49-87` source-checks the data query predicate shape.
- `apps/web/src/__tests__/data-timeline.test.ts:117-200` tests inline copies of grouping and MM-DD matching logic, not the exported server component or an injected clock.
- Repo search found no test that mocks the current date and asserts `OnThisDayWidget` calls `getOnThisDayImages` with the expected month/day.

Failure scenario:

The server runs in UTC while the product/operator expectation is local calendar day. Around local midnight, the widget can query yesterday/tomorrow relative to the gallery's intended timezone. A future refactor can also change `new Date()` handling in the component and still pass the current source-level data query tests because they never render the widget or control the clock.

Fix:

Extract a tiny `getTodayMonthDay(now = new Date())` helper or inject a clock into the widget's date resolver. Add unit tests for normal dates, local-midnight boundaries, and February 29. If the product expects a specific timezone, make that explicit in config/docs and test it.

TDD opportunity:

Write a failing test that freezes the clock to a boundary instant and asserts the exact `(month, day)` passed into a mocked `getOnThisDayImages`. Then implement the smallest clock abstraction needed to make the behavior deterministic.

### TE19-05. Nav "visual" Playwright checks save screenshots but do not compare them

Severity: Low
Confidence: High

Evidence:

- `apps/web/e2e/nav-visual-check.spec.ts:6-38` checks visible nav targets for 44 px minimum size and pairwise overlap.
- `apps/web/e2e/nav-visual-check.spec.ts:41-52` saves `test-results/nav-collapsed-mobile.png`.
- `apps/web/e2e/nav-visual-check.spec.ts:54-66` saves `test-results/nav-expanded-mobile.png`.
- `apps/web/e2e/nav-visual-check.spec.ts:68-79` saves `test-results/nav-desktop.png`.
- None of these tests call `expect(page).toHaveScreenshot(...)` or compare against a baseline. The screenshots are diagnostic artifacts only.

Failure scenario:

A regression changes nav colors, spacing, active state, clipping, z-index, or a non-overlapping but visibly broken layout. The test still passes as long as controls remain visible, non-overlapping, and at least 44 px. The file name "visual checks" can give reviewers false confidence that screenshot regression is enforced.

Fix:

Either convert these to real visual regression tests with Playwright `toHaveScreenshot` baselines and stable masks, or rename/comment them as layout-smoke tests. If snapshot churn is too high, keep the metric assertions and add targeted checks for the specific visual invariants the repo cares about.

TDD opportunity:

Add one baseline-backed mobile-expanded nav screenshot first. Tune masks/timeouts until it is stable, then decide whether collapsed and desktop states should join the visual gate or remain diagnostic.

## Coverage Notes

- The repository has strong coverage for server actions, privacy select guards, color/HDR parsing, upload processing, custom lint fixtures, and many historical regression contracts.
- The main false-confidence pattern is source-contract testing over runtime-heavy surfaces. Source contracts are useful here, but they should not be the only gate for stateful runtime behavior such as CLIP queueing, dialog state, multipart route cleanup, or migration/schema equivalence.
- Cycle 18 test-engineer deferred items remain tracked in `plan/plan-375-cycle18-deferred.md` (`AGG-C18-25` through `AGG-C18-30`). I did not re-count those as new Cycle 19 findings, but they remain relevant coverage debt.

## Final Missed-Issue Sweep

Final sweep covered:

- Prior Cycle 18 test-engineer report and current deferred plan, to avoid duplicating already-tracked debt as new findings.
- Current HEAD diff and tests touched by `26f1a66d`.
- Semantic and similar search route tests, CLIP queue source contracts, and abort handling.
- Bulk edit client/server integration path and existing bulk server-action tests.
- Public timeline/on-this-day tests and date handling.
- Playwright admin/public/origin/nav specs and e2e server/seed setup.
- Public analytics/view-count tests, migration/reconcile source tripwires, Lightroom source contracts, service worker/PWA contracts, and custom lint scanner fixtures.

No critical coverage gaps were confirmed in this pass. Confirmed findings: 5.
