# Cycle 16 Test-Engineer Review

Scope: comprehensive test coverage and test-quality review of GalleryKit at `78778dd8`, from the test-engineer lane of the review-plan-fix loop. I reviewed repo guidance (`AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/test-engineer.md`), built a full test/source inventory, then checked the critical auth, upload, route/security, migration, rate-limit, UI, accessibility, fixture, and e2e surfaces against the tests that claim to cover them.

I did not run the full mutating browser/e2e gate during this review. Evidence is from static inventory, current CI/test configuration, source/test cross-checks, and targeted full-file reads for the risk surfaces below.

## Inventory

- Active test surface: 355 Vitest files in `apps/web/src/__tests__`; 9 Playwright specs plus 3 helpers/fixtures in `apps/web/e2e`.
- Behavior-critical source surface: 8 API route files, 15 server-action/action-adjacent files, 80 app-route files, 61 component files, 114 library files, 27 scripts, and 33 migration/meta files.
- Gate/config files inspected: `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`.
- Source-contract footprint: 170 Vitest files read implementation source via `readFileSync`/`readFile(...)`; 86 test filenames include source/contract/wiring/lock/scan/audit-style roles.
- Skips/focus sweep: no `.only` found. Conditional skips are admin/baseURL e2e guards (`apps/web/e2e/admin.spec.ts:7`, `apps/web/e2e/admin.spec.ts:12`, `apps/web/e2e/origin-guard.spec.ts:29-58`, `apps/web/e2e/origin-guard.spec.ts:77`) and real-CLIP guards (`apps/web/src/__tests__/clip-offline-load.test.ts:41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`).
- Full-tree risk categories checked: missing regression tests, source-string false confidence, e2e browser gaps, auth/session and upload/security gates, migration/schema tests, UI accessibility/touch targets, rate-limit/concurrency tests, fixture quality, and TDD opportunities.

## Confirmed Issues

### TE16-01 - Logout skipped-revocation behavior is source-pinned, not behavior-tested

- Severity: High
- Confidence: High
- File/region: runtime `apps/web/src/app/actions/auth.ts:286-312`; source-string tests `apps/web/src/__tests__/pending-session-revocations.test.ts:88-99` and `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:63-72`; only behavioral logout test is hostile-origin early return at `apps/web/src/__tests__/auth-actions-behavior.test.ts:231-239`.
- Why this is a problem: the critical contract is behavioral: if logout cannot delete the DB session because restore maintenance is active or the admin mutation barrier is unavailable, it must clear the cookie and queue `hashSessionToken(token)` for later revocation. Current tests prove the queue implementation works and that certain strings exist/order in `auth.ts`; they do not call `logout()` under the blocked branches.
- Concrete failure scenario: a refactor leaves `enqueuePendingSessionRevocation(hashSessionToken(token))` in the file but outside the real not-revoked branch, or changes the maintenance/barrier branch so it redirects after cookie deletion without queuing. The user sees a logout, but the server-side session remains valid until expiry or restore flush; source tests can still pass.
- Suggested fix: add behavioral cases in `auth-actions-behavior.test.ts` that mock a valid cookie/session, `getRestoreMaintenanceMessage()` truthy, and `acquireAdminMutationSlot().acquired === false`. Assert `db.delete(sessions)` is not called, `enqueuePendingSessionRevocation` receives the exact hash, `cookieStore.delete` is called, and redirect still occurs.
- TDD opportunity: first write the restore-window case as a failing test with the queue spy; then add the barrier-unavailable sibling.

### TE16-02 - Browser upload quota TOCTOU protection has no concurrent behavior test

