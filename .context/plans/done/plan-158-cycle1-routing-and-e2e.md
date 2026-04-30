# Plan 158 — Cycle 1 Routing + E2E Gate Fixes

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `designer.md`, `test-engineer.md`, `verifier.md`

## Scope
Fix the newly re-verified issues from cycle 1:
1. Default-locale redirect loop in local QA (`/` and `/admin`)
2. E2E gate validating production by default instead of the working tree
3. Broken local Playwright server bootstrap path
4. Current lint warnings in `storage/local.ts`

## Completed items

### C1-01 — Eliminate default-locale self-redirects in local QA
- **Files changed:** `apps/web/src/proxy.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/__tests__/locale-path.test.ts`
- **Implemented:** Switched locale routing to explicit locale prefixes (`localePrefix: 'always'`) and aligned locale-path helpers/tests so default-locale requests redirect cleanly to `/en...` instead of looping back to themselves.
- **Verification:**
  - `curl -i --max-redirs 0 http://127.0.0.1:3000/` → `307 location: /en`
  - `curl -i --max-redirs 0 http://127.0.0.1:3000/admin` → `307 location: /en/admin`
  - `cd apps/web && npx playwright test -c playwright-test.config.ts e2e/public.spec.ts --project=chromium` → `3 passed`

### C1-02 — Make `npm run test:e2e` validate the current checkout by default
- **Files changed:** `apps/web/playwright.config.ts`
- **Implemented:** Defaulted Playwright’s `baseURL` to the local test server (`http://127.0.0.1:3100`) while preserving remote smoke coverage through explicit `E2E_BASE_URL` overrides.
- **Verification:**
  - `npm run test:e2e --workspace=apps/web` now boots a local app instance and passes against the working tree.

### C1-03 — Replace the broken local Playwright webServer command
- **Files changed:** `apps/web/playwright.config.ts`
- **Implemented:** Replaced the unusable `.next/standalone/server.js` assumption with a supported local boot path (`npm run build && npm run start -- --hostname 127.0.0.1 --port ...`).
- **Verification:**
  - `npm run test:e2e --workspace=apps/web` passed with the local server auto-managed by Playwright.

### C1-04 — Clear current lint warnings
- **Files changed:** `apps/web/src/lib/storage/local.ts`
- **Implemented:** Consumed intentionally unused parameters with `void` statements so the storage backend stays interface-compatible without lint noise.
- **Verification:**
  - `npm run lint --workspace=apps/web` → clean

## Ralph progress
- 2026-04-20: Plan created from validated cycle-1 aggregate findings.
- 2026-04-20: Completed routing + E2E + lint pass.
- 2026-04-20: Final gates green (`lint`, `lint:api-auth`, `test`, `build`, `test:e2e`).
