# Test Engineer Review - Cycle 6/100 Prompt 1

**Date:** 2026-06-29
**HEAD inspected:** `5443009e411113bf97fe2d8fcb166b2ac78625fb`
**Role:** test-engineer
**Scope:** current HEAD only. Deep test review for coverage gaps, flaky tests, false confidence, missing regression cases, TDD opportunities, fixture drift, and quality-gate blind spots. No fixes implemented.

## Inventory Before Findings

Required instructions read first: `AGENTS.md`, then `CLAUDE.md`.

HEAD inventory used for review:

- Total tracked files: 2,504.
- Context docs/history: 1,729 files under `.context/`; reviewed current planning/review surface names and relevant policy docs, not every historical archive body.
- Docs/config/deploy: `AGENTS.md`, `CLAUDE.md`, `.github/workflows/quality.yml`, root/app `package.json`, `vitest.config.ts`, `playwright.config.ts`, `next.config.ts`, `eslint.config.mjs`, `tsconfig*.json`, Docker/deploy/nginx config, package lock presence.
- Tests: 253 tracked files under `apps/web/src/__tests__/` and 8 Playwright e2e files/fixtures under `apps/web/e2e/`.
- App code: 76 App Router files, including 13 server-action modules and 8 API route modules.
- Libraries/components: 94 `src/lib` files, 55 component files, DB schema, proxy, instrumentation, i18n/messages.
- Scripts/migrations: 27 scripts under `apps/web/scripts/`, 25 SQL migrations plus Drizzle metadata/journal.
- Cross-file interactions inspected: quality workflow order, package scripts, custom lint scanners and scanner tests, public/admin mutation surfaces, public route rate limits, action-origin exemptions, public analytics actions, migration journal/reconcile tests, E2E seed/server wiring, deploy/nginx contract tests.

Review method:

- Used HEAD-based `git ls-tree`, `git show HEAD:<path>`, and `git grep ... HEAD -- ...` so findings are based on committed HEAD, not unrelated working-tree edits.
- Existing unrelated modified review files were left untouched. This file is expected to be overwritten for this cycle.
- Did not run the full quality suite because this prompt asked for review only and current findings are static coverage/gate issues. Existing CI workflow wiring was inspected directly.

## Confirmed Issues

### TE-C6-01 - Public mutating server actions are outside both mutation lint gates

Severity: High
Confidence: High
Status: Confirmed quality-gate blind spot

Exact region:

- `apps/web/scripts/check-action-origin.ts:13-21`, `apps/web/scripts/check-action-origin.ts:49`, `apps/web/scripts/check-action-origin.ts:86-105`
- `apps/web/scripts/check-public-route-rate-limit.ts:25-26`, `apps/web/scripts/check-public-route-rate-limit.ts:296-305`
- `apps/web/src/app/actions/public.ts:349-411`
- `apps/web/src/__tests__/public-actions.test.ts:227-270`

Problem:

`check-action-origin.ts` recursively scans `app/actions/` but excludes any basename `public`. Its header still describes `public.*` as an unauthenticated read-only surface, but current `public.ts` contains three public DB-writing server actions: `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView`. Those actions are intentionally public and rate-limited, and `public-actions.test.ts` covers the current implementation. The gap is that no scanner enforces that future public server-action mutations keep validation and rate limiting. The sibling public rate-limit lint only scans `src/app/api/**` route files, not server actions.

Concrete failure scenario:

A future public action lands in `app/actions/public.ts`, for example `recordReaction()` or a new analytics write, and calls `db.insert(...)` without an IP budget. `npm run lint:action-origin` skips the file by basename, `npm run lint:public-route-rate-limit` never sees server actions, and the existing unit tests do not fail unless someone manually adds a case for the new export. That is exactly the class of false confidence these lint gates are meant to prevent.

Suggested fix:

Add a dedicated public-action mutation scanner or extend `check-action-origin` with a separate mode for `public.ts`: allow documented unauthenticated exports, but require every DB-writing public action to call an approved pre-increment helper before the write or carry a narrowly reviewed exemption. Add fixtures that fail for `export async function recordFoo(){ db.insert(...) }` and pass for the current analytics shape.

