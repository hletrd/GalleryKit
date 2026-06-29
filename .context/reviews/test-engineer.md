# Test Engineer Review - review-plan-fix Cycle 2

**Date:** 2026-06-29
**HEAD:** `3d138704`
**Role:** test-engineer
**Scope:** repository-wide test health, missing regression coverage, weak/flaky assertions, and tests-vs-real-behavior mismatch. No application code edited.

## Inventory

Built inventory before reviewing:

- Test configs/runners: `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/scripts/run-e2e-server.mjs`, `apps/web/scripts/seed-e2e.ts`.
- Unit tests: 245 tracked `*.test.ts`/`*.test.tsx` files under `apps/web/src/__tests__`.
- E2E tests: 5 Playwright specs plus helpers/fixtures under `apps/web/e2e`.
- Source under test: 226 non-test TS/TSX files under `apps/web/src`, including app routes/actions, components, lib, db, proxy, instrumentation, and i18n.
- Scripts/migrations: 27 scripts and 28 Drizzle migration/metadata files.
- Current review/plan docs: top-level `.context/reviews/{verifier,test-engineer}.md`, recent run/cycle review summaries, and current root `plan/` records.

Fresh checks run:

- `npm run lint --workspace=apps/web` - pass.
- `npm run lint:api-auth && npm run lint:action-origin && npm run lint:public-route-rate-limit` - pass.
- `npm run typecheck --workspace=apps/web` - pass.
- `npm test --workspace=apps/web` - pass, 2236 passed / 4 skipped across 245 files.

## Confirmed Findings

### TE-C2-01 - Navigation "visual checks" still take screenshots without assertions

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:
- `apps/web/e2e/nav-visual-check.spec.ts:14`, `:27`, and `:39` call `page.screenshot(...)`.
- Repository search found no `toHaveScreenshot` or `toMatchSnapshot` usage in `apps/web/e2e` or `apps/web/src/__tests__`.
- The same tests assert only coarse visibility at `nav-visual-check.spec.ts:10-13`, `:23-26`, and `:35-38`.

Failure scenario: a nav regression such as overlapping controls, clipped mobile menu content, wrong spacing, or bad dark-mode contrast still passes because screenshots are artifacts only. Playwright does not compare them or fail on visual difference.

Suggested fix: either convert these to real visual assertions with `await expect(nav).toHaveScreenshot(...)` and committed baselines/masks, or rename them to artifact-capture smoke tests and add DOM/bounding-box assertions for the intended contract: no overlap, expected control visibility, stable height, and 44 px hit areas at mobile and desktop widths.

### TE-C2-02 - Browser upload enqueue settings are correct in code but weakly asserted in tests

Severity: Medium
Confidence: High
Status: Confirmed coverage gap

Evidence:
- Production code forwards the upload-time processing/search settings in `apps/web/src/app/actions/images.ts:467-497`: `quality`, `imageSizes`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`, and `semanticSearchMode`.
- The browser action test only checks `id` and `topic` in the enqueue payload at `apps/web/src/__tests__/images-actions.test.ts:375`.
- The Lightroom path has the stronger source-contract lock at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:326-337`, asserting every analogous config field.
- The queue consumes these fields at `apps/web/src/lib/image-queue.ts:414-429`; if a field is omitted from an upload job, the worker can fall back to defaults or skip the admin snapshot.

Failure scenario: a future refactor of `uploadImages()` drops `wideGamutMaxSourcePixels` or `forceSrgbDerivatives` from the payload. Existing browser-action tests still pass because they only assert id/topic, while fresh browser uploads ignore admin color/quality/search settings until a backfill re-encode or manual detection catches it.

Suggested fix: strengthen `images-actions.test.ts` to assert the full enqueue payload shape for the success case, matching the LR coverage: all quality keys, `imageSizes`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`, and `semanticSearchMode`.

## Risks / Test Quality Gaps

### TE-C2-R1 - High-value client async behavior is still locked by source scans rather than runtime behavior

Severity: Medium
Confidence: Medium
Status: Risk

Evidence:
- `apps/web/src/__tests__/search-stale-response.test.ts:8-10` explicitly says the repo has no jsdom render harness and pins client behavior by source order; assertions at `:20-27` search for string positions around `await resp.json()` and `setResults`.
- The real async behavior lives in `apps/web/src/components/search.tsx:175-225`.
- `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts:15-21` uses the same fixture-source pattern for a user-visible mid-batch topic update contract; the real `FormData` behavior is in `apps/web/src/components/upload-dropzone.tsx:214-234`.

Failure scenario: a refactor can preserve the searched strings while changing runtime behavior, or improve runtime behavior while breaking a brittle source regex. These are user-visible asynchronous contracts: stale search responses must not clobber newer results, and mid-batch topic edits must affect not-yet-uploaded files.

Suggested fix: add a minimal browser/component behavior harness for these contracts. For search, mock two semantic fetches so request A resolves JSON after request B and assert only B is rendered. For upload, drive the dropzone or a small extracted upload-loop harness and assert the second request's `FormData` reads the changed topic. Keep source contracts as secondary tripwires if useful.

## Non-Findings / Closed Prior Items

- Prior TE-01 is closed: public-route rate-limit lint now has a root script and CI invocation.
- Prior TE-02 is closed: valid single-photo share e2e uses deterministic `Abc234Def6`.
- Prior TE-03 is closed: Vitest includes `.test.tsx`.
- Prior inert `@/lib/caption` mock is closed: the current test mocks `@/lib/caption-generator`.
- CLIP skips are intentional model-weight skips: `clip-offline-load.test.ts` and `clip-semantic-integration.test.ts`.
- No committed `.only` tests found in the reviewed test tree.

## Final Sweep

Searched for skipped/focused tests, screenshot-only checks, snapshot usage, source-contract tests, weak route-gate wiring, test discovery drift, and current review-plan docs. The suite is broadly healthy and the fresh unit/type/lint gates passed, but the screenshot-only e2e checks and browser-upload settings assertion gap remain actionable.
