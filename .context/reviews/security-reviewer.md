# Security Reviewer — Cycle 1 Review

> Provenance: requested subagent timed out twice in this environment; this file is the leader's security-angle synthesis from direct repo inspection.

## SUMMARY
- Confirmed 1 high-severity security finding and 1 defense-in-depth gap.

## INVENTORY
- Request-origin validation: `src/lib/request-origin.ts`
- Auth entry points: `src/app/actions/auth.ts`
- Proxy/IP trust model baseline: `src/lib/rate-limit.ts`

## FINDINGS

### SEC-01 — `hasTrustedSameOrigin()` accepts spoofed forwarded headers when `TRUST_PROXY` is off
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/app/actions/auth.ts:92-95`, reference model in `apps/web/src/lib/rate-limit.ts:58-75`
- **Why it matters:** The app already treats proxy headers as untrusted unless `TRUST_PROXY=true` for rate limiting, but the CSRF/same-origin guard does not. That inconsistency leaves a bypass in the more security-sensitive path.
- **Exploit scenario:** A hostile client or intermediary injects `X-Forwarded-Host` / `X-Forwarded-Proto` headers matching an attacker-controlled `Origin`; login-side origin validation then passes even though the true request host is different.
- **Suggested fix:** Gate forwarded-header trust on `TRUST_PROXY === 'true'`; otherwise ignore those headers entirely for expected-origin computation. Add tests that prove spoofed forwarded headers are rejected when proxy trust is disabled.

### SEC-02 — No regression test currently proves the forwarded-header spoofing case stays closed
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/__tests__/request-origin.test.ts:1-58`
- **Why it matters:** Existing tests cover valid forwarded-port normalization and obvious cross-origin rejection, but not the attacker-controlled forwarded-header case.
- **Exploit scenario:** A future refactor could reintroduce the bypass without tripping the current test suite.
- **Suggested fix:** Add explicit negative tests for spoofed `x-forwarded-host` / `x-forwarded-proto` when `TRUST_PROXY` is unset, plus positive coverage when it is enabled.

## FINAL SWEEP
- I did not find a second confirmed exploit path of similar severity in the inspected auth/origin surface.
