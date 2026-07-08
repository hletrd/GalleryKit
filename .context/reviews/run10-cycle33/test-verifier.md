# Run-10 Cycle 33 Test Verifier

Date: 2026-07-08 KST  
Scope: test-engineer/verifier lane; read-only for application source.

## Quality Gate Inventory

Configured blocking/local gates:

- `npm run lint --workspace=apps/web` (`AGENTS.md:31`, `package.json:21`, `apps/web/package.json:14`)
- `npm run lint:api-auth --workspace=apps/web` (`AGENTS.md:32`, `package.json:25`, `apps/web/package.json:25`)
- `npm run lint:action-origin --workspace=apps/web` (`AGENTS.md:33`, `CLAUDE.md:695-700`, `package.json:26`, `apps/web/package.json:26`)
- `npm run lint:public-route-rate-limit --workspace=apps/web` (`AGENTS.md:34`, `CLAUDE.md:701-705`, `package.json:27`, `apps/web/package.json:27`)
- `npm run typecheck --workspace=apps/web` (`AGENTS.md:35`, `CLAUDE.md:681-683`, `package.json:22`, `apps/web/package.json:15`)
- `npm run build --workspace=apps/web` (`AGENTS.md:36`, `apps/web/package.json:11`)
- `npm test --workspace=apps/web` (`AGENTS.md:37`, `CLAUDE.md:677`, `package.json:23`, `apps/web/package.json:13`)
- `npm run audit:prod` (`AGENTS.md:38`, `.github/workflows/quality.yml:66-67`, `package.json:28`, `apps/web/package.json:28`)
- `npm run test:e2e --workspace=apps/web` when browser-flow coverage is required (`AGENTS.md:39`, `.github/workflows/quality.yml:79-80`, `apps/web/package.json:21`)

Additional configured proof/conditional gates:

- `npm run test:e2e:admin --workspace=apps/web` for authenticated admin Playwright proof (`CLAUDE.md:679`, `apps/web/package.json:22`)
- `CLIP_MODELS_ROOT=<abs-models-root> npm run test:clip:preflight --workspace=apps/web` before production semantic-search activation (`CLAUDE.md:680`, `.github/workflows/clip-preflight.yml:44-45`, `apps/web/package.json:23`)
- `npm run check:proxy-topology` is a read-only deployed-edge proof script, not part of the default CI quality workflow (`package.json:29`, `scripts/check-proxy-topology.mjs:3-17`)

## Findings

### C33-TV-01 - `lint:action-origin` accepts fake imported public rate-limit helpers

- **Severity:** Medium
- **Confidence:** High
- **Exact file/line:** `apps/web/scripts/check-action-origin.ts:1061`; `apps/web/scripts/check-action-origin.ts:1070`; `apps/web/scripts/check-action-origin.ts:1122`
- **Coverage gap evidence:** `apps/web/src/__tests__/check-action-origin.test.ts:1427` covers public analytics exemption behavior, and `apps/web/src/__tests__/check-action-origin.test.ts:1643-1685` covers action-local function/parameter shadowing, but there is no fixture for a public-rate-limit helper name imported from an unapproved module.
- **Failure scenario:** A future edit to `src/app/actions/public.ts` imports `checkViewRecordRateLimit` or `isViewRecordRateLimited` from a wrong/fake module, then uses it before `db.insert(...)`. The scanner classifies the bare identifier name as a valid public limiter and returns `OK (public rate-limited action)`, so an unauthenticated public analytics mutation can ship without the real per-IP budget.
- **Reproduction:** `checkActionSource()` returns no failures for a fixture that imports `checkViewRecordRateLimit` from `./fake-rate-limit`, carries `@action-origin-exempt`, checks `result.status === 'rateLimited'`, and then inserts into `imageViews`.
- **Focused test/fix:** Add a fixture next to the existing public analytics shadow tests that imports `checkViewRecordRateLimit` from `./fake-rate-limit` and expects `EXEMPT COMMENT ON MUTATING ACTION`. Then harden `publicActionCallsRateLimitBeforeMutation` so helper calls are accepted only when the identifier resolves to a same-file helper declaration or an explicitly approved import source; unapproved imports with protected helper names should count as shadowing.

## Evidence Run

Passed:

```text
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/cycle12-ops-contracts.test.ts
```

Result: all three custom lint gates passed on current source; focused Vitest files passed `4` files / `230` tests. This confirms the current committed source is green while the missing fake-import fixture remains uncovered.

## Non-Findings

- Cycle 32 audit-gate hardening is now reflected in root/web package scripts, CI, AGENTS, CLAUDE, and `cycle12-ops-contracts.test.ts`.
- The admin API and public route rate-limit scanners already validate approved import sources for their critical wrappers/helpers.
- No additional actionable current gap was confirmed in the inspected package scripts, custom lint scripts, or focused scanner fixture coverage.