### TE-C6-02 - Public route rate-limit scanner trusts helper names without verifying source

Severity: Medium
Confidence: High
Status: Confirmed scanner false-confidence gap

Exact region:

- `apps/web/scripts/check-public-route-rate-limit.ts:38-45`
- `apps/web/scripts/check-public-route-rate-limit.ts:96-100`
- `apps/web/scripts/check-public-route-rate-limit.ts:140-187`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:277-288`

Problem:

The public route rate-limit gate accepts any call expression whose callee identifier starts with `preIncrement` or `checkAndIncrement`. It does not verify that the identifier is imported from `@/lib/rate-limit` or `@/lib/auth-rate-limit`, despite the scanner contract saying the helper should be a documented rate-limit pre-increment helper. The test suite explicitly blesses a generic `preIncrement` import, which widens the spoofing surface.

Concrete failure scenario:

A future public `POST` route can define or import a noop function named `preIncrementWhatever()` from the same file or a local utility, call it before `db.insert(...)`, and pass `npm run lint:public-route-rate-limit` while shipping an unmetered public mutation.

Suggested fix:

Track imports and local declarations in the scanner. Only count helpers imported from approved modules, or count local helpers only when their definition calls an approved helper. Add failing fixtures for a locally defined `function preIncrementNoop(){ return false }` and an import from `./not-rate-limit`.

### TE-C6-03 - Migration reconcile coverage checks column/index names globally, not table-local structure

Severity: Medium
Confidence: High
Status: Confirmed test coverage gap / fixture drift risk

Exact region:

- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-101`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-170`
- `apps/web/scripts/migrate.js:293-418`
- `apps/web/src/db/schema.ts:19-117`, `apps/web/src/db/schema.ts:221-286`

Problem:

The reconcile tripwire is valuable, but its key assertions are name-presence checks over all of `migrate.js`. For columns, `columns.filter((c) => !MIGRATE_SRC_CODE.includes(c))` passes when a column name appears anywhere in executable migrate code, even if it is missing from the relevant table's `CREATE TABLE` or `ensureColumn` call. For indexes, the test similarly checks only that each index name appears somewhere in `migrate.js`, not that it is created on the right table with the right columns.

Concrete failure scenario:

A migration adds a common column such as `created_at`, `updated_at`, `slug`, `user_id`, or `model_version` to an existing table but the author forgets the `reconcileLegacySchema` mirror. The test can still pass because those tokens already appear for other tables. A legacy DB that takes the reconcile/baseline path then misses the real column or index while the migration coverage gate stays green.

Suggested fix:

Move this from token presence to structural comparison. Parse Drizzle table/column/index metadata into expected table-local requirements, then parse or execute `reconcileLegacySchema` against a disposable MySQL schema and compare `information_schema` columns/indexes to `schema.ts`. As a lower-cost TDD step, require each column to match either that table's `CREATE TABLE` block or an `ensureColumn(connection, dbName, '<table>', '<column>', ...)` call, and each index to match `ensureIndex(..., '<table>', '<index>', ...)` or the matching table block.

### TE-C6-04 - E2E seed can destructively target the wrong database if env points away from a disposable DB

Severity: Medium
Confidence: Medium
Status: Confirmed fixture safety gap

Exact region:

- `apps/web/playwright.config.ts:18-24`, `apps/web/playwright.config.ts:76-82`
- `apps/web/scripts/run-e2e-server.mjs:75-83`
- `apps/web/scripts/seed-e2e.ts:9`
- `apps/web/scripts/seed-e2e.ts:156-160`
- `apps/web/scripts/seed-e2e.ts:183-204`, `apps/web/scripts/seed-e2e.ts:250-254`

Problem:

Local Playwright starts `run-e2e-server.mjs`, which loads `.env.local` or `E2E_ENV_FILE`, runs `npm run init`, then runs `npm run e2e:seed`. The seed script refuses only when `NODE_ENV === 'production'`; it does not assert that `DB_HOST`/`DB_NAME` are a known disposable E2E database or require an explicit destructive-seed confirmation variable. The seed deletes existing images in the `e2e-smoke` topic, deletes share group rows, and removes derivative/original files.

Concrete failure scenario:

A developer points `.env.local` or `E2E_ENV_FILE` at a shared/staging/production-like MySQL database while `NODE_ENV` is not `production`, then runs `npm run test:e2e`. The test seed mutates that database and file store before the browser tests start. Even if the topic is named `e2e-smoke`, this is still a destructive fixture path guarded by a weak environment check.

Suggested fix:

Require an explicit `E2E_ALLOW_DESTRUCTIVE_SEED=true` or `E2E_DB_NAME_ALLOWLIST` check in `seed-e2e.ts`, and fail unless `DB_NAME` matches a disposable pattern such as `gallery_e2e` or CI's known service DB. Add a unit/source test that proves the guard exists before any `db.delete`/`fs.rm` calls.

## Likely Issues

### TE-C6-05 - CLIP real-model suites skip in normal CI, leaving production semantic behavior mostly mocked

Severity: Medium
Confidence: Medium
Status: Likely coverage gap

Exact region:

- `apps/web/src/__tests__/clip-offline-load.test.ts:37-43`
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:1-31`
- `.github/workflows/quality.yml:27-80`
- `CLAUDE.md` semantic-search production notes and model-weight seeding runbook