- Severity: High
- Confidence: High
- File/region: runtime claim/order in `apps/web/src/app/actions/images.ts:232-269` and first awaited checks at `apps/web/src/app/actions/images.ts:271-319`; source-only lock in `apps/web/src/__tests__/images-action-toctou-claim.test.ts:17-56`; existing behavior tests cover single-call branches in `apps/web/src/__tests__/images-actions.test.ts:435-493`.
- Why this is a problem: the important property is that two overlapping `uploadImages()` calls for the same admin/IP cannot both pass quota checks before either claims. The test only compares source indexes against two known awaits (`ensureUploadDirectories()` and topic select). It would not catch a new awaited pre-check inserted between the quota checks and `tracker.bytes += totalSize`.
- Concrete failure scenario: future code awaits a new audit/settings/virus-scan precheck after `tracker.bytes + totalSize` validation but before the claim. Two concurrent requests both pass, both then claim, and jointly exceed `UPLOAD_MAX_FILES_PER_WINDOW` or `MAX_TOTAL_UPLOAD_BYTES`. The source test still passes if the new await is not one of the two hard-coded needles.
- Suggested fix: add a concurrency test around `uploadImages()` with a controllable Promise at the first post-claim dependency. Launch two calls with the same tracker key, hold them at the gate, and assert the second observes the first claim or the combined tracker never exceeds the configured window. Keep the source-order test only as a secondary tripwire.
- TDD opportunity: make the test fail by temporarily moving the claim below a controlled await, then restore the runtime ordering.

### TE16-03 - Search `tag_names` full-tag aggregation regression is only source-sliced

- Severity: High
- Confidence: High
- File/region: runtime query in `apps/web/src/lib/data.ts:1682-1729`; source-slice test in `apps/web/src/__tests__/data-tag-names-sql.test.ts:234-248`.
- Why this is a problem: this guards a documented production bug class: tag search must filter by `EXISTS` while `tag_names` aggregates the full tag set. The current test checks strings like `tagMatchExists`, `.leftJoin(imageTags`, and not `.innerJoin(tags`; it does not execute `searchImages()` or assert a result for a multi-tag photo.
- Concrete failure scenario: a refactor preserves those strings but attaches the tag filter to the wrong query branch or changes the `EXISTS` predicate so the selected row still loses non-matching tags. Search result labels/alt text drop tags again while the source-slice test remains green.
- Suggested fix: add a behavior-level data test with a fixture row/photo carrying at least two tags and a search term matching only one. Assert returned `tag_names` contains both tags. If full DB execution remains too heavy, compile the actual Drizzle query shape and assert the generated SQL keeps tag filtering in an `EXISTS` predicate rather than the aggregation join.
- TDD opportunity: start with a failing fixture that expects `tag_names === 'matching,other'` after searching `matching`.

### TE16-04 - GPS fail-closed cleanup is not asserted on either upload path

