# Cycle 24 Security Review - Security Reviewer Lane

Date: 2026-07-08
Scope: review only; no source-code changes.
Workspace: `/Users/hletrd/flash-shared/gallery`

## Inventory Built First

I built the security inventory before assessing findings. The review covered 654 tracked security-relevant files across app routes/actions, libs, DB/schema/migrations, scripts, tests, deployment config, docs, and plans. Generated `.next/`, `node_modules/`, and gitignored runtime secret files were not inspected as source; tracked examples and secret-hygiene tests were inspected.

Primary categories examined:

- Auth, sessions, admin tokens: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`.
- CSRF/origin/rate limiting: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, lint gates in `apps/web/scripts/check-*.ts`.
- Admin actions and APIs: all `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/**/route.ts`.
- Public expensive/mutating surfaces: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/**`, `apps/web/src/app/api/og/**`, feed routes, share pages, upload-serving routes.
- Uploads, file serving, path traversal: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/storage/local.ts`.
- SQL, raw query, backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/db/**`, `apps/web/drizzle/**`.
- XSS/CSP/SEO sinks: `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/seo-og-url.ts`, public pages with `dangerouslySetInnerHTML`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`.
- Secrets/deploy/hardening: `apps/web/.env.local.example`, `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `package*.json`.

## Findings

### Confirmed Issues

No confirmed security vulnerabilities found in the reviewed repository state.

### Likely Issues

No likely code-level security issues found.

### Risks Needing Manual Validation

#### RV-24-01 - Reverse-proxy topology and nginx template application remain operational assumptions

Severity: Low-Medium
Confidence: Medium
Status: Manual-validation risk, not a confirmed repo defect
OWASP: A05 Security Misconfiguration, A04 Insecure Design

Evidence:

- `apps/web/docker-compose.yml:15-22` uses host networking, expects the host reverse proxy to handle rate limits/security headers, and sets `TRUST_PROXY=true`.
- `apps/web/nginx/default.conf:52-71` explicitly documents the internal HTTP-hop/X-Forwarded-For topology contract and warns that LB-fronted deployments must adjust forwarding and trusted hop count.
- `apps/web/nginx/default.conf:274-295` applies the public SSR page limiter only in this nginx config and states it must be applied/reloaded by an operator.
- `apps/web/src/lib/rate-limit.ts:175-216` trusts proxy headers only when `TRUST_PROXY=true`, otherwise all requests key as `unknown`.

Why it matters:

The source code is internally consistent, but the protection depends on the deployed nginx/topology matching the committed assumptions. If the host is behind another load balancer without `real_ip`/append-mode forwarding or if this nginx template was not actually applied, public SSR flood protection and per-client rate-limit attribution can degrade. The most likely failure mode is availability impact or shared-bucket lockout, not auth bypass.

Failure scenario:

A CDN/LB connects to nginx from one private address while nginx overwrites `X-Forwarded-For` with `$remote_addr`. The app sees the LB as every client, so one attacker can consume login/search/share/OG budgets for all visitors. Separately, if the public `location /` limiter was not deployed, dynamic public pages lose the edge backstop documented in the repo.

Suggested fix:

Operationally verify `nginx -T` on the host includes this config, configure `ngx_http_realip_module` or append-mode forwarding when an upstream LB exists, set `TRUSTED_PROXY_HOPS` to the real right-anchored hop count, and smoke-test that two external client IPs produce distinct app-side buckets.

#### RV-24-02 - Gitignored runtime secret files and historical secret rotation cannot be proven from source review

Severity: Low-Medium
Confidence: High
Status: Manual-validation risk, not a confirmed repo defect
OWASP: A02 Cryptographic Failures, A05 Security Misconfiguration

Evidence:

- `apps/web/.env.local.example:21-33` requires strong `ADMIN_PASSWORD` and `SESSION_SECRET`, and warns that older checked-in examples must be treated as compromised.
- `apps/web/.env.local.example:57-70` documents proxy trust settings that affect security behavior.
- `.env.deploy.example:1-16` instructs copying deploy credentials to a gitignored env file with `chmod 600`.
- `scripts/deploy-remote.sh:22-29` prefers repo-root `.env.deploy` when present and `scripts/deploy-remote.sh:61-80` refuses group/world-readable deploy env files.
- `apps/web/deploy.sh:15-43` requires `apps/web/.env.local` and refuses unsafe file permissions.

