# Test-Engineer Review - Cycle 20

Role: `test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `bd0cc170412b0f70ae231cec27ca54ee50e638fd`
Review time: `2026-07-08T06:16:06+09:00`

## Inventory

Test and gate files inventoried:

- Unit/source tests: `apps/web/src/__tests__/` (357 `*.test.ts` files plus fixtures/stubs).
- Browser tests: `apps/web/e2e/` (9 Playwright specs, shared helpers, two image fixtures).
- Test configs: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Gate scripts: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/scripts/check-js-scripts.mjs`, `apps/web/scripts/typecheck-app.mjs`.
- CI/dependency gates: `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `.github/dependabot.yml`.
- Source areas mapped against tests: `apps/web/src/app/actions/`, `apps/web/src/app/api/`, localized public/admin routes, `src/lib/`, `src/components/`, `src/db/`, scripts, migrations, PWA/service worker, messages, Docker/deploy helpers.

Relevant source/test interactions examined:

- Admin API/auth/origin/rate-limit scanners and their fixture tests.
- Migration journal/reconcile tests and `scripts/migrate.js`.
- Backup/restore action tests and `admin/db-actions.ts`.
- Upload, image queue, backfill, Lightroom PAT route, CLIP/search, semantic/similar routes.
- Public/admin Playwright coverage, e2e seeding/server bootstrap, browser matrix.
- Touch-target audit, focus/a11y source contracts, i18n key parity, service worker template/cache tests.

Validation note: I did not run the full gate suite or start browser/DB infrastructure; this was a read-only test-engineering review plus the requested report write.

## Confirmed Issues

### C20-TE-01 - ESLint warnings are allowed to pass the blocking lint gate

- Severity: Medium
- Confidence: High
- Region: `apps/web/eslint.config.mjs:18-29`, `apps/web/package.json:13-15`, `.github/workflows/quality.yml:54-55`
- Evidence: `@typescript-eslint/no-unused-vars` is configured as `"warn"` at `eslint.config.mjs:20-21`, while the lint script is plain `"eslint"` at `package.json:14`; CI runs `npm run lint` without `--max-warnings=0`.
- Failure scenario: A stale variable/import, missed refactor branch, or dead callback lands as a warning and the quality job remains green. This is especially risky in a repo that uses many source-contract tests, where unused code can keep satisfying string assertions.
- Concrete fix: Make lint warnings blocking via `eslint --max-warnings=0`, or change `@typescript-eslint/no-unused-vars` back to `"error"` while retaining the underscore ignore patterns.

### C20-TE-02 - Touch-target audit carries warning-budget allowances that can hide a primitive regression

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/__tests__/touch-target-audit.test.ts:97-117`, `apps/web/src/__tests__/touch-target-audit.test.ts:188-243`, `apps/web/src/__tests__/touch-target-audit.test.ts:769-803`; primitive floor at `apps/web/src/components/ui/button.tsx:23-30`
- Evidence: the audit permits nonzero `KNOWN_VIOLATIONS` counts for admin files, while `ui/button.tsx` currently floors `sm` and `icon` to `min-h-11` / `size-11`.
- Failure scenario: If `buttonVariants` regresses `sm` or `icon` below 44 px, many existing admin controls remain within the documented per-file budgets and the audit can still pass. The gate then detects only new uses, not the existing controls that became real runtime violations.
- Concrete fix: Add a direct unit assertion over `buttonVariants` that every size variant contains a >=44 px class, and retire budgets whose only "violation" is `size="sm"` / `size="icon"` covered by the primitive. Keep budgets only for measured, genuinely intentional exceptions.

### C20-TE-03 - Playwright matrix is Desktop-Chromium only despite mobile/touch-heavy flows

