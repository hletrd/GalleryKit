# Cycle 66 Security Review

## Inventory

- Reviewed HEAD `d3e18c6f6f8db7f064a612a045a2033c1660ca95`.
- Covered auth/session/PAT, admin APIs/actions, public API rate limits, SSRF/path traversal, privacy selectors, backup/restore, deploy scripts, and nginx config.

## Findings

No new security findings.

## Non-Findings

- Admin API exports remain wrapped by `withAdminAuth`.
- Mutating server actions gate on `requireSameOriginAdmin()` or the stricter auth-origin path.
- Public expensive routes are rate-limited before shared DB/CPU-heavy work.
- Per-photo OG fetches are pinned to canonical origin, not attacker-controlled request host.
- Upload and backup file serving keep filename/path validation, symlink rejection, and containment checks.
- Public image selectors omit admin-only/privacy fields; search enrichment uses the shared privacy guard.
- Deploy scripts check env-file permissions and prune Docker only after a healthy `up -d`.

## Validation

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-filename.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/nginx-config.test.ts` - pass.
- `npm audit --workspace=apps/web --audit-level=high` - pass, 0 vulnerabilities.

## Final Sweep

No files modified by the reviewer. No live deploy or remote DB inspected.
