# Cycle 11 Test-Engineer Review

Scope: whole-repo test review for missing tests, flaky tests, fixture realism, weak assertions, TDD opportunities, browser-flow gaps, quality-gate drift, and coverage of critical behavior. I inspected current source, tests, docs, CI wiring, prior review history, and the dirty worktree. I did not edit source or plans.

## Inventory

- Project instructions read: `AGENTS.md`, `CLAUDE.md`.
- Test surface: 345 Vitest files under `apps/web/src/__tests__`; 12 e2e files under `apps/web/e2e` including 9 specs, 1 helper, and 2 JPEG fixtures.
- Source surface checked: app routes/actions, admin UI, public components, lib modules, scripts, Drizzle migrations/meta, package scripts, Vitest config, Playwright config, and GitHub Actions.
- Current skips/focus: no `.only(` found. Conditional skips are admin/local e2e guards and the CLIP real-model suites.
- Source-contract density: 155 test files match source-reading/source-contract patterns. These are useful tripwires, but several critical paths still lack behavior-level or browser-level oracles.
- Current worktree note: unrelated edits exist in `.context/plans/*`, other review files, `apps/web/src/app/[locale]/admin/db-actions.ts`, and `apps/web/src/lib/sql-restore-scan.ts`. I reviewed current worktree content as source of truth and only wrote this file.

## Findings

### TE-C11-01 - Real CLIP production activation is still outside required gates

- Severity: High
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/__tests__/semantic-route-production.test.ts:3-5`, `apps/web/package.json:21-24`, `.github/workflows/quality.yml:66-80`
- Failure scenario: a dependency upgrade, model layout change, ONNX runtime issue, or `CLIP_MODELS_ROOT` path drift breaks offline `jina-clip-v2` loading. Default CI still passes because the real-model tests use `describe.skip` unless env/model weights are present, and the production route unit test mocks `embedTextReal`.
- Concrete recommendation: add a scheduled or dependency-change CI job that seeds/caches the pinned CLIP weights and runs `npm run test:clip:preflight --workspace=apps/web`. If full weights are too heavy for normal PRs, require a preflight artifact before production mode can be enabled and add a lightweight hermetic loader contract for cache layout/revision handling.
- TDD opportunity: first add a failing activation test that refuses production semantic mode when the latest real-model preflight marker is absent or stale.

### TE-C11-02 - DB restore child-process failure cleanup is source-only

- Severity: Medium
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/src/__tests__/db-restore.test.ts:47-75`, `apps/web/src/__tests__/restore-upload-lock.test.ts:71-91`, `apps/web/src/app/[locale]/admin/db-actions.ts:783-820`
- Failure scenario: a restore import spawn error, stdin error, read-stream error, or watchdog timeout stops killing the child process, stops destroying stdin/read streams, fails to clean the temp SQL file, or drops `keepMaintenance: true`. The current tests only assert that literal snippets exist in source, so reordering or unreachable code can stay green while a real failed restore leaves maintenance state or temp/process cleanup wrong.
- Concrete recommendation: add a behavior harness around `restoreDatabase`/`runRestore` using mocked `child_process.spawn`, fake `stdin`, fake read stream, fake timers for the watchdog, and mocked `fs` cleanup. Assert returned result, `kill()`/`stdin.destroy()`/read destroy calls, temp cleanup, and maintenance retention for each failure event.
- TDD opportunity: write the spawn-error behavior test first with a fake child that emits `error`; it should fail until cleanup and `keepMaintenance` are observable through behavior, not source text.

### TE-C11-03 - Lightroom upload route behavior harness covers only two branches

