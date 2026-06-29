# Test Engineer Review - review-plan-fix Cycle 5

**Date:** 2026-06-29
**HEAD:** `2f7895a5782518236c124e490c5b374f92019473`
**Role:** test-engineer
**Scope:** current HEAD only. Focused on test coverage gaps, flaky tests, missing regression locks, bad mocks, quality-gate blind spots, and TDD opportunities. No application source was edited.

## Inventory

Required repo instructions read first: `AGENTS.md` and `CLAUDE.md`.

Current HEAD test and behavior-surface inventory:

- Unit tests: 247 tracked `*.test.ts` / `*.test.tsx` files under `apps/web/src/__tests__/`.
- E2E tests: 5 Playwright specs under `apps/web/e2e/`.
- Source under test: 229 non-test TS/TSX files under `apps/web/src`.
- API routes: 8 App Router route modules under `apps/web/src/app/api`.
- Server actions: 13 action modules under `apps/web/src/app/actions`.
- Blocking gates reviewed: ESLint, typecheck, Vitest, Playwright, `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, touch-target audit, privacy guards, migration/schema guards, deploy/build contract tests, and CI workflow wiring.
- Prior cycle-4 test-engineer findings checked for staleness: deploy-script and site-config contract gaps are closed at current HEAD by dedicated tests.

Validation evidence:

- `npm test --workspace=apps/web -- semantic-route-production.test.ts semantic-similarity-selector-contract.test.ts data-pagination.test.ts smart-collection-pagination.test.ts public-actions.test.ts clip-offline-load.test.ts clip-semantic-integration.test.ts` - pass: 5 files / 36 tests passed; 2 files / 4 tests skipped by CLIP env gates.
- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- No committed `.only` tests found. Expected skips remain admin E2E local-credential skips and CLIP real-model opt-in suites.

## Findings

### TE-C5-01 - Semantic text-search route does not regression-lock active model-version filtering

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap

Exact region:

- Runtime contract: `apps/web/src/app/api/search/semantic/route.ts:227-249`
- Existing semantic production test with unused `whereSpy`: `apps/web/src/__tests__/semantic-route-production.test.ts:8-30`
- Similar route has the missing style of assertion: `apps/web/src/__tests__/similar-route.test.ts:306-320`

Problem:

The route correctly derives `activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION` and applies `.where(eq(imageEmbeddings.modelVersion, activeModelVersion))`. That filter is load-bearing: production search must not scan stub vectors, and stub search must not scan production vectors. Current semantic-route tests prove production calls `embedTextReal()` and disabled mode returns 503, but they never assert the DB scan's `modelVersion` predicate. `semantic-route-production.test.ts` defines `whereSpy` and clears it, but no test inspects it. The image-similarity route already has this regression lock.

Concrete failure scenario:

A future refactor removes the `.where(eq(imageEmbeddings.modelVersion, activeModelVersion))` line, hardcodes `STUB_MODEL_VERSION`, or accidentally filters production mode with the stub version. The mock DB still returns rows, `semantic-search-route.test.ts` can remain green, and production natural-language search starts ranking against mixed or wrong-model embeddings.

Concrete fix / TDD opportunity:

Add a failing test before changing the route. Mirror `similar-route.test.ts:306-320`: spy on the semantic route's scan `where()` arguments and assert production mode includes `PRODUCTION_MODEL_VERSION`; add a stub-mode companion asserting `STUB_MODEL_VERSION`. Prefer table-keyed query dispatch over call-order-only mocks so the test fails for the predicate, not for harmless query reordering.

### TE-C5-02 - Cursor pagination tests copy a looser `normalizeImageListCursor` mock instead of testing the real helper

Severity: Medium  
Confidence: High  
Status: Confirmed bad mock / confirmed missing regression lock

Exact region:

- Real cursor normalizer: `apps/web/src/lib/data.ts:678-731`
- Public action use sites: `apps/web/src/app/actions/public.ts:113-126` and `apps/web/src/app/actions/public.ts:161-185`
- Divergent inline mocks: `apps/web/src/__tests__/public-actions.test.ts:37-54`, `apps/web/src/__tests__/load-more-rate-limit.test.ts:30-45`, `apps/web/src/__tests__/smart-collection-pagination.test.ts:56-75`
- Existing direct data pagination tests do not cover the cursor normalizer: `apps/web/src/__tests__/data-pagination.test.ts:1-30`

Problem:

The production normalizer requires strict MySQL/ISO timestamp shapes via `MYSQL_DATETIME_CURSOR_RE` and `ISO_DATETIME_CURSOR_RE`; invalid strings return `null`. The public-action tests mock `@/lib/data` and reimplement `normalizeImageListCursor` inline, but the copied version accepts any short `capture_date` string and converts any `created_at` string with `new Date(...)`. Those tests therefore verify action wiring against a different cursor contract than production.

Concrete failure scenario:

A future cursor regression changes the real helper to accept malformed dates, reject valid MySQL fractional timestamps, or return a different `created_at` shape. The mocked action tests still pass because they never import the real helper. Conversely, a test can pass with a cursor shape production rejects, giving false confidence around load-more and smart-collection pagination.

Concrete fix / TDD opportunity:

Add direct unit tests for `normalizeImageListCursor` in `data-pagination.test.ts`: valid MySQL datetime, valid fractional MySQL datetime, valid ISO `Z`, `capture_date: null`, invalid free-form strings, overlong date strings, invalid `Date`, non-positive/non-integer id. Then replace the copied mocks with `vi.importActual('@/lib/data')` for `normalizeImageListCursor` while keeping heavy DB functions mocked.

### TE-C5-03 - Real CLIP model activation tests are opt-in and skipped by the blocking CI path

Severity: Medium  
Confidence: Medium
Status: Risk / quality-gate blind spot

Exact region:

- CI runs only default unit tests with no CLIP model env: `.github/workflows/quality.yml:27-37` and `.github/workflows/quality.yml:66-67`
- Offline activation suite skip gate: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`
- Real semantic-ranking suite skip gate: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`
- Skipped assertions that would prove the real path: `apps/web/src/__tests__/clip-offline-load.test.ts:54-64`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:72-80`

