# Test-Engineer Review - Cycle 9

Date: 2026-07-07
Mode: PROMPT 1 deep review from test coverage, flaky tests, regression locks, and TDD opportunity angle. Application code was not modified.

## Scope and Inventory

Read first: `AGENTS.md` and `CLAUDE.md`.

Inventory built from the full repository test/source surface, not a sampled subset:
- Unit tests: 347 files under `apps/web/src/__tests__`.
- Playwright/e2e: 12 files under `apps/web/e2e`.
- Main source surfaces reviewed for test gaps: 81 files under `apps/web/src/app`, 61 under `apps/web/src/components`, 111 under `apps/web/src/lib`, 30 scripts under `apps/web/scripts` and root `scripts`, and 33 Drizzle migration/meta files.
- Gate harness reviewed: root/package workspace scripts, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, e2e helpers, lint-checker tests, source-contract tests, migration tests, privacy/security guard tests, public/admin route tests, CLIP tests, upload/image queue tests, and prior `.context` plan/review artifacts for known residuals.

Static review evidence:
- `rg` found no focused `.only(` usage in the test/e2e/config surface checked.
- Intentional skip surface is concentrated in admin/origin Playwright config gaps and the CLIP env-gated suites: `apps/web/e2e/admin.spec.ts:7,12`, `apps/web/e2e/origin-guard.spec.ts:29,35,56,58,77`, `apps/web/src/__tests__/clip-offline-load.test.ts:41`, and `apps/web/src/__tests__/clip-semantic-integration.test.ts:31`.
- Source-contract usage is broad: 154 test files under `apps/web/src/__tests__` match `readFileSync`, `source-contract`, `Source-contract`, or `extractFnBody`, with 333 matching lines. Those tests are useful tripwires, but several behavior-critical paths still depend on them too heavily.

Not run:
- Full Vitest/Playwright gates. This was a read-only review task; no app code changed, and no completion claim depends on fresh green test output.

## Findings

### TE-C9-01 - Authenticated admin/security e2e coverage can be skipped by the default gate

Severity: High
Confidence: High
Status: confirmed
File/region: `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:27-73`, `apps/web/e2e/helpers.ts:28-45`, `apps/web/playwright.config.ts:48-87`

Why: the admin Playwright suite is opt-in unless `adminE2EEnabled` resolves true (`admin.spec.ts:11-12`). The helper auto-enables only for a local non-production origin with plaintext `E2E_ADMIN_PASSWORD` or plaintext `ADMIN_PASSWORD` (`helpers.ts:28-45`). CI has an assertion that credentials are configured (`admin.spec.ts:6-9`, `origin-guard.spec.ts:27-31`), but ordinary `npm run test:e2e` can skip all authenticated admin workflows. The most security-sensitive origin-guard assertion also skips unless admin credentials are available (`origin-guard.spec.ts:55-73`), while the unauthenticated smoke allows `401` and explicitly does not prove the origin branch (`origin-guard.spec.ts:33-53`). Playwright itself runs one project, one worker, one desktop Chromium profile (`playwright.config.ts:48-87`).

Concrete failure scenario: a refactor breaks an authenticated admin route, token-scoped admin surface, or the same-origin branch after a valid admin cookie. A local or remote smoke run without plaintext e2e credentials still passes because the authenticated specs are skipped; the unauthenticated origin test returns `401` before the CSRF/origin guard is exercised.

Suggested fix: make authenticated admin coverage deterministic in the local e2e harness by seeding an isolated disposable admin user/password for Playwright, then fail the e2e command if the admin project cannot run. Split the authenticated origin-guard test into a required security project or add a unit/integration route test that creates a valid session cookie without relying on optional Playwright credentials. Keep the current remote-admin safety opt-in.

TDD opportunity: add a failing test first that asserts `npm run test:e2e` in the default local e2e environment runs at least one authenticated admin test and the authenticated spoofed-origin request returns `403`.

### TE-C9-02 - Production CLIP activation still relies on manual skipped suites, not a required gate

