# Test-Engineer Review - Cycle 20

Date: 2026-06-30 KST
HEAD reviewed: `24c82c71` (`docs(reviews): 📝 add cycle 20 perf review`)
Scope: repository-wide review of tests, lint scripts, build/type gates, invariants, fixtures, flaky/weak assertions, missing regression locks, TDD opportunities, gate blind spots, and source-contract test quality. No implementation files were modified.

## Inventory

Required docs and context read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`
- `.context/reviews/run4-cycle20/*`
- `plan/plan-311-run4-cycle20-fixes.md`
- `plan/plan-312-run4-cycle20-deferred.md`
- `.context/gate-logs/cycle-20/baseline.log`

Test and gate surface inventoried:

- Unit/integration: 264 Vitest files under `apps/web/src/__tests__`.
- Browser E2E: 5 Playwright specs under `apps/web/e2e`.
- Public API routes: 8 route handlers under `apps/web/src/app/api`.
- Server actions: 13 files under `apps/web/src/app/actions`.
- Non-API route handlers: 4 files (`uploads` GET/HEAD and feed GET routes).
- Blocking gates: ESLint, api-auth scanner, action-origin scanner, public-route-rate-limit scanner, typecheck, build, Vitest, Playwright E2E.
- Structural test patterns: source-contract tests, custom scanner fixtures, privacy `SENSITIVE_KEYS`, migration journal monotonicity, service-worker generated/template contracts, touch-target audit, deployment script contracts, and E2E admin/public/origin/nav specs.

Validation performed:

- `npm test --workspace=apps/web -- --run src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/clip-model-contract.test.ts src/__tests__/og-photo-fallback.test.ts src/__tests__/cycle-19-source-contracts.test.ts src/__tests__/seo-actions.test.ts`: passed, 6 files / 78 tests.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.

Full lint/typecheck/build/all-unit/E2E were not run during this review pass.

## Confirmed Findings

### TE20-01 - CLIP queue abort/concurrency behavior is still source-contract tested, not behavior-tested

Severity: Medium
Confidence: High
Status: Confirmed weak assertion

Exact file+region:

- `apps/web/src/lib/clip-model.ts:65-160` implements shared queue state, waiter removal, timeout rejection, abort listener cleanup, and slot release.
- `apps/web/src/lib/clip-model.ts:228-236` passes `InferenceSlotOptions` through `embedTextReal`.
- `apps/web/src/app/api/search/semantic/route.ts:247-260` passes `request.signal` to production text embedding and maps abort errors to 499.
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-50` only asserts source strings such as `ClipInferenceQueueAbortError`, `signal.addEventListener('abort'`, and `}), options)`.

Missing/weak test scenario:

No test drives actual queue behavior. A refactor can preserve the strings while breaking the invariant: aborted waiters may remain queued, timed-out waiters may still be woken by `inferenceWaiters.shift()?.resolve()`, `activeInferenceCount` may be decremented too early, or an aborted request may still reach `model(...)`.

Suggested test/fix:

Extract a small queue helper or expose a test-only model/tokenizer injection seam. Add fake-timer tests that saturate `CLIP_INFERENCE_CONCURRENCY`, enqueue and abort a second request, assert the model callback is not invoked for that request, assert `CLIP_INFERENCE_MAX_PENDING` throws `ClipInferenceQueueFullError`, and advance timers past `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` to prove timed-out waiters are removed and never woken later.

TDD opportunity:

Write the aborting-waiter test first against a narrow queue helper, watch it fail against the current source-only coverage, then move the current implementation behind that helper without changing route semantics.

### TE20-02 - Recent dialog/swipe/accessibility fixes are locked by source text instead of runtime UI tests

Severity: Medium
Confidence: High
Status: Confirmed coverage gap

Exact file+region:

- `apps/web/src/components/bulk-edit-dialog.tsx:81-103` stores and resets stateful draft modes/values.
- `apps/web/src/components/bulk-edit-dialog.tsx:155-160` resets after successful submit.
- `apps/web/src/components/photo-navigation.tsx:47-48` reads `swipeTargetRef.current`; `apps/web/src/components/photo-navigation.tsx:134-142` binds/removes touch listeners on that element.
- `apps/web/src/components/photo-viewer.tsx:689-697` wires the media container ref into `PhotoNavigation`.
- `apps/web/src/components/image-zoom.tsx:343-365` builds and renders the zoom accessible name; `apps/web/src/components/photo-viewer.tsx:554` and `apps/web/src/components/photo-viewer.tsx:724` pass the current photo identity into it.
- `apps/web/src/__tests__/cycle-19-source-contracts.test.ts:27-54` checks these contracts by reading source text.
- `apps/web/e2e/test-fixes.spec.ts:49-75` and `apps/web/e2e/public.spec.ts:61-83` cover adjacent UI paths but not these exact regressions.

Missing/weak test scenario:

The current tests do not render the dialog, dispatch real touch events, or inspect the browser accessibility tree. The source strings can remain while behavior regresses: a parent-driven close might preserve hidden destructive draft modes, a ref change might attach swipe handlers to the wrong element, or the zoom control might render as only "Zoom in" while `accessibleName` still appears in source.

Suggested test/fix:

Add Playwright coverage for the browser-native behaviors:

- Open bulk edit, set a non-default mode, submit successfully, reopen, and assert defaults are restored.
- On mobile, swipe over page chrome/metadata and assert the photo ID does not change; swipe over the media container and assert it does.
- Open a seeded photo, focus the main zoom control, and assert its accessible name includes the photo identity plus zoom action.

If Playwright is too slow for the dialog case, add `@testing-library/react` with jsdom/happy-dom for `BulkEditDialog` only.

TDD opportunity:

Start with the bulk-edit reopen regression because it is deterministic and low-cost: make the test fail by selecting `clear`, submitting, toggling `open` false/true, and asserting all modes return to `leave`.

### TE20-03 - Per-photo OG route behavior is under-tested at the route boundary

Severity: Low-Medium
Confidence: High
Status: Confirmed weak assertion

Exact file+region:

- `apps/web/src/app/api/og/photo/[id]/route.tsx:45-56` charges the OG limiter and rolls back only invalid IDs.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:58-129` performs DB/config lookup, canonical-origin fetch, missing-photo fallback, and all-derivatives-missing fallback.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:223-240` converts ImageResponse output through Sharp and handles catch fallback.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:249-295` builds canonical fallback redirects.
- `apps/web/src/__tests__/og-photo-fallback.test.ts:40-87` route-level assertions are source-grep contracts.
- `apps/web/src/__tests__/og-photo-fallback.test.ts:111-203` runtime tests cover only `pickFirstAvailablePhotoBuffer`.
- `apps/web/src/__tests__/og-route-source-contracts.test.ts:5-11` source-checks the sibling topic OG route.

Missing/weak test scenario:

The helper can be correct while the route glues it incorrectly. The current tests would miss wrong helper arguments, a request-origin fallback redirect, limiter refund drift after DB work, catch-path cache-control drift, or a successful route returning the wrong content type after Sharp post-processing.

Suggested test/fix:

Add mocked route tests that call `GET()` directly. Mock `getImageCached`, `getSeoSettings`, `getGalleryConfig`, `pickFirstAvailablePhotoBuffer`, `next/og`, and `sharp`. Assert status, `Cache-Control`, `Content-Type`, limiter/rollback calls, canonical `Location`, and helper args for invalid ID, missing photo, canonical URL parse failure, all-derivatives-missing, success, and catch fallback.

TDD opportunity:

Write the invalid-ID and missing-photo route tests first because they need the fewest mocks and prove the charged/rollback policy at runtime instead of through string counts.

### TE20-04 - Nav visual checks create screenshots but do not compare them

Severity: Low
Confidence: High
Status: Confirmed false-confidence risk

Exact file+region:

- `apps/web/e2e/nav-visual-check.spec.ts:6-38` checks visible nav targets for 44 px size and pairwise non-overlap.
- `apps/web/e2e/nav-visual-check.spec.ts:41-52` writes `test-results/nav-collapsed-mobile.png`.
- `apps/web/e2e/nav-visual-check.spec.ts:54-66` writes `test-results/nav-expanded-mobile.png`.
- `apps/web/e2e/nav-visual-check.spec.ts:68-79` writes `test-results/nav-desktop.png`.

Missing/weak test scenario:

No `expect(page).toHaveScreenshot(...)` or baseline comparison runs. Color, spacing, typography, active states, clipping, z-index, or a visually broken but non-overlapping layout can regress while the "visual checks" pass. The screenshots are diagnostic artifacts, not a regression gate.

Suggested test/fix:

Either convert one or more states to real Playwright visual snapshots with stable masks and `toHaveScreenshot`, or rename/comment the spec as a nav layout-smoke test. If snapshot churn is too high, add targeted metric assertions for the visual invariants the repo actually needs.

TDD opportunity:

Start with one stable mobile-expanded screenshot baseline. If that proves noisy, keep the metric checks but stop presenting this file as visual-regression coverage.

## Likely Issues

### TE20-05 - Rate-limit policy comments contradict current source-contract tests

Severity: Low
Confidence: High
Status: Likely future-test risk

Exact file+region:

- `apps/web/src/lib/rate-limit.ts:24-30` says semantic text search refunds only pre-work short-query rejections, but current semantic route tests assert short/long query and disabled mode stay charged.
- `apps/web/src/lib/rate-limit.ts:53-55` says `og-photo-fallback.test.ts` enforces "exactly two" pre-DB rollbacks.
- `apps/web/src/lib/rate-limit.ts:287-300` repeats that the photo route has "exactly two" pre-DB rollbacks.
- `apps/web/src/__tests__/og-photo-fallback.test.ts:53-75` currently asserts exactly one `rollbackOgAttempt(ip)` occurrence in the photo route.
- `apps/web/src/__tests__/semantic-search-route.test.ts:232-267` asserts no rollback for short/long query and disabled mode.
- `apps/web/src/__tests__/similar-route.test.ts:167-184` asserts disabled/stub mode stays charged for similar search.

Missing/weak test scenario:

The behavior tests are stronger than the prose today, but the stale comments are likely to seed incorrect future tests. A future maintainer could "fix" tests or implementation toward the old comments, reintroducing free config probes or changing the OG refund policy while believing they are following the documented contract.

Suggested test/fix:

Align the comments with current tested behavior. For semantic search, state that route-level tests intentionally keep disabled mode and query-length rejections charged after the config lookup. For the OG photo route, change "exactly two" to "exactly one" or describe the actual invalid-ID-only rollback. A small source-contract test for these comments is optional; removing contradictory examples is enough if behavior tests remain authoritative.

## Coverage Notes

- Strong areas: server-action scanner fixtures, admin API wrapper scanner, semantic/similar route behavior, privacy select guards, migration journal monotonicity, SQL restore scanner, upload processing, color/HDR parsing, service-worker cache helper, tracked-secret hygiene, and touch-target/focus source scans.
- Recurring weak pattern: source-contract tests are used for client UI and route glue where a real DOM or mocked route invocation would be more reliable. Source contracts are useful as cheap tripwires, but they should not be the only gate for stateful React behavior, DOM event scoping, accessible names, or multi-branch route glue.
- E2E suite is intentionally small and single-worker. It covers public smoke, search, lightbox open/close, shared navigation, nav layout smoke, admin login/navigation/topic create/delete/upload when admin credentials are enabled, and origin guard. It does not yet cover semantic search UI, similar-photo UI, OG route responses, bulk edit dialog behavior, or mobile swipe scoping.
- Local Playwright admin coverage can still skip when plaintext admin credentials are unavailable: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:27-31`, and `apps/web/e2e/helpers.ts:28-45`. The CI sentinel mitigates this when `CI=true`; local `npm run test:e2e` can pass with those admin branches skipped.
- The cycle-20 SEO OG backslash regression is now locked by behavior-level validator tests at `apps/web/src/__tests__/seo-actions.test.ts:14-28`; I did not re-report the fixed implementation issue.

## Final Missed-Issue Sweep

Final sweep covered:

- Test config, Playwright config, typecheck config, root/app package scripts.
- All API route files under `apps/web/src/app/api`.
- Non-API route handlers under `apps/web/src/app/**/route.ts`.
- Custom lint scanner scripts and their fixture tests.
- Current semantic/similar route tests and CLIP queue source contracts.
- OG route/helper tests and the fixed SEO OG validator tests.
- Recent cycle-19 source contracts and adjacent E2E specs.
- Cycle-20 historical reviews, fixes, deferred ledger, and baseline gate log.
- Source-contract-heavy tests, skipped tests, timeout/fake-timer usage, and Playwright screenshot usage.

No critical or high-severity test gaps were found. Confirmed test-engineering findings: 4. Likely future-test risk: 1.