- Severity: Medium
- Confidence: High
- File/region: browser runtime cleanup at `apps/web/src/app/actions/images.ts:409-422`; LR runtime cleanup at `apps/web/src/app/api/admin/lr/upload/route.ts:407-424`; browser source test at `apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts:69-76`; LR source test at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:106-111`; LR behavior tests only assert HDR cleanup at `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-208`.
- Why this is a problem: when mandatory GPS stripping fails, the saved original must be deleted before returning an error. The source tests assert the strip call, failure branch, message/status, and `continue`/422, but not the deletion call. The behavior test for LR proves cleanup for HDR rejection, not GPS-strip failure.
- Concrete failure scenario: `deleteOriginalUploadFile(...)` is accidentally removed from the GPS failure branch while `stripGpsFromOriginal`, `if (!gpsStripped)`, and the error response remain. The tests pass, but a GPS-bearing original remains on disk after a rejected upload.
- Suggested fix: add behavior tests for browser and LR paths with `stripGpsOnUpload: true` and `stripGpsFromOriginal` returning `false`, asserting cleanup, no DB insert, quota settlement/failed count, and the expected user-facing error. As a cheap interim, scope the existing source-window assertions to the `if (!gpsStripped)` block and assert the delete call appears inside it.
- TDD opportunity: add the LR route behavior test first because its existing harness already mocks `stripGpsFromOriginal` and `deleteOriginalUploadFile`.

### TE16-05 - The repository has no coverage report, threshold, or changed-file ratchet

- Severity: Medium
- Confidence: High
- File/region: root scripts `package.json:17-29`; app scripts `apps/web/package.json:8-29`; Vitest config `apps/web/vitest.config.ts:16-39`; CI unit-test step `.github/workflows/quality.yml:69-70`.
- Why this is a problem: the suite is large, but 170 tests read source text and many critical contracts are source-pinned. There is no `test:coverage`, coverage provider config, threshold, or changed-file ratchet to expose unexecuted branches in high-risk directories.
- Concrete failure scenario: a new public API route, server-action branch, migration reconcile path, or client island lands with only source-string assertions or no direct execution. Lint/typecheck/build/Vitest can pass because nothing measures whether the changed behavior was executed.
- Suggested fix: add a non-blocking coverage command first, then ratchet coverage for high-risk changed files under `src/app/api`, `src/app/actions`, `src/lib`, `scripts/migrate.js`, and key client components. Avoid a broad global threshold until source-contract-only tests are classified, otherwise the signal will be noisy.
- TDD opportunity: introduce a temporary untested fixture in a critical directory to prove the ratchet fails before enforcing it in CI.

### TE16-06 - Nav “visual” e2e screenshots are artifacts, not visual assertions

- Severity: Medium
- Confidence: High
- File/region: screenshots in `apps/web/e2e/nav-visual-check.spec.ts:40-58`, `apps/web/e2e/nav-visual-check.spec.ts:61-72`, and `apps/web/e2e/nav-visual-check.spec.ts:75-85`; screenshot search found no `toHaveScreenshot(...)` baseline assertion.
- Why this is a problem: the spec name says visual checks, but CI only asserts visibility, minimum dimensions, and non-overlap. The PNGs are written to `test-results` and are not compared to any committed baseline.
- Concrete failure scenario: nav colors, logo alignment, spacing rhythm, active states, or mobile panel composition regress while every target is still visible and at least 44 px. CI passes and the only evidence is an unreviewed artifact.
- Suggested fix: either convert these to `expect(page).toHaveScreenshot(...)` with stable baselines for mobile collapsed, mobile expanded, and desktop nav, or rename the spec to geometry smoke and create a separate visual-regression job.
- TDD opportunity: commit one mobile-expanded baseline first and verify the failure mode by intentionally changing a nav spacing token locally.

## Likely Issues

### TE16-07 - Semantic scan caps are not behavior-asserted by route tests

- Severity: Medium
- Confidence: Medium
- File/region: source-only cap test `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`; semantic route mock chain does not record the `limit` argument at `apps/web/src/__tests__/semantic-search-route.test.ts:372-382` and `apps/web/src/__tests__/semantic-search-route.test.ts:459-467`; similar-route mock returns from `limit()` without argument assertion at `apps/web/src/__tests__/similar-route.test.ts:59-78`; runtime caps in `apps/web/src/app/api/search/semantic/route.ts:263-279` and `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`.
- Why this is a problem: the brute-force embedding scan must stay bounded by `SEMANTIC_SCAN_LIMIT`. Existing tests catch deleting the source token, but not a route refactor where `.limit(SEMANTIC_SCAN_LIMIT)` remains in a dead or unrelated chain while the awaited scan uses a different limit.
- Concrete failure scenario: semantic search starts scanning `topK` or all rows due to a query-chain refactor. The source string still exists, route tests still return mocked rows, and production query CPU/memory cost becomes unbounded on large galleries.
- Suggested fix: make the embedding scan `.limit` in both route test mocks a spy and assert it is called with `SEMANTIC_SCAN_LIMIT`; for similar route, separately assert the target lookup uses `.limit(1)` and the scan uses `.limit(SEMANTIC_SCAN_LIMIT)`.
- TDD opportunity: temporarily change the route to `.limit(topK)` and confirm the new route test fails.

### TE16-08 - Migration reconcile tests still do not prove structural schema parity

- Severity: Medium
- Confidence: High
- File/region: test self-description admits name-only coverage at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` and `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:107-122`; reconcile/bootstrap path in `apps/web/scripts/migrate.js:858-947`.
- Why this is a problem: `reconcileLegacySchema` is the maintained full-schema bootstrap and drift-repair path, but the tests mostly verify table/column/index names are mentioned in executable source. They do not compare types, nullability, defaults, index order/uniqueness, or foreign-key actions against committed migrations/schema.
- Concrete failure scenario: a migration changes a column default, width, nullability, composite index order, or FK delete rule. The name appears in `migrate.js`, so the source tripwire passes; a fresh or drift-repaired DB can run with subtly wrong schema until a runtime query depends on the exact metadata.
- Suggested fix: add a disposable MySQL structural parity test or CI substep: initialize from the reconcile/bootstrap path, introspect `information_schema.columns`, `statistics`, and FK metadata, and compare against a generated snapshot from committed migrations/Drizzle schema. Keep the current source tests as fast tripwires.
- TDD opportunity: add a test fixture that deliberately mismatches a column default in a temporary reconcile copy and assert the structural diff reports it.

