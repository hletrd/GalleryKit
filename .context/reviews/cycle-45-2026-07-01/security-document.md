# Cycle 45 Security + Documentation Review

Reviewer specialties: security-reviewer + document-specialist.
Date: 2026-07-01.
Scope: auth/authz, CSRF/origin, public rate limits, SSRF, path traversal, secrets, dangerous scripts, deployment/docs drift, and security-critical documentation mismatches.

## Prior Context Read

- `AGENTS.md`
- `CLAUDE.md`
- Latest aggregate pointer: `.context/reviews/_aggregate.md`
- Latest aggregate body: `.context/reviews/cycle-44-2026-07-01/_aggregate.md`
- Cycle 44 plan: `.context/plans/cycle-44-2026-07-01-plan.md`
- Cycle 44 deferred: `.context/plans/cycle-44-2026-07-01-deferred.md`
- Historical baseline aggregate used to avoid stale carry-forward repeats: `.context/reviews/run9-cycle8/_aggregate.md`

Cycle 44 scheduled scanner hardening and CLIP activation doc fixes only; no new Cycle 44 deferrals. I did not re-raise carry-forward deferred items (`PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, `AGG-C38-08`) because I found no new evidence changing severity or scheduling.

## Inventory

Relevant files inventoried and spot-read:

- Auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`
- Admin APIs: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Public APIs and public actions: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/actions/public.ts`
- Path/file/restore surfaces: `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`
- Token/rate-limit/scanner gates: `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`
- Dangerous scripts/deploy/docs: `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `CLAUDE.md`, `apps/web/README.md`

## Findings

No new security or security-documentation issue found.

Inspected surface and evidence:

- Admin API auth/authz: both admin API route files are exported through `withAdminAuth(...)`; the wrapper verifies PAT scope before LR upload and otherwise enforces same-origin before cookie admin auth (`apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:116`, `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/db/download/route.ts:21`).
- CSRF/origin: mutating server actions use `requireSameOriginAdmin()` before auth reads/mutations, while auth actions use the dedicated `hasTrustedSameOrigin` path (`apps/web/src/lib/action-guards.ts:37`, `apps/web/src/lib/request-origin.ts:83`, `apps/web/src/app/actions/auth.ts:100`).
- Public rate limits: semantic and similar routes enforce same-origin plus rate-limit before DB/embedding work; OG routes rate-limit before CPU/DB generation (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:178`, `apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:102`, `apps/web/src/app/api/og/photo/[id]/route.tsx:48`, `apps/web/src/app/api/og/route.tsx:82`).
- SSRF: per-photo OG internal derivative fetch is pinned to trusted canonical `BASE_URL` and fails closed instead of using request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:98`, `apps/web/src/app/api/og/photo/[id]/route.tsx:111`).
- Path traversal: upload serving validates top-level directory, extension, path segments, symlinks, and realpath containment before opening a descriptor (`apps/web/src/lib/serve-upload.ts:136`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:185`).
- Backup/restore: backup filenames and realpaths are checked before streaming; restore validates SQL dump headers, scans chunks for dangerous SQL, uses fixed `spawn` argv, `MYSQL_PWD`, stderr sanitization, and restore/backfill/upload advisory locks (`apps/web/src/app/api/admin/db/download/route.ts:23`, `apps/web/src/app/api/admin/db/download/route.ts:51`, `apps/web/src/app/[locale]/admin/db-actions.ts:221`, `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:637`, `apps/web/src/app/[locale]/admin/db-actions.ts:674`).
- Secrets: tracked-source grep for direct assignments to `ADMIN_PASSWORD`, `SESSION_SECRET`, `DB_PASSWORD`, `MYSQL_PWD`, `DATABASE_URL`, `GALLERYKIT_TOKEN`, `CLOUDFLARE_API_TOKEN`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` returned no hits.
- Deployment/docs drift: Cycle 44 CLIP activation docs now explicitly require applying `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` to the live container before flipping the DB mode (`CLAUDE.md:551`, `CLAUDE.md:554`, `apps/web/README.md:78`, `apps/web/README.md:79`). Nginx LR upload body cap docs match the dedicated location (`CLAUDE.md:590`, `apps/web/nginx/default.conf:133`).

## Validation

- `npm run lint:api-auth --workspace=apps/web` passed: 2 admin routes OK.
- `npm run lint:action-origin --workspace=apps/web` passed: all mutating server actions enforce same-origin provenance; public analytics actions recognized as rate-limited.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed: 10 public route files OK.

No source or plan files were edited.