Why it matters:

Tracked source and tests protect against committed literal secrets, but they cannot prove production secret provenance, rotation status, or local gitignored env values without intentionally reading operator secrets. The repo has guardrails, but runtime safety still depends on operator-owned files and rotation history.

Failure scenario:

A production `.env.local` was originally copied from an old checked-in example or reused after exposure. The app code would behave correctly, but sessions, bootstrap credentials, or deploy SSH material could already be known to an attacker.

Suggested fix:

Manually confirm production `SESSION_SECRET`, bootstrap/admin credentials, DB password, and deploy SSH material were generated independently of historical examples; rotate anything uncertain. Keep `.env.local` and `.env.deploy` at `0600`, and do not paste secrets into review logs.

#### RV-24-03 - Local plaintext SQL backups are protected by host permissions, not encryption

Severity: Low
Confidence: High
Status: Manual-validation risk, not a confirmed repo defect
OWASP: A02 Cryptographic Failures, A01 Broken Access Control

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:177-194` writes backup files under the app data backup directory with `0700` directory permissions and randomized backup names.
- `apps/web/src/app/[locale]/admin/db-actions.ts:235-253` runs `mysqldump` with argv arrays, a minimal environment, a temp file at mode `0600`, and a watchdog.
- `apps/web/src/app/api/admin/db/download/route.ts:21-40` wraps downloads in admin auth and validates backup filenames/containment.
- `apps/web/deploy.sh:84-97` documents persistent bind-mounted data and that deploy pruning preserves `./data`, including backups.

Why it matters:

This is a reasonable single-host design, but the SQL dumps are plaintext. If the host account, backup directory, or off-host backup transport is compromised, dumps can expose admin password hashes, session/token hashes, private photo metadata, and operational state.

Failure scenario:

An operator later syncs `apps/web/data/backups` to shared storage without encryption or restrictive ACLs. The application access controls are bypassed because the dump is copied outside the app boundary.

Suggested fix:

Keep local filesystem permissions as-is, and encrypt or access-control any off-host backup copies. If backups become a formal export feature, add envelope encryption and key-management guidance rather than relying only on POSIX permissions.

## Evidence Review Highlights

- Auth/session: `apps/web/src/lib/session.ts:16-36` requires `SESSION_SECRET` in production; `apps/web/src/lib/session.ts:82-151` signs/verifies session tokens with HMAC, timing-safe comparison, expiry, hashed DB sessions, and purge. `apps/web/src/app/actions/auth.ts:79-109`, `137-197`, and `226-253` apply same-origin checks, rate limits, Argon2 dummy-hash timing resistance, transactional session insert/cleanup, and secure `httpOnly` cookies.
- Admin API/PAT: `apps/web/src/lib/api-auth.ts:66-152` requires scoped token auth or same-origin cookie admin auth and adds no-store/nosniff headers. `apps/web/src/lib/admin-tokens.ts:53-90` generates high-entropy `gk_` bearer tokens and stores only SHA-256 hashes; `142-168` verifies expiry/scope; `206-238` creates/revokes scoped tokens.
- CSRF/origin: `apps/web/src/lib/request-origin.ts:47-145` derives an expected origin from configured origin/host/proxy settings and fails closed when Origin/Referer is missing. `apps/web/src/lib/action-guards.ts:37-44` centralizes same-origin checks for mutating admin actions.
- Upload/path traversal: `apps/web/src/lib/serve-upload.ts:162-238` restricts served uploads to derivative directories/extensions, rejects unsafe segments, checks symlinks/realpaths, and never serves originals. `apps/web/src/lib/upload-paths.ts:49-56` creates private originals at `0700`; `129-170` resolves originals with basename, lstat, symlink, realpath, and containment checks.
- Image privacy: `apps/web/src/app/actions/images.ts:367-380` nulls DB GPS and rejects/quarantines uploads when original GPS stripping cannot be guaranteed. `apps/web/src/lib/process-image.ts:1685-1807` strips GPS with lossless scrubbers or metadata-free re-encode, returning false on unsupported unsafe cases.
- SQL/restore: `apps/web/src/lib/smart-collections.ts:151-154` compiles allowed AST fields through Drizzle binding; `316-328` and `374-501` enforce size, depth, column, operator, and scalar validation. `apps/web/src/lib/sql-restore-scan.ts:12-32`, `88-140` allow only app backup table drops and block dangerous SQL classes. `apps/web/src/lib/db-restore.ts:21-54` validates plausible SQL headers and mysqldump completion trailers.
- XSS/CSP: `apps/web/src/lib/safe-json-ld.ts:14-19` escapes JSON-LD script content; `apps/web/src/lib/content-security-policy.ts:139-199` builds nonce-based production script CSP plus frame/base/form/object restrictions; `apps/web/src/proxy.ts:36-52` injects per-request nonce/CSP into page requests; `apps/web/next.config.ts:87-106` sets API CSP and security headers.
- Privacy projections: `apps/web/src/lib/data.ts:368-407` derives public select fields by omitting sensitive image fields; `458-488` adds compile-time guards; `1777-1817` exposes GPS only through map-visible topic filtering and runtime assertion.
- Public expensive routes: `apps/web/src/app/api/search/semantic/route.ts:107-184` enforces same-origin, content type, content length, chunked rejection, and pre-increment rate limiting; `apps/web/src/app/api/search/similar/[id]/route.ts:72-113` similarly guards similar search. `apps/web/src/app/api/og/route.tsx:80-107` and `apps/web/src/app/api/og/photo/[id]/route.tsx:93-118` rate-limit CPU/DB-heavy OG paths.
- Public analytics/share: `apps/web/src/app/actions/public.ts:341-414` combines bounded in-memory and DB-backed view-record rate limits; `443-559` validates targets before recording views. Share pages validate base56 keys and rate-limit lookups before DB access.
- Deploy/container: `apps/web/Dockerfile:1-7` pins the Node base digest deliberately; `122-198` runs production with `NODE_ENV=production`, app-owned persistence dirs, healthcheck, and `gosu node`. `apps/web/scripts/entrypoint.sh:16-30` ensures writable app dirs and keeps private originals `0700`.

## Validation Run

- `npm run lint:api-auth --workspace=apps/web` - passed; admin route handlers were wrapped with `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web` - passed; mutating server actions enforce same-origin provenance or documented exemptions, and mutation barriers where required.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed; public mutating/expensive routes either use approved pre-increment rate-limit helpers or documented exemptions.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts` - passed, 2 files / 13 tests.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` - passed, 0 production vulnerabilities reported.

## Final Sweep

Checked common missed issues:

- OWASP Top 10: access control, crypto/secret handling, injection, insecure design, security misconfiguration, vulnerable components, auth/session, integrity, logging/monitoring, SSRF-adjacent fetches.
- Auth/authz: admin pages, admin APIs, server actions, PAT scope checks, session issuance/revocation, password update, token creation/revocation.
- CSRF/origin: login/logout/password/admin mutations, DB backup/restore, PAT/cookie split, route-handler wrappers.
- SSRF/open redirect: OG image fallback, internal OG photo fetch origin pinning, SEO OG image URL validation, CSP image base URL parsing.
- XSS: JSON-LD script injection, OG text rendering, admin metadata sanitization, EXIF-derived strings, CSP nonce/header coverage.
- File upload/path traversal: browser uploads, Lightroom/PAT upload, topic images, private originals, public derivative serving, symlink/realpath containment, cleanup paths.
- SQL/raw queries: Drizzle-bound queries, `sql.raw` literals, smart-collection compiler, restore scanner, migration reconciliation, child-process CLI invocations.
- Backup/restore safety: locks, maintenance window, quiescence/drain checks, restore scanner, dump trailer checks, temp file modes, post-restore migration env minimization.
- Rate limiting: login, password change, admin token attempts, search/load-more, semantic/similar, OG, share routes, feeds, analytics view recording, edge nginx limits.
- Deployment hardening: Docker user drop, runtime env permission checks, nginx headers/limits, host networking trust boundary, deploy prune data-safety comments, package audit.

Conclusion: no confirmed or likely source-level security issues were found in Cycle 24. The remaining items are operator validation risks around deployed proxy topology, gitignored secret provenance, and plaintext backup handling outside the app boundary.
