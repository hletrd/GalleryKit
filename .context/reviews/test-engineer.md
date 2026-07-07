# Cycle 22 Test-Engineer Review

Role: `test-engineer`
Repo: `/Users/hletrd/flash-shared/gallery`
Current HEAD at write: `dabf8e8a` (intervening commits after `8b795862` changed other review artifacts only)
Reviewed source HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`

## Inventory

Required guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`.

Test inventory and high-risk interactions inspected:

- 376 test/e2e files under `apps/web/src/__tests__` and `apps/web/e2e`.
- Blocking gate scripts from `package.json` and `apps/web/package.json`: ESLint, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `typecheck`, unit tests, Playwright e2e.
- Scanner tests: `check-action-origin`, API auth, public route rate limit, JS script syntax, SQL restore scan.
- Current-cycle tests around scheduled fixes: `check-action-origin.test.ts`, `pending-file-deletions-source.test.ts`, `image-queue-permanent-failure*.test.ts`, `mysql-datetime.test.ts`, `data-timeline.test.ts`, `check-js-scripts-contract.test.ts`.
- Broader persistent test-risk categories: migration/reconcile source contracts, backup/restore child-process source contracts, client search/load-more source contracts, Playwright matrix, visual screenshots, hydration readiness.

## Findings

### TE-C22-01 - Missing negative fixture for positive acquired guards allowed the scanner bypass to survive

- Severity: High
- Confidence: High
- Status: Confirmed test gap with confirmed scanner behavior
- Files/regions: `apps/web/src/__tests__/check-action-origin.test.ts:640-655`, `apps/web/src/__tests__/check-action-origin.test.ts:745-760`, `apps/web/scripts/check-action-origin.ts:641-650`, `apps/web/scripts/check-action-origin.ts:688-690`
- Weakness: Cycle 21 added a negative test for "mutation before `if (!slot.acquired)`" but not for the positive-guard sibling shape. The existing positive test only proves the valid case where the mutation is inside `if (mutationSlot.acquired)`.
- Failure scenario: a fixture with `using slot; if (slot.acquired) {}; await db.update(...)` passes today. That is exactly the kind of source-contract-vs-behavior weakness the scanner exists to prevent.
- Suggested test: add a failing fixture where the positive branch does not contain all mutations. Assert the scanner fails it before changing scanner logic. Add one positive fixture for the real `logout()` pattern so valid contained work stays accepted.

### TE-C22-02 - Pending file deletion durability is tested by source strings, not by executable cleanup behavior

- Severity: High
- Confidence: High
- Status: Confirmed gap
- Files/regions: `apps/web/src/__tests__/pending-file-deletions-source.test.ts:1-45`, `apps/web/src/lib/pending-file-deletions.ts:34-90`, `apps/web/src/app/actions/images.ts:714-727`, `apps/web/src/app/actions/images.ts:864-907`
- Weakness: The new tests read source and assert names/order. They do not execute `collectImageCleanupFailures()`, do not mock strict unlink failures, do not verify DB updates/deletes, and do not prove a later retry/drain exists.
- Failure scenario: cleanup can keep a row forever after one failed synchronous delete, or a future refactor can record attempts but never retry or remove successful rows. Source strings stay green.
- Suggested test: extract DB/filesystem effects behind injectable helpers or mock modules with Vitest. TDD cases: all cleanup succeeds -> ledger row deleted; one target fails once then succeeds on later drain -> attempts increments then row removed; permanent failure preserves `last_error`; missing files are idempotent success; batch deletion aggregates failures without unbounded concurrency.

### TE-C22-03 - Timeline grouping tests still reimplement old `Date` logic instead of exercising the new parser-backed behavior

