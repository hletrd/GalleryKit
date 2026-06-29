# Cycle 14 Test-Engineer Review

Date: 2026-06-30 00:35 KST
Scope: current HEAD of `/Users/hletrd/flash-shared/gallery`
Role: test coverage, test design, flaky-risk, TDD opportunities, gate coverage, and false-pass risk.

## Inventory

Read first:
- `AGENTS.md`
- `CLAUDE.md`

Tracked test-relevant inventory built before detailed inspection:
- 537 tracked relevant files under `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/e2e/**`, app configs, package scripts, and `.github/workflows/**`.
- 267 test/spec files: 262 Vitest files under `apps/web/src/__tests__/` plus 5 Playwright specs under `apps/web/e2e/`.
- 7 gate/config files inspected directly: `.github/workflows/quality.yml`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, and the three custom lint gate scripts under `apps/web/scripts/check-*`.
- 263 behavior/source files inventoried across `src/app`, `src/app/actions`, `src/app/api`, `src/components`, `src/lib`, `src/db`, and operational scripts.

Validation run during review:
- `npm test --workspace=apps/web -- src/__tests__/touch-target-audit.test.ts src/__tests__/check-public-route-rate-limit.test.ts` passed: 2 files, 45 tests.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Skipped/conditional test surfaces found:
- `apps/web/e2e/admin.spec.ts` and `apps/web/e2e/origin-guard.spec.ts` use `test.skip` for local or unconfigured admin runs, but CI has explicit admin env (`.github/workflows/quality.yml:27-37`) and a configuration assertion (`apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/origin-guard.spec.ts:28-31`).
- Real CLIP integration/offline-load suites are opt-in and skipped by default; see Risk R1.

Generated/build/runtime artifacts intentionally not reviewed as source of truth: `.next/**`, `node_modules/**`, `apps/web/public/uploads/**`, test result output, and untracked/generated runtime data. No tracked test, gate, config, or behavior-critical source file was skipped from the inventory.

## Confirmed Issues

### C1. Touch-target audit can falsely pass after stale violation budgets create slack

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/__tests__/touch-target-audit.test.ts:112-189` defines positive `KNOWN_VIOLATIONS` counts for multiple files.
- `apps/web/src/__tests__/touch-target-audit.test.ts:764-775` fails only when `issues.length > allowed`.
- `apps/web/src/__tests__/touch-target-audit.test.ts:778-782` explicitly treats stale positive budgets as informational, not a failure.

Concrete failure scenario:
1. A file with an allowed count of 5 is refactored so its current scanned violations drop to 0, but `KNOWN_VIOLATIONS` remains 5.
2. A later change adds 5 new real sub-44 px controls to that same file.
3. The audit still passes because `issues.length === allowed`, even though every issue is newly introduced.

Why this matters:
The audit is intended to catch any new touch-target regression. Positive budgets currently act as reusable capacity rather than exact documentation of known exceptions, so the test can pass while new violations ship.

Concrete fix:
- Make positive violation budgets exact: fail when `issues.length !== allowed`, not only when `>`.
- Better: store stable expected snippets or line-neighborhood fingerprints for known exceptions, so a removed exception cannot be replaced by a different violation.
- Add a fixture test proving stale slack fails: `allowed = 1`, actual known issue removed, different new issue appears.

TDD opportunity:
Write the failing fixture first against `scanSource`/budget comparison, then change the assertion logic. This is a small, isolated red-green test.

### C2. Public route rate-limit gate lets one exemption comment exempt an entire route file

Severity: Medium
Confidence: High

Evidence:
- `apps/web/scripts/check-public-route-rate-limit.ts:287-296` strips strings and then passes the whole file if any `@public-no-rate-limit-required: <reason>` comment exists.
- The scanner collects all mutating handlers first (`apps/web/scripts/check-public-route-rate-limit.ts:238-280`), but the exemption check is file-level rather than handler-level.
- Existing fixture coverage only proves a single exempt `POST` passes (`apps/web/src/__tests__/check-public-route-rate-limit.test.ts:79-89`); it does not cover a mixed file with one justified exemption plus one unmetered handler.

Concrete failure scenario:
```ts
// @public-no-rate-limit-required: provider webhook is HMAC-signed
export async function POST(request: Request) {
  return handleSignedWebhook(request);
}

