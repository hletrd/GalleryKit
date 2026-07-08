# Cycle 25 Verifier + Test-Engineer Review

Date: 2026-07-08 KST
Scope: whole-repo verifier/test-engineer pass for correctness vs stated behavior, missing tests, flaky-test risk, TDD opportunities, source-contract gaps, false confidence, and quality-gate blind spots. Product code was not edited.

## Inventory

- Repo controls/docs inspected: `AGENTS.md`, `CLAUDE.md`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, current `.context/plans/*2026-07-08*` and recent review artifacts.
- Gate/config files inspected: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Test surface inventoried: 367 committed Vitest files under `apps/web/src/__tests__`, 12 committed Playwright/e2e files under `apps/web/e2e`.
- Source surfaces sampled for contract risk: App Router routes/actions, custom lint scripts, migration/reconcile script, semantic-search/CLIP tests, upload/restore e2e helpers, touch-target and visual-navigation tests.
- Focused validation run: `npm test --workspace=apps/web -- --run src/__tests__/clip-offline-load.test.ts src/__tests__/clip-semantic-integration.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/bottom-sheet-dropdown-portal.test.ts` passed with `2 test files passed | 2 skipped`, `89 passed | 4 skipped`.
- Focused skip/focus sweep: no `.only` tests found. Skips are limited to local/admin e2e guard branches and the real CLIP model suites.

## Findings

### VTE-01 - Migration/reconcile coverage can still pass with structurally wrong schema

- Severity: Medium
- Confidence: High
- Evidence: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` explicitly calls the test a source tripwire, not a structural validator. Its main checks assert `migrate.js` creates each table and mentions each column/index name (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-101`, `157-171`). `prepareLegacyDatabaseIfNeeded` routes fresh DBs through `reconcileLegacySchema` and baselines all journal rows (`apps/web/scripts/migrate.js:877-897`), so reconcile is an authoritative bootstrap path, not just a helper.
- Failure scenario: a future migration changes type, nullability, default, generated expression, index uniqueness/order, or FK action while `migrate.js` still contains the same column/index/FK names. Unit tests pass because names are present, fresh/rebaselined installs can diverge from migrated installs, and the drift may not surface until a later query depends on the exact metadata.
- Fix/tests to add: add a disposable-MySQL structural parity test. Build one schema through current migration application and one through the reconcile/baseline path, then compare `information_schema.columns`, `statistics`, and `referential_constraints`. As a smaller TDD step, add a failing fixture around one column default/nullability and one index uniqueness/order before implementing the full parity harness.
- Existing tracking: overlaps with `.context/plans/cycle-24-2026-07-08-deferred.md:29` (`AGG-C24-19`), but remains open.

### VTE-02 - Mobile bottom-sheet dropdown containment is source-locked, not browser-proven