- Severity: Medium
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:112-115`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:178-278`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:191-320`, `apps/web/src/app/api/admin/lr/upload/route.ts:94-158`, `apps/web/src/app/api/admin/lr/upload/route.ts:257-340`, `apps/web/src/app/api/admin/lr/upload/route.ts:407-424`
- Failure scenario: regressions in early/late restore guards, missing or chunked `Content-Length`, quota count/byte rejection, multipart parse saturation, upload-contract lock denial, disk-space 507, GPS-strip fail-closed cleanup, topic lookup errors, or settings-load failure can pass the suite because most are pinned by source assertions. The real handler-level test currently exercises only late HDR rejection and one happy PAT upload.
- Concrete recommendation: extend `lr-upload-route-behavior.test.ts` with table-driven handler calls for 503 early restore, 411 missing/chunked length, 429 count/byte quota, 429 parse-slot saturation, 409 lock denial, 507 low `statfs`, 422 GPS-strip failure with original cleanup, 404 topic missing, and 503 settings read failure. Make `isRestoreMaintenanceActive` and `stripGpsFromOriginal` hoisted mocks overridable per test.
- TDD opportunity: start with the low-disk test by setting `statfsMock` to return `bavail * bsize < 1 GiB`; assert status 507, tracker settlement, and contract-lock release.

### TE-C11-04 - First-class admin UI surfaces remain e2e-shallow

- Severity: Medium
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-165`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:202-325`, `apps/web/src/__tests__/client-source-contracts.test.ts:172-224`, `apps/web/src/__tests__/lr-tokens-action.test.ts:85-199`
- Failure scenario: token creation can fail to show one-time plaintext, copy acknowledgement can fail, revoke confirmation can fail, token-list retry alerts can fail, or server label errors can fail to bind to the input. Unit/action tests cover mocked server behavior and source-contract tests assert JSX snippets, but no Playwright flow drives the actual token page. The admin e2e navigates to some pages and mutates topics/uploads, but it does not operate Tokens, SEO, Tags, Users, DB backup/restore, or most Settings controls.
- Concrete recommendation: add a small admin Playwright project for high-value UI flows: create a Lightroom token, assert plaintext appears only once, copy/acknowledge/done closes it, list row appears, revoke removes it, and label validation focuses/announces the field error. Then add one smoke each for SEO save validation, tag create/delete, and DB backup download listing without doing a destructive restore.
- TDD opportunity: first add a failing Tokens e2e that creates a token and requires the plaintext acknowledgement dialog; wire cleanup by revoking the created row in `finally`.

### TE-C11-05 - Component interaction regressions are still frequently locked by source strings

- Severity: Medium
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:8-21`, `apps/web/src/__tests__/image-zoom-source-contracts.test.ts:19-22`, `apps/web/e2e/hydration-photo-page.spec.ts:44-49`, `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, `apps/web/src/components/info-bottom-sheet.tsx:558-595`
- Failure scenario: photo auto-lightbox restoration can stop restoring, click-to-zoom can stop toggling, or the mobile bottom-sheet download dropdown can render outside the focus-trap subtree. Existing tests mostly assert source snippets. The hydration e2e assertion accepts either the restored `pinned` button or the fallback `info` button, so it does not prove restoration.
- Concrete recommendation: introduce a minimal DOM/component harness (`jsdom` or Playwright component-style page) for client interactions that are now source-only. For immediate coverage, tighten `hydration-photo-page.spec.ts` to require the deterministic restored button state, and add a mobile Playwright test that opens the info sheet, opens the download dropdown for a wide-gamut fixture, asserts menu visibility inside the dialog subtree, keyboard focus, and close/focus return.
- TDD opportunity: replace the `.or(...info...)` assertion with a strict `pinned` expectation first; then add behavior coverage before deleting any source-string lock.

### TE-C11-06 - Browser, device, and visual regression gates remain too narrow

- Severity: Medium
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:72-77`, `apps/web/e2e/nav-visual-check.spec.ts:40-87`
- Failure scenario: Safari/WebKit mobile gestures, Firefox focus/clipboard/display-capability behavior, responsive navigation, or visual spacing/color drift breaks while desktop Chromium stays green. CI installs only Chromium and Playwright defines only Desktop Chrome. The nav "visual" spec saves PNG artifacts but never compares them with `toHaveScreenshot`, so visual drift cannot fail the gate.
- Concrete recommendation: add a narrow required smoke matrix, not a full duplication: mobile WebKit for public nav/photo/lightbox/search/load-more, and Firefox or WebKit desktop for a small public/admin route smoke. Convert the nav screenshots to `expect(page).toHaveScreenshot(...)` baselines or rename the spec to clarify it is a metric-only layout audit.
- TDD opportunity: add a mobile WebKit smoke that opens the nav, search, a photo, and the lightbox; keep it required once stable.

### TE-C11-07 - No coverage report, threshold, or changed-file ratchet exists

- Severity: Medium
- Confidence: High
- Validation label: confirmed
- File/region: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:66-80`
- Failure scenario: a new public API route, server action, migration branch, queue path, or security helper lands with zero executed tests while the suite stays green. This is amplified by the large source-contract footprint: source presence can pass without behavior being exercised.
- Concrete recommendation: add a non-blocking `test:coverage` baseline using Vitest V8 coverage, then enforce a changed-file ratchet for critical directories (`src/app/actions`, `src/app/api`, `src/lib`, `scripts/migrate.js`) before considering repo-wide thresholds. Exemptions should be explicit and reviewed.
- TDD opportunity: add a temporary fixture branch with no coverage and make the changed-file coverage check fail against it before wiring the real gate.

## Missed-Issue Sweep

- Rechecked skipped/focused tests: no focused `.only(` usage found; skips are conditional admin/local e2e and CLIP real-model suites.
- Rechecked previously reported cursor-normalizer gap: current `image-list-cursor.test.ts` directly covers strict date/id normalization, so I did not carry that finding forward.
- Rechecked the new restore SQL raw-bridge worktree change: `sql-restore-scan.test.ts:291-320` has a direct behavioral test with a negative no-bridge control, so I did not report it as missing coverage.
- Rechecked CI: lint, typecheck, custom auth/origin/rate-limit gates, unit tests, DB init, Chromium e2e, and build run in `.github/workflows/quality.yml`.
- Full gates were not run; this was a review-only task and no application code changed.
