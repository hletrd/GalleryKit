# Cycle 38 Security Review - Security Reviewer

Date: 2026-07-08 17:32 KST
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `746b3e118a5463970ffd1b3f69b4ecc13b565451`
Reviewer role: cycle-38 security-reviewer
Mode: review-only. No production code or config was changed.

## Provenance

Required guidance read before review:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/security-review/SKILL.md`

Repository coverage method:

- Enumerated tracked repository size with `git ls-files`: 3641 tracked files.
- Built the live security inventory before reviewing code.
- Enumerated all live App Router route handlers, server actions, and the admin DB action module: 26 files.
- Used source-wide greps for auth wrappers, origin checks, rate limit helpers, filesystem access, child processes, SQL execution, `dangerouslySetInnerHTML`, URL/fetch use, secret names, upload paths, backup/restore, and privacy-sensitive fields.
- Read cross-file flows instead of isolated files: browser admin session -> server actions/API wrappers -> origin checks -> rate limits -> data/storage; PAT upload -> token verification -> upload processing; public search/similar -> rate limits -> enrichment selects; backup/restore -> admin action -> child process -> SQL scan -> maintenance locks -> download route; upload serving -> nginx/Next headers -> realpath containment.

Relevant files skipped: none from the live security-relevant source/config inventory. I did not line-by-line review generated or non-source attack surfaces such as `node_modules`, `.next` output, runtime `data/uploads`, binary/image/font assets, or untracked local secret values. Historical `.context` review/plan artifacts were inventoried for provenance but not treated as live request-handling code.

## Security-Relevant Inventory

### Auth, Session, Origin, And Admin Boundaries

- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/password-hashing.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/admin-mutation-barrier.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`

### Route And Action Surfaces

- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`

### Uploads, Filesystem, Path Traversal, Image Processing

- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/gps-exif-strip.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-processing-contract-lock.ts`

### Public Data, Privacy, Search, Sharing

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`

### XSS, CSP, SSRF, OG, Structured Data

- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/csp-nonce.ts`
- `apps/web/next.config.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/seo-og-url.ts`
- Public pages using JSON-LD script injection under `apps/web/src/app/[locale]/(public)/**/page.tsx`

### Backup, Restore, Migrations, Deployment, Secrets

- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/db-child-watchdog.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/drizzle/**/*.sql`
- `apps/web/drizzle/meta/_journal.json`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `.github/workflows/quality.yml`
- `apps/web/.env.local.example`
- `.env.deploy.example`

## Findings

### Confirmed Issues

None found.

### Likely Issues

None found.

### Manual-Validation Risks

#### SEC-C38-MV-01: Live edge/IP topology can collapse rate-limit keys if host nginx is not applied for the real deployment shape

- Severity: Medium
- Confidence: High that the repo carries the risk; production impact requires live-host validation.
- Classification: Manual-validation risk.
- OWASP: A05 Security Misconfiguration, A04 Insecure Design.
- File / region:
  - `apps/web/nginx/default.conf:20-28` documents that nginx `limit_req_zone` keys use `$binary_remote_addr`, so LB-fronted installs also need `ngx_http_realip_module` or PROXY protocol.
  - `apps/web/nginx/default.conf:52-71` says the shipped template is an internal HTTP-hop template and that `X-Forwarded-For` overwrite is correct only when the TCP peer is the real client.
  - `apps/web/nginx/default.conf:274-295` applies the public catch-all limiter but states this config is not touched by deploys and must be manually applied/reloaded.
  - `apps/web/src/lib/request-origin.ts:71-107` and `apps/web/src/lib/rate-limit.ts` depend on trusted proxy/header configuration for canonical request provenance and client-IP buckets.
- Failure scenario: production sits behind a CDN/LB whose TCP peer is a load balancer, but the host nginx still uses `$remote_addr`/`$binary_remote_addr` without real-IP restoration, or the checked-in template changed but the host was not reloaded. All visitors share one effective limiter bucket. One abusive client can lock out login/search/page budgets for legitimate users, and operators may believe the public SSR flood limiter is active while the live host is still using an older config.
- Concrete fix: add an operator smoke check that captures `nginx -T` or an equivalent live config fingerprint after deploys affecting `apps/web/nginx/default.conf`. For LB-fronted deployments, configure `set_real_ip_from` and `real_ip_header X-Forwarded-For` or PROXY protocol before the `limit_req_zone` keys are evaluated; append rather than overwrite `X-Forwarded-For` on app-facing proxy hops; set `TRUSTED_PROXY_HOPS` to the actual trusted chain. Add a documented verification command to the deploy checklist.

#### SEC-C38-MV-02: Database backups are intentionally plaintext at rest and rely on host/operator controls

- Severity: Medium
- Confidence: High.
- Classification: Manual-validation risk, not a confirmed bug under the documented personal-gallery threat model.
- OWASP: A02 Cryptographic Failures, A05 Security Misconfiguration.
- File / region:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:177-195` writes backups under `data/backups` and creates the directory owner-only.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:235-244` streams `mysqldump` output into a temp backup file with mode `0600`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:302-359` validates dump header/trailer and atomically renames the temp file to the listable backup path.
  - `apps/web/src/app/api/admin/db/download/route.ts:21-89` allows authenticated admins to download the backup after filename validation, realpath containment, and audit logging.
