# Cycle 26 Test-Engineer Review

Role: test-engineer
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `d13d66377e69` on `master`
Date: 2026-06-30

## Inventory And Evidence

Required docs read first: `AGENTS.md` and `CLAUDE.md`.

File inventory built before review:

- Repo files excluding `.git`, `node_modules`, `.next`, coverage/dist: 6,746.
- App-relevant tracked surface: `apps/web` contains 907 files.
- `apps/web/src`: 77 app route/page files, 57 component files, 98 library files, 3 DB files, 275 unit-test files, 6 other source files.
- API route files: 8 under `apps/web/src/app/api`.
- Server action files: 12 under `apps/web/src/app/actions`.
- E2E files: 8 under `apps/web/e2e`.
- CI/gates inspected: `.github/workflows/quality.yml`, root/package workspace scripts, Vitest config, Playwright config, three custom lint scanners.

Validation run during this review:

- `npm test --workspace=apps/web -- --run src/__tests__/og-rate-limit.test.ts src/__tests__/og-photo-fallback.test.ts src/__tests__/og-route-source-contracts.test.ts src/__tests__/shared-route-rate-limit-source.test.ts src/__tests__/shared-page-title.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts` passed: 7 files, 67 tests.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

## Findings

### C26-TE-01 - OG GET route rate-limit enforcement is not behavior-tested

- Severity: Medium
- Confidence: High
- Exact file/region: `apps/web/src/__tests__/og-rate-limit.test.ts:16-112`, `apps/web/src/__tests__/og-route-source-contracts.test.ts:7-18`, `apps/web/src/__tests__/og-photo-fallback.test.ts:53-74`; enforcement lives in `apps/web/src/app/api/og/route.tsx:74-90` and `apps/web/src/app/api/og/photo/[id]/route.tsx:45-55`.
- Failure scenario: `/api/og` and `/api/og/photo/[id]` are documented CPU-heavy public GET endpoints. The helper tests prove `preIncrementOgAttempt` and `rollbackOgAttempt`, while the route tests mostly grep source text for rollback/fallback contracts. A refactor can leave helper tests green while removing or bypassing the route-level `preIncrementOgAttempt` branch, changing the returned 429 shape, or doing DB/ImageResponse work before rejecting over-limit requests. The custom public-route rate-limit scanner will not catch this because GET handlers are explicitly out of scope (`CLAUDE.md:610-614`, `apps/web/scripts/check-public-route-rate-limit.ts:1-11`).
- Concrete fix: Add mocked route-level tests that import each `GET` handler. For `/api/og`, mock `preIncrementOgAttempt` to return `true`, call `GET` with a valid topic query, assert status 429 and `Retry-After: 60`, and assert `getSeoSettings`/`getTopicBySlug`/`ImageResponse` work is not reached. For `/api/og/photo/[id]`, mock `preIncrementOgAttempt` to return `true`, call `GET` with a valid numeric id, assert 429, and assert `getImageCached`, `getSeoSettings`, `getGalleryConfig`, `pickFirstAvailablePhotoBuffer`, and `rollbackOgAttempt` are not called. Keep the existing helper/source tests as secondary locks.

### C26-TE-02 - Shared-link lookup throttling lacks an over-limit behavior test

- Severity: Medium
- Confidence: Medium-High
- Exact file/region: `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:9-81`, `apps/web/src/__tests__/shared-page-title.test.ts:74-130`; enforcement lives in `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:30-34,83-94` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:35-38,89-100`.
- Failure scenario: The source-order test proves the page body still contains `await isShareLookupRateLimited()` before the share-key DB lookup, and existing render tests cover valid pages with `preIncrementShareAttempt` returning `false`. They do not prove the observable over-limit path. A future edit can make `isShareLookupRateLimited()` return `false`, stop calling `preIncrementShareAttempt`, swallow the over-limit result, or still perform `getImageByShareKeyCached` / `getSharedGroupCached` before `notFound()` while the current source-order and title-render tests continue to pass.
- Concrete fix: Extend `shared-page-title.test.ts` or add a focused route-render unit test with `preIncrementShareAttemptMock.mockReturnValue(true)`. For both `/s/[key]` and `/g/[key]`, call the page with a valid Base56 key and assert it throws the mocked `notFound` error before any share-key lookup. Also assert malformed keys do not call `headers`, `getClientIp`, or `preIncrementShareAttempt`, preserving the current "validate before charging" contract.

## Flakiness And TDD Notes

- No currently failing or newly flaky test was found in the inspected target set.
- Playwright remains intentionally serial (`workers: 1`) to avoid admin login/rate-limit contention; that is a valid flake-control tradeoff.
- The main TDD opportunity is replacing source-only route contract checks with behavior tests at the public boundary. Semantic POST and similar GET already show the better pattern: they mock the limiter and assert the route returns 429 (`semantic-search-route.test.ts:308-317`, `similar-route.test.ts:236-244`).

## Final Missed-Issue Sweep

I rechecked route/action coverage, skipped tests, scanner scope, source-contract tests, E2E specs, CI workflow gates, and existing cycle-25 reports. I did not refile the broader cycle-25 coverage requests unless I found fresh evidence in this pass. No additional test-engineer findings survived the final sweep.
