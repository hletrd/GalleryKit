# Verifier — Cycle 1 Review

> Provenance: requested subagent timed out twice in this environment; this file is the leader's verifier-angle synthesis from direct repo inspection and gate runs.

## SUMMARY
- Verified 3 confirmed mismatches between intended behavior and actual runtime behavior/tooling.

## INVENTORY
- Behavior checks: `src/lib/request-origin.ts`, `src/app/actions/auth.ts`, `src/components/photo-navigation.tsx`
- Test/gate evidence: `src/__tests__/request-origin.test.ts`, `playwright.config.ts`, `next.config.ts`, `npm run test:e2e --workspace=apps/web`

## FINDINGS

### VER-01 — Same-origin validation does not actually follow the repo's forwarded-header trust policy
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Evidence:** `rate-limit.ts` explicitly requires `TRUST_PROXY === 'true'` before honoring proxy headers; `request-origin.ts` does not.
- **Files:** `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/lib/rate-limit.ts:58-75`
- **Failure scenario:** An operator deploys with `TRUST_PROXY` unset expecting forwarded headers to be ignored, but login same-origin enforcement still trusts them.
- **Suggested fix:** Reuse the same trust gate for expected-origin computation and add regression tests.

### VER-02 — Desktop keyboard focus does not reveal photo navigation controls
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-navigation.tsx:208-233`
- **Evidence:** Only `group-hover` toggles desktop visibility; no focus-related class is present on the wrappers.
- **Failure scenario:** Keyboard focus reaches a control whose button chrome remains transparent.
- **Suggested fix:** Add `group-focus-within` or similar focus-driven visibility.

### VER-03 — E2E startup emits a real warning because the config contradicts standalone mode
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53`
- **Evidence:** Running `npm run test:e2e --workspace=apps/web` prints: `"next start" does not work with "output: standalone" configuration. Use "node .next/standalone/server.js" instead.`
- **Failure scenario:** The gate validates a less deployment-faithful path and may break on framework upgrades.
- **Suggested fix:** Start `.next/standalone/server.js` instead of `next start`.

## FINAL SWEEP
- Verified current gates before any code changes: lint, api-auth lint, unit tests, and E2E all pass; the standalone-start mismatch still produces a warning.