Problem:

Production semantic search is documented as live, but the two tests that prove real offline model loading and real ko/en semantic ranking both use `describe.skip` unless local env and seeded weights are present. The blocking GitHub Actions job supplies DB/admin/site env only, then runs plain `npm test`, so these suites are skipped in the default quality gate. Targeted validation in this review reproduced that posture: both CLIP real-model files skipped.

Concrete failure scenario:

A dependency update, pinned-revision path change, model-root layout change, or transformers runtime change breaks offline `jina-clip-v2` loading or multilingual ranking. Source-contract and mocked route tests can stay green while production silently falls back to errors, empty search results, or degraded relevance once the live model path is exercised.

Concrete fix / TDD opportunity:

Add a scheduled or manually-triggered CI job that seeds the pinned model cache once, sets `CLIP_OFFLINE_LOAD=1`, `CLIP_INTEGRATION=1`, and `CLIP_MODELS_ROOT`, then runs only the two real-model suites. Keep the default PR gate lightweight if model download cost is too high, but require the scheduled job before dependency/model-runtime upgrades. At minimum, publish the skip count as an explicit CI artifact so a skipped real-model lane is visible rather than buried in the unit-test summary.

## Closed Prior Items / Non-Findings

- Cycle-4 deploy script safety gap is closed: `apps/web/src/__tests__/deploy-script-contract.test.ts:16-50` now pins prune-after-up ordering, absence of all-volume prune, narrow bind mounts, and config-driven remote deploy.
- Cycle-4 production site-config validator gap is closed: `apps/web/src/__tests__/ensure-site-config.test.ts:40-77` now subprocess-tests missing config, missing production URL, placeholder host, invalid URL schemes, relative URLs, and valid `BASE_URL` override.
- Cycle-4 public mutating-route scanner dead-branch gap is closed: `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:195-225` now covers unreachable and branch-only helper calls, and `apps/web/scripts/check-public-route-rate-limit.ts:149-154` only lets the `if` condition dominate.
- CI is wired to run lint, typecheck, security lint gates, unit tests, DB init, Playwright E2E, and build. Admin E2E is expected to run in GitHub Actions because `CI=true` plus plaintext E2E credentials are supplied.
- The touch-target audit now scans shared components, admin routes, public routes, and app-level error/not-found/layout/loading files. I did not find a fresh scanner root omission.

## Final Missed-Issues Sweep

Swept for committed `.only` tests, expected/hidden skips, env-gated tests, source-contract vacuity, custom-lint blind spots, brittle call-order mocks, duplicated mock logic, public API rate-limit coverage, public server-action exclusions, touch-target scanner reach, CI gate ordering, and prior test-engineer findings.

Coverage statement: current HEAD has strong regression coverage around admin/auth/origin gates, upload processing, migrations/schema drift, privacy field guards, deploy/build contracts, color/HDR processing, public analytics limits, and accessibility/touch-target scans. The remaining test-engineer gaps are concentrated in semantic-search regression locks and model-backed integration coverage rather than broad absence of tests.
