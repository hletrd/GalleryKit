# Aggregate Review — Cycle 1

## AVAILABLE AGENTS
- Requested/available in this environment: `code-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `architect`, `debugger`, `designer`
- Requested but unavailable in this environment: `perf-reviewer`, `tracer`, `document-specialist`

## UNIQUE FINDINGS

| ID | Title | Severity | Confidence | Cross-agent agreement | Files |
| --- | --- | --- | --- | --- | --- |
| AGG-01 | Forwarded-header trust bypasses login same-origin validation when `TRUST_PROXY` is off | HIGH | HIGH | code-reviewer, security-reviewer, critic, verifier, architect, debugger | `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/app/actions/auth.ts:92-95`, `apps/web/src/lib/rate-limit.ts:58-75` |
| AGG-02 | Desktop photo-nav buttons remain visually hidden for keyboard users | MEDIUM | HIGH | code-reviewer, critic, verifier, debugger, designer | `apps/web/src/components/photo-navigation.tsx:208-233` |
| AGG-03 | Playwright E2E starts the app with `next start` despite standalone output | LOW | HIGH | code-reviewer, critic, verifier, test-engineer, architect, debugger | `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53` |
| AGG-04 | Missing regression test for spoofed forwarded headers | MEDIUM | HIGH | security-reviewer, test-engineer | `apps/web/src/__tests__/request-origin.test.ts:1-58` |
| AGG-05 | No automated coverage for keyboard-only reveal of photo-nav controls | LOW | MEDIUM | test-engineer | `apps/web/src/components/photo-navigation.tsx:208-233`, `apps/web/e2e/*` |

### AGG-01 — Forwarded-header trust bypasses login same-origin validation when `TRUST_PROXY` is off
- **Severity:** HIGH
- **Confidence:** HIGH
- **Type:** Confirmed correctness/security bug
- **Why it matters:** `hasTrustedSameOrigin()` currently trusts `x-forwarded-host` and `x-forwarded-proto` unconditionally, while the repo's IP/rate-limit path only trusts forwarded headers when `TRUST_PROXY === 'true'`. That inconsistency creates a bypass in the auth-side origin check.
- **Concrete failure scenario:** A malicious client sends `Origin: https://evil.example` alongside forged `X-Forwarded-Host: evil.example` and `X-Forwarded-Proto: https`; `hasTrustedSameOrigin()` accepts the request even though the true host is different.
- **Suggested fix:** Gate forwarded-header trust on `TRUST_PROXY === 'true'` and add negative tests for spoofed forwarded headers.

### AGG-02 — Desktop photo-nav buttons remain visually hidden for keyboard users
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Type:** Confirmed accessibility/UX bug
- **Why it matters:** The button wrappers only reveal on desktop hover, not focus. Keyboard users can land on a control whose button chrome is still transparent.
- **Concrete failure scenario:** A desktop user tabs through the photo viewer and cannot visually locate the prev/next controls when focus reaches them.
- **Suggested fix:** Add `group-focus-within` (or equivalent focus-driven visibility) to the wrappers and cover it with a regression test if practical.

### AGG-03 — Playwright E2E starts the app with `next start` despite standalone output
- **Severity:** LOW
- **Confidence:** HIGH
- **Type:** Confirmed tooling/runtime mismatch
- **Why it matters:** Current E2E output already warns that `next start` is unsupported with `output: 'standalone'`. The tests pass today but validate a noisier, less deployment-faithful path.
- **Concrete failure scenario:** A future Next.js update hard-errors this combination, breaking the E2E gate before behavior is exercised.
- **Suggested fix:** Launch `.next/standalone/server.js` with explicit `PORT` / `HOSTNAME` instead.

### AGG-04 — Missing regression test for spoofed forwarded headers
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Type:** Confirmed test gap
- **Why it matters:** Existing request-origin tests cover normal forwarded-port normalization, but not attacker-controlled forwarded headers when proxy trust is disabled.
- **Suggested fix:** Add explicit tests for both untrusted and trusted proxy modes.

### AGG-05 — No automated coverage for keyboard-only reveal of photo-nav controls
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Type:** Likely test gap
- **Why it matters:** The accessibility bug in AGG-02 could regress silently because current E2E coverage does not assert keyboard reveal/discoverability for photo navigation.
- **Suggested fix:** Add a focused UI regression test after fixing AGG-02.

## AGENT FAILURES
- `code-reviewer`: initial run hung; retry hung; agent shut down by leader.
- `security-reviewer`: initial run hung; retry hung; agent shut down by leader.
- `critic`: initial run hung; retry hung; agent shut down by leader.
- `verifier`: initial run hung; retry hung; agent shut down by leader.
- `test-engineer`: initial run hung; retry hung; agent shut down by leader.
- `architect`: initial spawn hit thread limit; retry hung; agent shut down by leader.
- `debugger`: initial spawn hit thread limit; retry hung; agent shut down by leader.
- `designer`: initial spawn hit thread limit; retry hung; agent shut down by leader.

## DEDUPING NOTES
- AGG-01 had the strongest multi-agent agreement and is the clear top priority.
- AGG-02 is lower severity than AGG-01 but still concrete and user-visible.
- AGG-03 is low severity but easy to fix and already produces warning noise in the gate.
- AGG-04 and AGG-05 are test gaps attached to AGG-01 and AGG-02 respectively; they should be implemented alongside those fixes, not deferred silently.
