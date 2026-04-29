# Security Review Report — security-reviewer (Cycle 1 deep review)

Scope: `/Users/hletrd/flash-shared/gallery` full repo security review  
Scan date: 2026-04-29  
Write scope honored: only this report file was written.

## Inventory

Reviewed security-sensitive surfaces across the tracked application and deployment files:

- Auth/session/cookies: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`.
- Authz and CSRF/origin: `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- Server Actions/API routes: `apps/web/src/app/actions/*`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/**`.
- Uploads/file paths/image processing: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/local.ts`.
- SQL/raw shell/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, migration/init scripts.
- DB/data privacy: `apps/web/src/db/*`, `apps/web/src/lib/data.ts`, sharing/photo/group routes.
- Headers/CSP/TLS/deploy: `apps/web/next.config.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/nginx/default.conf`, Docker/compose/deploy scripts.
- Secrets/dependencies: env examples/docs, gitignore/dockerignore, package manifests/lockfile.

Evidence commands run: `omx explore --prompt ...`, targeted `rg` sweeps for auth/origin/upload/path/secrets/raw SQL/shell/XSS patterns, line-numbered file inspection, `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, and `npm audit --workspaces --json`.

## Summary

- Critical: 0
- High: 1
- Medium: 2
- Low: 3
- Dependency vulnerabilities: 0 reported by `npm audit --workspaces --json`

## Findings

### HIGH

#### SEC-C1-01 — Global Server Action body limit creates a large pre-auth DoS budget

- Severity: High
- Confidence: High
- OWASP: A04 Insecure Design / A05 Security Misconfiguration
- Location: `apps/web/src/lib/upload-limits.ts:1-6`, `apps/web/src/lib/upload-limits.ts:15-29`, `apps/web/next.config.ts:69-77`, `apps/web/src/app/actions/auth.ts:70-95`, `apps/web/src/app/actions/images.ts:116-129`, `apps/web/src/app/[locale]/admin/db-actions.ts:275-386`, `apps/web/nginx/default.conf:20`, `apps/web/nginx/default.conf:60-64`

Finding: `SERVER_ACTION_UPLOAD_BODY_BYTES` is derived from the largest upload/restore file cap plus multipart overhead, so Next's global Server Action parser accepts about 266 MB by default before individual action code can run. The action-level checks (`getCurrentUser()`, `isAdmin()`, `requireSameOriginAdmin()`, per-action validation) occur inside the Server Action after the framework has accepted/parsing the action body. Public actions such as login are part of the same Server Action body-size surface.

Failure scenario: An unauthenticated attacker scrapes a public Server Action endpoint/action id and repeatedly submits near-limit multipart bodies to login or another action. The app eventually returns auth/origin/validation errors, but only after the framework and reverse proxy have accepted a very large request. This can consume bandwidth, temp storage, and CPU/memory well before authz logic applies.

Suggested fix: Do not use one large global Server Action transport limit for all actions. Move large upload/restore flows to dedicated route handlers where auth, method, same-origin, and rate limits run before streaming the body, or put strict edge rules around Server Action POSTs. Keep the global Server Action body cap small and set route-specific limits for restore/upload endpoints.

### MEDIUM

#### SEC-C1-02 — Public share-key pages have no explicit rate limit

- Severity: Medium
- Confidence: High
- OWASP: A04 Insecure Design / A07 Identification and Authentication Failures (token enumeration hardening) / availability
- Location: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:34-42`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:89-95`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-38`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99-107`, `apps/web/src/lib/data.ts:736-752`, `apps/web/src/lib/data.ts:778-814`, `apps/web/src/lib/base56.ts:31-40`

Finding: Photo and group share routes validate that keys are Base56 and exactly 10 characters, which gives a large key space. However, failed lookups still hit the database, and unlike public search/load-more/OG surfaces, these unauthenticated routes do not have an explicit app-level or nginx rate limit.

Failure scenario: A bot sends high-volume random `/s/<key>` and `/g/<key>` requests. Data disclosure probability is low because the key space is large, but each valid-shaped miss can still perform DB work and generate server-rendered error/not-found responses. This is a cheap public DB pressure path.

Suggested fix: Add per-IP rate limiting for share-key lookup routes, preferably at the edge and/or a small app-level limiter before DB queries. Consider returning a uniform, cache-controlled 404 for malformed or missing keys and adding metrics for share-key miss rates.

#### SEC-C1-03 — Shipped nginx config does not itself enforce HTTPS if exposed as the public edge

- Severity: Medium
- Confidence: High
- OWASP: A05 Security Misconfiguration / A02 Cryptographic Failures
- Location: `apps/web/nginx/default.conf:12-20`, `apps/web/nginx/default.conf:42`, `apps/web/nginx/default.conf:50-58`, `apps/web/nginx/default.conf:115-124`, `apps/web/next.config.ts:62-64`

Finding: The provided nginx server listens on port 80 and comments that it is intended to run behind a TLS-terminating edge. It sets HSTS, but HSTS only has security effect when delivered over HTTPS; this config does not include a 443 server or HTTP-to-HTTPS redirect. If an operator deploys this file as the public edge, admin login/session traffic can be sent over plaintext HTTP.

Failure scenario: A deployment follows the checked-in nginx file directly on an internet-facing host without a TLS terminator. Users can browse/admin-login over HTTP; `Secure` cookies may not be set or sent as expected, credentials traverse plaintext, and HSTS does not bootstrap because it is not received over HTTPS.

Suggested fix: Ship an explicit public-edge TLS example with a 443 server and a port-80 redirect, or fail deployment/docs loudly when no TLS terminator is configured. Keep HSTS only on HTTPS responses. If nginx is always behind TLS termination, document the exact required upstream headers and ensure the terminator overwrites `X-Forwarded-*` safely.

### LOW

#### SEC-C1-04 — Deployment workflow still encourages live env files inside the repo checkout

- Severity: Low
- Confidence: High
- OWASP: A02 Cryptographic Failures / secrets management
- Location: `README.md:115-140`, `CLAUDE.md:70-84`, `apps/web/deploy.sh:14-18`, `apps/web/docker-compose.yml:16-17`, `.gitignore:6-7`, `.dockerignore:12`, `scripts/deploy-remote.sh:5-6`

Finding: Tracked docs and `apps/web/deploy.sh` still instruct operators to create `apps/web/.env.local` inside the repository checkout. It is gitignored and excluded from Docker context, and this review did not find tracked production secrets. Still, keeping live DB/admin/session secrets in a shared working tree increases exposure to accidental archives, broad grep/debug commands, agent transcripts, and local backups. The newer remote deploy helper defaults to `$HOME/.gallerykit-secrets/...`, which is safer.

Failure scenario: A future troubleshooting session attaches or archives the repo directory including ignored files, or an agent/tool scans `.env.local` while debugging. DB credentials, `ADMIN_PASSWORD`, or `SESSION_SECRET` can leak even though they were never committed.

Suggested fix: Update deploy docs/scripts to prefer external secret paths by default (`$HOME/.gallerykit-secrets/`, OS secret manager, or CI secret storage). Let compose read an env-file path from an environment variable. Keep only placeholder examples in the repo and rotate any values ever exposed in logs/transcripts.

#### SEC-C1-05 — Authenticated DB backup download route is not rate-limited

- Severity: Low
- Confidence: Medium-High
- OWASP: A04 Insecure Design / A09 Security Logging and Monitoring Failures (abuse detection)
- Location: `apps/web/src/app/api/admin/db/download/route.ts:13-32`, `apps/web/src/app/api/admin/db/download/route.ts:76-93`, `apps/web/src/proxy.ts:101-106`, `apps/web/nginx/default.conf:45-90`

Finding: The DB backup download API has admin auth, fail-closed same-origin validation, filename/path checks, no-store headers, and audit logging. However, API routes are explicitly excluded from middleware, and the checked-in nginx `limit_req` locations cover `/admin...` pages, not `/api/admin/db/download`. A valid admin session can repeatedly request large backup files without a dedicated app/edge rate limit.

Failure scenario: A stolen admin cookie, malicious admin, or browser automation on an admin workstation repeatedly downloads backups. This increases exfiltration volume and can cause disk/network pressure. Audit events exist, but throttling is absent.

Suggested fix: Add a small per-user/per-IP limiter to the download route and/or an nginx `location ^~ /api/admin/` limit. Consider alerting on repeated `db_backup_download` audit events.

#### SEC-C1-06 — `TRUST_PROXY` misconfiguration collapses rate limits into one shared bucket

- Severity: Low
- Confidence: High
- OWASP: A05 Security Misconfiguration / availability
- Location: `apps/web/src/lib/rate-limit.ts:82-113`, `README.md:146-148`, `apps/web/docker-compose.yml:18-21`

Finding: When `TRUST_PROXY` is not exactly `true`, `getClientIp()` intentionally ignores forwarded IP headers and returns `"unknown"`. This is a safe anti-spoofing default, and the README documents the operational need. But if a non-compose deployment forgets `TRUST_PROXY=true`, all users share login/search/share/OG buckets and one attacker can exhaust shared budgets for legitimate users.

Failure scenario: A reverse-proxied deployment omits `TRUST_PROXY=true`. An attacker sends enough login or search requests to fill the single `"unknown"` bucket, locking out legitimate traffic for the window.

Suggested fix: In production, fail startup or readiness when proxy headers are present but `TRUST_PROXY` is unset, unless an explicit single-client/direct mode is configured. Keep the existing warning, but make the misconfiguration operationally visible before traffic.

## Positive controls / non-findings

- Auth: production `SESSION_SECRET` is required (`apps/web/src/lib/session.ts:19-35`); session tokens are HMAC-signed and hashed before DB storage (`apps/web/src/lib/session.ts:82-144`); auth cookies are `httpOnly`, `sameSite: 'lax'`, and secure in production (`apps/web/src/app/actions/auth.ts:207-220`, `apps/web/src/app/actions/auth.ts:386-393`).
- Passwords: Argon2id is used for login verification and password creation/change (`apps/web/src/app/actions/auth.ts:158-163`, `apps/web/src/app/actions/auth.ts:363`, `apps/web/src/app/actions/admin-users.ts:142-147`).
- Server Action CSRF/origin: `npm run lint:action-origin --workspace=apps/web` passed and reported all mutating actions enforce same-origin checks or are read-only exempt.
- API auth: `npm run lint:api-auth --workspace=apps/web` passed for the current `/api/admin/db/download` route.
- Upload paths: public upload serving is directory/extension allowlisted and checks `lstat` plus `realpath` containment (`apps/web/src/lib/serve-upload.ts:32-101`). Original uploads default outside the public web root (`apps/web/src/lib/upload-paths.ts:24-40`) and production instrumentation asserts no legacy public originals (`apps/web/src/instrumentation.ts:1-4`, `apps/web/src/lib/upload-paths.ts:82-103`).
- Restore/shell: backup/restore uses `spawn()` with argument arrays, DB password in env rather than argv, temp restore files mode `0600`, SQL header/dangerous statement scanning, and stderr redaction (`apps/web/src/app/[locale]/admin/db-actions.ts:35-46`, `apps/web/src/app/[locale]/admin/db-actions.ts:160-173`, `apps/web/src/app/[locale]/admin/db-actions.ts:380-462`, `apps/web/src/lib/sql-restore-scan.ts:23-85`).
- Public privacy: public image select fields explicitly omit GPS/original filename/user filename/internal processing data (`apps/web/src/lib/data.ts:179-224`), while admin-only fields include them intentionally (`apps/web/src/lib/data.ts:136-177`).
- XSS/JSON-LD: all `dangerouslySetInnerHTML` uses found were JSON-LD scripts routed through `safeJsonLd()` (`apps/web/src/lib/safe-json-ld.ts:14-18`).
- Dependencies: `npm audit --workspaces --json` returned zero known vulnerabilities.
- Secrets: no tracked production secret values were found in current source. CI/test placeholders are present in `.github/workflows/quality.yml:16-37`; README/CLAUDE warn to rotate historical example values (`README.md:138-140`, `CLAUDE.md:82-84`).

## Final sweep

Reviewed OWASP, secrets, auth/authz, Server Actions, API auth, uploads, file paths, SQL/raw shell, cookies, rate limits, and data leakage. No source code changes were made. No destructive operations were run. Live ignored env values were not opened or copied into this report.
