# Cycle 93 Test/Docs/Ledger Review

Scope: current deployed `master` at `2571d8a8c27e2d2a7bc95ed5e6a72e26487093dc`.

## Confirmed Findings

### C93-01 - Cycle 92 terminal ledger is stale for current deployed HEAD

- Severity / confidence: Medium / High.
- Citations: `AGENTS.md:17`, `CLAUDE.md:469`, `.context/plans/cycle-92-2026-07-01-plan.md:59`, `.context/plans/README.md:7`.
- Problem: repo policy requires every pushed `master` commit to be deployed with `npm run deploy`, but the committed Cycle 92 plan still leaves commit/push/deploy/smoke unchecked and the plan index marks Cycle 92 active.
- Failure scenario: Cycle 93 cannot determine from committed artifacts whether production ran `2571d8a8` or only the prior deployed baseline.
- Suggested fix: update the Cycle 92 plan/index/latest aggregate with the current run's deployed-HEAD evidence and close the stale active state.

### C93-04 - Admin GPS-toggle E2E can leave persistent settings mutated on failure

- Severity / confidence: Medium / High.
- Citations: `apps/web/e2e/admin.spec.ts:89`, `apps/web/e2e/admin.spec.ts:97`.
- Problem: the test flips `#strip-gps`, asserts, then flips it back without `try/finally`.
- Failure scenario: if the assertion after the first click fails, later tests inherit the opposite GPS privacy setting.
- Suggested fix: snapshot the initial state and restore it in `finally` whenever the first click succeeds.

### C93-05 - Lightroom upload route lacks route-level behavior coverage

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:583`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`.
- Problem: existing tests mainly source-contract the heavy multipart PAT route.
- Failure scenario: token rejection, multipart parsing, maintenance, success response, or cleanup wiring can regress while source-text tests stay green.
- Suggested fix: add mocked route-level tests for token rejection, header/size rejection, maintenance, success, and cleanup paths.

### C93-06 - Admin E2E navigation omits first-class admin pages

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/__tests__/client-source-contracts.test.ts:57`, `apps/web/e2e/admin.spec.ts:20`.
- Problem: source-contract metadata lists admin, analytics, categories, dashboard, db, password, seo, settings, tags, tokens, and users, but Playwright navigation visits only categories, tags, users, password, and db.
- Failure scenario: analytics, dashboard, SEO, settings, or token pages can break behind auth while admin E2E stays green.
- Suggested fix: expand admin navigation smoke to visit each first-class route with one stable landmark assertion.

### C93-07 - Sitemap omits indexable archive/collection routes

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/sitemap.ts:57`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:31`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:42`.
- Problem: sitemap includes home, topics, images, feeds, and topic feeds but omits public timeline and smart-collection routes that define canonical/OpenGraph metadata and are not marked noindex.
- Failure scenario: crawlers under-discover intended indexable archive/collection surfaces.
- Suggested fix: add sitemap entries and policy tests after route inventory confirms which collection/archive URLs should be indexed.

### C93-08 - Unit gate has no coverage instrumentation or threshold

- Severity / confidence: Low / High.
- Citations: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16`.
- Problem: `npm test` is plain `vitest run`; no coverage provider or thresholds are configured.
- Failure scenario: source-contract volume can grow while meaningful behavioral coverage declines unnoticed.
- Suggested fix: add an explicit coverage script/config and conservative initial thresholds as release-policy work.
