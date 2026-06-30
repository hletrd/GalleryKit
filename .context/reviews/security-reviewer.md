# Security Reviewer - Cycle 21

Date: 2026-06-30
HEAD reviewed: `2cc619bb`
Scope: whole current HEAD security/privacy review for OWASP issues, auth/authz, CSRF/same-origin, rate limits, SSRF, path traversal, upload safety, secrets, SQL/raw command safety, privacy/data leaks, backup/restore, and deployment script risks. This pass validated implementation code, not comments alone, and did not edit runtime code.

## Inventory

Repository and policy context:
- `AGENTS.md`
- `CLAUDE.md`
- `.gitignore`
- `.env.deploy.example`
- `.context/reviews/security-reviewer.md`

Auth, sessions, admin APIs, and CSRF:
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- all files under `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- all route handlers under `apps/web/src/app/api/**/route.ts(x)`

Uploads, file access, SSRF-adjacent fetches, and storage:
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/seo-og-url.ts`

Public routes, public actions, rate limits, privacy, and data exposure:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/next.config.ts`

Backup, restore, migrations, and deployment:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/.env.local.example`

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed; admin API route exports are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating server actions return early on `requireSameOriginAdmin()` or carry a read-only/public exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating route scan found no missing pre-increment helper.
- `npm audit --workspace=apps/web --omit=dev --json`: passed; 0 production vulnerabilities.
- `npm test --workspace=apps/web -- tracked-secrets privacy-fields rate-limit request-origin nginx-config og-route-source-contracts og-photo-fallback load-more-rate-limit semantic-search-route similar-route backup-download-route`: passed; 20 files, 219 tests.
- Source sweeps covered secrets, raw SQL/command execution, `dangerouslySetInnerHTML`, dynamic code execution, `fetch`/URL/redirect surfaces, path traversal helpers, file streaming, forwarded-header trust, rollback/rate-limit helpers, and deployment scripts.

## Findings

No confirmed findings.

Finding count: 0

## Prior Cycle Revalidation

- Prior SEC-01 is fixed in code: `apps/web/src/app/actions/public.ts:197-211` now keeps the post-lookup smart-collection load-more charge for missing/private collections, and only the thrown-error catch at `apps/web/src/app/actions/public.ts:228-231` rolls back the limiter.
- Prior SEC-02 is fixed in code: `apps/web/src/app/api/og/route.tsx:36-58` bounds `tags` parsing with `MAX_OG_TAG_SOURCE_LENGTH`, stops after `MAX_OG_TAGS`, and avoids unbounded `split()` allocation before the display cap.
- Prior SEC-03 is fixed in the nginx template: `apps/web/nginx/default.conf:67-70`, `84-87`, `101-104`, `117-120`, `141-144`, `158-161`, `180-183`, and `192-196` overwrite `X-Forwarded-For` with `$remote_addr` instead of appending user-supplied chains.
- Prior SEC-RISK-01 is fixed in code: `apps/web/src/app/api/admin/db/download/route.ts:43-57` realpath-validates the backup path and opens the validated file, `apps/web/src/app/api/admin/db/download/route.ts:57-64` verifies the descriptor metadata, and `apps/web/src/app/api/admin/db/download/route.ts:72-75` streams from `fileHandle.createReadStream()`.

## Positive Security Evidence / Non-Findings

