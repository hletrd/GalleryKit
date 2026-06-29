# Cycle 14 Security Review

Reviewer: cycle-14 security-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30
Reviewed HEAD: `c2da917d0fe9620bcbef3897570591080445592c`

## Result

I read `AGENTS.md` and `CLAUDE.md` first, built a security-relevant inventory, then reviewed current HEAD for OWASP Top 10, auth/authz, session handling, CSRF/same-origin, rate limits, upload/path traversal, SSRF, secrets, backup/restore, Docker/deploy scripts, public API abuse, privacy leaks, unsafe raw SQL, and destructive operations.

No confirmed security vulnerabilities were found in current HEAD. No likely issues were found.

The remaining items are risks needing manual validation because they depend on production topology, operator secret rotation, backup storage, or admin trust assumptions rather than a directly exploitable code path in this repository snapshot.

## Security-Relevant Inventory

Inventory method:

- Confirmed current HEAD with `git rev-parse HEAD`.
- Enumerated tracked/source files with `rg --files`, `find apps/web/src/app`, and `git ls-files`.
- Included all Next route handlers, all server actions, security-critical libs, database/migration scripts, Docker/nginx/deploy assets, config examples, tests that enforce security invariants, and documentation/runbooks that define operator boundaries.
- Excluded dependency/build/runtime artifacts from manual review: `node_modules`, `.next`, runtime `apps/web/public/uploads/**`, runtime `apps/web/data/**`, and generated dependency lock internals except for dependency audit.

Reviewed security surfaces:

