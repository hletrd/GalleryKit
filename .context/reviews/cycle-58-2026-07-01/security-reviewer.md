# Cycle 58 Security Review

Review target: `51bca78933a702e237853a509ddce10f13f9ed6b`.

Mode: read-only security review. No files were edited by this lane.

## Findings

No confirmed security findings.

Confidence: High for the inspected surfaces below. Prior deferred carry-forward items were not re-raised; no new evidence changed their severity or made them newly schedulable.

## Inspected Surfaces

- Auth/session/token handling: `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-tokens.ts`
- Admin API/authz/origin checks: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`
- Mutating server actions: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- SQL backup/restore/download: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/backup-filename.ts`
- Upload/file path handling: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-filenames.ts`
- Public API rate limits and privacy: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`
- Data privacy projections: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`
- HEAD-specific public photo page path: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- XSS/CSV output hardening: `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/csv-escape.ts`
- SSRF/open redirect/CSP/headers: `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`
- Deploy/script security: `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Focused security/privacy regression run passed: 24 test files, 446 tests.
- `npm audit --workspace=apps/web --audit-level=high --json` reported 0 vulnerabilities.
- Credential-pattern sweep found only expected placeholders/tests/source variable names; tracked secret hygiene tests passed.

Not run in this lane: full build, full test suite, or e2e suite.
