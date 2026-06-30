# Cycle 40 Test/Verifier Review

Scope: test-engineer and verifier. Focused on regression coverage, custom lint scanners, type/build/test gate blind spots, brittle tests, and evidence mismatches. I avoided re-raising the deferred cycle-39 items unless new evidence changed the risk.

## Inventory Reviewed

- Project guidance: `AGENTS.md`, `CLAUDE.md`
- Cycle context: `.context/reviews/archive/_aggregate-cycle40.md`, `.context/plans/done/plan-133-cycle40-fixes.md`, `.context/plans/archive/107-deferred-cycle39.md`, `.context/plans/archive/plan-106-cycle39-fixes.md`
- Gate config: `apps/web/package.json`, root `package.json`, `apps/web/tsconfig*.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`
- Custom lint scanners and fixtures:
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
  - `apps/web/src/__tests__/check-api-auth.test.ts`
  - `apps/web/src/__tests__/check-action-origin.test.ts`
  - `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- Public/admin route-handler inventory under `apps/web/src/app/**/route.*`
- Server action inventory under `apps/web/src/app/actions/**`, `apps/web/src/app/actions.ts`, and `apps/web/src/app/[locale]/admin/db-actions.ts`
- Operational JS scripts under `apps/web/scripts/*.{js,mjs,cjs}`
- Touch-target audit and scan roots in `apps/web/src/__tests__/touch-target-audit.test.ts`

## Verification Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed; the script phase reported `Checked 8 JavaScript script files.`
- I did not run the full Vitest or Playwright suites because this was a read-only review pass and the actionable evidence came from scanner-level inspection plus targeted scanner probes.

## Findings

### TV-40-01: `lint:action-origin` misses protected reads that use Drizzle `db.query.*.findFirst/findMany`

Severity: MEDIUM
Confidence: HIGH

`check-action-origin` is supposed to reject read-only `@action-origin-exempt` admin actions that touch protected data before an auth read. The protected-read detector only treats property calls named `.select(...)` and a small set of helper-name prefixes as protected reads (`apps/web/scripts/check-action-origin.ts:410`). It does not treat Drizzle query-builder reads like `db.query.sessions.findMany()` or `db.query.adminSettings.findFirst()` as protected reads, even though this repo uses that API in `apps/web/src/lib/session.ts`.

Concrete proof: this fixture is skipped as an exempt read instead of failing:

```ts
/** @action-origin-exempt: read-only admin getter */
export async function listSessions() {
  return db.query.sessions.findMany();
}
```

The existing fixture coverage only locks the `.select(...)` path and the positive auth-before-select path (`apps/web/src/__tests__/check-action-origin.test.ts:488`, `apps/web/src/__tests__/check-action-origin.test.ts:501`). A future admin getter could use Drizzle's relational query API, carry a read-only exemption, omit `isAdmin()` / `getCurrentUser()` / `requireSameOriginAdmin()`, and still keep `lint:action-origin` green.

Fix: extend `nodeContainsProtectedRead` to flag `db.query.*.findFirst`, `findMany`, and similar Drizzle relational read calls before auth. Add fixture tests for exempt read-only actions using `db.query.sessions.findMany()` before auth (must fail) and after `isAdmin()` (may skip).

### TV-40-02: `lint:public-route-rate-limit` misses DB-backed imported read helpers not named in its marker list

Severity: MEDIUM
Confidence: HIGH

Expensive public GET detection is marker-based. `EXPENSIVE_GET_MARKERS` includes a few hard-coded strings such as `getGalleryConfig`, `getSeoSettings`, `getImage`, `getMapImages`, `getTimeline`, and `db.` (`apps/web/scripts/check-public-route-rate-limit.ts:60`). The actual expensive-work detector returns true only when the handler body text contains one of those markers or calls a local helper already classified as expensive (`apps/web/scripts/check-public-route-rate-limit.ts:448`).

This misses DB-backed imported helpers whose names are outside the marker list. Two current examples are `getTopicBySlug`, which executes Drizzle selects and an alias join (`apps/web/src/lib/data.ts:1364`), and `getLatestImageForOg`, which runs a DB query with `limit(1)` (`apps/web/src/lib/data.ts:953`). A targeted probe showed a public `GET` that imports and awaits `getTopicBySlug()` with no rate limit and no exemption is reported as `OK: ... (no mutating or expensive GET handlers...)`.

Failure scenario: a future public route adds a lightweight-looking `GET` that calls `getTopicBySlug()` or `getLatestImageForOg()` before any limiter. The route consumes unauthenticated DB work but the custom lint gate stays green, so the intended "expensive public GET must rate-limit or explicitly exempt" invariant is not enforced.

Fix: replace the fragile substring list with an approved/known DB-read import classifier, or at least add all DB-backed public data helpers to the marker set and add negative fixtures for `getTopicBySlug()` and `getLatestImageForOg()` without a limiter. Prefer classifying imports from `@/lib/data`, `@/db`, image/fs/embedding modules, and known route helper modules instead of relying on function-name substrings.

### TV-40-03: JS operational scripts are only syntax-checked, so runtime deploy-script regressions can pass `typecheck`

Severity: MEDIUM
Confidence: MEDIUM

`npm run typecheck` delegates to `typecheck:scripts`, which runs `npm run check:js-scripts` and then `tsc -p tsconfig.scripts.json --noEmit` (`apps/web/package.json:26`). The TypeScript script config includes only `scripts/**/*.ts` and `.next/types/**/*.ts` (`apps/web/tsconfig.scripts.json:7`). The JavaScript script checker walks `apps/web/scripts` but only executes `node --check` on each JS/MJS/CJS file (`apps/web/scripts/check-js-scripts.mjs:38`), which validates syntax but does not catch unresolved identifiers, wrong CommonJS exports, or missing required modules.

This matters because runtime/deploy-critical JS files are copied into the production image and executed there. `migrate.js` is copied into the runner image (`apps/web/Dockerfile:123`) and is executed before the server starts (`apps/web/Dockerfile:158`). A typo such as an undefined variable in an untested migration branch can pass `npm run typecheck`, `npm run build`, and `node --check`, then fail during deploy startup.

Existing tests cover selected `migrate.js` contracts (`apps/web/src/__tests__/migrate-legacy-originals.test.ts:9`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:113`), but they do not make the JS gate semantic. I verified separately that `node --check` exits 0 for code that references an undefined variable.

Fix: add semantic checking for JS scripts. Options: enable `checkJs` for a script-focused tsconfig that includes `scripts/**/*.{js,mjs,cjs}`, add `// @ts-check` plus JSDoc where needed, or convert production-critical JS scripts (`migrate.js`, `mysql-connection-options.js`, `restore-maintenance-recovery.mjs`, `run-e2e-server.mjs`) to TypeScript/compiled JS with tests. Keep the syntax check if desired, but do not treat it as type/build coverage.

## Notes

- The three custom lint gates are currently green on the checked-out tree.
- Cycle-39 deferred items were not re-raised. The one C40 deferred CSV memory item is still intentionally deferred and was not counted as a new finding here.