- Failure scenario: if the host account, backup directory, filesystem snapshot, off-host backup sync, or NAS mount is compromised, the attacker gets plaintext SQL containing session hashes, admin-token hashes, audit metadata, photo metadata, share records, and any private operational state in the app database. The source code mitigates web access and local Unix permissions but does not encrypt backup contents before writing to disk.
- Concrete fix: if the deployment threat model includes host-user compromise or off-host backup sync, add optional public-key encryption for generated SQL backups before publishing them under `data/backups` (for example age/GPG with an operator-provided public key), and make the download route serve only encrypted artifacts unless an explicit break-glass mode is enabled. Keep the current `0600`/`0700` controls as defense in depth.

#### SEC-C38-MV-03: Admin PATs may be created without expiry

- Severity: Low to Medium, depending on how Lightroom/API tokens are handled operationally.
- Confidence: High.
- Classification: Manual-validation risk.
- OWASP: A07 Identification and Authentication Failures.
- File / region:
  - `apps/web/src/lib/admin-tokens.ts:21-40` defines long random PATs with nullable `expiresAt`.
  - `apps/web/src/lib/admin-tokens.ts:142-169` verifies a token and enforces expiry only when `expires_at` is present.
  - `apps/web/src/lib/admin-tokens.ts:206-227` inserts `expiresAt ?? null`.
  - `apps/web/src/app/actions/lr-tokens.ts:80-101` validates provided expiry but leaves `expiresAt` as `null` when omitted.
- Failure scenario: an admin creates a Lightroom token without an expiry, copies it to a laptop or external publish client, and that client/token later leaks. The token remains usable until explicit revocation. Scope checks reduce blast radius (`lr:upload` today), token hashes protect the DB at rest, and attempts are rate-limited, but a leaked plaintext token is a bearer credential with no automatic decay.
- Concrete fix: require an expiry at token creation, or default omitted expiries to a bounded lifetime such as 90 days. If never-expiring service tokens are required, make them an explicit privileged choice with a warning, audit metadata, and a periodic stale-token review in the admin UI.

## Evidence By Area

### Auth/Authz And CSRF

- `apps/web/src/lib/session.ts:16-36` refuses a database-stored session-secret fallback in production and requires `SESSION_SECRET`.
- `apps/web/src/lib/session.ts:82-150` signs tokens with HMAC, stores only SHA-256 token hashes, bounds session age, and verifies signatures with timing-safe comparison.
- `apps/web/src/app/actions/auth.ts:100-177` applies same-origin checks, mutation-barrier admission, pre-incremented per-IP and per-account login rate limits, DB-backed verification, and rollback only before auth work.
- `apps/web/src/app/actions/auth.ts:240-253` sets session cookies `httpOnly`, `sameSite=lax`, `secure` in production or HTTPS, path `/`, and bounded `maxAge`.
- `apps/web/src/lib/request-origin.ts:47-68` anchors expected origin to `BASE_URL` or production `siteConfig.url` before header inference.
- `apps/web/src/lib/request-origin.ts:118-146` fails closed unless `Origin` or `Referer` matches the expected origin.
- `apps/web/src/lib/api-auth.ts:66-152` centralizes admin API auth, enforces origin for cookie auth, restricts PAT auth to route-declared scopes, clears request-scoped token context, and adds no-store/nosniff defaults.
- Validation: `npm run lint:api-auth --workspace=apps/web` passed. `npm run lint:action-origin --workspace=apps/web` passed.