Severity: High
Confidence: High
Status: confirmed
File/region: `CLAUDE.md:587-596`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/__tests__/semantic-route-production.test.ts:3-5`, `apps/web/src/lib/gallery-config.ts:123-126`, `apps/web/src/app/api/search/semantic/route.ts:247-289`

Why: the project documentation says the real encoder pre-activation suites are permanently skipped in CI and are the only verification before flipping semantic search to production (`CLAUDE.md:587-596`). The offline load test skips unless `CLIP_OFFLINE_LOAD=1` and a seeded model root exists (`clip-offline-load.test.ts:15-41`). The semantic ranking test skips unless `CLIP_INTEGRATION=1` (`clip-semantic-integration.test.ts:8-31`). The production route test mocks both `getGalleryConfig` and `embedTextReal` (`semantic-route-production.test.ts:3-5`), so default unit gates do not load the real model. Runtime production activation is still possible through `semantic_search_mode` plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (`gallery-config.ts:123-126`), after which the public route calls `embedTextReal` and returns `503` if inference fails (`route.ts:247-260`).

Concrete failure scenario: a dependency, model layout, cache path, native runtime, or pinned revision change breaks offline CLIP loading. Default CI remains green because the real encoder suites skip and the route test uses a mock. An operator enables production semantic search and public search requests start returning `503`.

Suggested fix: promote CLIP activation verification from manual documentation into an executable gate. Options: add `npm run test:clip:preflight` and require a persisted preflight artifact before the DB mode can be switched to `production`, or run the two CLIP suites in CI with a small seeded cache artifact. The production route test should remain mocked for speed, but activation should fail closed if no recent real-model preflight result exists.

TDD opportunity: first add a test around the activation path that refuses `production` semantic mode when the required CLIP preflight marker is absent or stale.

### TE-C9-03 - Load-more cursor tests duplicate a permissive mock instead of exercising the real normalizer

Severity: Medium
Confidence: High
Status: confirmed
File/region: `apps/web/src/lib/data.ts:701-759`, `apps/web/src/app/actions/public.ts:132-245`, `apps/web/src/__tests__/public-actions.test.ts:39-56`, `apps/web/src/__tests__/smart-collection-pagination.test.ts:56-75`, `apps/web/src/__tests__/load-more-rate-limit.test.ts:30-45`

Why: production cursor normalization is strict: capture dates must match MySQL datetime format, created timestamps must match ISO or MySQL datetime format, strings are length-capped, IDs must be positive integers, and invalid dates are rejected (`data.ts:701-759`). The public load-more actions directly rely on that helper and fail closed on invalid object cursors (`public.ts:132-245`). The main caller tests mock `@/lib/data` and reimplement a looser `normalizeImageListCursor`: `public-actions.test.ts` omits the production regex checks and accepts any parseable string date; `smart-collection-pagination.test.ts` and `load-more-rate-limit.test.ts` are even looser and do not preserve the length/format checks.

Concrete failure scenario: a future change to the real helper rejects a cursor shape emitted by the client, or accidentally relaxes accepted cursor strings. The action tests still pass because their in-test duplicate normalizer encodes a different contract from production. Pagination can then return `invalid`, restart at page 1, or pass unsafe cursor data to the data layer without a unit failure that points at the mismatch.

Suggested fix: add direct unit tests for `normalizeImageListCursor` covering accepted ISO/MySQL strings, fractional seconds, null capture date, long strings, invalid `Date`, slash-formatted dates, non-integer IDs, and object/non-object inputs. In action tests, use `vi.importActual('@/lib/data')` for the real normalizer while mocking only data-fetching functions, or export a small fixture helper shared by production and tests.

TDD opportunity: write failing cases for the currently duplicated mock accepting `created_at: '2026/07/07'` and for smart-collection pagination passing a malformed cursor object; then remove the duplicate implementations.

### TE-C9-04 - Behavior-critical UI regressions are still locked by brittle source contracts

Severity: Medium
Confidence: Medium
Status: risk
File/region: `apps/web/src/__tests__/search-stale-response.test.ts:1-35`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:1-31`, broad source-contract inventory under `apps/web/src/__tests__`

Why: source-contract tests intentionally inspect component text instead of executing UI behavior. For example, `search-stale-response.test.ts` reads `components/search.tsx` and checks string order around `await resp.json()`, a request-id guard, and `setResults(semanticResults)` (`search-stale-response.test.ts:16-27`). `load-more-source-contracts.test.ts` asserts cooldown/live-region behavior through string and regex matches over `components/load-more.tsx` (`load-more-source-contracts.test.ts:5-31`). This catches some accidental edits, but it cannot prove user-observable behavior, async races, event timing, disabled states, or live-region output. It is also brittle under safe refactors.

