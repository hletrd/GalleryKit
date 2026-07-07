# Cycle 15 Test-Engineer Review

Scope: whole-repository test coverage and testability review for review-plan-fix cycle 15. I read the required local instructions first: `AGENTS.md`, the testing/gates/security portions of `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, and `.context/reviews/prompts/test-engineer.md`. I did not run mutating gates or E2E because this was a review-only task and the Playwright path intentionally seeds and mutates a disposable runtime; validation here is static inventory, source/config inspection, and cross-file coverage comparison.

## Inventory

- Test harness and gates examined: root `package.json:17-29`, `apps/web/package.json:8-29`, `apps/web/vitest.config.ts:16-39`, `apps/web/playwright.config.ts:48-87`, AGENTS quality gates at `AGENTS.md:29-38`, CLAUDE test/gate docs at `CLAUDE.md:665-722`, and security surface notes at `CLAUDE.md:199-249`.
- Active test surface examined: 355 Vitest files under `apps/web/src/__tests__`; 9 Playwright spec files plus `helpers.ts` and 2 image fixtures under `apps/web/e2e`; about 3213 `it(`/`test(` declarations across the unit and E2E trees.
- Active specialty source inventory examined: 8 API route files under `apps/web/src/app/api`, 13 server-action files under `apps/web/src/app/actions`, 81 app-route files under `apps/web/src/app`, 61 component files, 114 library files, 3 DB entry files, 28 scripts, and 33 Drizzle migration/meta files.
- Source-contract inventory: 168 test files read source files directly via `readFileSync`/`readFile(...)`. I treated these as useful tripwires but reviewed whether they execute the behavior they claim to protect.
- Gate coverage comparison: the server-side custom scanners are strong and tested: API admin auth, action origin, public route rate limits, touch target audit, migration journal/reconcile, privacy-sensitive field guards, upload-path security, and rate-limit ordering all have dedicated tests or fixture scanners. The thinner areas are browser/device diversity, visual assertions, client component behavior, and real CLIP pre-activation proof.
- Skipped/generated exclusions: `.git`, `node_modules`, `.next`, `test-results`, coverage/dist output, hidden agent/runtime caches, and binary fixtures except where they were part of E2E or CLIP/color/HDR coverage. No active review-relevant file in the inventory above was intentionally skipped; lower-risk source files were covered through full-tree inventory, static scans, and targeted cross-file reads.

## Confirmed Issues

### TE15-01 - Nav visual E2E writes screenshots but cannot fail on visual regressions

- Severity: Medium
- Confidence: High
- File/region: `apps/web/e2e/nav-visual-check.spec.ts:40-58`, `apps/web/e2e/nav-visual-check.spec.ts:61-72`, `apps/web/e2e/nav-visual-check.spec.ts:75-85`; repo-wide screenshot search found only these `page.screenshot(...)` calls and no `toHaveScreenshot(...)`/snapshot comparison.
- Why this is a problem: the spec name and artifacts imply visual coverage, but the assertions only prove visibility, 44 px target dimensions, and non-overlap. The screenshots are written to `test-results` and are not compared against a baseline.
- Concrete failure scenario: a nav redesign breaks spacing, colors, logo alignment, active chip styling, or mobile panel composition while every target remains visible and non-overlapping. `npm run test:e2e --workspace=apps/web` still passes and the unreviewed PNG artifact is the only clue.
- Suggested fix: either convert the three captures to Playwright `expect(page).toHaveScreenshot(...)` with committed baselines, or rename the spec to a geometry smoke and add a separate baseline-diff visual spec for mobile collapsed, mobile expanded, and desktop nav.
- TDD opportunity: first add a failing baseline for the mobile expanded menu, verify the intended rendering manually once, then commit the accepted baseline.

### TE15-02 - There is no coverage report, threshold, or changed-file coverage ratchet

- Severity: Medium
- Confidence: High
- File/region: root scripts at `package.json:17-29`, web scripts at `apps/web/package.json:8-29`, and Vitest config at `apps/web/vitest.config.ts:16-39`.
- Why this is a problem: the repo has a very large suite, but no configured coverage command or threshold. A full-text search for coverage tooling found prose/comments and test names, not a runnable coverage gate. This matters because 168 tests are source-contract tests and may not execute the runtime branches they protect.
- Concrete failure scenario: a new public API route, action branch, migration reconcile path, or client island lands with only source-string assertions or no test. Lint/typecheck/build/Vitest can still pass because no gate measures changed-file execution.
- Suggested fix: add a non-blocking `test:coverage` first, then introduce a changed-file ratchet for high-risk directories (`src/app/api`, `src/app/actions`, `src/lib`, `scripts/migrate.js`, and high-traffic client components). Keep broad global thresholds optional until noisy generated/source-contract-only cases are classified.
- TDD opportunity: add a temporary untested fixture under a critical directory and make the ratchet fail before enforcing it in CI.

## Likely Issues

### TE15-03 - Semantic scan caps are source-pinned instead of behavior-asserted

- Severity: Medium
- Confidence: Medium
- File/region: `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:1-17`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-76`, `apps/web/src/__tests__/semantic-search-route.test.ts:372-382`, `apps/web/src/__tests__/semantic-search-route.test.ts:459-467`, `apps/web/src/__tests__/similar-route.test.ts:59-78`, runtime routes at `apps/web/src/app/api/search/semantic/route.ts:263-279` and `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`.
- Why this is a problem: the runtime code correctly applies `.limit(SEMANTIC_SCAN_LIMIT)`, but the behavioral DB mocks resolve from `.limit(...)` without recording or asserting the argument. The dedicated cap test reads route source and regexes `.limit(SEMANTIC_SCAN_LIMIT)`, which catches simple deletion but does not prove the scan query receives that cap.
- Concrete failure scenario: a refactor leaves `.limit(SEMANTIC_SCAN_LIMIT)` in a dead/unrelated chain or changes the embedding-scan chain to call `.limit(topK)` while preserving the searched source tokens. The expensive vector scan can become too wide, and the behavioral tests still pass.
- Suggested fix: in both semantic and similar route tests, make the embedding-scan `.limit` a spy and assert it is called with `SEMANTIC_SCAN_LIMIT` for the scan query, while the target lookup in similar remains `.limit(1)`. Keep the source-contract test as a secondary architecture tripwire only.
- TDD opportunity: first change a local test double to fail when `.limit` receives anything other than `SEMANTIC_SCAN_LIMIT`, then wire the route test to that double.

### TE15-04 - High-value client interactions are still mostly tested through source strings

- Severity: Medium
- Confidence: High
- File/region: Node-only Vitest config at `apps/web/vitest.config.ts:16-39`; source-string tests at `apps/web/src/__tests__/search-status-source.test.ts:15-70`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-30`, and `apps/web/src/__tests__/map-thumb-wiring.test.ts:34-85`; runtime behavior in `apps/web/src/components/search.tsx:163-281`, `apps/web/src/components/search.tsx:283-315`, `apps/web/src/components/load-more.tsx:43-110`, `apps/web/src/components/map/map-client.tsx:53-72`, and `apps/web/src/app/[locale]/(public)/map/page.tsx:89-95`.
- Why this is a problem: the tests assert tokens such as `requestIdRef.current++`, cooldown refs, `sizedImageUrl(`, and prop names. They do not execute user-visible behavior such as stale async search suppression, abort handling, retry cooldowns, live-region messaging, one-shot image fallback, or configured map thumbnail URL generation.
- Concrete failure scenario: a slow stale semantic search response renders after a newer query, load-more transient retry suppression stops working, or map thumbnails regress to full-size images while the asserted strings remain present in helper comments or nearby code. The suite stays green because the contract is lexical rather than behavioral.
- Suggested fix: avoid broad new dependencies unless approved, but move the highest-risk pieces into executable contracts: pure state helpers for search/load-more transitions, URL helper tests for thumbnail selection/fallback, and Playwright flows for search stale-response and load-more retry behavior. If a DOM-capable Vitest lane is acceptable later, port these client islands to jsdom/happy-dom behavior tests.
- TDD opportunity: start with search stale-response handling: mock a slow first request and fast second request, assert only the second query's status/results become visible.

### TE15-05 - Password-change UI has no browser-level submit regression test

- Severity: Medium
- Confidence: High
- File/region: E2E only navigates to the password page at `apps/web/e2e/admin.spec.ts:36-38`; form behavior lives in `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:36-45` and `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:59-120`; existing tests are source/action-side at `apps/web/src/__tests__/password-form-a11y.test.ts:10-18`, `apps/web/src/__tests__/auth-actions-behavior.test.ts:241-254`, and `apps/web/src/app/actions/auth.ts:342-430`.
- Why this is a problem: the action has coverage for server-side validation/order, and the E2E suite proves the form is visible, but no browser test submits the form. The client-only mismatch guard, `formAction(formData)` handoff, pending disable/focus restore, field names, and alert rendering are not exercised together.
- Concrete failure scenario: a refactor changes the `name` of `confirmPassword`, prevents `formAction` from being called after a valid client submission, or breaks the mismatch alert/focus behavior. Unit/source tests still pass and admin E2E still passes because it never submits the form.
- Suggested fix: add a non-destructive admin E2E that fills mismatched new/confirm passwords and asserts the visible error summary plus `aria-invalid` without changing credentials. Add a separately gated reversible test for real password rotation only if it can always restore the original password in `finally`.
- TDD opportunity: mismatch-only E2E first, because it is deterministic and does not mutate stored credentials.

### TE15-06 - Service-worker registration is source-pinned, not browser-proven

- Severity: Low
- Confidence: Medium
- File/region: registration component at `apps/web/src/components/register-service-worker.tsx:13-25`, root layout wiring at `apps/web/src/app/[locale]/layout.tsx:13` and `apps/web/src/app/[locale]/layout.tsx:152`, source contract at `apps/web/src/__tests__/client-source-contracts.test.ts:58-61`, and SW template tests anchored on generated worker contents at `apps/web/src/__tests__/sw-template-contract.test.ts:28`.
- Why this is a problem: the generated service worker has extensive template tests, and the root layout import/render is source-pinned, but no test executes production-mode registration or proves `navigator.serviceWorker.register('/sw.js', { scope: '/' })` is called in the browser.
- Concrete failure scenario: a refactor changes the registration path/scope, removes the production guard, or introduces a browser-only exception before registration. The SW template tests still pass because `public/sw.js` is correct, and the layout source contract can still pass if the component remains mounted.
- Suggested fix: add a small browser smoke in a production-build context that stubs `navigator.serviceWorker.register` and asserts the path/scope call, or extract the registration decision into a tiny helper that can be executed under unit tests while keeping the browser smoke for integration.
- TDD opportunity: write the helper test first for `NODE_ENV`/capability gating, then add the production Playwright smoke when the harness can stub `serviceWorker`.

## Risks Requiring Manual Validation

### TE15-07 - Playwright runs only Desktop Chrome

- Severity: Medium
- Confidence: High
- File/region: `apps/web/playwright.config.ts:48-58` serializes the suite for admin login budgets; `apps/web/playwright.config.ts:72-77` defines a single `chromium` project using `Desktop Chrome`.
- Why this needs manual validation: the public UI depends on mobile navigation, focus traps, touch/swipe behavior, color-scheme media, clipboard permissions, and photo viewer layout. Some specs set mobile viewport sizes, but they still run in Chromium's desktop engine rather than mobile WebKit or Firefox.
- Concrete failure scenario: iOS/WebKit focus, viewport, pointer/touch, or status-bar behavior regresses while Desktop Chrome passes. This is especially relevant for search dialogs, mobile nav, lightbox/swipe, bottom sheets, and OLED/color UI.
- Suggested fix: add a small required Playwright project for mobile WebKit covering home/nav/search/photo/lightbox, plus one Firefox or desktop WebKit smoke. Keep admin specs serialized or isolated so login-rate-limit constraints do not block public device coverage.

### TE15-08 - Real CLIP production encoder proof is intentionally manual/env-gated

- Severity: Medium
- Confidence: High
- File/region: operator runbook at `CLAUDE.md:610-618`, runtime limit docs at `CLAUDE.md:620-626`, script gate at `apps/web/package.json:21-23`, offline-load skip gate at `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, and semantic integration skip gate at `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`.
- Why this needs manual validation: default CI has no model weights, so both real encoder tests are skipped unless an operator provides `CLIP_MODELS_ROOT` and env flags. This is documented and probably appropriate for a heavy model path, but it means normal PR gates do not prove production semantic search can load weights or rank real images.
- Concrete failure scenario: model layout, pinned revision, native ONNX binding, or seeded volume path drifts. Stub-mode tests and source contracts pass; production semantic activation fails only when the operator flips the DB row without running preflight.
- Suggested fix: keep the manual preflight mandatory, and consider writing a small activation checklist/marker that refuses or warns on production semantic mode unless the preflight script has succeeded against the current model root and revision.

## Positive Coverage Evidence

- Security gate coverage is comparatively strong: CLAUDE documents blocking auth/origin/rate-limit lint gates at `CLAUDE.md:678-695`, and the repo has fixture tests for those scanners. Public/admin API route inventory was checked against the scanner model, and current route files are either wrapped, rate-limited before expensive work, or explicitly exempted.
- E2E seed safety is intentionally guarded: `apps/web/scripts/run-e2e-server.mjs` asserts disposable DB safety before init/seed/build, and `apps/web/scripts/seed-e2e.ts` refuses production/non-disposable databases unless explicitly opted in.
- Touch target coverage is broad: `apps/web/src/__tests__/touch-target-audit.test.ts:17-23` documents a recursive audit, and `apps/web/src/__tests__/touch-target-audit.test.ts:84-88` scans components, admin route files, and public route files.
- Admin E2E credentials are enforced when CI expects admin coverage: `apps/web/e2e/admin.spec.ts:6-12` and `apps/web/e2e/origin-guard.spec.ts:27-31`.

## Final Sweep

- Commonly missed issue sweep covered: focused/skipped tests, source-contract tests, visual assertions, browser/device projects, admin credential gating, semantic/CLIP env gates, route/action scanners, touch-target audit, migration/schema gates, E2E seed safety, SW registration, search/load-more/map client behavior, password-change UI, and API/action route inventories.
- No `.only` tests were found. Skips are limited to admin credential/baseURL guards and real CLIP env/fixture guards: `apps/web/e2e/admin.spec.ts:7-12`, `apps/web/e2e/origin-guard.spec.ts:29-58`, `apps/web/src/__tests__/clip-offline-load.test.ts:41`, and `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`.
- I did not identify a new confirmed gap in the server-side auth/origin/rate-limit scanner coverage. The main remaining risk is that several high-value client and semantic-search contracts are still lexical or single-engine rather than behavior/device-proven.
- Relevant active files from the inventory were examined through file inventories, static scans, and targeted full-file reads for each specialty surface. No relevant active file in the inventory was intentionally skipped.
