# Critic — Cycle 1 Review

> Provenance: requested subagent timed out twice in this environment; this file is the leader's critic-angle synthesis from direct repo inspection.

## SUMMARY
- The codebase is generally disciplined, but three small inconsistencies still weaken trust in the edges: proxy trust policy, keyboard affordance, and E2E startup fidelity.

## INVENTORY
- Cross-cutting trust logic: `src/lib/request-origin.ts`, `src/lib/rate-limit.ts`
- Photo-viewer interaction shell: `src/components/photo-navigation.tsx`
- Verification pipeline: `playwright.config.ts`, `next.config.ts`, current E2E output

## FINDINGS

### CRT-01 — Proxy trust policy is inconsistent across security-sensitive helpers
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/lib/rate-limit.ts:58-75`
- **Why fragile:** One helper (`getClientIp`) correctly distrusts forwarded headers unless `TRUST_PROXY=true`; another (`getExpectedOrigin`) silently trusts them. That kind of split-brain trust model is exactly how future regressions slip in.
- **Failure scenario:** Operators think `TRUST_PROXY=false` globally disables forwarded-header trust, but login origin validation still depends on them.
- **Suggested fix:** Centralize the trust decision or at least mirror the same `TRUST_PROXY` gate in `request-origin.ts`.

### CRT-02 — Photo navigation assumes hover is the primary discoverability path even on desktop keyboards
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-navigation.tsx:208-233`
- **Why fragile:** The interaction model is polished for pointer users but incomplete for keyboard-only flows.
- **Failure scenario:** The feature technically works, yet keyboard users perceive the viewer as having missing navigation because focus does not reveal the controls.
- **Suggested fix:** Couple visibility to `group-focus-within` as well as hover.

### CRT-03 — The E2E harness is not using the deployment-shaped startup path it claims to validate
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53`
- **Why fragile:** A warning-only mismatch today becomes a broken gate tomorrow.
- **Failure scenario:** A Next.js update hardens standalone startup expectations; CI fails even though app behavior did not regress.
- **Suggested fix:** Launch the standalone server artifact directly.

## FINAL SWEEP
- No additional high-signal issues emerged after a second pass over auth, viewer navigation, and E2E startup.