- Route handlers: all 12 `route.ts` / `route.tsx` files under `apps/web/src/app`, including non-API feed/upload routes that bypass page middleware.
- Server actions: all files in `apps/web/src/app/actions/` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/session/PATs: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`.
- Origin/CSRF/proxy/rate limits: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/proxy.ts`, lint scanners in `apps/web/scripts/check-*.ts`.
- Uploads/file paths/images: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/gps-exif-strip.ts`.
- Public APIs and abuse surfaces: semantic/similar search, OG image routes, share pages, public analytics actions, feeds, sitemap, robots, manifest.
- SQL/data/privacy: `apps/web/src/db/**`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/lib/sql-restore-scan.ts`, migrations and migration reconciliation.
- XSS/CSP/metadata/XML: `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/safe-json-ld.ts`, JSON-LD call sites, `apps/web/src/lib/atom-feed.ts`, `apps/web/src/lib/seo-og-url.ts`.
- Backup/restore/destructive operations: DB backup/download/restore actions and route, migration scripts, deploy scripts, Dockerfile, compose, nginx, entrypoint.
- Secrets/dependencies: `.env` examples, tracked secret scans, `npm audit`.

## Confirmed Issues

None.

## Likely Issues

None.

## Risks Needing Manual Validation

### R14-MV-01: Production must match the documented single-instance, trusted-proxy topology

Severity: High if the app is horizontally scaled or exposed behind an untrusted/incorrect proxy; otherwise informational
Confidence: High for the repo assumption, Medium for live deployment state
Category: Deployment, CSRF/origin, rate limits, session security

Evidence:

- The documented deployment is single web instance / single writer; process-local restore maintenance, upload quota tracking, image queue state, and many non-login rate-limit buckets are explicitly not safe to scale horizontally without shared storage (`CLAUDE.md:228`).
- README says the checked-in nginx config is an internal HTTP hop behind a TLS-terminating edge, and warns not to expose it directly as the public cleartext edge (`README.md:152-154`).
- Proxy trust controls same-origin validation and rate-limit identity. `hasTrustedSameOrigin()` derives host/proto from trusted forwarded headers only when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:31-66`, `apps/web/src/lib/request-origin.ts:79-107`).
- `getClientIp()` ignores forwarded headers unless proxy trust is enabled and logs a security warning when proxy headers appear without trust (`apps/web/src/lib/rate-limit.ts:142-192`).
- Middleware injects a nonce-backed production CSP into page requests (`apps/web/src/proxy.ts:21-49`), but API routes remain responsible for their own auth/security headers (`apps/web/src/proxy.ts:135-140`).

Failure scenario:

If multiple web instances serve the same app without moving process-local coordination into DB/Redis, an attacker can multiply non-login rate-limit budgets across instances, race upload/restore maintenance checks, or see inconsistent queue/status state. If a proxy forwards untrusted `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, or `X-Forwarded-For`, same-origin checks and per-IP limits can be weakened or fail closed in production.

Concrete fix / validation:

Validate the live network path: the public TLS edge must overwrite forwarded headers, nginx should remain internal-only, and only one web process should serve writes unless process-local state is moved into shared storage. If scale-out is required, move upload quotas, public route rate limits, restore maintenance, and queue coordination to durable shared storage and add deployment tests for trusted proxy header behavior.

### R14-MV-02: SQL backups are intentionally plaintext and DB-only

Severity: Low to Medium depending on host/storage controls
Confidence: High
Category: Backup/restore, data protection, privacy

Evidence:

- The runbook explicitly states DB backups are plaintext SQL at rest and host/storage encryption is the operator boundary (`CLAUDE.md:209`).
- The same section states DB backup/restore snapshots rows only and does not snapshot or roll back `data/uploads/original`, `public/uploads`, or `public/resources` (`CLAUDE.md:210`).
- `dumpDatabase()` writes under `data/backups`, creates the directory with `0700`, and writes the dump file with `0600` (`apps/web/src/app/[locale]/admin/db-actions.ts:140-147`, `apps/web/src/app/[locale]/admin/db-actions.ts:172-178`).
- The authenticated download route path-validates the backup name, rejects symlinks, realpath-confines the file, and streams it as SQL (`apps/web/src/app/api/admin/db/download/route.ts:21-101`).

Failure scenario:

If host filesystem backups, copied SQL dumps, or the deploy user account are exposed, backup contents can disclose admin password hashes, session hashes, token hashes, audit events, private metadata, settings, and other database rows. Separately, restoring a DB dump without a matching filesystem snapshot can leave rows pointing at missing or stale image/resource files.

Concrete fix / validation:

Confirm `data/backups` is on encrypted storage and any off-host backups are encrypted. For full disaster recovery, pair DB dumps with filesystem snapshots for original uploads, derivatives, resources, and site config. If the threat model requires stronger protection, encrypt dumps before writing or immediately after creation with a key outside the app/database trust boundary.

### R14-MV-03: Admin authorization is all-root by design

Severity: Medium if multiple admins are not equally trusted; otherwise informational
Confidence: High
Category: Authz, privilege separation, destructive operations

Evidence:

- The README describes multiple root-admin accounts and says there is no role separation yet (`README.md:40`).
- CLAUDE.md states any admin can upload, edit, export/restore DB backups, change settings, and manage other admins (`CLAUDE.md:229`).
- Representative privileged actions gate on same-origin plus `isAdmin()` rather than per-capability roles, including admin creation (`apps/web/src/app/actions/admin-users.ts:75-82`) and DB backup/restore (`apps/web/src/app/[locale]/admin/db-actions.ts:121-133`, `apps/web/src/app/[locale]/admin/db-actions.ts:272-285`).
- Delete-admin protects self/last-admin with an advisory lock, but it is still root-admin capability (`apps/web/src/app/actions/admin-users.ts:182-290`).

Failure scenario:

A compromised or merely lower-trust admin account can perform high-impact operations: create more admins, revoke/delete other admins except self/last-admin constraints, upload content, edit metadata/settings, export plaintext SQL backups, or restore a malicious/old database dump.

Concrete fix / validation:

Validate that every admin account is intended to be fully trusted. If not, introduce roles/capabilities for backup/restore, user management, token management, upload, and settings, and require step-up authentication or dual control for restore and backup download.

### R14-MV-04: Historical secrets still require operator rotation validation

Severity: Medium if production ever reused historical example values; otherwise informational
Confidence: High that current HEAD is clean; Low/Unknown for production secret provenance
Category: Secrets, operational incident response

Evidence:

- Current `.env` examples use placeholders and warn operators to rotate if older checked-in examples were ever used (`apps/web/.env.local.example:19-30`).
- CLAUDE.md documents strong `ADMIN_PASSWORD` and `SESSION_SECRET` requirements and warns historical git values must be treated as compromised (`CLAUDE.md:80-85`).
- Prior plan history records the historical-secret issue as operational and HEAD-clean, with rotation/history rewrite requiring explicit operator action (`plan/plan-353-run6-cycle3-deferred.md:166-170`).
- Current tracked secret scan found only examples/placeholders and historical documentation; `git ls-files` matched only `.env.deploy.example` and `apps/web/.env.local.example` for env-like tracked files.

Failure scenario:

If a production/staging environment was seeded from old committed example secrets, an attacker with repo history could forge sessions or use known bootstrap/admin/DB credentials depending on which value was reused.

Concrete fix / validation:

Confirm production `SESSION_SECRET`, bootstrap/admin passwords, DB password, deploy key, and PATs were never copied from historical examples. Rotate any value with uncertain provenance. A git history purge is optional incident-response work and should only be done with explicit coordination because it requires destructive history rewriting/force-push.

## Positive Security Evidence

- Admin API routes are lint-enforced to wrap `withAdminAuth()`. Cookie-authenticated admin API requests require same-origin before session auth, while PAT requests use scoped token auth for non-browser integrations (`apps/web/src/lib/api-auth.ts:55-140`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-70`).
- Session tokens are HMAC-signed, timing-safe verified, bounded to 24 hours, stored hashed in DB, and production refuses weak/missing `SESSION_SECRET` (`apps/web/src/lib/session.ts:16-36`, `apps/web/src/lib/session.ts:82-150`).
- Login uses same-origin validation, IP and account buckets, DB-backed pre-increment before Argon2 verification, dummy hash timing equalization, and secure/HttpOnly/SameSite cookies (`apps/web/src/app/actions/auth.ts:58-238`).
- Password changes require same-origin/session/current-password, pre-increment password-change rate limits, rotate all sessions, and insert a fresh current session after updating the hash (`apps/web/src/app/actions/auth.ts:291-428`).
- Mutating server actions are covered by `requireSameOriginAdmin()` and the blocking action-origin scanner; public/read-only exemptions are explicit (`apps/web/src/lib/action-guards.ts:37-44`, `apps/web/scripts/check-action-origin.ts:1-44`).
- Public mutating API routes are covered by the public-route rate-limit scanner; current scan found semantic search correctly pre-increments a public rate limit before body parse (`apps/web/scripts/check-public-route-rate-limit.ts:1-45`, `apps/web/src/app/api/search/semantic/route.ts:106-220`).
- Browser uploads and Lightroom uploads validate content length/size/count, sanitize user filenames, generate random storage names, stream originals to private storage, reject unsupported/oversized images through Sharp limits, and apply late restore-maintenance checks (`apps/web/src/app/actions/images.ts:100-460`, `apps/web/src/app/api/admin/lr/upload/route.ts:72-580`, `apps/web/src/lib/process-image.ts:887-1037`).
- Public upload serving allows only derivative directories/extensions, validates each path segment, rejects symlinks/non-files, realpath-confines to upload roots, sends `nosniff`, and never serves originals (`apps/web/src/lib/serve-upload.ts:15-18`, `apps/web/src/lib/serve-upload.ts:137-188`, `apps/web/src/lib/serve-upload.ts:242-265`).
- Nginx also blocks `/uploads/original/` and only proxies derivative upload paths to the app (`apps/web/nginx/default.conf:164-184`).
- DB backup/restore uses same-origin plus admin auth, advisory locks, maintenance flags, size/header checks, temp file permissions, dangerous-SQL scanning, `MYSQL_PWD` rather than command-line passwords, no shell spawn, TLS-required CLI args for non-local DB hosts, `--one-database`, and sanitized stderr (`apps/web/src/app/[locale]/admin/db-actions.ts:121-260`, `apps/web/src/app/[locale]/admin/db-actions.ts:272-658`, `apps/web/src/lib/sql-restore-scan.ts:1-168`, `apps/web/src/lib/mysql-cli-ssl.ts:1-24`).
- Backup download validates filename shape, rejects symlinks, realpath-confines reads, and is admin-authenticated (`apps/web/src/app/api/admin/db/download/route.ts:1-101`).
- Raw SQL found in current code is either static DDL/reconciliation, MySQL advisory-lock plumbing, or parameterized queries; smart collection user input is compiled from allowlisted columns/operators and parameterized predicates (`apps/web/src/lib/smart-collections.ts:1-620`, `apps/web/src/app/actions/admin-users.ts:202-290`, `apps/web/scripts/migrate.js:188-268`).
- JSON-LD call sites use `safeJsonLd()`, which escapes `<`, `>`, U+2028, and U+2029 before `dangerouslySetInnerHTML` (`apps/web/src/lib/safe-json-ld.ts:14-19`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:126-138`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:118-130`).
- Atom feeds XML-escape text and attribute values and strip forbidden XML C0 controls (`apps/web/src/lib/atom-feed.ts:21-29`, `apps/web/src/lib/atom-feed.ts:107-164`).
- Production CSP uses script nonces rather than `unsafe-inline`/`unsafe-eval`, blocks objects, restricts base/form/frame ancestors, and validates optional image CDN origin shape (`apps/web/src/lib/content-security-policy.ts:1-25`, `apps/web/src/lib/content-security-policy.ts:98-123`, `apps/web/src/proxy.ts:21-49`).
- OG photo fetches are pinned to the configured canonical origin and validated fallback URLs are same-origin, avoiding request-origin SSRF/open redirect behavior (`apps/web/src/app/api/og/photo/[id]/route.tsx:38-299`, `apps/web/src/lib/seo-og-url.ts:3-43`).
- Public data helpers omit sensitive/admin-only fields with compile-time privacy guards; semantic/similar search enrichment has its own sensitive-key type guard (`apps/web/src/lib/data.ts:300-500`, `apps/web/src/lib/search-enrichment-fields.ts:1-47`).
- Public share pages use generic metadata, rate-limit lookup in the page body before DB access, and noindex/nocache semantics for revocable share URLs (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:1-132`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:1-240`).
- Localized feed route handlers self-validate locale because dotted route handlers bypass page layout and middleware guards (`apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:28-47`).
- Docker runtime drops to the `node` user after permission fixes; the standalone server binds localhost in the documented compose/nginx deployment (`apps/web/scripts/entrypoint.sh:4-42`, `apps/web/docker-compose.yml:1-27`, `apps/web/Dockerfile:1-150`).
- Deploy-time Docker pruning runs after `up -d` and prunes containers/images/build cache/dangling volumes only; documented persistence uses bind mounts and host MySQL rather than Docker volumes (`apps/web/deploy.sh:31-58`, `CLAUDE.md:462-464`).

## Verification Evidence

Commands run:

- `npm run lint --workspace=apps/web` - passed.
- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed.
- `npm audit --workspace=apps/web --audit-level=low --json` - passed with 0 vulnerabilities.
- `npm test --workspace=apps/web -- tracked-secrets privacy-fields api-auth-response-headers request-origin upload-paths serve-upload db-restore sql-restore-scan backup-download-route` - passed, 10 files / 77 tests.
- `npm test --workspace=apps/web -- content-security-policy next-config-uploads-headers nginx-config atom-feed seo-actions mysql-cli-ssl shared-route-rate-limit-source clip-semantic-limits-env` - passed, 8 files / 89 tests.

## Final Missed-Issues Sweep

Final sweep included:

- All route handlers, including non-API feed/upload routes.
- All server actions and action-origin exemptions.
- Admin API auth wrappers and public mutating route rate-limit coverage.
- `dangerouslySetInnerHTML`, JSON-LD, Atom/XML escaping, metadata and OG URL generation.
- Raw SQL, migration reconciliation, restore/import SQL scanner, advisory locks, and MySQL CLI use.
- Upload path construction, public file serving, original-file references, symlink/realpath checks, filename validation, and delete/unlink paths.
- Public API abuse surfaces: search, similar, OG, share pages, analytics actions, feeds, sitemap.
- Secrets/env examples, deploy scripts, Dockerfile, compose, nginx, entrypoint, backup/restore scripts, and dependency audit.

No security-relevant tracked source/config/script/migration files were intentionally skipped. I did not manually review third-party dependency source under `node_modules`, generated build output, or runtime uploaded/data files; those are outside current-HEAD source review and were covered only by dependency audit or excluded as runtime artifacts.