### Admin APIs, Actions, And PATs

- `apps/web/src/lib/admin-tokens.ts:53-90` creates 32-byte random `gk_` tokens, stores SHA-256 hashes, and validates presented token format before DB lookup.
- `apps/web/src/lib/admin-tokens.ts:142-169` looks up by hash, joins to an admin user, constant-time compares the stored hash, checks expiry, and returns only token id/user/scopes.
- `apps/web/src/app/api/admin/lr/upload/route.ts` is included in the `lint:api-auth` pass and must export through `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`.
- `apps/web/src/app/actions/lr-tokens.ts:35-48` blocks token creation during restore maintenance, requires same-origin, holds the admin mutation barrier, and verifies admin identity.
- `apps/web/src/app/actions/lr-tokens.ts:80-101` validates expiry when supplied and rejects invalid or past dates.

### Rate Limits

- Login has per-IP and account-scoped buckets and pre-increments before Argon2 verification in `apps/web/src/app/actions/auth.ts:100-177`.
- Admin token attempts are pre-incremented in `apps/web/src/lib/api-auth.ts:80-90`.
- Public route linting passed for expensive public routes and mutating public handlers.
- `apps/web/nginx/default.conf:1-19` defines edge limit zones for login, admin, public SSR, and Next image optimization.
- `apps/web/nginx/default.conf:254-263` protects `/_next/image` with a dedicated limiter rather than leaving Sharp/cache writes unlimited.
- Validation: `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

### Uploads, Path Traversal, And Filesystem

- `apps/web/src/lib/upload-filenames.ts:27-33` reduces user filenames to a sanitized basename and rejects empty or over-255-byte names.
- `apps/web/src/lib/upload-paths.ts:49-66` creates private original storage and derivative directories.
- `apps/web/src/lib/upload-paths.ts:120-170` validates original filenames, blocks absolute paths and basename mismatches, rejects symlinks, and checks realpath containment.
- `apps/web/src/lib/serve-upload.ts:162-180` requires at least a top-level format and filename, limits top-level directories to `jpeg|webp|avif`, and validates extension/directory consistency.
- `apps/web/src/lib/serve-upload.ts:181-384` validates every path segment, rejects symlink traversal, checks root/file realpaths, opens the validated file before streaming, emits stable cache/nosniff headers, and closes file handles on error/abort.
- `apps/web/nginx/default.conf:206-208` blocks `/uploads/original/` at the edge.
- Validation: targeted `serve-upload` and `upload-paths` tests passed.

### SSRF, XSS, And CSP

- `apps/web/src/lib/content-security-policy.ts:15-40` only accepts absolute `http(s)` image base URLs, rejects credentials/query/hash, and requires HTTPS in production.
- `apps/web/next.config.ts:87-92` sets a restrictive production CSP for `/api/*`: `default-src 'none'; frame-ancestors 'none'; sandbox`.
- `apps/web/src/proxy.ts:36-52` generates a per-request nonce and CSP for production page responses.
- `apps/web/src/lib/safe-json-ld.ts:14-20` JSON-serializes structured data and escapes `<`, `>`, U+2028, and U+2029.
- Public `dangerouslySetInnerHTML` JSON-LD sites call `safeJsonLd`, for example `apps/web/src/app/[locale]/(public)/page.tsx:214-230`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:270-284`, and `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:220-226`.
- Source grep for `dangerouslySetInnerHTML` found only JSON-LD script injection paths using this helper.

### Backup, Restore, SQL, And Migrations

- `apps/web/src/app/[locale]/admin/db-actions.ts:158-176` requires restore-maintenance clear, same-origin admin provenance, and admin authorization before backup.
- `apps/web/src/app/[locale]/admin/db-actions.ts:189-244` creates backup directory/files as owner-only and passes DB password via `MYSQL_PWD` env instead of CLI args while excluding `HOME`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:302-359` rejects empty/truncated/malformed dumps and atomically publishes only validated dumps.
- `apps/web/src/app/[locale]/admin/db-actions.ts:421-610` requires same-origin/admin, takes DB restore, upload-processing, and backfill advisory locks, and starts durable restore maintenance before import.
- `apps/web/src/app/[locale]/admin/db-actions.ts:789-913` caps restore file size, writes temp SQL as `0600`, verifies plausible dump header/trailer, scans chunks with boundary bridging, and rejects dangerous SQL.
- `apps/web/src/app/[locale]/admin/db-actions.ts:915-979` invokes `mysql --one-database` with sanitized/minimal env and redacted stderr.
- `apps/web/src/lib/sql-restore-scan.ts:88-156` blocks grants, user changes, arbitrary table/database drops, temp tables, truncates/deletes, routines, triggers, views, events, plugins, global settings, prepared statements, and other dangerous statements.
- `apps/web/src/app/api/admin/db/download/route.ts:21-89` uses `withAdminAuth`, validates backup filenames, verifies path and realpath containment, streams from the validated file handle, and sets no-store/nosniff headers.
- `apps/web/scripts/migrate.js` and `apps/web/drizzle/meta/_journal.json` were reviewed for migration baseline/journal behavior described in `AGENTS.md`; the restore path reruns migrations after import.

### Privacy Leakage

- `apps/web/src/lib/data.ts:368-407` derives `publicSelectFields` by omitting GPS, original filename, user filename, original format/size, processing state, HDR/color pipeline details, upload user id, errors, processing JSON, ICC/color fields, and pipeline version.
- `apps/web/src/lib/data.ts:409-444` has a separate `publicMapSelectFields` path that intentionally allows only latitude/longitude beyond the public field set and documents the required `map_visible` filter.
- `apps/web/src/lib/data.ts:458-488` has compile-time guards to keep privacy-sensitive keys out of public selects and out of map selects except GPS.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` centralizes public semantic/similar enrichment fields and guards them against `PrivacySensitiveKeys`.
- `apps/web/src/__tests__/privacy-fields.test.ts:41-70` defines the privacy-sensitive contract and `apps/web/src/__tests__/privacy-fields.test.ts:125-161` asserts public keys omit sensitive fields and that admin-only keys exactly match the sensitive contract.
- Validation: targeted privacy tests passed.

### Secrets And Supply Chain

- I did not read untracked local secret values. The local `.env.deploy` and `apps/web/.env.local` are untracked operational files.
- Source grep for secret assignment patterns found placeholders/test identifiers and code references, not obvious live tracked credentials.
- `apps/web/src/lib/sanitize.ts:117-141` redacts child-process stderr for actual DB password and common credential patterns.
- `apps/web/src/lib/mysql-cli-ssl.ts:11-24` requires CA-backed MySQL CLI TLS for non-local hosts unless `DB_SSL=false`.
- `apps/web/scripts/mysql-connection-options.js:13-29` requires CA-backed runtime MySQL TLS for non-local hosts unless `DB_SSL=false`.
- Validation: `npm run audit:prod` passed with `found 0 vulnerabilities`.

## Validation Commands

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run audit:prod`
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/serve-upload.test.ts src/__tests__/upload-paths.test.ts src/__tests__/upload-filenames.test.ts src/__tests__/request-origin.test.ts src/__tests__/content-security-policy.test.ts`

Targeted test result: 13 files, 339 tests passed.

Not run:

- Full `npm test --workspace=apps/web`, full `npm run build --workspace=apps/web`, and Playwright e2e. The task was review-only; targeted security validation plus required guard/audit gates were run.

## Final Missed-Issue Sweep

Final sweep checked:

- OWASP Top 10 categories against the live app surface.
- Admin API exports and server-action provenance.
- Same-origin handling and proxy-derived origin/IP assumptions.
- Public and admin rate-limit gates.
- Upload filename, directory, symlink, realpath, and derivative serving behavior.
- SSRF-like URL/fetch paths, especially OG and image-base configuration.
- XSS paths, especially structured-data `dangerouslySetInnerHTML`.
- CSP for pages and API routes.
- Secret patterns in tracked source and env examples.
- Backup creation, backup download, restore upload, SQL scanning, child-process env/stderr, and migration post-restore behavior.
- Privacy leakage through public selects, map selects, share routes, search/similar enrichment, and tests.
- Deployment scripts and nginx/Docker posture.

Final status: no confirmed or likely source-code vulnerability was found in the reviewed repository state. The remaining risks are operational/manual-validation items listed above.
