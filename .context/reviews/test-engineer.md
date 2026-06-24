# Test-Engineer Review — PROMPT 1 / Cycle 1

Scope: whole-repository test coverage, flakiness, false-positive/false-negative gates, and TDD opportunities. This was a read-only review except for this report. I did not modify source, commit, push, or deploy.

## Inventory

- Unit tests: 227 `apps/web/src/__tests__/**/*.test.ts` files; no `.test.tsx/.test.js/.test.jsx` files currently exist.
- E2E tests: 5 Playwright spec files under `apps/web/e2e/`.
- API route files: 8 `route.*` files under `apps/web/src/app/api`.
- Server action files: 13 files under `apps/web/src/app/actions/`, plus the barrel `apps/web/src/app/actions.ts` and out-of-tree admin DB actions at `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Blocking local gates documented in `AGENTS.md`: ESLint, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, typecheck, build, Vitest.
- CI workflow examined: `.github/workflows/quality.yml`.

## Findings

### 1. CI omits the public-route rate-limit lint gate

- Severity: High
- Confidence: High
- Type: Confirmed issue
- Region: `.github/workflows/quality.yml:60-64`, `AGENTS.md:32-34`, `apps/web/package.json:22-24`

`AGENTS.md:32-34` declares all three custom lint gates blocking, including `npm run lint:public-route-rate-limit --workspace=apps/web`. The script exists in `apps/web/package.json:22-24`. CI only runs:

```yaml
# .github/workflows/quality.yml:60-64
npm run lint:api-auth
npm run lint:action-origin
```

Problem: the repository has a dedicated scanner for public mutating API route rate limits, but pull requests and pushes to `master` can pass CI without running it. That makes this gate dependent on local discipline even though the repo rules call it blocking.

Concrete failure scenario: a future PR adds `apps/web/src/app/api/foo/route.ts` with `export async function POST()` and no `preIncrement*` / `checkAndIncrement*` helper. `npm run lint:public-route-rate-limit` would fail, but the GitHub quality workflow would still go green if no one runs the local gate before merging.

Suggested fix: add `npm run lint:public-route-rate-limit` to `.github/workflows/quality.yml` beside the other security lint gates. Add a small workflow contract test or script that parses `.github/workflows/quality.yml` and asserts every repo-declared blocking custom gate appears in CI, so this does not drift again.

### 2. Public analytics server actions have no compensating regression test for their write limiter

- Severity: Medium
- Confidence: High
- Type: Confirmed test coverage gap
- Region: `apps/web/scripts/check-action-origin.ts:13-21`, `apps/web/scripts/check-action-origin.ts:49-72`, `apps/web/src/app/actions/public.ts:312-338`, `apps/web/src/app/actions/public.ts:353-397`, `apps/web/src/__tests__/check-action-origin.test.ts:338-348`, `apps/web/src/__tests__/public-actions.test.ts:72-250`

The action-origin scanner excludes `public.*` files by basename:

```ts
// apps/web/scripts/check-action-origin.ts:49-72
const EXCLUDED_ACTION_BASENAMES = new Set(['auth', 'public']);
...
if (EXCLUDED_ACTION_BASENAMES.has(parsed.name)) continue;
```

The scanner comment still describes `public.*` as the "unauthenticated read-only action surface" at `check-action-origin.ts:13-19`, but `apps/web/src/app/actions/public.ts:353-397` exports three intentionally public mutating server actions: `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView`. They all write with `db.insert(...)` and rely on the shared in-memory limiter at `public.ts:320-338`.

The exclusion itself is locked by `check-action-origin.test.ts:338-348`, but I found no test exercising the `record*View` actions. `public-actions.test.ts:72-250` imports and tests `loadMoreImages` and `searchImagesAction`; it does not import or mock `recordPhotoView`, `recordTopicView`, or `recordSharedGroupView`.

Problem: this public write path sits outside the generic origin scanner and outside the public API route scanner, so its rate-limit/write ordering is protected only by code review. The source comment at `public.ts:320-324` explicitly says the limiter prevents bots or malicious actors from flooding analytics tables, which makes the missing regression coverage material.

Concrete failure scenario: a refactor removes `if (isViewRecordRateLimited(params.ip, Date.now())) return;` from `recordSharedGroupView` only. Existing action-origin tests still pass because `public.ts` is excluded. Existing public-action tests still pass because they only cover search/load-more. A bot can then repeatedly invoke the server action and flood `shared_group_views`.

Suggested fix: add unit tests that mock `headers()` and `db.insert(...).values(...)`, saturate the view-record budget, and assert each `record*View` stops inserting after `VIEW_RECORD_MAX_REQUESTS`. Add a source-shape guard that each `record*View` calls `isViewRecordRateLimited` before its first `db.insert`. Longer term, either update `check-action-origin` to scan `public.ts` with a narrow public-analytics allowlist or create a dedicated `lint:public-actions-rate-limit` gate.

### 3. Touch-target audit allows stale violation budgets to mask future regressions

- Severity: Medium
- Confidence: High
- Type: Confirmed issue
- Region: `apps/web/src/__tests__/touch-target-audit.test.ts:112-244`, `apps/web/src/__tests__/touch-target-audit.test.ts:755-786`, `apps/web/src/__tests__/touch-target-audit.test.ts:168-183`, `apps/web/src/__tests__/touch-target-audit.test.ts:190-197`

The audit stores per-file allowed counts in `KNOWN_VIOLATIONS` at `touch-target-audit.test.ts:112-244`. The enforcement only fails when the current count is greater than the allowed count:

```ts
// apps/web/src/__tests__/touch-target-audit.test.ts:755-786
const allowed = KNOWN_VIOLATIONS[rel] ?? 0;
if (issues.length > allowed) {
  failures.push(...)
}
```

There is a comment at `touch-target-audit.test.ts:769-773` saying stale entries are informational, but there is no actual comparison, warning, or assertion for `issues.length < allowed`. The file itself documents prior cases where stale budgets masked real regressions: `image-manager.tsx` was tightened because a stale `6` could mask five new sub-44 targets (`touch-target-audit.test.ts:168-183`), and `upload-dropzone.tsx` had a stale budget that absorbed a native select violation (`touch-target-audit.test.ts:190-197`).

Problem: the test claims "adding a NEW violation in a file with N existing violations causes a hard failure" (`touch-target-audit.test.ts:17-23`), but that is only true when `KNOWN_VIOLATIONS[file]` exactly matches the real current count. If a file improves from 5 real hits to 1 but keeps an allowed count of 5, four new violations can land with the audit still green.

Concrete failure scenario: an admin component with `KNOWN_VIOLATIONS[rel] = 5` is fixed down to 1 actual violation, but the map is not updated. Later a change adds four undersized buttons. The audit sees `issues.length === 5`, `allowed === 5`, and passes, even though four fresh touch-target regressions shipped.

Suggested fix: make the audit fail when `issues.length !== allowed` for files listed with positive budgets, or at least fail on `issues.length < allowed` with an explicit "budget is stale; retighten it" message. If "removing violations is always allowed" remains a desired workflow, add a separate self-check that recomputes and prints stale budgets in CI as a hard failure before source changes can spend the stale allowance.

## Residual Risks / TDD Opportunities

- `apps/web/vitest.config.ts:16-18` only includes `src/__tests__/**/*.test.ts`. That matches the current inventory, but future React/component tests named `.test.tsx` would be silently skipped. Consider expanding the include to `.test.{ts,tsx}` before adding TSX component tests.
- `apps/web/e2e/helpers.ts:151-172` polls MySQL every 500 ms for image processing. This is bounded and acceptable, but it is the main timing-sensitive E2E helper; a future queue slowdown will manifest as intermittent upload E2E failures.
- The public GET route rate-limiting story remains intentionally split: `check-public-route-rate-limit.ts:9-11` does not scan GET handlers, while expensive GET routes such as OG and semantic-similar rely on route-local tests. Keep adding explicit route-local tests for new expensive GET routes.

## Missed-Issues Sweep

I searched for `.only`, `.skip`, fake timers, direct `Date.now` mutation, `setTimeout`, and Playwright wait patterns. No `.only` leaks were found. Skips are intentional environment-gated CLIP/admin/share-key cases. Current `.test.ts` inventory matches Vitest's include pattern. The CI omission, public analytics coverage gap, and stale touch-target budget behavior above are the actionable issues from this pass.

Relevant files examined:

- `AGENTS.md`
- `CLAUDE.md`
- `package.json`
- `apps/web/package.json`
- `.github/workflows/quality.yml`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/load-more-rate-limit.test.ts`
- `apps/web/src/__tests__/semantic-search-rate-limit.test.ts`
- `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- Route/action/test inventory from `apps/web/src/app/api`, `apps/web/src/app/actions`, `apps/web/src/__tests__`, and `apps/web/e2e`.
