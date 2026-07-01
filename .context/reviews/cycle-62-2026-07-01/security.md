# Cycle 62 Security Review

Reviewer: security-reviewer
Date: 2026-07-01
Scope: auth/session, admin API, server actions, public API, upload/file serving, backup/restore, privacy selects, SSRF/rate-limit surfaces, and deploy hardening.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-61-2026-07-01-plan.md`
- `.context/plans/cycle-61-2026-07-01-deferred.md`
- Latest aggregate: `.context/reviews/cycle-61-2026-07-01/_aggregate.md`

Cycle 61 scheduled `C61-01` through `C61-05` and deferred only broad test-depth gaps (`C61-06`, `C61-07`) plus carry-forward non-security/perf/test items. I did not re-raise those deferred items.

## Inventory

- Auth/session/admin API: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Server actions/admin mutations: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`
- Public API/rate limits: `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/lib/rate-limit.ts`
- Upload/file serving/privacy: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`
- Backup/restore/SQL scanning/secrets: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/deploy.sh`
- Deploy/reverse proxy: `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`

## Findings

No confirmed new security findings.

## Evidence

- Admin API authorization and CSRF: `withAdminAuth` verifies PAT scope before token route execution and enforces same-origin for cookie-backed admin API calls (`apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:83`, `apps/web/src/lib/api-auth.ts:116`, `apps/web/src/lib/api-auth.ts:123`). Admin API success responses also receive no-store/nosniff defaults (`apps/web/src/lib/api-auth.ts:134`).
- Session/auth hardening: production refuses DB-stored session-secret fallback (`apps/web/src/lib/session.ts:30`), tokens are HMAC-verified with constant-time comparison (`apps/web/src/lib/session.ts:107`, `apps/web/src/lib/session.ts:117`), login requires same-origin before rate-limited Argon2 work (`apps/web/src/app/actions/auth.ts:99`), and successful login rotates existing sessions in a transaction (`apps/web/src/app/actions/auth.ts:218`).
- Server-action CSRF contract: mutating actions are covered by `requireSameOriginAdmin`; the gate passed and listed all protected exports. The shared origin helper fails closed by default when Origin/Referer is absent (`apps/web/src/lib/request-origin.ts:87`).
- Cycle 61 restore-route fixes are present: OG routes now short-circuit restore maintenance before rate-limit/DB/image work (`apps/web/src/app/api/og/route.tsx:64`, `apps/web/src/app/api/og/photo/[id]/route.tsx:46`), and LR upload re-checks restore maintenance plus acquires the upload-processing contract lock before topic lookup (`apps/web/src/app/api/admin/lr/upload/route.ts:257`, `apps/web/src/app/api/admin/lr/upload/route.ts:272`, `apps/web/src/app/api/admin/lr/upload/route.ts:287`).
- Backup/restore: backup filenames are generated server-side, backup download validates filename plus realpath containment and streams from the already-opened descriptor (`apps/web/src/app/api/admin/db/download/route.ts:24`, `apps/web/src/app/api/admin/db/download/route.ts:51`, `apps/web/src/app/api/admin/db/download/route.ts:58`, `apps/web/src/app/api/admin/db/download/route.ts:77`). Restore holds DB/upload/backfill locks before durable maintenance (`apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`), validates dump size/header and scans SQL before invoking `mysql --one-database` (`apps/web/src/app/[locale]/admin/db-actions.ts:577`, `apps/web/src/app/[locale]/admin/db-actions.ts:614`, `apps/web/src/app/[locale]/admin/db-actions.ts:637`, `apps/web/src/app/[locale]/admin/db-actions.ts:674`).
- Path traversal/file serving: derivative serving allowlists top-level directories/extensions, validates every segment, rejects symlinks, and enforces realpath containment (`apps/web/src/lib/serve-upload.ts:136`, `apps/web/src/lib/serve-upload.ts:146`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:185`). Original uploads are stored under private `data/uploads/original` and created `0700` (`apps/web/src/lib/upload-paths.ts:28`, `apps/web/src/lib/upload-paths.ts:49`).
- SSRF/open redirect: per-photo OG internal fetch pins to trusted `BASE_URL` origin and fails closed instead of using request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:117`, `apps/web/src/app/api/og/photo/[id]/route.tsx:124`); fallback redirect is constrained to canonical same-origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:275`, `apps/web/src/app/api/og/photo/[id]/route.tsx:281`).
- Public API rate limits: OG and semantic/similar endpoints call pre-increment limiters before protected DB/CPU work (`apps/web/src/app/api/og/route.tsx:90`, `apps/web/src/app/api/og/photo/[id]/route.tsx:56`, `apps/web/src/app/api/search/semantic/route.ts:178`, `apps/web/src/app/api/search/similar/[id]/route.ts:102`). The public-route rate-limit lint gate passed.
- Privacy: public image selects are derived from admin selects by explicit omission of sensitive fields and compile-time guarded (`apps/web/src/lib/data.ts:376`, `apps/web/src/lib/data.ts:406`, `apps/web/src/lib/data.ts:473`, `apps/web/src/lib/data.ts:476`). Semantic/similar enrichment uses a shared privacy-guarded select (`apps/web/src/lib/search-enrichment-fields.ts:29`, `apps/web/src/lib/search-enrichment-fields.ts:43`).
- Secrets/deploy hardening: local ignored env file is currently `0600`; deploy refuses group/world-readable runtime env files (`apps/web/deploy.sh:28`, `apps/web/deploy.sh:39`). Compose binds the web server to localhost with `TRUST_PROXY=true` (`apps/web/docker-compose.yml:21`, `apps/web/docker-compose.yml:22`). Nginx overwrites forwarded client headers and denies `/uploads/original/` (`apps/web/nginx/default.conf:67`, `apps/web/nginx/default.conf:70`, `apps/web/nginx/default.conf:165`).
- Dependency check: `npm audit --workspace=apps/web --audit-level=moderate` returned `found 0 vulnerabilities`.

## Residual Risks

- The shipped topology remains a single web instance. In-memory fast-path rate-limit buckets and restore-maintenance process state weaken under horizontal scale, as documented in `CLAUDE.md`; this is an architectural constraint, not a new Cycle 62 defect.
- DB backups are plaintext at rest under `data/backups`; this remains an operator/host-encryption boundary documented in the project security model.
- Cycle 61 deferred test-depth items remain deferred: shared-group view-count behavioral coverage and LR upload handler-level coverage.

## Validation

- `npm run lint:api-auth --workspace=apps/web` - pass.
- `npm run lint:action-origin --workspace=apps/web` - pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - pass.
- `npm audit --workspace=apps/web --audit-level=moderate` - pass, 0 vulnerabilities.
