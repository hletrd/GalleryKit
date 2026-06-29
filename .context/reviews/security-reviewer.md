# Security Reviewer - cycle 5/100

Role: `security-reviewer`
HEAD reviewed: `79c698eb`
Date: 2026-06-29
Scope: current HEAD in `/Users/hletrd/flash-shared/gallery`; report-only pass. No source code edited.

## Inventory

Read first:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/security-review/SKILL.md`

Security-relevant files inventoried and reviewed:
- API routes: `apps/web/src/app/api/**/route.{ts,tsx}` including admin DB download, Lightroom upload, health/live, OG, semantic search, and similar search.
- Server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/session/token/origin/rate-limit: `apps/web/src/lib/api-auth.ts`, `session.ts`, `admin-tokens.ts`, `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `action-guards.ts`.
- Upload/path/file surfaces: `upload-paths.ts`, `upload-filenames.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `storage/local.ts`, Lightroom upload route.
- Backup/restore: `db-actions.ts`, `api/admin/db/download/route.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `backup-filename.ts`, `download-filename.ts`, `mysql-cli-ssl.ts`.
- Public/admin data boundaries: `data.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, public pages, share pages, feed/JSON-LD emitters, OG routes.
- Input/output safety: `sanitize.ts`, `validation.ts`, `safe-json-ld.ts`, `og-sanitize.ts`, `csv-escape.ts`, `seo-og-url.ts`, `content-security-policy.ts`.
- Deployment/config: `apps/web/next.config.ts`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `.dockerignore`, package manifests.

Review categories covered: OWASP Top 10, secrets, auth/authz, CSRF/origin, rate limits, file upload/path traversal/symlink handling, SQL injection/raw SQL, SSRF, XSS/JSON-LD/XML output, backup/restore safety, session/token handling, public/admin data boundaries, and destructive operational paths.

## Findings

No confirmed Critical, High, Medium, or Low vulnerabilities were found in current HEAD under the documented single-web-instance deployment.

Finding count: 0 Critical, 0 High, 0 Medium, 0 Low.

## Residual Risk

### RR-C5-01 - Process-local security state would be unsafe if the app were horizontally scaled

Severity: Medium if scaled out; not a current-topology vulnerability
Confidence: High
Status: risk, not confirmed exploit in documented deployment
OWASP: A04 Insecure Design, A05 Security Misconfiguration

File/region:
- `apps/web/src/lib/restore-maintenance.ts` stores restore-maintenance state in process memory.
- `apps/web/src/lib/upload-tracker-state.ts` stores active upload claims and cumulative upload windows in process-local maps.
- `apps/web/src/lib/rate-limit.ts` keeps several public limiter buckets in process-local bounded maps.
- `apps/web/docker-compose.yml:14-21` ships a single loopback-bound web service, matching `CLAUDE.md`'s single-instance topology.

Failure scenario:
If an operator adds multiple web replicas behind a load balancer without changing these controls, a restore or upload quota state on replica A is invisible to replica B. An authenticated upload could land on B during A's restore window, and unauthenticated public route budgets could be multiplied by spraying requests across replicas.

Concrete fix:
Keep the single-instance topology as a hard deploy invariant, or move restore maintenance, upload-claim accounting, and public limiter state into shared DB/Redis-backed leases/buckets before scale-out. Add a startup/deploy guard if replica count can become greater than one.

## Evidence Highlights

- Admin API boundary: `withAdminAuth` enforces token scope for PAT routes and same-origin plus `isAdmin()` for cookie-auth admin APIs (`apps/web/src/lib/api-auth.ts:68-130`).
- Sessions: production refuses DB-stored signing secret fallback, tokens are HMAC-signed, timing-safe verified, DB-hashed, age-limited, and expired sessions are deleted (`apps/web/src/lib/session.ts:16-150`).
- Login: same-origin check, IP plus account-scoped pre-increment rate limits, Argon2 dummy-hash timing equalization, session rotation, and secure cookie attributes are present (`apps/web/src/app/actions/auth.ts:70-240`).
- Browser uploads: admin auth plus origin check, filename sanitization, count/byte limits, atomic preclaim, disk-space failure close, topic existence check, HDR/GPS policy, blur-data URL assertion, cleanup, and queue handoff are present (`apps/web/src/app/actions/images.ts:110-560`).
- Lightroom upload: `withAdminAuth({ allowTokenScope: 'lr:upload' })`, content-length requirement, quota tracking, sanitized metadata, topic validation, upload contract lock, disk check, GPS/HDR parity, cleanup, and audit logging are present (`apps/web/src/app/api/admin/lr/upload/route.ts:55-430`).
- Upload serving: allowed top-level dirs, extension matching, safe segment regex, `lstat` symlink rejection, `realpath` containment, resolved-path streaming, no SVG serving, and `nosniff` are present (`apps/web/src/lib/serve-upload.ts:127-309`).
- Backup: admin and same-origin gated, owner-only backup dir/file modes, credentials via env instead of CLI args, sanitized stderr, non-empty output check, and authenticated download URL are present (`apps/web/src/app/[locale]/admin/db-actions.ts:120-257`).
- Restore: admin and same-origin gated, advisory restore lock, upload contract lock, maintenance window, temp file mode `0600`, size/header validation, dangerous SQL scan, `mysql --one-database`, sanitized stderr, and temp cleanup are present (`apps/web/src/app/[locale]/admin/db-actions.ts:266-520`; scanner at `apps/web/src/lib/sql-restore-scan.ts:1-168`).
- Backup download: `withAdminAuth`, backup filename allowlist, path containment, symlink rejection, realpath containment, resolved-path streaming, audit logging, `no-store`, and `nosniff` are present (`apps/web/src/app/api/admin/db/download/route.ts:22-101`).
- Public semantic/similar search: same-origin gate, maintenance gate, body/type/size limits, rate-limit preincrement, bounded scan, model-version filtering, no-store responses, and shared privacy-guarded enrichment are present (`apps/web/src/app/api/search/semantic/route.ts:100-300`; `apps/web/src/app/api/search/similar/[id]/route.ts:60-237`).
- Public/admin field boundary: public select shapes explicitly omit sensitive admin fields, and compile-time privacy guards check both standard public and map-visible projections (`apps/web/src/lib/data.ts:250-482`).
- XSS/JSON-LD: all `dangerouslySetInnerHTML` hits reviewed are JSON-LD script emitters using `safeJsonLd`, which escapes `<` (`apps/web/src/lib/safe-json-ld.ts:14-16`).
- Headers/CSP: global `nosniff`, `SAMEORIGIN`, referrer policy, permissions policy, HSTS in production, and CSP construction are present (`apps/web/next.config.ts:55-109`; `apps/web/src/lib/content-security-policy.ts`).

## Automated Validation

Passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=moderate` - 0 vulnerabilities
- `npm test --workspace=apps/web -- --run src/__tests__/api-auth-response-headers.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts` - 4 files / 72 tests
- `npm test --workspace=apps/web -- --run src/__tests__/session.test.ts src/__tests__/session-verify.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/auth-rate-limit-ordering.test.ts src/__tests__/password-hashing-policy.test.ts src/__tests__/admin-tokens.test.ts` - 6 files / 82 tests
- `npm test --workspace=apps/web -- --run src/__tests__/backup-download-route.test.ts src/__tests__/backup-filename.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/request-origin.test.ts` - 6 files / 44 tests
- `npm test --workspace=apps/web -- --run src/__tests__/upload-paths.test.ts src/__tests__/upload-filenames.test.ts src/__tests__/serve-upload.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/search-route-privacy.test.ts` - 6 files / 52 tests

## Final Missed-Issues Sweep

- Route inventory: every `apps/web/src/app/api/**/route.{ts,tsx}` checked for auth, origin, rate-limit posture, runtime constraints, and response cache headers.
- Action inventory: every mutating server action checked by source review and by `lint:action-origin`.
- Raw SQL/process sweep: `db.execute`, `tx.execute`, `conn.query`, `spawn`, `mysqldump`, `mysql`, file streams, and restore scanner paths reviewed for parameterization, secret exposure, and cleanup.
- XSS sweep: `dangerouslySetInnerHTML`, JSON-LD, feeds, OG rendering, and admin-controlled string validation reviewed.
- Path traversal sweep: upload serving, backup download, local storage, topic images, original upload paths, and cleanup paths reviewed for filename/path validation, `realpath`, `lstat`, and symlink handling.
- SSRF/open redirect sweep: OG photo fetch/fallback, SEO OG URL validation, image base URL parsing, and request-origin handling reviewed.
- Secrets sweep: tracked source/docs/examples contain placeholders or operational notes only; no live usable credential was found in HEAD.

Conclusion: current HEAD presents a strong security posture for the documented single-instance deployment. No code change is recommended from this cycle.
