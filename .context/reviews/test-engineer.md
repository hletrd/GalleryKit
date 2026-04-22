# Test Engineer — Cycle 1 Review

> Provenance: requested subagent timed out twice in this environment; this file is the leader's test-engineer-angle synthesis from direct repo inspection and gate runs.

## SUMMARY
- Current automated coverage is good, but two regression gaps remain and one gate path is noisier than it should be.

## INVENTORY
- Unit tests: `src/__tests__/request-origin.test.ts`
- E2E harness: `playwright.config.ts`, `e2e/*.spec.ts`
- UX-sensitive component: `src/components/photo-navigation.tsx`

## FINDINGS

### TEST-01 — Missing regression test for spoofed forwarded headers in origin validation
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/__tests__/request-origin.test.ts:1-58`, `apps/web/src/lib/request-origin.ts:28-41`
- **Why it matters:** The current suite never asserts that attacker-controlled `x-forwarded-host` / `x-forwarded-proto` are ignored when proxy trust is disabled.
- **Regression scenario:** A future refactor reintroduces the bypass and the existing tests still pass.
- **Suggested fix:** Add explicit negative coverage for spoofed forwarded headers with `TRUST_PROXY` unset and positive coverage when it is enabled.

### TEST-02 — No accessibility regression test covers keyboard reveal of photo-nav controls
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Status:** Likely
- **Files:** `apps/web/src/components/photo-navigation.tsx:208-233`, current E2E specs under `apps/web/e2e/`
- **Why it matters:** The viewer has interactive prev/next chrome whose visibility depends on hover classes, but no automated check exercises keyboard-only discovery.
- **Regression scenario:** Desktop keyboard accessibility regresses silently because the current E2E surface focuses on routing and major workflows.
- **Suggested fix:** Add a focused component/unit test or Playwright keyboard-navigation assertion once the UI fix lands.

### TEST-03 — E2E server startup warning adds avoidable noise to the gate
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53`
- **Why it matters:** Warning-heavy gates train maintainers to ignore output that should stay meaningful.
- **Regression scenario:** A real startup regression hides inside a wall of expected warnings.
- **Suggested fix:** Launch the standalone server artifact directly and keep the E2E gate warning-clean.

## FINAL SWEEP
- Gate evidence this cycle: `npm test --workspace=apps/web` passed (169 tests); `npm run test:e2e --workspace=apps/web` passed (11 passed / 3 skipped) but emitted the standalone-start warning.