- Severity: Medium
- Confidence: High
- Evidence: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26` only reads source and asserts strings for the `DropdownMenuContent` `container` prop and sheet refs. The implementation uses that prop at `apps/web/src/components/info-bottom-sheet.tsx:565-603`. Existing browser tests open the sheet (`apps/web/e2e/test-fixes.spec.ts:56-65`) and verify focus restoration (`apps/web/e2e/focus-restore.spec.ts:34-59`), but neither opens the download dropdown or asserts it is inside the dialog/focus-trap subtree.
- Failure scenario: a Radix upgrade, ref wiring change, portal wrapper change, or conditional wide-gamut branch drift causes the menu to render under the overlay, outside the focus trap, or unfocusable on mobile. The source strings can remain present and the current e2e sheet/focus tests still pass.
- Fix/tests to add: add a mobile Playwright test against a deterministic wide-gamut/AVIF fixture: open photo, open Info sheet, expand/open the download menu, assert menu items are visible, are descendants of the sheet dialog or configured portal container, can receive keyboard focus, and close with focus returning to the trigger. Write this as a red test by temporarily omitting `container={sheetElement ?? undefined}`.
- Existing tracking: overlaps with earlier test-engineer findings and `.context/plans/cycle-24-2026-07-08-deferred.md:29` source-contract carry-forward.

### VTE-03 - Browser matrix is Chromium desktop-only despite mobile/touch/product claims

- Severity: Medium
- Confidence: High
- Evidence: `apps/web/playwright.config.ts:72-77` defines only the `chromium` project using `Desktop Chrome`; `.github/workflows/quality.yml:75-80` installs only Chromium and runs `npm run test:e2e`. The app’s stated quality policy includes mobile/touch concerns (`AGENTS.md:44`, `CLAUDE.md:708-721`), and several e2e specs manually set mobile viewports, but they still run in desktop Chromium engine only.
- Failure scenario: a WebKit/Safari-specific fixed-position, focus-trap, dialog portal, service-worker, image color/profile, or touch event behavior regresses. CI stays green because no WebKit/mobile-browser project runs. Manual viewport resizing catches some responsive layout issues, but not engine/device behavior.
- Fix/tests to add: add at least one mobile browser project, preferably `Mobile Safari`/WebKit for public gallery/photo/search/info-sheet smoke, and keep full admin flows Chromium-only if runtime is a concern. If all PRs cannot afford it, run the WebKit/mobile subset on `app/**`, `components/**`, `public/sw.template.js`, and e2e changes.
- Existing tracking: matches `.context/plans/cycle-24-2026-07-08-deferred.md:30` (`AGG-C24-20`).

### VTE-04 - Nav “visual” checks produce artifacts but no visual oracle

- Severity: Low
- Confidence: High
- Evidence: `apps/web/e2e/nav-visual-check.spec.ts:40-87` measures target size and overlap, then saves screenshots at lines 58, 72, and 85. There is no `toHaveScreenshot` or baseline comparison. The grep sweep found only `page.screenshot(...)` calls in this spec, no visual assertion.
- Failure scenario: color, spacing, wrap, z-index, density, or visual hierarchy regresses while the measured buttons remain 44x44 and non-overlapping. CI passes and the screenshots are only artifacts for humans to inspect after the fact.
- Fix/tests to add: either convert the three screenshots to `await expect(page).toHaveScreenshot(...)` with stable masks/baselines, or rename the spec to clarify it is geometry-only. If visual regression is intended, commit baselines for collapsed mobile, expanded mobile, and desktop nav and treat screenshot diffs as release evidence.
- Existing tracking: `.context/plans/cycle-24-2026-07-08-deferred.md:30` and older `D25-19` carry this forward.

### VTE-05 - Real CLIP production coverage is still non-blocking for ordinary code changes

- Severity: Low-Medium
- Confidence: High
- Evidence: the real CLIP suites skip by default unless env/model-weight flags are set (`apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `32-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `30-31`). The focused run in this review produced `2 skipped` CLIP files and `4 skipped` tests. A dedicated preflight workflow exists, but only on schedule/manual dispatch (`.github/workflows/clip-preflight.yml:3-6`) and is separate from the required quality workflow (`.github/workflows/quality.yml:54-83`).
- Failure scenario: a dependency/model-loader/revision/path change breaks offline loading or semantic ranking. Normal PR/push quality stays green; the weekly/manual CLIP job catches it later, if watched.
- Fix/tests to add: make `clip-preflight.yml` path-triggered for `clip-*`, `semantic`, `@huggingface/transformers`, `package-lock`, and model-download changes, or add a required lightweight offline-loader contract that does not need full weights. Before touching CLIP production code, start with a red preflight or mocked-loader test that proves the failure mode.
- Existing tracking: `.context/plans/cycle-24-2026-07-08-deferred.md:31` (`AGG-C24-21`).

### VTE-06 - Coverage volume is high, but there is no coverage/changed-file ratchet

- Severity: Low-Medium
- Confidence: High
- Evidence: root and app test scripts run `vitest run` with no coverage command (`package.json:17-29`, `apps/web/package.json:13-29`), `apps/web/vitest.config.ts:16-39` configures include/exclude/timeouts only, and `.github/workflows/quality.yml:54-83` runs lint/typecheck/security gates/unit/e2e/build without coverage instrumentation.
- Failure scenario: a new branch in a high-risk action/route/migration path ships with only a source-contract test or no test because the suite’s aggregate size creates false confidence. Reviewers can see test count growth, but CI does not enforce changed-code behavior coverage.
- Fix/tests to add: start with a changed-file coverage ratchet or module allowlist for high-risk paths (`app/actions`, `app/api`, `scripts/migrate.js`, `lib/rate-limit`, `lib/restore-*`, `lib/process-image`). Do not require global thresholds immediately; require new/changed branches in those paths to carry behavior tests or an explicit review waiver.
- Existing tracking: `.context/plans/cycle-24-2026-07-08-deferred.md:32` (`AGG-C24-22`).

## Positive Verification Notes

- CI does enable admin e2e in the main quality workflow: `.github/workflows/quality.yml:35-37` provides plaintext e2e admin credentials, and `apps/web/e2e/helpers.ts:28-45` auto-enables admin e2e for local/CI plaintext credentials. The local skip guards in `apps/web/e2e/admin.spec.ts:6-13` are not a CI blind spot under the current workflow.
- The custom public-route rate-limit scanner is AST-based and includes ordering checks for limiter-before-expensive-work (`apps/web/scripts/check-public-route-rate-limit.ts:391-575`, `578-637`) and ambiguous file-level exemption handling (`apps/web/scripts/check-public-route-rate-limit.ts:909-928`), so I did not file a rate-limit scanner gap.
- The action-origin scanner is similarly broad: recursive action discovery and explicit admin DB-actions inclusion are present (`apps/web/scripts/check-action-origin.ts:64-115`), and it enforces both same-origin and mutation-barrier contracts.

## Missed-Issue Sweep

- `.only` sweep: none found under `apps/web/src/__tests__` or `apps/web/e2e`.
- `.skip` sweep: only documented admin/local e2e guards and CLIP env-gated suites were found.
- I did not run the full lint/typecheck/build/e2e suite in this review lane. The focused validation run was scoped to the findings above.
- No product-code edits were made. This report file is the only workspace change from this lane.
