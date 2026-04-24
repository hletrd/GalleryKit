# Security Review Report — Cycle 1

**Recovered from read-only subagent output.**

## Inventory
Reviewed admin/server actions, API routes, auth/session code, uploads/storage, DB backup/restore, config/deployment scripts, env examples, security-focused tests, and dependency audit output.

## Verification evidence
- `npm audit --omit=dev --json`: 0 production vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- Security-focused Vitest subset: 10 files / 98 tests passed.

## Findings

### SEC-001 — Plaintext live secrets are present in workspace env files
- **Type:** Confirmed workspace issue
- **Severity:** High
- **Confidence:** High
- **Files/regions:** `apps/web/.env.local:2-9` (gitignored/untracked), `.env.deploy` (gitignored/untracked)
- **Problem:** Local workspace files contain live plaintext DB/admin/session/deploy values. They are not tracked, but they are directly usable if the workstation, backup, or support bundle leaks.
- **Concrete failure scenario:** An attacker obtains `apps/web/.env.local`, signs valid admin cookies with `SESSION_SECRET`, logs in with `ADMIN_PASSWORD`, or accesses DB credentials.
- **Suggested fix:** Rotate all values, keep only placeholders in examples, store live secrets in deployment/secret-manager systems, and consider pre-commit/CI secret scanning.

### SEC-002 — Production CSP permits inline scripts/styles
- **Type:** Likely risk
- **Severity:** Medium
- **Confidence:** Medium
- **Files/regions:** `apps/web/next.config.ts:73-76`, `apps/web/next.config.ts:95`
- **Problem:** CSP includes `script-src 'unsafe-inline'` and `style-src 'unsafe-inline'`, reducing XSS containment.
- **Concrete failure scenario:** A future injection bug can execute inline payloads despite CSP.
- **Suggested fix:** Move toward nonce/hash-based CSP and remove unsafe-inline where possible.

## Non-findings
No confirmed auth wrapper, same-origin, upload traversal, SQL injection, command injection, public privacy-field leak, or production dependency vulnerability was found.
