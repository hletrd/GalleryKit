# Cycle 68 Security Review

Reviewer: Cycle 68 security reviewer
Date: 2026-07-01
HEAD reviewed: `e221b01a` (`fix(cycle-67): 🐛 align backfill warnings and controls`)

## Scope

Deep review for auth/authz, public/admin API exposure, CSRF/origin/rate-limit invariants, file upload/path traversal, secrets handling, SQL/raw query risk, SSRF/open redirect, privacy/PII leakage, and deploy/security drift.

Required context read:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/reviews/cycle-67-2026-07-01/_aggregate.md`
- Current relevant source and targeted tests listed below

Cycle-67 aggregate context: the prior aggregate scheduled six non-security findings and explicitly recorded that no new security finding was confirmed (`.context/reviews/cycle-67-2026-07-01/_aggregate.md:71-92`). I did not re-raise deferred/carry-forward operational history such as historical git secrets because HEAD remains covered by current docs/tests and no new evidence changes severity or scheduling.

## Inventory

Route inventory reviewed:

- Admin API: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public API: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Public file/feed routes: `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, root and localized `feed.xml` routes
- Server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Auth/session/rate-limit helpers: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/admin-tokens.ts`
- Storage/upload/privacy/SQL/deploy surfaces: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, migration/deploy scripts

## Findings

No confirmed Cycle 68 security findings.

## Evidence

- Admin API exposure is covered centrally: `withAdminAuth` accepts scoped PATs only when configured, rate-limits token auth before DB verification, enforces token scope, adds no-store/nosniff headers, and cookie-session admin API calls require trusted same-origin before `isAdmin()` (`apps/web/src/lib/api-auth.ts:58-144`). The lint gate reported both admin API route files OK.
- Public semantic/similar endpoints require same-origin, reject oversized/unsupported bodies or invalid IDs before expensive work, and pre-increment the semantic rate limiter before DB-backed mode/embedding work (`apps/web/src/app/api/search/semantic/route.ts:107-184`, `apps/web/src/app/api/search/similar/[id]/route.ts:68-126`).
- Public OG endpoints are rate-limited before DB/CPU work and keep post-DB failures charged to avoid free enumeration/CPU probes (`apps/web/src/app/api/og/route.tsx:62-111`, `apps/web/src/app/api/og/photo/[id]/route.tsx:53-83`). The per-photo route pins internal derivative fetches and fallback redirects to canonical origin rather than request host (`apps/web/src/app/api/og/photo/[id]/route.tsx:105-125`, `apps/web/src/app/api/og/photo/[id]/route.tsx:257-303`).
- Upload/original/file-serving path traversal controls are present: originals use private `0700` directory creation, safe basename/filename checks, `realpath` containment, and symlink rejection (`apps/web/src/lib/upload-paths.ts:49-171`). Public derivative serving allowlists top-level directories/extensions, validates every segment, rejects symlinks, checks `realpath` containment, and streams from the validated file descriptor (`apps/web/src/lib/serve-upload.ts:126-202`).
- Backup download is admin-auth wrapped, backup filename allowlisted, path-contained with `path.resolve` plus `realpath`, no-store/nosniff, and streams from the already validated file handle (`apps/web/src/app/api/admin/db/download/route.ts:21-90`).
- DB backup/restore use same-origin admin checks, advisory locks, owner-only backup/temp file modes, env-based MySQL credentials rather than CLI password flags, restore header validation, chunked dangerous-SQL scanning, and `--one-database` (`apps/web/src/app/[locale]/admin/db-actions.ts:164-228`, `apps/web/src/app/[locale]/admin/db-actions.ts:365-430`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-730`).
- Public privacy selectors omit sensitive fields and carry compile-time guards; map latitude/longitude is isolated to its dedicated visible-map path; semantic/similar enrichment uses its own guarded select (`apps/web/src/lib/data.ts:368-489`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Upload actions and PAT upload reject unsafe user filenames, validate topic/tag/admin strings, preclaim upload quota before awaited work, reject HDR/GPS-strip failures according to settings, and persist originals mode `0600` (`apps/web/src/app/actions/images.ts:128-180`, `apps/web/src/app/actions/images.ts:189-313`, `apps/web/src/app/actions/images.ts:370-480`, `apps/web/src/lib/process-image.ts:887-931`, `apps/web/src/lib/process-image.ts:1737-1818`).
- Admin credential and token management paths require same-origin admin context, validate inputs before expensive work, use Argon2id parameters, avoid deleting the last admin, hash PATs, verify tokens by hash/scope/expiry, and never return raw DB errors to the client (`apps/web/src/app/actions/admin-users.ts:77-184`, `apps/web/src/app/actions/admin-users.ts:186-280`, `apps/web/src/app/actions/lr-tokens.ts:28-140`, `apps/web/src/lib/admin-tokens.ts:52-168`).

## Validation

Passed:

```text
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm test --workspace=apps/web -- --run src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/upload-paths.test.ts src/__tests__/serve-upload.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/db-restore.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/request-origin.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/semantic-search-rate-limit.test.ts src/__tests__/og-rate-limit.test.ts src/__tests__/sql-restore-scan.test.ts
npm audit --workspace=apps/web --audit-level=moderate
```

Results: 14 targeted test files passed, 323 tests passed; `npm audit` found 0 vulnerabilities.

## Residual Risk

- Review was static plus targeted tests/lint/audit; I did not run the full unit suite, full build/typecheck, e2e tests, or a live deploy.
- Some rate-limit buckets remain process-local by documented design; that is a known topology constraint, not a new Cycle 68 finding.
- Historical secret exposure remains an operational carry-forward documented in plan history and `CLAUDE.md`; HEAD grep/test evidence did not find new committed secret assignments.
