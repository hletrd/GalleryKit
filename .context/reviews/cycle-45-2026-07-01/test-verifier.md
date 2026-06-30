# Cycle 45 Test-Verifier Review

Reviewer: test-engineer + verifier
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-01
Scope: read-only review for missing regression coverage, weak source-contract tests, flaky tests, quality-gate blind spots, and unverified correctness claims. No source or plan files were edited.

## Inventory

Required guidance and recent context read:

- `AGENTS.md` lines 29-38: blocking gate list.
- `CLAUDE.md` lines 9-17 and 89-119: tech stack, runtime assumptions, operational variables.
- `.context/reviews/_aggregate.md` lines 3-12: latest aggregate points at Cycle 44 and lists scheduled/carry-forward items.
- `.context/reviews/cycle-44-2026-07-01/_aggregate.md` lines 6-35: Cycle 44 findings and lane results.
- `.context/plans/cycle-44-2026-07-01-plan.md` lines 10-38 and 40-47: Cycle 44 fixes, regression coverage, validation, and deployed completion.
- `.context/plans/cycle-44-2026-07-01-deferred.md` lines 5-12: current carry-forward deferred items.

Configured gates inventoried:

- Root scripts: `package.json` lines 11-22.
- App scripts: `apps/web/package.json` lines 8-27.
- Vitest config: `apps/web/vitest.config.ts` lines 16-38.
- Playwright config: `apps/web/playwright.config.ts` lines 48-87.
- GitHub Actions quality job: `.github/workflows/quality.yml` lines 54-80.

Focused test/source surfaces inspected:

- Custom scanner tests and scripts: `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`.
- Privacy/source contracts: `privacy-fields.test.ts`, `map-privacy.test.ts`, `search-route-privacy.test.ts`, `search-enrichment-fields.ts`.
- E2E safety and coverage: `playwright.config.ts`, `e2e/*.spec.ts`, `e2e/helpers.ts`, `scripts/run-e2e-server.mjs`, `scripts/seed-e2e.ts`, `seed-e2e-safety.test.ts`.
- Skipped/conditional tests: CLIP integration/offline load, admin E2E guard tests.
- Deploy/build coverage contracts: `deploy-script-contract.test.ts`, Dockerfile/deploy workflow references.

## Existing Items Not Repeated

I did not re-raise these because the latest aggregate and Cycle 44 deferred file already carry them, or earlier review artifacts document them with no new evidence from this pass:

- `PA-42-02`: production CLIP web-process catch-up advisory locking and caps.
- `TV-40-03`: JavaScript operational scripts need semantic checking.
- `PERF-C39-03` / `PERF-C39-04`: feed/sitemap and backfill indexes.
- `AGG-C38-07`: broader imported-helper side-effect classification.
- `AGG-C38-08`: sidecar keyset pagination.
- Public JS/histogram worker execution coverage from the prior test-engineer artifact.
- Docker production image CI gap and native package pin drift, already deferred in earlier cycle plans.
- CLIP real-model tests skipped by default and Chromium-only E2E matrix, already deferred in multiple cycle plans.

## Findings

No new test-verifier finding.

The current test/gate surface already has focused regression coverage for the Cycle 44 scanner fixes: `check-action-origin.test.ts` covers approved imports, auth spoofing, protected reads, wrapper forms, and source discovery; `check-public-route-rate-limit.test.ts` covers alias exports, expensive GET/HEAD dominance, exemptions, comment/string false positives, and imported/namespace expensive read helpers. The privacy guards are also layered: `privacy-fields.test.ts` keeps the admin-only/public key difference symmetric, `search-enrichment-fields.ts` has a type-level `PrivacySensitiveKeys` guard, and `search-route-privacy.test.ts` remains a route-source belt-and-braces check.

## Validation

This was a read-only review artifact lane. I did not run the full lint/typecheck/build/Vitest/Playwright gates because the task was to inspect and write this review only, and several full gates generate build/test artifacts. Evidence came from source/config inspection, current aggregate/plan/deferred comparison, and line-numbered review of the configured gate and regression-test surfaces above.
