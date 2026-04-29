# Plan 249 — Cycle 2 fresh gate reliability fix

## Context
A fresh post-push verification run was started after the cycle 2 report. `npm run lint` completed, but `npm run typecheck` ran for more than 30 minutes without completing. Process inspection showed TypeScript consuming CPU while using generated artifacts in `apps/web/.next` and `apps/web/tsconfig.typecheck.tsbuildinfo` that were owned by UID 3000, not the local user. The earlier cycle had only regenerated `next typegen` manually, so the gate still depended on local generated state.

## Findings addressed
- Gate reliability: `npm run typecheck` could hang or fail on stale/foreign-owned incremental/generated artifacts because `next-env.d.ts` imports `./.next/types/routes.d.ts`, while the typecheck script did not regenerate Next route types and the typecheck config inherited incremental cache output.
  - Files: `apps/web/package.json`, `apps/web/tsconfig.typecheck.json`, `apps/web/next-env.d.ts`
  - Original severity/confidence: High / High
  - Fix: make the typecheck gate generate Next route types before TypeScript, disable incremental cache writes for the dedicated typecheck config, and make the build script run that explicit typecheck before invoking `next build` with Next's duplicate internal type validation disabled.

## Implementation
- [x] Update `apps/web/package.json` so `npm run typecheck` runs `next typegen` before `tsc`.
- [x] Override `compilerOptions.incremental` to `false` in `apps/web/tsconfig.typecheck.json` so no `tsconfig.typecheck.tsbuildinfo` ownership/cache state can block the gate.
- [x] Rejected pointing Next's build-time type validation at `tsconfig.typecheck.json`: a targeted build then hung before the Next banner, so that did not resolve the framework-side hang.
- [x] Make `npm run build` execute `npm run typecheck` first and configure `next build` to skip its duplicate internal type validation after the explicit gate succeeds.
- [x] Remove stale local generated artifacts and rerun targeted gate checks from a clean generated-artifact state.
- [ ] Commit and push the gate reliability fix with a signed gitmoji semantic commit after targeted build evidence is collected.

## Verification
Fresh/targeted gate evidence:
- `npm run lint`
- `npm run typecheck` — passed in the fresh fixed run before the build hang
- `npm run build` — pending rerun with explicit typecheck + skipped duplicate internal Next validation
- `npm run test`
- `npm run test:e2e`
- `npm run lint:api-auth`
- `npm run lint:action-origin`

## Cycle 2 reconciliation update (Prompt 2)
- [x] The typecheck/build gate-reliability work remains active input for Prompt 3.
- [x] Cycle 2 review found additional gaps: cursor type mismatch, unchecked JS/MJS scripts, and restore/body-limit mismatch. These are scheduled in `plan/plan-252-cycle2-review-fixes.md`.
- [ ] Prompt 3 must rerun all configured gates after repairing these gaps.

## Cycle 2 implementation update (Prompt 3)
- [x] Repaired the cursor/typecheck, JS script syntax-check, restore/body-limit, Playwright dotenv, storage URL, restore/upload lock, deploy-env, and PostCSS audit issues from Plan 252.
- [x] Verification passed: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run lint:api-auth`, `npm run lint:action-origin`.
- [x] Remaining performance-only items are explicitly deferred in `plan/plan-253-cycle2-deferred.md`; build sitemap fallback warning is recorded in `plan/plan-254-cycle2-gate-warnings.md`.
