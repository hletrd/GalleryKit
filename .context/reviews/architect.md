# Architect — Cycle 1 Review

> Provenance: requested subagent timed out after retry in this environment; this file is the leader's architect-angle synthesis from direct repo inspection.

## SUMMARY
- The main architectural concern is inconsistent trust-boundary handling between helpers that interpret reverse-proxy headers.

## INVENTORY
- Trust boundary helpers: `src/lib/request-origin.ts`, `src/lib/rate-limit.ts`
- Auth caller: `src/app/actions/auth.ts`
- Verification pipeline: `playwright.config.ts`, `next.config.ts`

## FINDINGS

### ARC-01 — Forwarded-header trust is implemented as two different policies
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/lib/rate-limit.ts:58-75`
- **Why it is a design risk:** The codebase has already encoded the correct "only trust proxy headers when configured" rule in one helper, but not in another helper used by auth. Security boundaries should not depend on duplicated, inconsistent trust logic.
- **Failure scenario:** `TRUST_PROXY` is unset and rate limiting behaves safely, yet origin validation still trusts forwarded headers.
- **Suggested fix:** Introduce a shared forwarded-header trust helper or align `request-origin.ts` to the existing policy.

### ARC-02 — E2E startup path diverges from production-shaped standalone deployment
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53`
- **Why it is a design risk:** Verification should exercise the same artifact shape the app deploys.
- **Failure scenario:** Standalone-only startup differences are missed until deployment.
- **Suggested fix:** Run the built standalone server in the Playwright webServer hook.

## FINAL SWEEP
- No broader layering rewrite is needed; these are targeted boundary-alignments.
