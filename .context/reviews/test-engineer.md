# Cycle 15 Test-Engineer Review

Date: 2026-06-30 KST
HEAD: `e87d1bc2`
Scope: current HEAD of `/Users/hletrd/flash-shared/gallery`
Lane: test-engineer, cycle 15/100

## Inventory

Read first:
- `AGENTS.md` from the prompt and `CLAUDE.md`
- Test/gate configs: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/tsconfig.typecheck.json`, `apps/web/tsconfig.scripts.json`

Relevant test surface inventoried:
- 261 Vitest files under `apps/web/src/__tests__/`
- 5 Playwright specs under `apps/web/e2e/`
- 27 scripts under `apps/web/scripts/`
- Custom blocking gates:
  - `npm run lint:api-auth --workspace=apps/web`
  - `npm run lint:action-origin --workspace=apps/web`
  - `npm run lint:public-route-rate-limit --workspace=apps/web`
  - `npm run typecheck --workspace=apps/web`
  - `npm test --workspace=apps/web`
  - `npm run test:e2e --workspace=apps/web`
  - `npm run build --workspace=apps/web`

Source areas inspected against tests:
- Server actions in `apps/web/src/app/actions/**`
- Admin/public API routes in `apps/web/src/app/api/**`
- Public pages and admin protected pages under `apps/web/src/app/[locale]/**`
- Search and semantic-search modules under `apps/web/src/lib/clip-*`, `apps/web/src/lib/search-*`, and route tests
- UI scan gates for touch target and focus-visible coverage
- Playwright e2e seed/server/helpers and admin/public specs
- Migration/deploy/script typecheck and scanner wiring

Coverage shape observed:
- Strong unit coverage exists for image processing, color/HDR metadata, privacy field guards, server-action origin ordering, admin API auth wrapping, public route rate limiting, public analytics, auth/session/rate limits, migrations, semantic route validation, e2e seed safety, and UI scanner contracts.
- Browser-flow coverage is intentionally small and serialized: public gallery/search/lightbox/share smoke, nav layout checks, origin-guard smoke, and opt-in admin workflows.
- Several high-value gates are source/AST scanners. Many have good self-checks, but the findings below are places where the scanner predicate still proves less than the policy it claims to enforce.

## Findings

### TE15-01. Public rate-limit scanners accept a pre-increment call without proving the over-limit branch stops mutation

Severity: Medium
Confidence: High
Status: confirmed test-gate gap

Evidence:
- `apps/web/scripts/check-public-route-rate-limit.ts:129-139` sets `sawRateLimit = true` when an approved helper is merely called.
- `apps/web/scripts/check-public-route-rate-limit.ts:305-306` passes the route when every mutating handler calls a helper before mutation.
- `apps/web/scripts/check-action-origin.ts:283-314` does the same for exempt public actions in `actions/public.ts`: it only verifies `isViewRecordRateLimited` or `preIncrementLoadMoreAttempt` appears before a mutation.
- Existing fixtures cover comments, missing imports, nested callbacks, unreachable branches, and post-mutation calls (`apps/web/src/__tests__/check-public-route-rate-limit.test.ts:182-265`), but they do not cover `preIncrementX(ip); await db.insert(...)` where the limit result is ignored.

Failure scenario:
A future public mutating route can do:

```ts
import { preIncrementShareAttempt } from '@/lib/rate-limit';

export async function POST(request: Request) {
  preIncrementShareAttempt('203.0.113.1');
  await db.insert(sharedGroups).values(...);
  return Response.json({ ok: true });
}
```

The gate reports "uses rate-limit helper", but over-limit requests still mutate state.

Recommended test/fix:
- Add failing fixtures to `check-public-route-rate-limit.test.ts` and `check-action-origin.test.ts` for an ignored rate-limit result before a DB write.
- Require a dominating early return on the helper result, e.g. `if (preIncrementX(...)) return ...`, or `const overLimit = preIncrementX(...); if (overLimit) return ...`, before any mutation.
- Keep branch-only and nested-call rejection fixtures, because those already caught real false-pass vectors.

### TE15-02. Action-origin scanner does not see mutations hidden behind local helper calls

Severity: Medium
Confidence: High
Status: confirmed scanner blind spot

Evidence:
- `apps/web/scripts/check-action-origin.ts:234-240` documents that `nodeContainsMutatingCall` detects direct mutating calls.
- The implementation only matches direct property calls or known identifiers (`apps/web/scripts/check-action-origin.ts:244-253`).
- `functionCallsRequireSameOriginAdmin` rejects direct pre-guard mutations (`apps/web/scripts/check-action-origin.ts:332-337`) but delegates that decision to the direct-call predicate.

Failure scenario:

```ts
async function writeAuditBeforeGuard() {
  await db.insert(auditLog).values(...);
}

export async function updateThing() {
  await writeAuditBeforeGuard();
  const originError = await requireSameOriginAdmin();
  if (originError) return { error: originError };
  return { success: true };
}
```

The exported action mutates before the origin guard, but the scanner only sees an identifier call to `writeAuditBeforeGuard`, not the `db.insert` inside it.

Recommended test/fix:
- Add a fixture in `check-action-origin.test.ts` where an exported action calls a local helper before `requireSameOriginAdmin`, and that helper performs `db.insert` or `logAuditEvent`; expected failure.
- Either fail closed on pre-guard calls to local functions, or build a small same-file call graph for local helper bodies. Failing closed is simpler and matches the existing conservative stance on aliased exports.

### TE15-03. Semantic search success test does not pin the full enriched result shape

Severity: Medium
Confidence: High
Status: confirmed missing regression test

Evidence:
- The semantic route maps `lens_model` and `capture_date` into public results (`apps/web/src/app/api/search/semantic/route.ts:331-345`).
- The semantic success fixture only asserts `imageId` and `filename_jpeg` (`apps/web/src/__tests__/semantic-search-route.test.ts:356-364`).
- The malformed-row fixture also omits `lens_model` and `capture_date` from its mocked image row (`apps/web/src/__tests__/semantic-search-route.test.ts:375-377`).
- The sibling similar-image route test explicitly pins those fields and explains the prior drift risk (`apps/web/src/__tests__/similar-route.test.ts:291-298`).

Failure scenario:
A future semantic-route refactor drops `lens_model` or `capture_date` from `searchEnrichmentSelectFields` mapping, or stops returning them in JSON. Semantic search cards lose lens/date metadata, while the semantic route tests still pass because they only check that a result exists with a JPEG filename.

Recommended test/fix:
- Mirror the similar-route assertion in `semantic-search-route.test.ts`: include `lens_model` and `capture_date` in `mockImageRows` and assert `toHaveProperty` on the first result.
- Add a shared helper or fixture for search enrichment result shape so semantic and similar routes cannot drift independently again.

### TE15-04. Real CLIP/offline-load tests are skipped by default even though production semantic search is live

Severity: Medium
Confidence: High
Status: risk requiring periodic validation

Evidence:
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-9` states default CI skips the real semantic-ranking suite.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31` uses `describe.skip` unless `CLIP_INTEGRATION=1`.
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-18` states default CI without weights skips the offline-load suite.
- `apps/web/src/__tests__/clip-offline-load.test.ts:32-41` only runs when `CLIP_OFFLINE_LOAD=1` and the seeded model file exists.
- The route uses the real encoder in production mode, not only source contracts or stubs (`apps/web/src/app/api/search/semantic/route.ts:248-255`).

Failure scenario:
A dependency/model-cache layout change, onnx runtime change, or model output shape change breaks offline production loading or degrades Korean/English ranking. Default CI stays green because only mocked/stubbed route tests run.

Recommended test/fix:
- Add a scheduled or manually triggered CI workflow that seeds/caches `CLIP_MODELS_ROOT` and runs:
  - `CLIP_OFFLINE_LOAD=1 npm test --workspace=apps/web -- src/__tests__/clip-offline-load.test.ts`
  - `CLIP_INTEGRATION=1 npm test --workspace=apps/web -- src/__tests__/clip-semantic-integration.test.ts`
- Make that workflow required for PRs touching `@huggingface/transformers`, `clip-model*`, `download-clip-models.ts`, semantic routes, or model manifest logic.

### TE15-05. Nav visual e2e tests save screenshots but do not compare them

Severity: Low
Confidence: High
Status: confirmed false-confidence test quality issue

Evidence:
- `apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, and `apps/web/e2e/nav-visual-check.spec.ts:78` call `page.screenshot(...)`.
- The same tests assert target size and overlap, but they never compare screenshots to a baseline or inspect pixels.

Failure scenario:
A visual regression changes spacing, color, stacking, or truncation while preserving the nav role, minimum target sizes, and non-overlap. The spec still passes and only writes new PNG artifacts under `test-results`.

Recommended test/fix:
- Replace raw screenshot writes with Playwright `expect(page).toHaveScreenshot(...)` for the three nav states, with stable masking for dynamic content if needed.
- If baseline visual assertions are intentionally too noisy, rename the tests away from "visual check" and keep them as layout-metric checks to avoid false confidence.

### TE15-06. Custom API route scanner CLIs fail open when discovery returns zero files

Severity: Low
Confidence: Medium
Status: likely gate robustness issue

Evidence:
- `apps/web/scripts/check-api-auth.ts:188-191` exits `0` when no admin API route files are found.
- `apps/web/scripts/check-public-route-rate-limit.ts:327-330` exits `0` when no public API route files are found.
- Current HEAD has 2 admin API route files and 8 total API route files, so a zero-file result would mean the scanner's root/extension/discovery assumptions broke, not that the policy became irrelevant.

Failure scenario:
A repo layout move, Next route-file extension change, or path-resolution regression makes discovery return `[]`. Both blocking lint gates print "skipping check" and pass, silently dropping admin auth/rate-limit enforcement for future route files.

Recommended test/fix:
- Fail closed when the expected route root exists but discovery returns zero files, or assert a minimum known route count in scanner tests.
- Export or fixture-test `findRouteFiles` for `.ts`, `.tsx`, `.js`, `.mjs`, and `.cjs` discovery, similar to the stronger action-file discovery tests.
- If empty route sets are truly valid for forks, require an explicit env opt-out rather than default success.

## Final Missed-Issues Sweep

Sweep performed:
- Re-read the custom scanner implementations and their fixture tests.
- Re-read Playwright config, helpers, seed script, and all e2e specs.
- Re-read semantic search route tests, production-mode route code, CLIP real/offline tests, and similar-route parity tests.
- Searched test inventory for `skip`, `only`, source-string assertions, raw screenshots, weak truthiness assertions, time use, broad mocks, and known flaky comments.
- Checked dirty worktree state before editing; unrelated modified review artifacts were left untouched.

Validation:
- This was a static review. I did not run the full test suite or mutate source code.
- The review artifact was written to `.context/reviews/test-engineer.md`.

Finding count: 6
