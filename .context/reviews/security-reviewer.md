# Security Reviewer - cycle 7/100

Role: `security-reviewer`
HEAD reviewed: `17124135999a`
Date: 2026-06-29
Scope: current HEAD in `/Users/hletrd/flash-shared/gallery`; report-only pass. No source code fixes implemented.

## Inspection Inventory

Read first, before source review:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/security-review/SKILL.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Review-relevant inventory built before findings:
- Project rules and operational docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/reviews/**`, `.context/plans/**`, and deployment notes embedded in `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, and `apps/web/nginx/default.conf`.
- Package/build/deploy config: root `package.json`, `package-lock.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.env.deploy.example`, and `apps/web/.env.local.example`.
- API routes: all route files under `apps/web/src/app/api/**/route.{ts,tsx}`, including admin DB download, Lightroom upload, health/live, OG image, OG photo, semantic search, and similar search.
- Server actions: all files under `apps/web/src/app/actions/*.ts` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/authz/origin/session/rate-limit: `api-auth.ts`, `session.ts`, `action-guards.ts`, `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `admin-tokens.ts`, `password-hashing.ts`, and `proxy.ts`.
- Upload and file handling: `upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`, `storage/local.ts`, `storage/types.ts`, upload queue/tracker helpers, and public upload routes.
- Backup/restore: `db-actions.ts`, `api/admin/db/download/route.ts`, `backup-filename.ts`, `download-filename.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `scripts/migrate.js`, `scripts/mysql-connection-options.js`, and Drizzle migration state.
- Public data and output safety: `data.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, public photo/topic/share/map pages, service worker code, JSON-LD helpers, OG helpers, Atom feed, `sanitize.ts`, `validation.ts`, `safe-json-ld.ts`, `og-sanitize.ts`, `csv-escape.ts`, `seo-og-url.ts`, `content-security-policy.ts`, and `blur-data-url.ts`.
- Scripts/tests used as security evidence: migration/bootstrap, CLIP model download and manifest verification, admin seeding, lint guards, service worker build, e2e server, backfill sidecars, auth/session/token/origin/rate-limit tests, upload/path/restore/search/share/privacy tests, safe JSON-LD tests, and Docker/deploy contract tests.

Categories covered: OWASP Top 10, secrets, auth/authz, admin route wrapping, CSRF/origin, upload/file handling, path traversal, SSRF/open redirect, SQL/raw shell, token/session handling, rate limiting, backup/restore, dependency integrity, and deployment risks.

## Confirmed Issues

No confirmed security issues were found in current HEAD.

The previous cycle's Docker build integrity issue was rechecked and appears fixed: the explicit Linux native package install now pins versions in `apps/web/Dockerfile:44-51` instead of resolving unversioned registry `latest` packages.

## Likely Issues

No likely application-security issues were identified. Reviewed auth, origin, upload, restore, public data, SSRF/CSP, and rate-limit paths had concrete guards and matching lint/test evidence.

## Risks Needing Manual Validation

### RISK-C7-01 - TLS and HSTS rely on an external edge

Severity if misdeployed: High
Confidence: Medium
Status: deployment risk needing manual validation
OWASP: A02 Cryptographic Failures; A05 Security Misconfiguration

File/region:
- `apps/web/nginx/default.conf:21-28`
- `apps/web/nginx/default.conf:47-53`

Problem:
The checked-in nginx server listens on cleartext port 80 and documents that it is intended to sit behind a TLS-terminating edge/load balancer. It also emits HSTS from this server block. That is safe only when production really terminates HTTPS before this listener and blocks or redirects direct cleartext public access.

Concrete failure scenario:
If this nginx config becomes the public edge without a separate 443 server and HTTP-to-HTTPS redirect, admin login/session traffic can be exposed on cleartext HTTP. Production cookies are `Secure`, which can break login over plain HTTP, but cookie flags are not transport enforcement.

Suggested fix:
Validate the live production path has HTTPS termination and port-80 redirect/blocking in front of this file. Consider shipping the redirect/443 config or a deploy-time probe/assertion so topology drift fails closed.

### RISK-C7-02 - Client-IP trust depends on exact proxy-chain topology

Severity if misconfigured: Medium
Confidence: Medium
Status: deployment risk needing manual validation
OWASP: A05 Security Misconfiguration

File/region:
- `apps/web/docker-compose.yml:14-21`
- `apps/web/nginx/default.conf:67-69`
- `apps/web/nginx/default.conf:84-86`
- `apps/web/nginx/default.conf:101-103`
- `apps/web/nginx/default.conf:141-143`
- `apps/web/nginx/default.conf:192-194`
- `apps/web/src/lib/rate-limit.ts:152-180`

Problem:
The container sets `TRUST_PROXY=true`, and app rate limits derive the client from `X-Forwarded-For`/`X-Real-IP`. The checked-in nginx config forwards `$remote_addr`, not an appended chain. That is correct only if this nginx instance directly sees the real client or a trusted upstream has already rewritten `$remote_addr` through real-IP handling outside this file.

Concrete failure scenario:
With a CDN or TLS load balancer in front of this nginx host and no matching `real_ip_header`/`set_real_ip_from`, every client can appear as the same upstream IP. A few failed login attempts can lock out unrelated users behind the edge bucket, while public route abuse attribution and throttling become inaccurate.

Suggested fix:
Validate the live nginx real-IP configuration or equivalent edge behavior. If a multi-hop chain is intentional, set and test `TRUSTED_PROXY_HOPS` with representative `X-Forwarded-For` headers and add an operational smoke test for distinct client IP extraction.

### RISK-C7-03 - Several security controls are process-local

Severity if scaled out: Medium
Confidence: High
Status: topology risk, not a current single-instance vulnerability
OWASP: A04 Insecure Design; A05 Security Misconfiguration

File/region:
- `apps/web/docker-compose.yml:11-21`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/restore-maintenance.ts`

Problem:
The documented deployment is a single web container. Under that topology, process-local restore maintenance flags, upload accounting, and in-memory rate-limit fast paths are coherent. If the service is horizontally scaled, those controls become per-replica unless backed by a shared store.

Concrete failure scenario:
A restore running on replica A would not automatically block upload work routed to replica B. Public request budgets could also be multiplied by distributing traffic across replicas.

Suggested fix:
Keep single-instance deployment as an explicit invariant, or move restore state, upload claims, and limiter buckets to shared DB/Redis leases before adding replicas. Add a deployment guard if replica count can exceed one.

## Positive Security Evidence

- Admin APIs: both admin API routes are wrapped by `withAdminAuth`; the lint guard passed. PAT auth is scope-limited for Lightroom upload, and cookie auth requires same-origin plus `isAdmin()` (`apps/web/src/lib/api-auth.ts:54-133`).
- Sessions: production rejects missing/short `SESSION_SECRET`, session tokens are HMAC signed, DB-hashed, max-age checked, timing-safe verified, and expired rows are deleted (`apps/web/src/lib/session.ts:16-150`).
- Login/password change: same-origin checks, pre-incremented IP/account rate limits, Argon2id policy, dummy-hash timing equalization, session rotation, and secure cookie attributes are present (`apps/web/src/app/actions/auth.ts:70-443`; `apps/web/src/lib/password-hashing.ts:10-15`).
- Server actions: the origin lint guard passed for all mutating server actions; reviewed mutating admin paths call `requireSameOriginAdmin()` or equivalent same-origin checks.
- Browser and Lightroom uploads: admin/PAT auth, origin or token-scope gating, content-length/size limits, filename sanitization, upload quota preclaims, disk-space fail-closed checks, topic validation, GPS stripping, HDR rejection, cleanup, and audit paths are present (`apps/web/src/app/actions/images.ts:107-920`; `apps/web/src/app/api/admin/lr/upload/route.ts:56-516`).
- Path traversal defenses: upload serving and backup download validate path segments/filenames, reject symlinks, use `realpath` containment, and stream from resolved paths (`apps/web/src/lib/serve-upload.ts:127-296`; `apps/web/src/app/api/admin/db/download/route.ts:22-87`).
- Backup/restore: dump and restore are admin plus same-origin gated, use random temp files with restrictive permissions, sanitize stderr, avoid shell interpolation, check restore size/header, scan for dangerous SQL, and use advisory/maintenance locks (`apps/web/src/app/[locale]/admin/db-actions.ts:119-629`; `apps/web/src/lib/sql-restore-scan.ts:12-168`).
- SSRF/open redirect: OG photo fetches are pinned to same-origin configured URLs with byte/time caps, and SEO OG URL validation rejects cross-origin absolute URLs and scheme-relative/backslash tricks (`apps/web/src/app/api/og/photo/[id]/route.tsx:100-133`; `apps/web/src/lib/og-photo-fetch.ts:30-94`; `apps/web/src/lib/seo-og-url.ts:3-43`).
- CSP/XSS: production CSP is generated centrally with nonces, `frame-ancestors 'self'`, `object-src 'none'`, and HTTPS-only optional image base URLs. Reviewed `dangerouslySetInnerHTML` usage is JSON-LD only and goes through `safeJsonLd`, with tests for `</script>` and U+2028/U+2029 escaping (`apps/web/src/lib/content-security-policy.ts:68-123`; `apps/web/src/lib/safe-json-ld.ts:14-19`).
- Public data privacy: public select shapes omit sensitive admin/internal fields and have compile-time privacy guards; semantic/similar search enrichment uses the shared public-safe field set.
- Dependencies: `npm audit --workspace=apps/web --audit-level=low --json` reported zero vulnerabilities for the workspace audit metadata.
- Secrets: tracked env examples and docs contain placeholders only in the reviewed HEAD. Local ignored env files were not copied into this report.

## Automated Validation

Passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=low --json` - 0 vulnerabilities

Additional static sweeps performed:
- API/action inventory with `find apps/web/src/app/api ...` and `find apps/web/src/app/actions ...`
- Dangerous primitive sweep for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, child-process calls, fetches, filesystem streams, cookies/headers, and path joins/resolves
- Secret-pattern sweep for common cloud/API/token/private-key markers and committed env files
- Raw SQL and child-process sweep for injection-sensitive code paths
- Dockerfile/lockfile sweep for native optional dependency version pinning and install commands

## Final Missed-Issues Sweep

- Auth/authz/admin guards: no unwrapped admin API route found; no mutating server action missing same-origin protection found by the dedicated lint gates.
- CSRF/origin: same-origin checks are centralized and used on cookie-auth admin/public mutation paths; PAT upload intentionally bypasses origin only with scoped bearer-token auth.
- Rate limiting: public mutating API lint passed; login/password/share/search/view/upload limiter paths were traced. Remaining concerns are deployment topology risks, not confirmed single-instance bugs.
- Upload/path traversal: browser upload, Lightroom upload, public derivative serving, topic images, local storage, backup download, and cleanup paths were checked for basename normalization, extension allowlists, symlink rejection, and containment.
- Backup/restore: mysqldump/mysql invocation, filename validation, restore SQL scan, temp-file handling, migration post-restore, and download route were checked.
- SSRF/CSP/open redirect: OG fetch/fallback, SEO OG URL validation, CSP image base URL parsing, and service worker cache boundaries were checked.
- Secrets/dependencies/config: committed examples/docs contain placeholders; dependency audit found no vulnerabilities; the prior unversioned native-package Docker install issue is fixed in current HEAD.

Relevant files intentionally not inspected byte-by-byte:
- Binary/static assets and fixtures: images, screenshots, ICC profiles, fonts, icons, and generated visual artifacts under `.context/**`, `apps/web/public/**`, `apps/web/e2e/fixtures/**`, and test fixture directories.
- Historical archived review/plan logs under `.context/reviews/**/archive`, `.context/plans/archive/**`, `plan/**`, and `docs/superpowers/**` were inventoried and spot-checked for security context but not treated as current source of truth.
- Generated/cache/output directories such as `.next`, runtime upload/data directories, gate logs, and pid/log artifacts were not reviewed as HEAD source.
- `package-lock.json` was audited and targeted for package/version/integrity entries relevant to dependency risk rather than read line-by-line.

Conclusion: current HEAD has no confirmed new security findings from this lane. The application security controls for auth, origin, uploads, restore, public privacy, SSRF, and CSP are strong for the documented single-instance deployment; TLS/proxy/scale assumptions remain operational validation items.
