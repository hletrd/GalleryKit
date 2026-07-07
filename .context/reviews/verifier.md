# Verifier Review - Cycle 9

Date: 2026-07-07
Reviewer: verifier
HEAD reviewed: `ff0c79d607208bae9487be8152fa648f4161674f`
Mode: PROMPT 1 deep review from evidence-based correctness against stated behavior. Application code was not modified. No commit, push, deploy, service action, database mutation, or destructive runtime action was performed.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory reviewed, not sampled:

- Docs and policies: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, current root `.context/reviews/*.md`, prior run9 review aggregates, `.context/plans/`, `plan/`, deploy/runbook docs.
- App source: 81 files under `apps/web/src/app`, 111 under `apps/web/src/lib`, 61 under `apps/web/src/components`, plus `src/db`, `src/i18n`, config, generated-public contracts, and route/action surfaces.
- Tests and gates: 342 unit test files under `apps/web/src/__tests__`, 12 Playwright/e2e files under `apps/web/e2e`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, root/app `package.json`, and custom lint scanners.
- Operations and schema: 30 scripts under `apps/web/scripts` + root `scripts`, 33 Drizzle migration/meta files, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, migration/reconcile code, CLIP/backfill scripts, and service-worker/PWA generation.

Fresh validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: pass; both admin API route files OK.
- `npm run lint:action-origin --workspace=apps/web`: pass; scanner reports every mutating server action guarded or explicitly exempt.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; 10 public route files classified OK.
- `npm run lint --workspace=apps/web`: pass.
- `npx vitest run src/__tests__/auth-mutation-barrier-source.test.ts src/__tests__/shared-link-runtime-contracts.test.ts src/__tests__/public-actions.test.ts src/__tests__/smart-collection-pagination.test.ts --config vitest.config.ts`: pass; 4 files, 43 tests.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: fail; Next's nested PostCSS remains vulnerable.
- Test-surface sweep: no `.only(` focus marker found in `apps/web/src/__tests__`, `apps/web/e2e`, or test configs. Intentional skip surface remains in admin/origin Playwright and CLIP env-gated suites.

Not run:

- `npm run typecheck --workspace=apps/web`: skipped because `typecheck:app` runs `next typegen`, which writes generated framework artifacts.
- `npm run build --workspace=apps/web`: skipped because `prebuild` writes generated PWA icons and `sw.js`.
- Full `npm test --workspace=apps/web`: targeted tests were run instead; the full suite was not necessary to establish the findings below.
- `npm run test:e2e --workspace=apps/web`: skipped because the local harness initializes/builds/seeds and `seed-e2e.ts` deletes/recreates disposable DB rows/files.

## Findings

### VER-C9-01 - Production dependency audit still fails despite the root PostCSS override

Severity: Medium
Confidence: High
Status: Confirmed
File/region: `package.json:7-9`, `apps/web/package.json:57,80`, `package-lock.json:9194-9205`, `package-lock.json:9334-9355`

Why: the root package declares an override to `postcss@8.5.16`, and the workspace also has top-level `postcss@^8.5.16`, but the production lockfile still contains `node_modules/next/node_modules/postcss@8.4.31` through `next@16.2.10`. `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` fails with GHSA-qx2v-qp2m-jg93. The override gives false confidence because it does not remove the nested production copy.

Concrete failure scenario: a future feature accepts user/admin-controlled CSS or theme snippets and stringifies them through the vulnerable nested PostCSS path into an HTML style context. The production audit gate would already have caught this dependency risk, but no repo quality gate currently runs it, so the issue can remain hidden behind passing lint/type/test gates.

Suggested fix: upgrade Next to a stable release that no longer vendors vulnerable PostCSS, or add a tested package-manager override that actually removes `node_modules/next/node_modules/postcss@8.4.31`. Add a CI/package-lock contract check for the nested path after remediation.

### VER-C9-02 - Production CLIP activation depends on manual skipped suites, not an enforced gate