### TE16-09 - Password-change UI submit path has no browser-level regression test

- Severity: Medium
- Confidence: High
- File/region: e2e only navigates to the page at `apps/web/e2e/admin.spec.ts:36-38`; client submit logic in `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:36-45` and alert/ARIA rendering at `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:59-120`; source-only a11y test in `apps/web/src/__tests__/password-form-a11y.test.ts:10-18`; server action tests cover hostile origin and action behavior around `apps/web/src/__tests__/auth-actions-behavior.test.ts:241-254`.
- Why this is a problem: the client-only mismatch guard, field names, `formAction(formData)` handoff, pending state, focus restore, and visible alert/ARIA state are not exercised together in a browser. The e2e suite proves the form is present, not that it submits or blocks correctly.
- Concrete failure scenario: `confirmPassword` is renamed, `handleSubmit` stops calling `formAction`, or mismatch errors render without `aria-invalid`. Server tests and source a11y tests pass; admin e2e still passes because it never submits the form.
- Suggested fix: add a non-destructive admin e2e that fills mismatched new/confirm passwords and asserts the visible error summary plus `aria-invalid`. Add a reversible real password-rotation test only if it can restore the original password in `finally`.
- TDD opportunity: mismatch-only e2e first; it does not mutate stored credentials.

### TE16-10 - Touch-target audit deliberately lets unsized plain text links pass

- Severity: Low
- Confidence: Medium
- File/region: audit comment and matcher behavior at `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`; passing fixture for unsized plain text link at `apps/web/src/__tests__/touch-target-audit.test.ts:1053-1060`; scanner enforcement loop at `apps/web/src/__tests__/touch-target-audit.test.ts:767-808`.
- Why this is a problem: the repo requires 44 px touch targets, but the source scanner intentionally does not flag plain text links without sizing. Current sampled public/footer links mostly include `min-h-11`, but a future `<Link className="text-sm hover:underline">` used as a real navigation control can slip through if it has no sub-44 sizing token.
- Concrete failure scenario: a mobile-only admin or public action is implemented as an unsized inline-style link. The regex audit accepts it as “plain text,” no Playwright DOM audit measures the rendered box, and the tap target can fall below 44 px.
- Suggested fix: add a page-level Playwright DOM audit over representative public/admin pages that measures visible `a`, `button`, form controls, and role-based controls. Alternatively, tighten the source scanner with an explicit inline-text allowlist and fail unsized navigation/action links by default.
- TDD opportunity: add a fixture for an unsized action/navigation link that must fail, while separately allowlisting true inline prose links.

## Risks Requiring Manual Validation

### TE16-11 - Playwright coverage is single-engine Desktop Chrome

- Severity: Medium
- Confidence: High
- File/region: Playwright project config `apps/web/playwright.config.ts:48-77`.
- Why this needs manual validation: the app has mobile nav, bottom sheets, focus traps, swipe/lightbox behavior, clipboard permissions, color/HDR UI, and responsive layouts. Some tests set mobile viewports, but they still run in Desktop Chromium only.
- Concrete failure scenario: mobile WebKit focus handling, viewport units, touch events, or fixed-position bottom sheets regress on iOS while Desktop Chrome passes.
- Suggested fix: add a small required public-flow project for mobile WebKit and a minimal Firefox/WebKit smoke. Keep admin specs serialized or isolated to avoid shared login-rate-limit collisions.