- Severity: Medium
- Confidence: High
- Region: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/swipe-visual-reset.spec.ts:23-27`
- Evidence: CI installs only Chromium and the sole Playwright project uses `devices['Desktop Chrome']`. Mobile tests mostly call `page.setViewportSize(...)`; swipe coverage dispatches synthetic `TouchEvent`s inside a desktop Chromium context.
- Failure scenario: Mobile Safari/WebKit viewport, real touch input, passive listener behavior, and browser rendering differences can break photo swipe/navigation, lightbox, nav, and search while CI remains green.
- Concrete fix: Add at least one mobile/touch project, ideally `devices['iPhone 15']` WebKit plus a mobile Chromium smoke. Keep admin specs serialized in Chromium unless seeded per-worker accounts are added.

### C20-TE-04 - i18n parity checks keys and duplicate keys, but not placeholder parity

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/__tests__/i18n-key-parity.test.ts:13-20`, `apps/web/src/__tests__/i18n-key-parity.test.ts:135-168`; examples in `apps/web/messages/en.json:156-177`, `apps/web/messages/ko.json:156-177`
- Evidence: the test explicitly compares leaf-key sets only. The locale files contain many runtime placeholders such as `{current}`, `{total}`, `{failed}`, `{maxFiles}`, `{file}`, and `{error}`.
- Failure scenario: A locale keeps the same key but drops or renames a placeholder. The key-parity test passes, but users see missing context or a formatter/runtime error when callers provide arguments the translated string no longer uses, or fail to provide a new argument.
- Concrete fix: Add a placeholder extractor that compares placeholder-name sets for every leaf key. Treat ICU plural syntax as valid as long as the argument identifiers match across locales.

## Likely Issues

### C20-TE-05 - High-risk client behavior is still over-represented by source contracts

- Severity: Medium
- Confidence: High
- Region: `apps/web/vitest.config.ts:13-38`, `apps/web/src/__tests__/search-stale-response.test.ts:1-11`, `apps/web/src/__tests__/search-status-source.test.ts:15-70`, `apps/web/src/components/search.tsx:163-281`, `apps/web/src/__tests__/load-more-source-contracts.test.ts:7-30`, `apps/web/src/components/load-more.tsx:43-111`
- Evidence: repo tests acknowledge there is no jsdom/RTL harness for these client components, and assert string/order contracts instead.
- Failure scenario: `Search` or `LoadMore` can keep the expected strings while runtime closure behavior, abort handling, live-region updates, observer/click races, or stale result commits break.
- Concrete fix: Add a focused component-behavior lane using jsdom/happy-dom plus React Testing Library, or lift the state machines into pure functions and test them with fake timers. Cover delayed semantic fetch A vs newer B, abort-on-query-change, retry cooldowns, observer + click double-fire, and live-region status.

### C20-TE-06 - Migration reconcile coverage is a name-presence tripwire, not a structural schema proof

- Severity: High
- Confidence: High
- Region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`; implementation at `apps/web/scripts/migrate.js:348-493`
- Evidence: the test says it cannot verify types or defaults and mostly checks that tables/columns/index names appear in `migrate.js`.
- Failure scenario: A migration changes a column type, nullability, default, index order, charset/collation, or FK behavior. The test still passes if names remain present, but a reconcile-baselined database can diverge from the Drizzle schema and fail later in production.
- Concrete fix: Add a disposable MySQL integration check that runs the reconcile/baseline path and diffs `INFORMATION_SCHEMA` against the current Drizzle/migration contract for columns, defaults, indexes, and FKs.

### C20-TE-07 - Backup/restore child-process paths rely heavily on source pins

- Severity: High
- Confidence: Medium
- Region: `apps/web/src/__tests__/db-restore.test.ts:47-136`, `apps/web/src/app/[locale]/admin/db-actions.ts:137-260`
- Evidence: important backup/restore guarantees are asserted by reading `db-actions.ts` substrings and ordering around `spawn('mysqldump')` / `spawn('mysql')`.
- Failure scenario: Stream flushing, child-process nonzero exit, timeout cleanup, watchdog cleanup, tmp-file handoff, trailer validation, or lock-release behavior breaks in execution while the source shape still contains the expected strings.
- Concrete fix: Add an integration harness with temp backup dirs and stub `mysqldump`/`mysql` binaries injected through `PATH`. Cover success, nonzero exit, timeout, truncated trailer, bad header, write error, post-restore migration failure, and lock-release failure.

## Manual-Validation Risks

### C20-TE-08 - Real CLIP production proof is opt-in/scheduled, not PR-blocking for CLIP path changes

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-42`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `.github/workflows/clip-preflight.yml:3-6`, `.github/workflows/quality.yml:69-83`
- Failure scenario: A PR changes model download/layout, `clip-model`, package versions, Docker/runtime paths, or semantic route behavior. Normal PR quality can pass while real-weight offline load/ranking is only checked later by the scheduled/manual workflow.
- Concrete fix: Trigger `clip-preflight` on PR path filters for `clip-*`, semantic routes, CLIP scripts, lockfile/package changes, and Docker/runtime model paths; or require a manual CLIP preflight check before merging those changes.