Severity: High
Confidence: High
Status: Confirmed evidence gap
File/region: `CLAUDE.md:587-596`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31,72-80`, `apps/web/src/__tests__/semantic-route-production.test.ts:3-5,33-41`, `apps/web/src/lib/gallery-config.ts:123-126`, `apps/web/src/app/api/search/semantic/route.ts:247-289`

Why: the docs label CLIP's real offline-load/ranking checks as the pre-activation test gate, but also state they are permanently skipped in CI and are the only verification before flipping production mode. The default production route test mocks `embedTextReal`; it proves the route's no-embedding response, not that the real model loads or ranks. Runtime production mode is still enabled by env plus DB setting, and the public route then calls `embedTextReal` and returns 503 if inference fails.

Concrete failure scenario: a model-cache layout, pinned revision, ONNX runtime binding, container mount, or Transformers.js behavior changes. Unit/CI gates stay green because real CLIP suites skip or mock the encoder. An operator follows the activation runbook, flips `semantic_search_mode='production'`, and public semantic search returns 503 for real users.

Suggested fix: make CLIP activation proof executable and enforceable. For example, add `npm run test:clip:preflight` and require a recent preflight marker/artifact before allowing production mode, or run the real-model suites in CI with a seeded cache artifact. Keep fast route tests mocked, but do not let production activation rely only on a manual doc step.

### VER-C9-03 - Load-more action tests duplicate a looser cursor normalizer

Severity: Medium
Confidence: High
Status: Confirmed
File/region: `apps/web/src/lib/data.ts:701-759`, `apps/web/src/app/actions/public.ts:132-245`, `apps/web/src/__tests__/public-actions.test.ts:39-56`, `apps/web/src/__tests__/smart-collection-pagination.test.ts:56-75`, `apps/web/src/__tests__/load-more-rate-limit.test.ts:30-45`

Why: production `normalizeImageListCursor` strictly accepts MySQL datetime strings or ISO UTC strings, length-caps values, rejects invalid `Date`s, and requires a positive integer id. The public action tests mock `@/lib/data` and reimplement a simpler normalizer; two mocks accept any parseable date string and do not preserve all regex/length/invalid-date checks. These tests prove the mocked contract, not the real cursor validation used by `loadMoreImages` and `loadMoreSmartCollectionImages`.

Concrete failure scenario: a client emits a slash-formatted date or fractional timestamp shape that the mock accepts but production rejects, causing load-more to return `invalid` or restart pagination. Conversely, a future production normalizer regression can relax unsafe cursor data while action tests still pass because the duplicate mock did not change.

Suggested fix: add direct unit tests for `normalizeImageListCursor` covering accepted ISO/MySQL forms, null capture dates, invalid dates, slash-formatted dates, overlong strings, non-integer ids, and non-object values. In action tests, import the actual normalizer with `vi.importActual('@/lib/data')` while mocking only DB-fetching functions.

### VER-C9-04 - Authenticated admin/browser e2e proof remains conditional

Severity: Medium
Confidence: High
Status: Confirmed risk
File/region: `apps/web/playwright.config.ts:48-87`, `apps/web/e2e/helpers.ts:28-45`, `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/origin-guard.spec.ts:27-73`, `apps/web/scripts/run-e2e-server.mjs:80-90`, `apps/web/scripts/seed-e2e.ts:169-183,217-233`

Why: Playwright runs one desktop Chromium project. Admin tests are skipped unless `adminE2EEnabled` resolves true; that auto-enables only for local non-production origins with plaintext `E2E_ADMIN_PASSWORD` or plaintext `ADMIN_PASSWORD`, and remote admin remains opt-in. CI includes a guard that expects admin coverage, which is good, but ordinary `npm run test:e2e` can still pass without proving authenticated admin navigation or the authenticated same-origin rejection branch. The local server path also builds and seeds a disposable DB, so verifier/review lanes often cannot run it without mutating local test state.

Concrete failure scenario: an authenticated admin route, login-cookie behavior, hydrated settings/dashboard UI, or same-origin branch after a valid session regresses. A local e2e smoke without plaintext e2e credentials skips the authenticated specs and still reports green on public/unauthenticated flows.

Suggested fix: split e2e into explicit projects: a required local disposable admin project that seeds a known admin account, and a separate remote-admin project that remains opt-in. Make the default e2e command fail with a clear message when browser-flow coverage is requested but authenticated admin proof was skipped.

### VER-C9-05 - The unit gate has no coverage threshold or changed-file ratchet

Severity: Medium
Confidence: High
Status: Confirmed risk
File/region: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`, broad source-contract surface under `apps/web/src/__tests__`

Why: the unit gate is plain `vitest run`, and the Vitest config only defines include/exclude and timeout. There is no coverage provider, branch threshold, critical-directory threshold, or changed-file ratchet. A repo-wide sweep found 154 test files using source-contract patterns (`readFileSync`, `source-contract`, or `extractFnBody`), which are useful tripwires but can pass while behavior branches remain unexecuted.

Concrete failure scenario: a new public API route, server action branch, migration reconcile branch, upload queue failure path, or security helper lands with no behavior test. Existing source-contract and unrelated unit tests stay green, and no gate reports that the new file or branch has zero executed coverage.

Suggested fix: add a non-blocking coverage report first, then ratchet changed files and critical directories such as `src/app/actions`, `src/app/api`, `src/lib`, and migration scripts. Keep explicit exemptions for source-contract-only invariants, but require behavior coverage for user/security/data paths.

## Verified Non-Findings

- Restore barrier regression from earlier cycle-9 lane reports is fixed in the current tree: `updatePassword` checks `if (!mutationSlot.acquired)` before rate-limit, Argon2, transaction, or cookie work (`apps/web/src/app/actions/auth.ts:309-312`), and the source contract asserts that shape (`apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:17-25`).
- Admin CSV export no longer uses MySQL-invalid `SEPARATOR CHAR(1)`: it defines `CSV_TAG_SEPARATOR` and uses a quoted `sql.raw` separator (`apps/web/src/app/[locale]/admin/db-actions.ts:42,116,139-144`), and the shared-link runtime contract checks both the public and admin export source (`apps/web/src/__tests__/shared-link-runtime-contracts.test.ts:21-40`).
- Custom auth/origin/rate-limit scanners execute and passed in this review. They prove the current source matches scanner contracts, though they do not replace the behavior/e2e gaps listed above.
- No focused `.only(` test marker was found in the reviewed test surfaces.

## Final Sweep

Commonly missed areas checked: repo docs vs source claims, root/app quality gates, intentional skips, source-contract test concentration, custom scanner pass evidence, production dependency audit, CLIP activation, load-more cursor validation, admin e2e proof, restore-barrier claims, CSV separator claims, migration/schema docs, privacy guards, deploy/test write behavior, and generated artifact gates.

I did not inspect live production host state, real environment secrets, deployed DB rows, real CLIP weights, or browser/CDN cache state. The findings above are limited to current repository evidence.