### TE16-12 - Real CLIP proof is scheduled/manual, not a pull-request gate

- Severity: Medium
- Confidence: High
- File/region: skip gates at `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` and `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`; manual script at `apps/web/package.json:21-23`; scheduled/manual workflow at `.github/workflows/clip-preflight.yml:3-6` and `.github/workflows/clip-preflight.yml:40-45`; standard quality workflow does not run it at `.github/workflows/quality.yml:69-80`.
- Why this needs manual validation: the scheduled preflight is useful, but normal PR quality gates still skip real model loading/ranking. Dependency, model-layout, native ONNX, or path regressions may not block the PR that introduced them.
- Concrete failure scenario: a dependency upgrade changes transformer cache behavior or model output keys. Unit/stub route tests pass, the PR merges, and production semantic activation fails until the weekly scheduled preflight or an operator run catches it.
- Suggested fix: keep the scheduled workflow, and make it required for dependency/model-path changes via a path-filtered workflow or branch protection rule. At minimum, document that semantic-production changes require `npm run test:clip:preflight`.

### TE16-13 - Hydration e2e uses `networkidle` as the hydration settle signal

- Severity: Low
- Confidence: Medium
- File/region: `apps/web/e2e/hydration-photo-page.spec.ts:29-42`.
- Why this needs manual validation: `page.waitForLoadState('networkidle')` can be brittle in apps with service workers, image waterfalls, analytics, or future polling. The test currently passes by waiting for page quietness rather than a specific hydration/UI readiness signal.
- Concrete failure scenario: a harmless background request or service-worker revalidation keeps the page from reaching network-idle, making the hydration spec fail or time out even though the user-visible hydration state is correct.
- Suggested fix: wait for a deterministic UI condition or a short `expect.poll` around the specific console-error collection window, such as the info/pin button becoming visible plus no hydration errors after a bounded timeout.

## Positive Coverage Evidence

- CI runs lint, typecheck, custom auth/origin/rate-limit gates, dependency audit, Vitest, DB init, Playwright e2e, and build (`.github/workflows/quality.yml:54-83`).
- Admin e2e is auto-enabled in CI through seeded local plaintext credentials (`apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/helpers.ts:29-44`, `.github/workflows/quality.yml:31-35`), so the admin browser smoke is not merely local/manual.
- The security lint gates are AST-based and fixture-tested, not just grep: API auth, action origin, and public-route rate-limit scanners all have dedicated tests and run in CI.
- Migration journal monotonicity and pending-migration behavior have strong targeted tests; the remaining migration finding is about structural parity, not absence of migration coverage.
- Upload and Lightroom route behavior tests cover many single-branch failures, quota settlement, HDR rejection, disk prechecks, route auth, and PAT actor attribution. The remaining upload findings are specifically concurrency and GPS-strip cleanup.
- Touch-target source coverage is broad and explicit; the remaining accessibility finding is the deliberately unsized plain-link blind spot and lack of rendered DOM measurement.

## Final Sweep

- Commonly missed issue sweep covered: focused/skipped tests, source-string false confidence, admin/browser e2e gates, visual screenshots, single-browser coverage, auth/session revocation, upload quota/concurrency, GPS cleanup, route rate limits, semantic scan caps, CLIP env gates, migration reconcile/schema parity, password UI submit behavior, touch targets, flaky waits/timers, and fixture quality.
- No active `.only` tests found.
- Skips are documented and conditional: admin/baseURL e2e and real-CLIP model gates.
- I did not find a new confirmed hole in the custom auth/origin/public-route scanner coverage itself.
- Highest-priority TDD targets for the next fix pass: TE16-01 logout blocked-branch behavior, TE16-02 concurrent browser upload quota, TE16-03 tag aggregation behavior, and TE16-04 GPS cleanup behavior.
