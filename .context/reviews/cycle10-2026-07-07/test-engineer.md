# Cycle 10 Test-Engineer Review

Scope: whole repository review from test coverage gaps, flaky tests, TDD opportunities, gate reliability, e2e reliability, and regression-locking perspective. No source edits were made.

## File Inventory

- Root/workspace gates: `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`.
- Test configuration: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Current test surface: 345 top-level Vitest test files in `apps/web/src/__tests__`, 12 Playwright/e2e files in `apps/web/e2e`.
- Product/source surface inspected: 81 app files, 8 API route files, 13 server-action files, 61 components, 111 lib files, 29 scripts.
- Source-to-test shape: many regression locks are executable unit tests, but several high-risk areas still rely on source-contract/string tests or gated/manual suites.

Validation run:

```text
npm test --workspace=apps/web -- --run src/__tests__/bottom-sheet-dropdown-portal.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/clip-offline-load.test.ts src/__tests__/clip-semantic-integration.test.ts
Result: 2 test files passed, 2 skipped; 83 tests passed, 4 skipped.
```

## Findings

### TE-01 — Real CLIP semantic-search coverage is skipped by every default gate

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`, `apps/web/package.json:21-24`, `.github/workflows/quality.yml:66-80`
- Failure scenario: a dependency upgrade, model revision/layout drift, ONNX runtime change, or production `CLIP_MODELS_ROOT` path regression breaks the real `@huggingface/transformers` offline model load or semantic ranking. The standard `npm test`, CI quality workflow, build, and e2e gates still pass because both real-model suites are `describe.skip` unless model-weight env flags are set. The only runnable script, `test:clip:preflight`, is manual and not wired into CI.
- Concrete fix: add a scheduled or opt-in CI job that seeds/caches the pinned CLIP weights and runs `npm run test:clip:preflight --workspace=apps/web`; make it required for dependency/model changes. If full weights are too heavy for every PR, add a lightweight hermetic loader fixture or contract test that exercises the same offline `env.cacheDir`, `allowRemoteModels=false`, revision path, and output-key handling without depending on network.

### TE-02 — Migration mirror tests do not structurally verify schema shape

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:107-122`, `apps/web/scripts/migrate.js:858-947`, `.github/workflows/quality.yml:66-80`
- Failure scenario: a future migration changes a column type/default/nullability, index uniqueness/order, or foreign-key action, and `reconcileLegacySchema` still merely mentions the same table/column/index/FK names. The source tripwires pass because they check name presence, and CI fresh init/e2e can pass unless the app immediately exercises the exact metadata difference. Existing deployments that rely on reconcile as the applier can then run with subtly wrong schema.
- Concrete fix: add a disposable-MySQL structural parity gate. One practical pattern: run `npm run init --workspace=apps/web` on an empty DB, introspect `information_schema.columns`, `statistics`, and `referential_constraints`, and compare against a checked expected snapshot generated from the current committed migrations/schema. At minimum, extend `migrate-reconcile-coverage` beyond name presence to assert column type/null/default, index uniqueness/column order, and FK delete/update rules for all current tables.

### TE-03 — Mobile bottom-sheet download dropdown is locked only by source strings

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, `apps/web/src/components/info-bottom-sheet.tsx:558-595`, `apps/web/e2e/test-fixes.spec.ts:56-65`, `apps/web/e2e/focus-restore.spec.ts:34-59`
- Failure scenario: the Radix portal `container` prop, `sheetElement` ref wiring, or dropdown trigger path regresses so the mobile download menu renders outside the focus-trap subtree, behind the overlay, or with broken keyboard focus. Current e2e only opens/closes the sheet; the regression lock checks that certain strings exist in source, not that the real browser can open the menu inside the dialog.
- Concrete fix: add a Playwright mobile test that opens a seeded wide-gamut photo, opens the Info sheet, expands it, opens the download dropdown, and asserts the menu items are visible, are descendants of the sheet dialog, can receive focus, and close/return focus correctly. If the current E2E fixture is not wide-gamut, seed one deterministic wide-gamut image or add a component/browser test with a mocked `InfoBottomSheet` image carrying both JPEG and AVIF download paths.

### TE-04 — Touch-target audit intentionally lets bare interactive links pass

- Severity: Medium
- Confidence: High
- Location: `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`, `apps/web/src/__tests__/touch-target-audit.test.ts:1058-1059`, `plan/plan-342-run9-cycle3-deferred.md:12-17`
- Failure scenario: a future public or admin control is implemented as `<Link className="text-sm hover:underline">...</Link>` or `<a className="text-xs ...">...</a>` with no `min-h-11`/`min-w-11` sizing token. The scanner treats “plain text links” as out of scope, so a real mobile tap target can fall below 44 px while the touch-target gate stays green. Prior plan history says this blind spot has already produced repeated findings.
- Concrete fix: add a second layer that does not rely only on source regex. Good options: a Playwright DOM audit over representative public/admin pages that measures visible `a`, `button`, `input`, `select`, and role-based controls; or a source scanner that flags bare interactive links unless they are in a documented inline-text allowlist. Keep the existing regex audit as a fast prefilter, but make visible page-level target size the authoritative regression lock.

### TE-05 — Nav “visual” screenshots are artifacts, not visual regression assertions

- Severity: Low
- Confidence: High
- Location: `apps/web/e2e/nav-visual-check.spec.ts:40-87`, specifically screenshots at `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, and `apps/web/e2e/nav-visual-check.spec.ts:85`
- Failure scenario: nav colors, spacing, wrapping, or visual hierarchy regress while element sizes and non-overlap still pass. The spec writes screenshots to `test-results/`, but it never compares them to baselines, so CI cannot fail on visual drift.
- Concrete fix: either convert these to `await expect(page).toHaveScreenshot(...)` with stable baselines for mobile collapsed, mobile expanded, and desktop nav, or rename/remove the artifact screenshots and keep the test explicitly as a metric-only layout smoke. If visual regression is important, isolate fonts/theme/viewport and commit baselines so the gate has an actual oracle.

## Missed-Issues Sweep

- No `.only`/focused tests found under `apps/web/src/__tests__` or `apps/web/e2e`.
- Skips found are conditional and documented: admin e2e local opt-outs, baseURL guard skips, and the two CLIP real-model suites.
- Playwright is deliberately single-worker (`workers: 1`) to protect shared login/rate-limit state.
- CI runs lint, typecheck, custom auth/origin/rate-limit gates, unit tests, DB init, Playwright e2e, and build.
- Remaining risk is not lack of test volume; it is the few places where the gate oracle is source presence, skipped/manual model-weight coverage, or screenshots without comparison.