- Admin API authorization is centralized in `apps/web/src/lib/api-auth.ts:58-144`: token requests are scoped and rate-limited before handler execution, cookie requests require same-origin at `apps/web/src/lib/api-auth.ts:114-121`, and successful admin responses receive no-store/nosniff defaults at `apps/web/src/lib/api-auth.ts:130-142`.
- Same-origin enforcement fails closed by default in `apps/web/src/lib/request-origin.ts:79-107`; expected origin construction uses only trusted forwarded headers when proxy trust is enabled at `apps/web/src/lib/request-origin.ts:45-68`.
- Client IP extraction avoids trusting spoofable proxy headers unless `TRUST_PROXY=true`, validates `X-Forwarded-For` parts, and selects the client before the trusted proxy suffix in `apps/web/src/lib/rate-limit.ts:164-195`.
- Session handling in `apps/web/src/lib/session.ts:16-36` and `apps/web/src/lib/session.ts:82-150` uses a production-strength `SESSION_SECRET`, HMAC session tokens, timing-safe comparison, DB-stored token hashes, and expiry cleanup.
- Browser upload handling in `apps/web/src/app/actions/images.ts:114-260` requires same-origin admin auth, rejects dirty topic/tag input, enforces file count/byte limits, sanitizes filenames, pre-claims cumulative upload quota before awaited work, and checks disk space before accepting data.
- Lightroom upload handling in `apps/web/src/app/api/admin/lr/upload/route.ts:68-186` is behind `withAdminAuth`, requires PAT scope through the wrapper, rejects chunked uploads, requires safe `Content-Length`, enforces cumulative quota, and sanitizes user filenames. It then verifies topic existence and locks the upload-processing contract at `apps/web/src/app/api/admin/lr/upload/route.ts:225-259`, and handles GPS stripping / HDR policy / late restore maintenance before insert at `apps/web/src/app/api/admin/lr/upload/route.ts:348-452`.
- Public health endpoints in `apps/web/src/app/api/health/route.ts:7-42` and `apps/web/src/app/api/live/route.ts:3-10` return only generic status with no-store/nosniff headers; optional DB health only exposes `ok`/`unavailable`.
- Public OG topic rendering validates topic slug and rate-limits before expensive rendering at `apps/web/src/app/api/og/route.tsx:61-90`, keeps nonexistent-topic probes charged after DB work at `apps/web/src/app/api/og/route.tsx:92-103`, and sanitizes rendered labels/tags at `apps/web/src/app/api/og/route.tsx:105-117`.
- Backup creation in `apps/web/src/app/[locale]/admin/db-actions.ts:162-226` requires same-origin admin auth, owner-only backup directory creation, TLS argument validation, DB restore advisory locking, and env-based MySQL credentials rather than CLI password flags. Backup integrity is checked before success at `apps/web/src/app/[locale]/admin/db-actions.ts:257-333`.
- Restore import in `apps/web/src/app/[locale]/admin/db-actions.ts:516-595` enforces file size, temp file mode `0600`, plausible dump header checks, and chunked dangerous-SQL scanning before invoking `mysql`; the child process path at `apps/web/src/app/[locale]/admin/db-actions.ts:597-702` uses `--one-database`, TLS args, env-based credentials, watchdogs, stderr redaction, and temp cleanup.
- Post-restore migration execution uses `process.execPath` with a resolved local migration script and redacts configured DB values from stderr at `apps/web/src/app/[locale]/admin/db-actions.ts:727-767`.
- Public field selection omits sensitive/admin-only fields in `apps/web/src/lib/data.ts:368-408`; GPS-bearing public map selection is separated and guarded at `apps/web/src/lib/data.ts:410-489`.
- JSON-LD sinks reviewed are routed through `safeJsonLd`; the escaping helper is in `apps/web/src/lib/safe-json-ld.ts:14-19`.
- Deployment cleanup in `apps/web/deploy.sh:55-58` prunes only after `docker compose up -d`; `docker volume prune -f` is non-`-a`, matching bind-mounted persistence assumptions. Remote deployment command execution in `scripts/deploy-remote.sh:31-72` is intentionally controlled by the gitignored operator deploy env file and quotes the default `DEPLOY_PATH` with `%q`.
- Container startup drops to the `node` user after ownership fixes in `apps/web/scripts/entrypoint.sh:4-42`.

## Final Missed-Issue Sweep

I completed a final pass over the route/action inventory, public unauthenticated endpoints, admin auth wrappers, CSRF/same-origin gates, IP trust and rate-limit refund paths, upload and derivative-serving path handling, OG/semantic fetch and rendering paths, raw SQL and child-process use, backup/restore flows, JSON-LD sinks, secret patterns, nginx forwarding/body limits, Docker runtime assumptions, and deploy scripts. I did not find a high-confidence exploitable issue to report for cycle 21.
