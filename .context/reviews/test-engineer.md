# Test Engineer Review - review-plan-fix Cycle 3

**Date:** 2026-06-29  
**HEAD:** `3d3b78167360b9c66070619c0734c97dc49653f8`  
**Role:** test-engineer  
**Scope:** current HEAD only; repository-wide test health, missing regression coverage, fragile/flaky tests, lint-gate blind spots, fixture drift, and TDD opportunities. No application source was edited.

## Inventory

Reviewed instructions first: `AGENTS.md` and `CLAUDE.md`.

Inventoried current HEAD surfaces:

- Test/build config: root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`.
- Unit tests: 245 tracked `*.test.ts` / `*.test.tsx` files under `apps/web/src/__tests__`.
- E2E tests: 5 Playwright specs under `apps/web/e2e`.
- Source under test: 230 non-test TS/TSX files under `apps/web/src`.
- Scripts/migrations: 27 files under `apps/web/scripts`, 28 files under `apps/web/drizzle`.
- Custom gates: `check-api-auth.ts`, `check-action-origin.ts`, `check-public-route-rate-limit.ts`, touch/focus/source-contract tests, migration/privacy/schema drift tests.
- Prior history checked: committed `.context/reviews/test-engineer.md` from cycle 2, latest run summaries including `run9-cycle8`, and current top-level review/plan history. I did not rely on the three unrelated modified review files in the worktree.

Validation run:

- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass; 6 public API routes scanned.
- `npm test --workspace=apps/web -- public-actions.test.ts check-public-route-rate-limit.test.ts client-source-contracts.test.ts` - pass; 42 tests across 3 files.

## Confirmed Findings

### TE-C3-01 - Public analytics view-recording rate limit has no behavior regression test

Severity: Medium  
Confidence: High  
Status: Confirmed coverage gap

Evidence:

- `apps/web/src/app/actions/public.ts:316-334` defines the per-IP `VIEW_RECORD_*` limiter and `isViewRecordRateLimited`.
- `apps/web/src/app/actions/public.ts:357-400` wires that limiter into `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` before the fire-and-forget DB inserts.
- The public action test imports only `loadMoreImages` and `searchImagesAction` at `apps/web/src/__tests__/public-actions.test.ts:72`, and its assertions cover those paths through `apps/web/src/__tests__/public-actions.test.ts:74-250`.
- Repo-wide search for `recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` in `apps/web/src/__tests__` found no test that calls those actions, saturates the 120/minute bucket, verifies invalid inputs avoid inserts, or verifies over-limit calls return before `db.insert`.

Failure scenario: a future refactor moves the `isViewRecordRateLimited(...)` call below `db.insert(...)`, removes it from one of the three analytics actions, or accidentally changes the shared limiter to return the inverse boolean. Existing `public-actions.test.ts`, `load-more-rate-limit.test.ts`, and route-gate tests still pass because they exercise search/load-more rate limits, not analytics view inserts. A bot can then flood `image_views`, `topic_views`, or `shared_group_views` until production table growth reveals it.

Concrete fix/test: add a `public-view-recording.test.ts` or extend `public-actions.test.ts` with mocks for `headers`, `getClientIp`, and `db.insert`. Assert each `record*View` writes once under limit, writes zero times for invalid ids/slugs, and writes zero times after 120 same-IP calls. Include one reset-window assertion so the `createResetAtBoundedMap` behavior is locked for this public mutation surface.

### TE-C3-02 - Public route rate-limit lint can be satisfied by an unreachable helper call

Severity: Medium  
Confidence: High  
Status: Confirmed lint-gate blind spot

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:107-126` recursively walks the whole handler AST, sets `sawRateLimit` when it sees any `preIncrement*` / `checkAndIncrement*` call, and only tracks whether a known mutation was encountered before that AST visit.
- This is syntactic preorder, not executable control flow. A handler like `if (false) preIncrementSemanticAttempt(ip); await db.insert(...);` would set `sawRateLimit = true` before the mutation node and pass the gate even though no request is charged.
- Existing fixtures cover comments/imports/after-mutation cases at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:103-179`, but there is no unreachable-branch, never-called helper, or nested-local-function fixture.
- The current gate run is green, so this is not an active route failure; it is a fail-open regression risk in the gate itself.

Failure scenario: a future public mutating route copies a helper into a dead debug branch or local nested helper, then performs the real mutation uncharged. `npm run lint:public-route-rate-limit` reports OK, CI stays green, and the route ships without effective rate limiting.

Concrete fix/test: first add failing fixtures that should be rejected:

```ts
if (false) preIncrementSemanticAttempt(ip);
await db.insert(rows).values({});
```

and

```ts
function charge() { preIncrementSemanticAttempt(ip); }
await db.insert(rows).values({});
```

Then make `bodyCallsRateLimitBeforeMutation` statement-aware, similar to the action-origin gate's top-level guard logic: only accept an executed top-level rate-limit call, or a clearly returned/awaited wrapper call that the scanner can resolve. When in doubt, fail closed and require explicit route-local structure.

### TE-C3-03 - Admin metadata coverage is a static allowlist, so new admin routes can silently miss localized metadata

Severity: Low  
Confidence: High  
Status: Confirmed test fragility / TDD opportunity

Evidence:

- The cycle-2 fix introduced localized admin metadata helpers at `apps/web/src/app/[locale]/admin/admin-metadata.ts:16-31`.
- The regression test uses a hand-maintained `routeContracts` array at `apps/web/src/__tests__/client-source-contracts.test.ts:35-47`, then checks only those paths at `apps/web/src/__tests__/client-source-contracts.test.ts:49-53`.
- The current admin route tree includes route modules outside that array, such as `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` and the admin/protected layouts; today `db/page.tsx` is covered by metadata on `apps/web/src/app/[locale]/admin/(protected)/db/layout.tsx`, but the test does not derive this relationship from the filesystem.

Failure scenario: a future admin page is added under `apps/web/src/app/[locale]/admin/(protected)/reports/page.tsx` without `generateMetadata` and without a metadata-bearing segment layout. The current test still passes because the new path is not in `routeContracts`; the route inherits generic admin/root metadata, recreating the localized-admin-title regression that cycle 2 just fixed.

Concrete fix/test: replace the static list with a filesystem-driven test. Enumerate admin `page.tsx` modules and nearest segment `layout.tsx` files under `apps/web/src/app/[locale]/admin`, then require each routable page to have either its own `generateMetadata` using `adminRouteMetadata` / `adminTokenRouteMetadata` or an ancestor segment layout with one. Keep explicit exemptions for non-routable shells only, with comments and reopen criteria.

## Manual-Validation / Likely Risks

### TE-C3-R1 - Nav "visual checks" still produce manual screenshots, not visual assertions

Severity: Low  
Confidence: Medium  
Status: Manual-validation risk

Evidence:

- The old cycle-2 nav finding is partially fixed: `apps/web/e2e/nav-visual-check.spec.ts:4-35` now asserts visible nav targets are at least 44x44 and non-overlapping.
- The same spec still writes screenshots at `apps/web/e2e/nav-visual-check.spec.ts:49`, `apps/web/e2e/nav-visual-check.spec.ts:63`, and `apps/web/e2e/nav-visual-check.spec.ts:76`, with no `toHaveScreenshot` baseline.

Risk scenario: contrast, theme colors, clipping inside a target, or visual hierarchy regressions can still pass automatically and are only visible if someone manually opens the PNG artifacts. Because the added geometry assertions cover the highest-risk layout failure, I am not re-filing the prior medium finding; this is now a lower manual-validation gap.

Concrete fix/test: either rename the spec away from "visual checks" and keep it as geometry smoke coverage, or add Playwright visual baselines with masks for dynamic content and use `await expect(nav).toHaveScreenshot(...)`.

## Non-Findings / Closed Prior Items

- Cycle-2 TE-C2-02 is closed at current HEAD: `apps/web/src/__tests__/images-actions.test.ts:247-258` now asserts the browser upload enqueue payload includes the color/search/alt-text settings that `uploadImages()` forwards at `apps/web/src/app/actions/images.ts:488-497`.
- Cycle-2 TE-C2-01 is not re-filed as-is: the nav e2e spec now has real DOM geometry assertions at `apps/web/e2e/nav-visual-check.spec.ts:4-35`.
- The expensive public GET similar-search route is not relying on the public mutating-route lint gate: `apps/web/src/app/api/search/similar/[id]/route.ts:85-95` explicitly pre-increments the semantic limiter, and `apps/web/src/__tests__/similar-route.test.ts:219-228` locks the 429 branch.
- CLIP offline/load integration skips remain intentional environment-gated tests: `clip-offline-load.test.ts` and `clip-semantic-integration.test.ts`.
- No committed `.only` tests found.

## Final Missed-Issues Sweep

Swept for focused/skipped tests, screenshot-only specs, source-contract fragility, lint-gate fixture gaps, admin metadata route drift, public analytics rate limits, E2E credential gates, migration/privacy/schema drift tests, and recent HEAD deltas after cycle 2.

Current quality posture is strong: targeted tests and the public route lint gate pass, CI is configured to run unit/lint/typecheck/e2e/build, and many historical drift classes are locked. The three actionable findings above are remaining regression-protection gaps rather than known failing runtime behavior.