Problem:

The production semantic-search path is live per project docs, but the only tests that load actual local CLIP model weights are skipped unless model directories/env flags exist. CI provides DB/admin/SESSION env, but no `CLIP_MODELS_ROOT` seed or real-model opt-in. The rest of the semantic route tests mock the encoder and DB heavily.

Concrete failure scenario:

A dependency upgrade, model-manifest drift, missing ONNX runtime file, or path mismatch breaks production offline model loading. Unit tests and CI stay green because the real-load tests are skipped and route tests mock `embedTextReal`.

Suggested fix:

Add a small scheduled/manual CI job or local documented gate that seeds a tiny required fixture model set and runs only the real CLIP load/integration suites. If full weights are too large for PR CI, add a preflight script that validates the production model manifest and required file names against `CLIP_MODELS_ROOT` without running inference.

## Risks Needing Manual Validation

- E2E admin flows are present in CI and fail if CI lacks admin credentials (`apps/web/e2e/admin.spec.ts:6-12`, `.github/workflows/quality.yml:35-37`), but local runs can still skip them. Manual release validation should confirm admin upload/settings flows when working outside CI.
- Several high-value regression tests are source-shape tests using `readFileSync`/regex rather than behavioral execution. They are useful tripwires, but reviewers should treat them as guardrails, not proof of runtime equivalence, especially around migrations, deploy scripts, nginx config, and scanner behavior.
- I did not validate current production model weights, real browser rendering screenshots, or a live fresh-DB reconcile diff; those require heavier external state than a HEAD-only review.

## Missed-Issues Sweep

Final sweep covered:

- `git grep` for `.skip`, `.only`, `TODO`/`FIXME`, fake timers, wall-clock sleeps, source-grep tests, mutation calls, destructive fixture operations, and rate-limit/origin/auth helper usage.
- Custom scanners and their fixtures: API auth, action origin, public route rate limit.
- CI workflow ordering and package scripts.
- E2E seed/server flow, admin opt-in behavior, and seeded public fixture assumptions.
- Migration journal/reconcile tests, current schema, and `migrate.js`.
- Deploy/nginx/Docker contract tests.

Relevant files intentionally not inspected line-by-line:

- Historical `.context/reviews/archive/**`, `.context/plans/**`, and screenshot/image artifacts; they are review history, not active test/runtime code for current HEAD.
- Binary image fixtures and generated `test-results` metadata; only their presence and use sites were inspected.
- `package-lock.json` was inventoried but not manually audited line-by-line; dependency freshness/security was outside this prompt.

No application fixes were implemented.