### C20-TE-09 - Service worker/PWA behavior is source/unit-tested but not installed/offline-tested in a browser

- Severity: Medium
- Confidence: High
- Region: `apps/web/src/components/register-service-worker.tsx:13-23`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-16`, `apps/web/src/__tests__/sw-template-contract.test.ts:59-168`
- Failure scenario: `/sw.js` scope, production registration, CacheStorage writes, offline fallback, admin/share route bypass, or generated worker freshness breaks in a real browser. Template/source tests still pass.
- Concrete fix: Add a production Playwright PWA spec: wait for `navigator.serviceWorker.ready`, load a cacheable public route, inspect cache keys, set offline mode, verify public fallback, and assert admin/share/smart-collection/map routes are not served from offline HTML fallback.

### C20-TE-10 - Admin E2E covers only a narrow subset of high-risk admin workflows

- Severity: Medium
- Confidence: High
- Region: `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-103`, `apps/web/e2e/admin.spec.ts:105-165`, `apps/web/e2e/helpers.ts:28-45`
- Failure scenario: Token creation/revoke/copy, backup download/restore UI, share management, settings persistence beyond GPS toggle, semantic setup banners, and destructive confirmation UX can break in hydrated browser code while action/unit/source tests stay green.
- Concrete fix: Split admin Playwright coverage into tagged low-cost specs by workflow: settings save, token create/revoke, backup download, restore rejection, share create/revoke, image delete confirmation, and semantic status banner. Require the matching tag on relevant source changes.

### C20-TE-11 - Nav "visual" checks save screenshots but do not compare them

- Severity: Low
- Confidence: High
- Region: `apps/web/e2e/nav-visual-check.spec.ts:40-86`
- Failure scenario: visual spacing, density, icon alignment, or hierarchy regresses while controls remain visible, >=44 px, and non-overlapping. The spec writes screenshots to `test-results/` but has no baseline assertion.
- Concrete fix: Either rename the spec as a manual screenshot capture, or add stable `toHaveScreenshot` baselines for collapsed mobile, expanded mobile, and desktop nav states.

## TDD Opportunities

- Before touching search/load-more client behavior, add executable stale-response and cooldown tests first; current source contracts are useful tripwires but weak TDD anchors.
- Before changing migrations, add the reconcile `INFORMATION_SCHEMA` diff harness and write the failing schema case before editing `migrate.js`.
- Before changing backup/restore, add stub-child integration tests for the exact failure branch being modified.
- Before changing CLIP/model paths, require the real CLIP preflight to run in PR context.
- Before changing service worker caching, add the production-browser install/offline spec so behavior is verified where it actually runs.

## Skipped / Opt-In Sweep

- No `test.only` found.
- Skipped/opt-in tests found:
  - `apps/web/e2e/admin.spec.ts:6-12` skips/admin-enables based on CI and credentials.
  - `apps/web/e2e/origin-guard.spec.ts:28-58` skips authenticated origin coverage without admin E2E credentials.
  - `apps/web/src/__tests__/clip-offline-load.test.ts:41` skips without seeded CLIP weights.
  - `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` skips without `CLIP_INTEGRATION=1`.
- Final missed-issue classes rechecked: lint warning gates, focused/skipped tests, browser matrix, mobile/touch coverage, source-contract-heavy tests, e2e seed/server bootstrap, scanner discovery roots, migration reconcile, backup/restore child process behavior, service worker install/offline behavior, i18n placeholder drift, CLIP real-weight coverage, and visual screenshot assertions.
