# Debugger — Cycle 1 Review

> Provenance: requested subagent timed out after retry in this environment; this file is the leader's debugger-angle synthesis from direct repo inspection.

## SUMMARY
- Confirmed 2 latent-bug paths and 1 test/runtime fragility.

## INVENTORY
- Auth/origin path: `src/lib/request-origin.ts`, `src/app/actions/auth.ts`
- Viewer controls: `src/components/photo-navigation.tsx`
- E2E harness: `playwright.config.ts`

## FINDINGS

### DBG-01 — Spoofed forwarded headers can make `hasTrustedSameOrigin()` accept the wrong origin
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/app/actions/auth.ts:92-95`
- **Bug scenario:** With `TRUST_PROXY` disabled, the helper still uses `x-forwarded-host` / `x-forwarded-proto`. A malicious request can rewrite the expected origin and slip through the auth-side origin check.
- **Suggested fix:** Ignore forwarded host/proto unless the deployment explicitly opts into trusting them.

### DBG-02 — Desktop keyboard navigation can land on visually hidden prev/next buttons
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-navigation.tsx:208-233`
- **Bug scenario:** Tabbing into the photo viewer reaches controls whose wrappers remain transparent because only hover reveals them.
- **Suggested fix:** Reveal the wrappers on focus-within as well as hover.

### DBG-03 — E2E startup path is one framework tightening away from breaking
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:54-61`
- **Bug scenario:** `next start` under standalone output becomes a hard error in a future upgrade and the test gate fails before app behavior is exercised.
- **Suggested fix:** Run the standalone server directly.

## FINAL SWEEP
- No additional hidden null/race bugs surfaced in the inspected areas after a second pass.
