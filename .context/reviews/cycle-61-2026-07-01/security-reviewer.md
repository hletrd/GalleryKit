# Cycle 61 Security Review

Reviewed auth/session/origin guards, admin token APIs, public rate-limited routes, upload/file handling, backup/restore, privacy selectors, CSP/OG sanitizers, deploy scripts, and local secret-file posture at HEAD `7e85644e`.

## Findings

### C61-05 - Local runtime env file is group/world-readable

- Severity: Medium
- Confidence: High
- File/line: `apps/web/.env.local` local metadata, `apps/web/deploy.sh:15`, `apps/web/deploy.sh:39`, `apps/web/deploy.sh:40`, `apps/web/deploy.sh:41`, `apps/web/deploy.sh:42`
- Problem: `stat` reported `apps/web/.env.local` as `-rw-r--r--`. The runtime env file is gitignored, but deploy policy requires owner-only permissions before Docker Compose consumes it.
- Failure scenario: another local user on a shared/synced host can read DB credentials, `SESSION_SECRET`, or operator flags; deploy would also abort on unsafe mode.
- Fix: tighten local file mode to `0600`. Rotate contained secrets if the checkout is shared or backed up in a broader trust domain.

No new source-level auth/authz, CSRF/origin, public API abuse, SSRF, path traversal, SQL injection, XSS, or committed privacy-selector issue was confirmed.

## Validation Notes

Security lane reported `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, focused security tests, and `npm audit --workspace=apps/web --omit=dev --json` passing with 0 vulnerabilities.
