# Cycle 17 Test-Engineer Review

Date: 2026-06-30 KST
HEAD: `5e054f80`
Scope: current HEAD of `/Users/hletrd/flash-shared/gallery`
Lane: test-engineer, cycle 17/100

## Inventory Summary

Read `AGENTS.md` and `CLAUDE.md` first, then inventoried current test/gate surfaces and inspected high-risk app/lib/components/routes/scripts/migration paths.

- Vitest: 262 `apps/web/src/__tests__/**/*.test.{ts,tsx}` files.
- Playwright: 5 specs in `apps/web/e2e/`: `admin`, `public`, `origin-guard`, `nav-visual-check`, `test-fixes`.
- API routes: 8 route handlers under `apps/web/src/app/api`, including 2 admin routes and 6 public routes.
- Server actions: 13 files in `apps/web/src/app/actions/` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Migrations: 28 SQL migrations plus `drizzle/meta/_journal.json`.
- Scripts: 27 files in `apps/web/scripts/` plus root `scripts/deploy-remote.sh`.
- Blocking gates: ESLint, API-auth scanner, action-origin scanner, public-route rate-limit scanner, app/script typechecks, build, Vitest, optional Playwright.

Validation performed during this review:

- Direct scanner probes confirmed TE17-01 and TE17-02 false-negative shapes using `checkPublicRouteSource(...)` and `checkActionSource(...)`.
- I did not run full lint/typecheck/build/test/e2e. This was a review-only artifact pass and no implementation fixes were requested.

## Confirmed Findings

### TE17-01. Public route rate-limit scanner passes an inverted local helper

Severity: Medium
Confidence: High
Status: confirmed scanner false negative

