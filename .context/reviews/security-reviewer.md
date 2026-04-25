# Security Review Report — Cycle 6

Scope reviewed: root docs/config, env examples and ignored live env files, nginx, deploy/init/migration scripts, DB/schema/auth/session/origin/rate-limit helpers, upload/storage/restore/backup code, API routes, server actions, public/admin routes, and security-relevant tests.

## Findings

### SEC6-01 — Password change does not revoke the active session
- **Location:** `apps/web/src/app/actions/auth.ts:363-381`
- **Severity/confidence:** High / High
- **Status:** Confirmed.
- **Problem:** `updatePassword()` deletes sessions for the current user except the current session, so a stolen current `admin_session` survives password rotation.
- **Failure scenario:** An attacker with the active cookie retains admin access after the victim changes password.
- **Suggested fix:** Invalidate all sessions for the user on password change and mint a new session/cookie for the current browser after commit.

### SEC6-02 — Live plaintext secrets are stored inside the shared repo checkout
- **Location:** ignored local files `apps/web/.env.local:4-10`, `.env.deploy:2-5`
- **Severity/confidence:** High / High
- **Status:** Confirmed in the working tree, not tracked.
- **Problem:** Live-looking DB/admin/session/deploy secrets reside under the repo path even though ignored by git.
- **Failure scenario:** Local backup/support bundle/screen-share/workstation compromise exposes credentials or session signing material.
- **Suggested fix:** Move live secrets outside the repo checkout, rotate sensitive values, and load from external env injection or secret manager.

### SEC6-03 — Historical committed secrets/default credentials remain in git history
- **Location:** historical git entries for `apps/web/.env.local.example`
- **Severity/confidence:** Medium / High
- **Status:** Manual-validation risk.
- **Problem:** Git history contains old default credential material such as `DB_PASSWORD=password`, `ADMIN_PASSWORD=password`, and a hardcoded `SESSION_SECRET`.
- **Failure scenario:** Any environment seeded from historical examples remains compromised.
- **Suggested fix:** Treat historical values as compromised, rotate reused values, and consider history rewrite only through an explicit security process.

### SEC6-04 — Dependency audit reports a transitive PostCSS XSS advisory
- **Location:** `package-lock.json` dependency graph (`next` -> nested `postcss`, `next-intl`)
- **Severity/confidence:** Low / Medium
- **Status:** Likely supply-chain issue; no app-path exploit found.
- **Problem:** `npm audit --omit=dev` reports `GHSA-qx2v-qp2m-jg93` for nested `postcss <8.5.10`.
- **Failure scenario:** Reachable if attacker-controlled CSS is stringified through the vulnerable path; no obvious path found.
- **Suggested fix:** Upgrade when Next.js ships a compatible patched dependency set; do not downgrade the app to the audit-suggested incompatible version.