Concrete failure scenario: a refactor leaves the exact guard string before `setResults` but moves it into a branch that does not run for semantic search, or preserves `setStatusMessage(t('home.loadMoreFailed'))` in source while the failing server-action path never reaches it. The source contracts pass while stale search results overwrite newer results or screen-reader-visible load-more errors stop being announced.

Suggested fix: add a small browser/component behavior harness for the highest-value source contracts. For search, mock semantic fetch responses so request A resolves JSON after request B and assert only B renders. For load-more, mock server-action statuses and assert cooldown, retry, disabled state, and live-region text. Once behavior tests exist, keep one minimal source tripwire per hard-to-render invariant or delete duplicated string locks.

TDD opportunity: convert the stale semantic response contract into a failing behavior test before touching `Search`, then use it as the regression lock and demote the source-order check.

### TE-C9-05 - There is no coverage report, threshold, or changed-file ratchet

Severity: Medium
Confidence: High
Status: confirmed
File/region: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`

Why: the unit test gate is plain `vitest run` (`package.json:13`). The Vitest config defines include/exclude and timeout only (`vitest.config.ts:16-39`); there is no coverage provider, per-directory threshold, changed-file ratchet, branch threshold, or required coverage report. This is especially risky in a repo with many source-contract tests, because line/string presence can mask missing behavior execution.

Concrete failure scenario: a new public API route, server action, migration reconciliation branch, upload queue path, or security helper lands with no executed test. Existing tests stay green and no gate reports that the new code has zero branch coverage.

Suggested fix: add a non-blocking `test:coverage` baseline with V8 coverage first, then ratchet changed files and critical directories (`src/app/actions`, `src/app/api`, `src/lib`, migration scripts). Make exemptions explicit in review artifacts. Avoid immediately enforcing a repo-wide high threshold; start with critical path branch coverage and raise it incrementally.

TDD opportunity: add a changed-file coverage check that fails on a deliberately untested branch in a temporary fixture, then wire it to CI after baselining.

### TE-C9-06 - Browser and device matrix coverage is too narrow for the visual/photo UI risk profile

Severity: Medium
Confidence: High
Status: confirmed
File/region: `apps/web/playwright.config.ts:72-77`, `apps/web/e2e/nav-visual-check.spec.ts:40-87`

Why: Playwright defines only one project: desktop Chromium (`playwright.config.ts:72-77`). Some tests manually resize the Chromium viewport to mobile and save screenshots (`nav-visual-check.spec.ts:40-87`), but there is no WebKit, Firefox, real mobile device profile, or screenshot diff/baseline assertion. For a gallery application with mobile nav, lightbox gestures, color/HDR/display capability behavior, and Korean/English UI strings, a desktop-Chromium-only gate misses browser engine and device class regressions.

Concrete failure scenario: a mobile Safari viewport, touch/gesture interaction, clipboard permission behavior, image color rendering branch, or CSS layout quirk breaks while desktop Chromium e2e stays green. The nav screenshot files are produced, but no automated diff fails the build.

Suggested fix: add a narrow required smoke matrix rather than duplicating the full suite: one mobile WebKit project for nav/lightbox/search/load-more, one Firefox or WebKit desktop project for key public routes, and optional screenshot diff baselines for the existing nav visual checks. Keep admin flows serialized in Chromium unless separate seeded users are added.

TDD opportunity: add a WebKit mobile smoke that currently fails or is skipped, then make the smallest layout/test-harness changes needed for it to run deterministically.

## Final Sweep

- Checked for skipped/focused tests in `apps/web/src/__tests__`, `apps/web/e2e`, and test configs. No focused `.only(` usage was found; current skips are intentional but create the gaps listed above.
- Checked the public route rate-limit scanner before reporting route-scan gaps; the scanner discovers public route files under the app tree, so I did not report a false scanner-root issue.
- Re-checked migration, privacy, auth-wrapper, action-origin, public-rate-limit, e2e safety, upload, image queue, CLIP, and source-contract test areas for common missing gates.
- Several findings align with older deferred risks in `.context/plans/`, but the citations above are from current files in this cycle.
- No application code was changed. The only write from this review is this report.
