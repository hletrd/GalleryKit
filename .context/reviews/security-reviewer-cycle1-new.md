# security-reviewer — cycle 1 (new)

Scope: OWASP top 10, secrets, unsafe patterns, auth/authz. Cross-checked against `CLAUDE.md` security architecture section.

## Findings

### SEC1-01 — Same-origin proof fails open on auth-sensitive server actions
- **Citation:** `apps/web/src/lib/request-origin.ts:62-87`; callers `apps/web/src/app/actions/auth.ts:93, 274`
- **Severity / confidence:** MEDIUM / HIGH
- **OWASP class:** A07:2021 Identification and Authentication Failures; A05 Security Misconfiguration.
- **Problem:** `hasTrustedSameOrigin` defaults to `allowMissingSource: true`. The two most auth-sensitive server actions (login, password change) rely on the default, so a request with no `Origin`/`Referer` passes the gate. This is the last line of defense before the Argon2 verify and the transactional password update.
- **Fix:** Flip default to fail-closed; keep `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` available for explicit legacy cases. Already tracked in `plan/cycle6-review-fixes.md` C6R-01 but remains unimplemented on current HEAD.
- **Operational note:** The backup download route `apps/web/src/app/api/admin/db/download/route.ts:27` already uses `hasTrustedSameOriginWithOptions({ allowMissingSource: false })` — the fail-closed path is already exercised elsewhere in the codebase, so the flip is safe.

### SEC1-02 — Unauthenticated `/admin` page leaks protected nav/logout affordances
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx:4-22`; `apps/web/src/components/admin-header.tsx:9-30`; `apps/web/src/components/admin-nav.tsx:10-45`
- **Severity / confidence:** LOW / HIGH (information-disclosure only; middleware still protects routes)
- **Problem:** Every admin sub-route path is enumerable from the unauthenticated login page HTML (`/admin/users`, `/admin/db`, `/admin/seo`, etc.). The middleware correctly redirects unauthenticated clients back, but the HTML response discloses the admin surface catalog to anyone who reaches the login page, and renders a logout button that POSTs to `/api/logout` in a confusing state.
- **Fix:** Branch the layout on authenticated state (same fix as CR1-03). The navigation catalog should be rendered only for authenticated admins.

### SEC1-03 — Historical example secrets in git history remain (operationally closed)
- **Citation:** `.context/reviews/security-reviewer-cycle44.md`; `d7c3279:apps/web/.env.local.example`; current warnings in `README.md`, `CLAUDE.md`, `apps/web/.env.local.example`.
- **Severity / confidence:** MEDIUM / HIGH (history), operationally closed.
- **Disposition:** Current HEAD has placeholder-only example files and explicit rotation warnings. Rewriting public git history is outside a normal code-fix cycle. No new action in cycle 1; keep operationally documented.

### SEC1-04 — CSP `'unsafe-inline'` remains in Next config
- **Citation:** `apps/web/next.config.ts:72-75`
- **Severity / confidence:** LOW / HIGH
- **Problem:** Allowing inline scripts weakens CSP. Removing it requires moving current inline/bootstrap behavior to nonce/hash and coordinating with Next.js inline-script patterns.
- **Disposition:** Defer. Already carried forward in `plan/cycle6-review-triage.md` D6-09.

### SEC1-05 — Session token generation and verification
- **Citation:** `apps/web/src/lib/session.ts` (referenced; no change here) and `apps/web/src/app/actions/auth.ts:180-215`
- **Severity / confidence:** LOW / HIGH (observation)
- **Problem:** No current defect. The HMAC-SHA256 signature + `timingSafeEqual` + `INSERT then DELETE existing` pattern inside the transaction is correct and avoids session fixation. Keeping as positive evidence; no action.

### SEC1-06 — CSRF provenance breadth audit (mutation server actions)
- **Citation:** `apps/web/src/app/actions/{images,settings,seo,sharing,tags,topics,admin-users}.ts`; `apps/web/src/app/[locale]/admin/db-actions.ts`
- **Severity / confidence:** MEDIUM / MEDIUM
- **Disposition:** Defer. Already carried forward as D6-07. Cycle 1 should fix the narrow login/password-change provenance gap first.

## Positive findings
- Argon2id + dummy-hash constant-time user-enumeration defense at `apps/web/src/app/actions/auth.ts:63-68, 155-164` is correct.
- Login transaction creates new session before invalidating old ones at `auth.ts:190-202`, avoiding the lost-session race.
- Backup download route uses `hasTrustedSameOriginWithOptions({ allowMissingSource: false })`.