export async function DELETE(request: Request) {
  await db.delete(rows);
  return new Response('ok');
}
```
This file would pass the gate because the comment is present, even though `DELETE` is a separate public mutating surface with no pre-increment rate limit and no handler-specific exemption.

Why this matters:
The project treats public mutating API route rate limiting as a blocking security gate. File-level exemptions make future multi-handler route files a false-pass risk.

Concrete fix:
- Attach exemptions to the mutating handler declaration/export being exempted, mirroring the server-action scanner’s per-export exemption model.
- If keeping file-level exemptions, fail when a file has more than one mutating handler and uses the exemption tag.
- Add a regression fixture where `POST` is exempt and `DELETE` is unmetered; expected result should be `MISSING RATE LIMIT` for `DELETE`.

TDD opportunity:
Add the mixed-handler fixture to `check-public-route-rate-limit.test.ts` first, confirm it currently passes incorrectly, then implement handler-local exemption detection.

## Risks Needing Manual Validation

### R1. Real CLIP production behavior is not exercised by default CI

Severity: Medium
Confidence: High

Evidence:
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9` documents that default CI skips the real semantic-ranking suite.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` uses `describe.skip` unless `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-18` documents the offline-load suite is gated on seeded weights.
- `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` skips unless `CLIP_OFFLINE_LOAD=1` and a seeded `CLIP_MODELS_ROOT` layout exists.
- `.github/workflows/quality.yml:66-80` runs unit, e2e, and build gates but does not set either CLIP opt-in env or seed model weights.
- The production semantic route calls the real encoder in production mode (`apps/web/src/app/api/search/semantic/route.ts:248-255`), and the loader relies on offline Transformers.js cache settings (`apps/web/src/lib/clip-model.ts:103-118`).

Concrete failure scenario:
A dependency or model-cache layout change breaks `AutoTokenizer.from_pretrained(...)`, changes output key names, or degrades Korean ranking. Default CI still passes because source-contract and manifest tests run, but the real model suites are skipped. Production semantic search then returns 503 or bad rankings after deployment.

Concrete fix:
- Add a scheduled or manually triggered CI workflow with a cached seeded `CLIP_MODELS_ROOT` that runs:
  - `CLIP_OFFLINE_LOAD=1 npm test --workspace=apps/web -- src/__tests__/clip-offline-load.test.ts`
  - `CLIP_INTEGRATION=1 npm test --workspace=apps/web -- src/__tests__/clip-semantic-integration.test.ts`
- Keep it out of every PR if runtime cost is too high, but make it blocking for dependency/model upgrades touching `@huggingface/transformers`, `onnxruntime-node`, `clip-model*`, or semantic-search routes.

Manual validation required:
I did not seed/download model weights in this review, so I did not execute the real CLIP suites.

## Likely Coverage Gaps

### L1. Metadata routes have little direct behavioral coverage

Severity: Low
Confidence: Medium

Evidence:
- `apps/web/src/app/sitemap.ts:24-119` contains non-trivial DB fallback, URL budget, locale expansion, feed-entry, and topic-feed-entry behavior.
- `apps/web/src/app/robots.ts:17-25` contains crawl policy and sitemap URL behavior.
- Repository search found no direct Vitest/e2e tests for `sitemap()` or `robots()`; coverage is mostly adjacent via feed/metadata tests.

Concrete failure scenario:
A route change drops localized topic feed URLs from the sitemap or removes `/api/` from `robots.txt` disallow. Existing feed, OG, and page tests still pass because they do not invoke these metadata-route functions.

Concrete fix:
- Add direct unit tests for `sitemap()` with mocked `getTopics`, `getLatestImageUpdatedAt`, and `getImageIdsForSitemap`, asserting localized homepage/topic/photo/feed entries and the 50,000 URL budget behavior.
- Add a direct `robots()` test asserting `/api/`, localized admin paths, and `${BASE_URL}/sitemap.xml`.

TDD opportunity:
Start with failing tests for feed-entry preservation and `/api/` disallow, then refactor metadata routes with confidence.

## Flaky-Risk Assessment

- Playwright is intentionally serialized (`apps/web/playwright.config.ts:48-59`) to avoid admin login rate-limit collisions. This is appropriate, but makes e2e slow and broad; keep admin specs serialized unless the test data model changes to one admin per worker.
- E2E admin coverage is configured in CI through explicit env (`.github/workflows/quality.yml:27-37`) and guarded by assertions, so I do not classify the local `test.skip` calls as a confirmed gap.
- Time/env-sensitive unit tests generally use `vi.useFakeTimers`, explicit module resets, or deterministic mocks. I did not find a current unbounded sleep-based unit flake in the inspected test inventory.

## Gate Coverage Summary

Strong gates:
- Admin API auth scanner covers route extensions and approved `withAdminAuth` imports.
- Server-action origin scanner is AST-based, recursive, and per-export.
- Public mutating route scanner covers public `POST`/`PUT`/`PATCH`/`DELETE` routes, but C2 shows its exemption model is too coarse.
- Typecheck includes tests via `tsconfig.typecheck.json` per AGENTS/CLAUDE.
- CI runs lint, typecheck, custom lint gates, unit tests, DB init, Playwright e2e, and build.

False-pass hotspots:
- Source-scanner tests are heavily used for UI and architecture contracts. Many are well hardened with self-check fixtures, but exact-budget assertions should be preferred over upper-bound budgets for any allowlist.
- Production-only external-model behavior is intentionally outside default CI and needs an explicit periodic validation lane.

## Final Missed-Issues Sweep

Final sweep performed:
- Re-scanned all tracked test/spec files for `skip`, `only`, assertion-vacuity, source-read tests, env/time usage, and broad mock usage.
- Re-read custom gate scripts and representative fixture tests.
- Re-read behavior-critical public API routes, CLIP production loader paths, e2e config/helpers, metadata routes, and CI workflow.
- Ran targeted gate validation listed above.

Relevant files skipped: none from the tracked test/gate/source inventory. Generated artifacts and runtime upload/build output were intentionally excluded as non-source.
