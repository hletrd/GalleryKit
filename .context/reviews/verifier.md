# Verifier Review - Cycle 14

Date: 2026-06-30
Role: cycle-14 verifier, evidence-based correctness check
Scope: `/Users/hletrd/flash-shared/gallery` current `HEAD` only
HEAD: `c2da917d0fe9620bcbef3897570591080445592c`
Constraint: review artifact only. No production code edited.

## Inventory Built Before Inspection

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the current tracked repo before inspecting behavior.

Tracked inventory:

- Total tracked files: 2551.
- Current implementation and invariant surfaces inventoried: 77 `apps/web/src/app` files, 96 `apps/web/src/lib` files, 57 component files, 27 scripts, 31 migration files, 9 public assets/templates, 27 config/deploy files, 265 unit/source-contract tests, and 8 e2e files.
- Review focus set from stated invariants: auth/session/origin gates, public API rate limits, server-action scanners, schema/migration/reconcile, public/admin privacy field separation, upload/original-file privacy, image/color/HDR pipeline, CLIP semantic search, service worker caching, deploy/runtime persistence, Docker prune guarantees, and build/test gates.
- Historical `.context/` and `plan/` files were inventoried and used only as hints/regression context; implementation claims were validated against current code, tests, and command output.

Relevant current-source files skipped: none intentionally. Excluded from behavior inspection: binary fixtures, screenshots, generated build output, `.git`, `node_modules`, local env/secrets, runtime upload/data directories, and historical review artifacts that do not encode current runtime behavior.

## Findings

No confirmed correctness findings were identified in this pass.

No likely implementation issues had enough evidence to report as actionable.

## Risks Needing Manual Validation

### Risk 1 - Browser e2e flow was not freshly proven locally

- Severity: Medium
- Confidence: High
- Status: Risk needing manual validation
- Evidence:
  - `apps/web/playwright.config.ts:78-85` starts a local web server for `npm run test:e2e`.
  - `apps/web/scripts/run-e2e-server.mjs:75-78` runs `npm run init`, then seeds e2e data before building/serving.
  - The local e2e run failed before tests started because `scripts/migrate.js` could not connect to MySQL at `127.0.0.1:3306`.
- Concrete failure scenario:
  - A regression in browser-only behavior, hydration, navigation, or admin flows could remain undetected by this verifier run because Playwright did not reach the app.
- Concrete fix:
  - Run `npm run test:e2e --workspace=apps/web` in an environment with the expected MySQL test database available, or provide an `E2E_ENV_FILE`/`E2E_BASE_URL` target that satisfies the guarded remote-e2e config.

## Confirmed Correct Invariants

- Security scanners passed:
  - `npm run lint:api-auth --workspace=apps/web` passed; both admin API routes are wrapped by `withAdminAuth`.
  - `npm run lint:action-origin --workspace=apps/web` passed; mutating server actions return early on `requireSameOriginAdmin()` or carry explicit read-only/public-rate-limit exemptions.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` passed; public mutating API routes are rate-limited or exempted.
- Type/lint/build/unit gates passed:
  - `npm run typecheck --workspace=apps/web` passed.
  - `npm run lint --workspace=apps/web` passed.
  - `npm test --workspace=apps/web` passed: 258 files passed, 2 skipped; 2386 tests passed, 4 skipped.
  - `npm run build --workspace=apps/web` passed. Build logged the documented sitemap homepage-only fallback when local DB was unavailable; `apps/web/src/app/sitemap.ts:24-55` intentionally catches DB failure for prerender/build.
- Service-worker cycle-13 finding is fixed:
  - `apps/web/src/lib/sw-cache.ts:54-63` and `apps/web/public/sw.template.js:42-47` both match `/admin`, localized admin paths, and `/api/admin`.
  - `apps/web/src/__tests__/sw-cache.test.ts:47-78` now covers `/admin` and `/admin/dashboard`.
  - `npm test --workspace=apps/web -- sw-cache.test.ts sw-template-contract.test.ts` passed: 41 tests.
- Migration journal risk is known and guarded, not a new finding:
  - The historical non-monotonic journal block is documented in tests.
  - `apps/web/src/__tests__/migration-journal.test.ts:76-104` enforces monotonicity for new/global entries.
  - `apps/web/scripts/migrate.js:710-744` baselines per journal hash, and `apps/web/scripts/migrate.js:787-806` throws if Drizzle silently skips a journal hash.
- Privacy field separation remains enforced:
  - `apps/web/src/lib/data.ts:368-507` derives public/map select fields from admin fields and applies TypeScript guards for sensitive keys.
  - `apps/web/src/__tests__/privacy-fields.test.ts:7-132` symmetrically asserts admin-only key differences and search enrichment omissions.
  - `apps/web/src/lib/search-enrichment-fields.ts:29-47` has its own compile-time sensitive-key guard for semantic/similar search enrichment.
- Recent cycle-14/15 hinted regressions are already fixed in current HEAD:
  - GPS NaN/Infinity coordinates return null and are covered by `apps/web/src/__tests__/process-image-metadata.test.ts:167-211`.
  - BoundedMap copy-on-read rate-limit users write back via `.set()` in `sharing.ts:40-57`, `admin-users.ts:31-44`, and `embeddings.ts:36-49`.
  - Admin-only color fields are gated in `color-details-section.tsx:194-215` and `color-details-section.tsx:453-459`, with source-contract coverage in `color-details-section-delivered.test.ts:33-46`.
  - LR upload disk-space check uses `stats.bavail * stats.bsize` at `apps/web/src/app/api/admin/lr/upload/route.ts:280-288`.

## Validation Evidence

Commands run:

- `git status --short && git rev-parse HEAD` -> clean before review; HEAD `c2da917d0fe9620bcbef3897570591080445592c`.
- `npm run lint:api-auth --workspace=apps/web` -> passed.
- `npm run lint:action-origin --workspace=apps/web` -> passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed.
- `npm run typecheck --workspace=apps/web` -> passed.
- `npm run lint --workspace=apps/web` -> passed.
- `npm test --workspace=apps/web` -> passed: 2386 passed, 4 skipped.
- `npm run build --workspace=apps/web` -> passed; local DB unavailable warning was the documented sitemap fallback.
- `npm test --workspace=apps/web -- sw-cache.test.ts sw-template-contract.test.ts` -> passed: 41 tests.
- `npm run test:e2e --workspace=apps/web` -> not completed; webServer init failed due `connect ECONNREFUSED 127.0.0.1:3306`.

## Final Missed-Issues Sweep

Final sweep actions:

- Rechecked prior verifier finding against current `sw-cache.ts`, `sw.template.js`, generated `sw.js`, and service-worker tests.
- Rechecked current source against known risk clusters from recent plans: GPS parsing, BoundedMap rate-limit writeback, admin-only color metadata gates, LR disk-space checks, migration baselining, and public search enrichment privacy.
- Re-ran the full unit suite, lint, typecheck, build, and custom security scanners.
- Attempted Playwright e2e and recorded the DB-environment blocker.
- Checked `git status --short` after validation; only this review file is modified.

Relevant files skipped: none, aside from non-source/generated/binary/local-secret/runtime artifacts listed in the inventory.