- Severity: Medium
- Confidence: High
- Status: Confirmed gap; production code uses the parser correctly
- Files/regions: `apps/web/src/__tests__/data-timeline.test.ts:121-205`, `apps/web/src/lib/data-timeline.ts:244-266`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:100-110`, `apps/web/src/components/on-this-day-widget.tsx:48-52`, `apps/web/src/lib/mysql-datetime.ts:33-69`
- Weakness: Cycle 21 correctly moved production timeline grouping to `parseMySqlDateTimeParts()`, but `data-timeline.test.ts` still validates inline fake grouping with `new Date(capture_date)`. That no longer tests the source contract it claims to test and could mask a future reintroduction of host-timezone parsing.
- Failure scenario: a later refactor switches `getYearInReviewImages()` or the page grouping back to `new Date()`. Parser unit tests still pass, and the fake grouping tests continue to bless `Date` behavior.
- Suggested test: export a small pure grouping helper or test `parseMySqlDateTimeParts`-based grouping directly. Add a TZ-sensitive fixture such as `2026-01-01 00:30:00` under a non-UTC timezone and assert the month remains January without `Date.parse`.

### TE-C22-04 - Safety-critical source-contract concentration remains high

- Severity: Medium
- Confidence: High
- Status: Risk / recurring gap
- Files/regions: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`, `apps/web/src/__tests__/db-restore.test.ts:47-136`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`, `apps/web/src/__tests__/search-stale-response.test.ts:1-35`
- Weakness: 167 unit test files read source with `readFileSync`; 221 files use at least one source/string assertion pattern. Some are useful tripwires, but high-risk runtime contracts still lack behavior-backed coverage.
- Failure scenario: schema reconcile semantics, restore child-process settlement, semantic scan caps, or stale client response handling can drift while preserving expected strings/imports.
- Suggested test strategy: keep source tripwires as lint-like checks, but add behavior gates for the highest-risk classes: disposable MySQL reconcile diff, fake `mysqldump`/`mysql` child-process harness, route-level semantic scan cap test, jsdom/RTL search stale-response test.

### TE-C22-05 - Browser-flow coverage remains single-project Chromium with non-asserting visual artifacts

- Severity: Medium
- Confidence: High
- Status: Risk / recurring gap
- Files/regions: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/e2e/hydration-photo-page.spec.ts:36-38`
- Weakness: CI installs/runs only Desktop Chromium. The nav "visual" spec writes screenshots but does not compare baselines, and hydration waits on `networkidle`, which is a timing heuristic vulnerable to service-worker/analytics/background work.
- Failure scenario: WebKit/mobile touch, Firefox color capability, PWA install/offline behavior, visual spacing, or hydration readiness regresses while CI stays green or flakes.
- Suggested test: add a small tagged matrix rather than broad parallelism: mobile WebKit smoke, mobile Chromium touch smoke, production service-worker offline smoke, and deterministic `toHaveScreenshot` baselines or rename the current screenshots as manual artifacts. Replace hydration `networkidle` with an app-specific readiness sentinel.

## Existing Strengths

- `lint:action-origin` is now AST-based and catches the Cycle 21 negative early-return bypass.
- Migration journal monotonicity and app-backup-table coverage caught the new table/index integration points.
- `mysql-datetime.test.ts` directly covers parser validity and MySQL DATETIME output shape.
- Root operator script syntax is now part of `typecheck:scripts`.

## Evidence Commands

```bash
npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/mysql-datetime.test.ts src/__tests__/pending-file-deletions-source.test.ts
npm test --workspace=apps/web -- --run src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/check-js-scripts-contract.test.ts src/__tests__/sql-restore-scan.test.ts
npm run lint:action-origin --workspace=apps/web
rg -n "pendingFileDeletions|pending_file_deletions|cleanupPendingFileDeletion" apps/web/src apps/web/scripts apps/web/drizzle
rg -n "new Date\\(|Date\\.parse|getMonth|getDate" apps/web/src/lib/data-timeline.ts apps/web/src/components/on-this-day-widget.tsx "apps/web/src/app/[locale]/(public)/timeline/page.tsx" apps/web/src/__tests__/data-timeline.test.ts
```

Results: targeted tests passed; `lint:action-origin` passed current files; repo-wide search confirmed no pending-deletion retry/drain path; `data-timeline.test.ts` still contains `new Date()` in fake grouping assertions.

## Final Missed-Issue Sweep / Uninspected

- No `test.only` sweep was rerun in this lane; prior top-level review recorded this class, and I focused on changed/high-risk tests.
- I did not run full Playwright, full unit, build, typecheck, or lint gates.
- Live production deploy state, host nginx, real CLIP model weights, and non-Chromium browsers were not dynamically inspected.
