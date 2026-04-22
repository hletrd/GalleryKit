# Code Reviewer — Cycle 1 Review

> Provenance: requested subagent timed out twice in this environment; this file is the leader's code-reviewer-angle synthesis from direct repo inspection.

## SUMMARY
- Confirmed 3 actionable findings.
- Highest-signal issue: `hasTrustedSameOrigin()` trusts spoofable forwarded headers even when `TRUST_PROXY` is disabled.

## INVENTORY
- Auth/session/origin: `src/app/actions/auth.ts`, `src/lib/request-origin.ts`, `src/lib/rate-limit.ts`
- UI navigation: `src/components/photo-navigation.tsx`, public photo/share routes
- Test/runtime tooling: `playwright.config.ts`, `next.config.ts`, e2e gate output

## FINDINGS

### CR-01 — Forwarded-header trust bypasses the login same-origin guard
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/request-origin.ts:28-41`, `apps/web/src/app/actions/auth.ts:92-95`
- **Why it is a problem:** `getExpectedOrigin()` always prefers `x-forwarded-proto` / `x-forwarded-host` over the actual request host. Unlike `getClientIp()`, this path does **not** require `TRUST_PROXY=true`. A directly exposed app or a proxy that passes user-supplied forwarded headers can therefore be tricked into accepting an attacker-chosen `Origin`.
- **Concrete failure scenario:** An attacker sends a login POST with `Host: gallery.example`, `X-Forwarded-Host: evil.example`, `X-Forwarded-Proto: https`, and `Origin: https://evil.example`. `hasTrustedSameOrigin()` computes `https://evil.example` as the expected origin and incorrectly accepts the request.
- **Suggested fix:** Mirror the `rate-limit.ts` trust model: only honor forwarded host/proto when `TRUST_PROXY === 'true'`; otherwise derive the expected origin from `host`, `origin`, and `referer` only. Add regression tests for spoofed forwarded headers.

### CR-02 — Desktop prev/next buttons stay visually hidden during keyboard focus
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-navigation.tsx:208-233`
- **Why it is a problem:** Desktop navigation buttons switch from `lg:opacity-0` to visible only on `lg:group-hover:opacity-100`. Keyboard focus does not trigger hover, so a keyboard user can tab into an effectively invisible control.
- **Concrete failure scenario:** A desktop keyboard user tabs through the photo viewer. Focus reaches the prev/next buttons, but the buttons remain transparent until the user also happens to move the mouse over the viewer.
- **Suggested fix:** Add a focus-based reveal class such as `lg:group-focus-within:opacity-100` (or equivalent on the button wrapper) so keyboard focus reveals the controls.

### CR-03 — Playwright launches the app in a mode Next.js itself flags as unsupported
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/playwright.config.ts:54-61`, `apps/web/next.config.ts:53`
- **Why it is a problem:** The E2E gate builds with `output: 'standalone'` but still starts the server with `npm run start` / `next start`. The gate output already warns that `next start` does not work with standalone output.
- **Concrete failure scenario:** A future Next.js update may hard-fail this combination, breaking the E2E gate even though the standalone artifact itself is fine. It also means the test path is not exercising the deployment-shaped startup path.
- **Suggested fix:** Start the built app via `.next/standalone/server.js` with `HOSTNAME`/`PORT` environment variables.

## FINAL SWEEP
- Re-checked for overlap with existing tests and docs: no existing request-origin regression covers spoofed forwarded headers; no focus-state class compensates for hidden photo nav buttons; E2E output reproduces the standalone warning today.