Evidence:
- `apps/web/scripts/check-public-route-rate-limit.ts:129-170` marks local helper calls as rate-limit expressions when the helper name is in `localRateLimitGateFunctions`.
- `apps/web/scripts/check-public-route-rate-limit.ts:193-214` treats any early-returning `if` around that helper as a gate, without proving the helper returns `true` when over limit.
- `apps/web/scripts/check-public-route-rate-limit.ts:271-275` populates `localRateLimitGateFunctions` from helpers that syntactically contain a limiter.
- Existing fixtures cover a correct helper and an ignored-helper result at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:326-360`, but not an inverted boolean helper.
- Direct probe result: an `enforceQuota()` helper that returns `false` when `preIncrementShareAttempt()` is over-limit was reported as `OK: route.ts (uses rate-limit helper)`.

Failure scenario:
A future public `POST` route defines a helper that accidentally returns the inverse boolean. The scanner passes, but over-limit requests continue into `db.insert(...)`.

Suggested test/fix:
Add a failing fixture with the inverted helper before changing the scanner. Then either disallow arbitrary local helper gates or require the exported handler to check the approved limiter result directly, with a named `overLimit` result rather than inferred helper semantics.

### TE17-02. Action-origin public-action scanner is not control-flow accurate for try/catch

Severity: Medium
Confidence: High
Status: confirmed scanner false negative

Evidence:
- `apps/web/scripts/check-action-origin.ts:342-360` records a rate-limit gate when it sees an early-returning `if`.
- `apps/web/scripts/check-action-origin.ts:391-399` processes all `try` statements before `catch` and `finally`.
- `apps/web/scripts/check-action-origin.ts:402-405` then visits mutations using the already-mutated `sawRateLimitGate` state.
- Fixtures cover catch/finally mutations before any gate at `apps/web/src/__tests__/check-action-origin.test.ts:184-203`, and bless a try-block gate before insert at `apps/web/src/__tests__/check-action-origin.test.ts:613-626`, but do not cover an exception before the gate followed by a catch mutation.
- Direct probe result: a public exempt action with `try { mightThrow(); if (isViewRecordRateLimited(...)) return; } catch { await db.insert(...) }` was reported as `OK (public rate-limited action)`.

Failure scenario:
A public analytics action later adds fallback persistence in `catch`. If an earlier statement in the `try` throws before the limiter runs, the catch writes without rate-limit admission, while the scanner still passes because it traversed the later limiter first.

Suggested test/fix:
Add fixtures where a `try` block has a potentially throwing statement before the limiter and `catch`/`finally` mutates. Treat catch/finally as independent branches that need their own dominating limiter, or fail closed on any catch/finally mutation in public exempt actions.

### TE17-03. Touch-target audit can miss replacement violations in files with allowances

Severity: Low
Confidence: High
Status: confirmed test design weakness

Evidence:
- `apps/web/src/__tests__/touch-target-audit.test.ts:183-199` and `apps/web/src/__tests__/touch-target-audit.test.ts:229-238` keep nonzero `KNOWN_VIOLATIONS` counts for several files.
- The main assertion compares only aggregate count per file: `issues.length > allowed` at `apps/web/src/__tests__/touch-target-audit.test.ts:764-775`.
- Stale allowances only fail when `actual < allowed` at `apps/web/src/__tests__/touch-target-audit.test.ts:778-788`.

Failure scenario:
One documented sub-44 target in `components/admin-user-manager.tsx` is fixed while a new sub-44 target is introduced elsewhere in the same file. Actual count remains 2, so the new violation is hidden by the removed one.

Suggested test/fix:
Add an in-memory scanner fixture for "one known issue removed, one new issue added" and make it fail. Replace per-file counts with stable issue signatures or adjacent exemption markers.

## Likely Findings

### TE17-04. Reconcile migration tests are source tripwires, not schema equivalence tests

Severity: Medium
Confidence: High
Status: likely coverage gap

Evidence:
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` explicitly says the test introspects schema and asserts `migrate.js` mentions table/column names, but cannot verify types or defaults.
- Column coverage is `MIGRATE_SRC_CODE.includes(c)` at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-101`.
- Index coverage likewise checks index-name presence in source at `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-170`.
- The real schema convergence logic is large and manual in `apps/web/scripts/migrate.js:307-702`.

Failure scenario:
A migration changes a column type/default/nullability, FK action, or index column order. The source tripwire can still pass because the name appears in executable code, while a fresh/reconciled DB drifts from Drizzle schema or production expectations.

Suggested test/fix:
Add an opt-in disposable MySQL schema-equivalence test that runs `scripts/migrate.js` against a throwaway DB and diffs `INFORMATION_SCHEMA` against Drizzle schema plus expected indexes/FKs. Keep the source tripwire as a fast unit gate, but do not treat it as the authoritative migration test.

### TE17-05. Real CLIP production behavior is skipped in default test runs

Severity: Medium
Confidence: High
Status: risk / environment-gated coverage gap

Evidence:
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-41` skips unless `CLIP_OFFLINE_LOAD=1`, `CLIP_MODELS_ROOT` is set, and seeded model files exist.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31` skips unless `CLIP_INTEGRATION=1`.
- The runtime path sets `env.cacheDir`, `env.allowRemoteModels = false`, and loads the pinned model/tokenizer in `apps/web/src/lib/clip-model.ts:98-118`.

Failure scenario:
Default CI can pass while the production model cache is missing, corrupt, or incompatible with the native runtime. Production semantic search then returns 503s only after the operator enables the live path.

Suggested test/fix:
Promote the offline-load and semantic-ranking checks to a scheduled or manually triggered CI job with a seeded model cache. At minimum, add an explicit release checklist gate for `CLIP_OFFLINE_LOAD=1` before changing CLIP model id, revision, download script, Docker/runtime dependencies, or production semantic mode.

## Manual-Validation Risks

- Lightroom PAT upload has many source/unit contracts, but a token-authenticated multipart e2e smoke would better cover `withAdminAuth({ allowTokenScope })`, Sharp, DB insert, queueing, and cleanup together.
- Full DB restore remains intentionally hard to cover by default because it is destructive. A disposable-DB e2e lane should exercise upload, advisory lock, restore import, migration postconditions, and UI recovery.
- `run-e2e-server.mjs` drives `init`, `e2e:seed`, `build`, static asset copy, and standalone server launch, but has no direct unit test. Breakage usually appears only when Playwright runs.
- Several operational scripts had no direct test references in the inventory (`backfill-alt-text.ts`, `migrate-aliases.ts`, `migrate-titles.ts`, `migration-add-column.ts`, `mysql-connection-options.js`, `prepare-next-typegen.mjs`). Some are legacy/operator tools, but changes there should get targeted smoke tests or source contracts.

## TDD Opportunities

- Add scanner-regression tests first for TE17-01 and TE17-02, then patch the AST logic.
- Add touch-target exemption signatures before any further admin UI compact-control work.
- Add a disposable MySQL schema-diff test around `reconcileLegacySchema`.
- Add a token-authenticated Lightroom upload Playwright/API test using existing E2E fixtures.
- Add a scheduled CLIP offline/ranking job with seeded weights.

## Final Missed-Coverage Sweep

Major surfaces inspected:

- Package scripts, Vitest config, Playwright config, e2e helpers, e2e specs, and seed/destructive guards.
- Custom scanner implementations and fixtures: API auth, action origin, public route rate limit, touch target, focus-visible style.
- App routes/actions: public search/load-more/analytics, admin routes, topics/tags/images/sharing/settings, OG routes, semantic/similar search, upload/download paths.
- Libraries: rate limiting, request origin, API auth, data selects, privacy guards, CLIP paths/model loading, image processing contracts, migration helpers.
- Scripts/migrations: `migrate.js`, migration journal tests, reconcile coverage tests, deploy scripts, e2e server script, CLIP download/backfill scripts.

No current unguarded admin API route, missing same-origin mutating action, or missing public mutating route limiter was found in current HEAD. The main residual risk is not lack of test volume; it is source-scanner false negatives and environment-gated integration coverage around production-only paths.
