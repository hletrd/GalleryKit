# Cycle 16 Security Review

Reviewer: security-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-07-08  
Mode: review-only; the intended write is this report.

## Required Instructions Read

- `AGENTS.md` from the prompt, including Gallery workspace rules.
- `CLAUDE.md` security, privacy, upload, backup/restore, deployment, runtime-topology, and operational sections.
- Security-review skill instructions from `/Users/hletrd/.agents/skills/security-review/SKILL.md`.

## Inventory Built First

I built the security inventory before detailed review and examined the production security surface plus cross-file interactions. No security-relevant file in this inventory was intentionally skipped.

- Auth/session/origin/rate limiting: `apps/web/src/proxy.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/pending-session-revocations.ts`.
- Server actions: every file in `apps/web/src/app/actions/`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Route handlers: every route under `apps/web/src/app/api/**/route.*`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, feed routes, health/live routes, OG routes, semantic/similar search, and admin DB/LR routes.
- Public/share surfaces: public home/topic/photo/map/timeline/year/smart-collection pages, `/s/[key]`, `/g/[key]`, and public actions.
- Upload/file-serving/storage: `apps/web/src/lib/upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `upload-tracker*.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`, `storage/*`, `og-photo-fetch.ts`, `image-url.ts`, `download-filename.ts`.
- Data/privacy/SQL/restore: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-like.ts`, `sql-restore-scan.ts`, `db-restore.ts`, `backup-filename.ts`, `mysql-cli-ssl.ts`, `db-child-watchdog.ts`, `restore-maintenance*.ts`, advisory lock helpers, `apps/web/src/db/**`, `apps/web/scripts/migrate.js`, `mysql-connection-options.js`.
- Rendering/headers/config/deploy/secrets/dependencies: `content-security-policy.ts`, `safe-json-ld.ts`, `og-sanitize.ts`, `seo-og-url.ts`, `next.config.ts`, `apps/web/public/sw.*`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/deploy-remote.sh`, `nginx/default.conf`, docs, package manifests, and lockfile.
- Supporting tests/lints were reviewed as evidence, not substitutes for source review.

## Confirmed Issues

None found.

## Likely Issues

None found.

## Risks Requiring Manual Validation

### C16-SEC-RISK-01: Live proxy topology must match app and nginx IP trust assumptions

Status: Manual-validation risk, not a confirmed repository-code defect  
Severity: Medium  
Confidence: Medium

Evidence:

- `apps/web/src/lib/rate-limit.ts:175-205` trusts proxy IP headers only when `TRUST_PROXY=true`; otherwise it keys callers as `"unknown"` and logs a production warning.
- `apps/web/src/lib/request-origin.ts:47-107` anchors CSRF origin checks to `BASE_URL` / production `siteConfig.url`, falling back to host/protocol headers only when no canonical origin exists.
- `apps/web/src/lib/request-origin.ts:126-145` fails closed unless `Origin` or `Referer` matches the expected origin.
- `apps/web/nginx/default.conf:20-29` warns that nginx `$binary_remote_addr` rate-limit keys need real-IP configuration in LB-fronted deployments.
- `apps/web/nginx/default.conf:59-71` documents that shipped `X-Forwarded-For $remote_addr` is correct only when nginx sees the real client IP.
- `apps/web/nginx/default.conf:290-306` says public-page throttling is config-only and must be manually applied/reloaded on the host.
- `CLAUDE.md:244-247` documents single-instance/process-local rate-limit assumptions and the edge-only public SSR page limiter.

Why this is a problem:

The source has reasonable fail-closed origin handling and anti-spoofing defaults, but correct per-client rate limiting depends on the live proxy chain matching the documented topology. Source review cannot prove the production nginx/CDN/LB configuration is actually applied.

Concrete failure scenario:

Production is moved behind a CDN or load balancer while nginx continues overwriting `X-Forwarded-For` with the LB address, or the app has the wrong `TRUSTED_PROXY_HOPS`. Login/share/OG/semantic budgets then key on the proxy, on `"unknown"`, or on a spoofable/incorrect XFF segment. A single abusive client can lock out legitimate users, or public dynamic pages can be left without the intended edge throttle.

Suggested fix:

After every edge/CDN/LB change, validate live headers and limiter keys with real requests. Keep `BASE_URL` set in production, set `TRUST_PROXY=true` only behind a scrubbed trusted proxy, set `TRUSTED_PROXY_HOPS` to the actual trusted suffix length, and ensure active nginx/CDN config has equivalent real-IP handling, body caps, and public-page throttles. Consider making proxy-topology drift fail deploy or health checks if the app is operated by more than one person.

### C16-SEC-RISK-02: Plaintext SQL backups rely on host and backup-storage controls

Status: Manual-validation risk; documented operator boundary  
Severity: Medium  
Confidence: Medium

Evidence:

- `CLAUDE.md:226-228` states DB dumps are non-public but plaintext at rest, and that host/storage encryption is the operator boundary.
- `apps/web/src/app/[locale]/admin/db-actions.ts:128-163` gates backup creation on maintenance, same-origin, admin auth, DB env presence, and owner-only backup directory creation.
- `apps/web/src/app/[locale]/admin/db-actions.ts:186-201` spawns `mysqldump` with argument arrays and writes a temporary dump with `0600`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:259-316` rejects empty/implausible/truncated dumps before atomically publishing the file.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` wraps download in admin auth, validates filenames, enforces realpath containment, streams from a validated file descriptor, and returns no-store/nosniff headers.

Why this is a problem:

The web path is guarded, but dumps contain the full database: admin password hashes, sessions, token hashes, image metadata, share keys, audit logs, settings, and analytics. Application route auth does not protect against host-level users, host backups, sync tools, support bundles, or misconfigured bind mounts.

Concrete failure scenario:

A host backup job syncs `data/backups/*.sql` to a less restricted location, or a local user/support process reads the bind mount. The attacker does not need a web exploit to obtain session/token hashes, private metadata, share keys, and operational history.

Suggested fix:

Validate production ownership and permissions for `data/backups`, host backup destinations, retention, and support collection paths. Encrypt backups or move them into an encrypted host backup pipeline where the host is multi-user, cloud-synced, or operator-shared. Treat downloaded SQL dumps as secrets and rotate sessions/tokens after suspected exposure.

### C16-SEC-RISK-03: Single-instance assumptions are advisory, not enforced

Status: Manual-validation risk; not exploitable in the documented single-web-instance deployment  
Severity: Medium  
Confidence: Medium

Evidence:

- `CLAUDE.md:244-246` documents the single web-instance / single-writer topology and the process-local restore, upload quota, image queue, and rate-limit state.
- `apps/web/src/lib/single-writer-guard.ts:6-16` says concurrent web processes sharing one DB break restore mutation fencing, upload quota tracking, and several rate-limit fast paths.
- `apps/web/src/lib/single-writer-guard.ts:218-235` emits a loud warning on another live instance but explicitly continues startup.
- `apps/web/src/lib/rate-limit.ts:288-429` keeps OG/share/feed/semantic fast-path rate limits in process memory.

Why this is a problem:

The current code is internally coherent for one web process. The singleton guard detects many accidental multi-instance cases, but it is warn-only. Running multiple web processes against one DB changes the effective security posture because several controls are per-process.

Concrete failure scenario:

An operator starts a second container during a manual restart, blue/green test, or attempted scale-out. The new process logs the singleton warning and still serves traffic. Attackers can multiply in-memory OG/share/feed/semantic budgets by the number of instances, upload quota/admission can diverge, and restore/upload coordination assumptions are weaker.

Suggested fix:

Keep production single-instance unless these controls are moved to shared storage. If accidental multi-instance operation is plausible, make persistent singleton-lock contention fail startup or fail health checks instead of warning only. For intentional scale-out, move rate-limit fast paths, upload quota/admission, background queues, and restore-maintenance coordination to DB/Redis-equivalent shared state.

## Positive Security Evidence

Auth and authorization:

- `apps/web/src/lib/api-auth.ts:58-145` enforces admin auth, central same-origin checks for cookie-auth admin APIs, scoped PAT auth, token-auth rate limiting, and no-store/nosniff response defaults.
- `apps/web/src/lib/session.ts:16-35` requires a real `SESSION_SECRET` in production; `session.ts:82-150` signs/verifies session tokens with HMAC-SHA256 and constant-time comparison, stores only token hashes, and checks DB expiry.
- `apps/web/src/app/actions/auth.ts:101-177` rate-limits login by IP and account before Argon2 work; `auth.ts:216-255` rotates sessions and sets httpOnly/secure/sameSite cookies; `auth.ts:319-453` applies the same-origin/admin/maintenance/rate-limit/session-rotation posture to password changes.
- `apps/web/src/lib/password-hashing.ts:10-15` uses Argon2id with explicit memory/time/parallelism parameters.

CSRF/origin and route coverage:

- `apps/web/src/lib/action-guards.ts` centralizes same-origin checks for mutating server actions.
- `apps/web/src/proxy.ts` guards admin pages while APIs and actions authenticate independently.
- `npm run lint:api-auth --workspace=apps/web` passed for admin API routes.
- `npm run lint:action-origin --workspace=apps/web` passed for all mutating server actions and approved exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed for public expensive/mutating handlers.

Uploads, file serving, symlinks, and traversal:

- `apps/web/src/lib/serve-upload.ts:162-238` allows only derivative directories/extensions, validates every segment, rejects symlinks, and enforces realpath containment.
- `apps/web/src/lib/serve-upload.ts:304-369` opens and stats the file descriptor before streaming, reducing rename/TOCTOU issues.
- `apps/web/src/lib/upload-paths.ts:27-57` places originals in a private directory and enforces owner-only permissions where possible.
- `apps/web/src/lib/storage/local.ts:23-61` normalizes storage keys and blocks path traversal; `local.ts:115-123` rejects symlink/non-file reads; `local.ts:159-167` refuses public URLs for originals.
- Upload processing uses UUID disk names, size/pixel caps, private originals, derivative-only public output, atomic writes, and fail-closed GPS stripping paths.

SSRF, redirects, rendering, CSP, and CSV:

- `apps/web/src/app/api/og/photo/[id]/route.tsx` uses canonical `BASE_URL` for internal derivative fetch and fallback redirects, not request-derived host.
- `apps/web/src/lib/seo-og-url.ts` restricts configured OG image URLs to the site origin.
- `apps/web/src/lib/safe-json-ld.ts` is used at JSON-LD `dangerouslySetInnerHTML` sinks and escapes script-breaking characters.
- `apps/web/src/lib/content-security-policy.ts` validates `IMAGE_BASE_URL` and builds a nonce-based production CSP with `object-src 'none'`.
- `apps/web/src/lib/csv-escape.ts` strips control/bidi/invisible characters and prefixes formula-leading values.

SQL, privacy, backup/restore, and process execution:

- Drizzle parameterization is used for untrusted values; reviewed raw SQL sites are static identifiers/templates or parameter-bound.
- `apps/web/src/lib/data.ts:368-487` derives public field sets by omitting GPS, original/user filenames, upload attribution, processing internals, and admin-only fields, with compile-time privacy guards.
- `apps/web/src/lib/data.ts:1778-1808` restricts map GPS output to `topics.map_visible=true` and asserts it at runtime.
- `apps/web/src/lib/search-enrichment-fields.ts` carries a type-only privacy guard for semantic/similar result enrichment.
- `apps/web/src/lib/smart-collections.ts` validates the predicate AST and builds SQL through allowlisted columns/operators and Drizzle parameter binding.
- `apps/web/src/lib/sql-restore-scan.ts` scans restore SQL for disallowed statements, schema-qualified writes, and non-app write targets.
- Backup/restore child processes use static executables and argument arrays, not shell command strings; credentials are passed through environment and stderr is sanitized.

Secrets, dependencies, and deployment:

- Tracked secret scan found examples/placeholders/tests but no committed runtime `.env` secret values.
- `apps/web/deploy.sh` and `scripts/deploy-remote.sh` refuse group/world-readable env files before use.
- `apps/web/nginx/default.conf` carries route-specific body caps and limit zones for login/admin/uploads/public pages/Next image optimizer.
- `npm audit --workspace=apps/web --audit-level=moderate` returned zero vulnerabilities.

## Validation Commands Run

- `rg` sweeps over auth, actions, routes, data access, file paths, process execution, redirects, CSP, secrets, backup/restore, and deployment scripts.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/auth-rate-limit-ordering.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/semantic-search-rate-limit.test.ts src/__tests__/og-route-rate-limit-behavior.test.ts`: 14 files passed, 339 tests passed.
- `npm audit --workspace=apps/web --audit-level=moderate`: passed, zero vulnerabilities.

## Final Sweep

- Covered OWASP Top 10 classes across broken access control, crypto/session handling, injection, insecure design, misconfiguration, dependency exposure, authentication failures, integrity concerns, logging/monitoring, and SSRF.
- Covered the requested areas: auth/authz, admin API guards, server actions, origin/CSRF controls, upload/file serving traversal and symlinks, SSRF/open redirects, SQL/raw query safety, secrets, rate limiting, session/cookie hardening, backups/restore, CSV/formula injection, privacy/PII leaks, deployment scripts, and docs/operation mismatches.
- The only findings are manual-validation operational risks. I found no confirmed or likely repository-code vulnerability in this cycle.
