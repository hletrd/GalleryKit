# Cycle 10 Security Review

Scope: comprehensive repository security review for `/Users/hletrd/flash-shared/gallery` at HEAD `ee8e08af`.

Reviewer role: security-reviewer, prompt 1 only. This review is read-only except for this report file.

## Result

No confirmed, likely, or risk findings requiring source changes were identified in current HEAD.

- Confirmed findings: none
- Likely findings: none
- Risk findings: none above informational threshold

This conclusion is based on manual review of the security-relevant repository inventory, cross-file control-flow checks, final pattern sweeps, dependency audit, and the repo's security-specific regression gates listed below.

## Inventory Reviewed

Primary security surfaces reviewed:

- Authentication and sessions: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`.
- Admin API auth and PATs: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Admin server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, protected admin pages under `apps/web/src/app/[locale]/admin/(protected)`.
- Upload and file serving: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- Database backup, restore, and migration helpers: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`.
- Public APIs and unauthenticated routes: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, public share/photo/topic/timeline/map pages.
- Data privacy and query boundaries: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/atom-feed.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/smart-collections.ts`.
- Configuration and deployment boundaries: `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`, `apps/web/src/db/index.ts`, `CLAUDE.md`, `AGENTS.md`.
- Security test/lint gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, and related tests under `apps/web/src/__tests__/`.

Repository route inventory built before review:

- Admin API route handlers: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Public API route handlers: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`.
- Server-action modules: `admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public pages reviewed for share-key, metadata, JSON-LD, feed, and upload-serving interactions: `[topic]`, `c/[slug]`, `g/[key]`, `map`, `p/[id]`, `s/[key]`, `timeline`, `year/[year]`, root gallery, and layouts.

## Evidence by Area

### Auth, Authz, and Session Boundary

- Login enforces same-origin provenance before rate-limit/authentication work in `apps/web/src/app/actions/auth.ts:92-95`, pre-increments both IP and account login buckets before Argon2 verification in `apps/web/src/app/actions/auth.ts:122-134`, checks the DB-backed buckets with includes-current-request semantics in `apps/web/src/app/actions/auth.ts:142-154`, and verifies a dummy Argon2 hash for missing users to reduce username timing enumeration in `apps/web/src/app/actions/auth.ts:173-176`.
- Successful login creates a fresh HMAC session token, inserts it, and deletes pre-existing sessions for that user inside one transaction in `apps/web/src/app/actions/auth.ts:201-223`. The cookie is `httpOnly`, production/TLS `secure`, `sameSite: 'lax'`, and scoped to `/` in `apps/web/src/app/actions/auth.ts:225-238`.
- Password changes require an authenticated current user and same-origin request in `apps/web/src/app/actions/auth.ts:283-298`, validate field shape and password length before charging the rate limiter in `apps/web/src/app/actions/auth.ts:300-334`, pre-increment before Argon2 verification in `apps/web/src/app/actions/auth.ts:336-363`, and rotate all sessions while inserting one fresh session in `apps/web/src/app/actions/auth.ts:381-411`.
- Production session signing refuses DB fallback and requires `SESSION_SECRET` with at least 32 characters in `apps/web/src/lib/session.ts:19-35`. Token verification uses HMAC-SHA256 with constant-time comparison and DB session lookup/expiry checks in `apps/web/src/lib/session.ts:94-151`.
- Admin API handlers are wrapped by `withAdminAuth`. Token-authenticated requests must present a valid scoped PAT, and cookie-authenticated requests must pass same-origin before `isAdmin()` in `apps/web/src/lib/api-auth.ts:64-118`; successful admin responses get no-store and nosniff defaults in `apps/web/src/lib/api-auth.ts:119-130`.

### Server Actions and CSRF

- Mutating server actions are covered by the source lint gate `apps/web/scripts/check-action-origin.ts`; the fresh run reported every mutating action either returns early on `requireSameOriginAdmin()` or is intentionally public/rate-limited.
- Read-only exemptions were reviewed as read-only surfaces: admin getters/status/list actions and public pagination/search actions. Public mutating analytics actions are explicitly public and rate-limited.
- `requireSameOriginAdmin()` delegates to the shared trusted-origin check; proxy trust is opt-in through `TRUST_PROXY`, matching deployment assumptions.

### Uploads and File Serving

- Browser upload path in `apps/web/src/app/actions/images.ts` was reviewed for authentication, same-origin, input sanitation, upload quota preclaims/settlement, disk-space checks, topic existence validation, GPS stripping, HDR policy, restore-maintenance checks, generated filenames, cleanup, and queue enqueue snapshotting.
- Lightroom upload path is protected by `withAdminAuth(..., { allowTokenScope: 'lr:upload' })` in `apps/web/src/app/api/admin/lr/upload/route.ts:60-65` and `apps/web/src/app/api/admin/lr/upload/route.ts:529-531`.
- LR uploads require `Content-Length`, reject chunked uploads, enforce declared-size quotas, and preclaim the upload tracker before body parsing in `apps/web/src/app/api/admin/lr/upload/route.ts:75-135`.
- LR file/topic/metadata inputs are validated and sanitized in `apps/web/src/app/api/admin/lr/upload/route.ts:145-218`; upload-processing contract locking prevents settings/restore races in `apps/web/src/app/api/admin/lr/upload/route.ts:220-236`.
- LR upload disk-space checks use `statfs().bavail` for the non-root `node` user in `apps/web/src/app/api/admin/lr/upload/route.ts:254-282`; HDR policy, GPS stripping, late restore-maintenance cleanup, generated DB values, original cleanup on post-save failure, and quota settlement are handled in `apps/web/src/app/api/admin/lr/upload/route.ts:284-453`.
- Uploaded derivative serving is constrained to `jpeg`, `webp`, and `avif`, requires safe path segments and matching file extensions, rejects symlinks/non-files, and uses `realpath` containment under the upload root in `apps/web/src/lib/serve-upload.ts:15-17` and `apps/web/src/lib/serve-upload.ts:127-189`.
- Nginx blocks `/uploads/original/` and only proxies expected derivative paths in `apps/web/nginx/default.conf:163-183`.

### DB Backup and Restore

- Backup creation requires admin auth and same-origin, writes into `data/backups` with owner-only directory/file modes, avoids password CLI arguments by using `MYSQL_PWD`, sanitizes stderr, checks non-empty output, and returns only an authenticated download URL in `apps/web/src/app/[locale]/admin/db-actions.ts:119-242`.
- Restore requires admin auth and same-origin, holds DB restore, upload-processing, and backfill advisory locks, enters restore maintenance, quiesces image processing, releases locks in `finally`, and resumes work after a verified lifecycle in `apps/web/src/app/[locale]/admin/db-actions.ts:266-418`.
- Restore uploads are capped, streamed to a `0600` temp file, require a plausible dump header, and are scanned chunk-by-chunk before invoking `mysql --one-database` with sanitized stderr in `apps/web/src/app/[locale]/admin/db-actions.ts:423-590`.
- Post-restore migrations resolve a local `scripts/migrate.js` path and execute `process.execPath` with sanitized stderr in `apps/web/src/app/[locale]/admin/db-actions.ts:598-641`.
- The SQL restore scanner allows only expected app backup `DROP TABLE IF EXISTS` lines and blocks privilege, database, destructive table, file-write, routine/trigger/view, plugin, prepared-statement, and global-setting SQL patterns in `apps/web/src/lib/sql-restore-scan.ts:12-105`. It unwraps MySQL executable conditional comments before scanning in `apps/web/src/lib/sql-restore-scan.ts:113-132`.
- Authenticated backup download validates the backup filename and uses path resolution, realpath, lstat, symlink rejection, no-store, and nosniff in `apps/web/src/app/api/admin/db/download/route.ts:22-87`.

### Public API, Privacy, and Injection/XSS Surfaces

- Public semantic search requires same-origin, content-type and body caps, rate-limit preincrement, production/stub mode gating, query length validation, model-version filtering, and public-field enrichment in `apps/web/src/app/api/search/semantic/route.ts`.
- Similar-image search validates the numeric ID, applies rate limiting, production mode gating, model-version filtering, and public enrichment in `apps/web/src/app/api/search/similar/[id]/route.ts`.
- OG image endpoints are per-IP rate-limited, sanitize text, avoid request-origin SSRF by pinning internal derivative fetches to configured site origin, and cap fetched derivative bytes.
- Share-key pages avoid metadata-time key lookups, apply a shared lookup rate limit in the page body, use noindex/nocache robots metadata, and resolve images/groups through public data helpers in `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`.
- Public field sets explicitly omit admin-only/PII/internal image fields in `apps/web/src/lib/data.ts:367-407`; map public fields permit latitude/longitude only for the map-visible path in `apps/web/src/lib/data.ts:409-444`; compile-time guards catch sensitive-field drift in `apps/web/src/lib/data.ts:458-506`.
- Public share queries use `publicSelectFields`, require processed images, validate base56 group keys, enforce expiry, and cap group image reads to 100 in `apps/web/src/lib/data.ts:1182-1282`.
- JSON-LD uses a safe serializer that escapes HTML-significant characters, and the raw HTML sweep found only JSON-LD insertion sites.
- Atom feeds route all values through XML escaping and emit bounded, cacheable feed responses.

### Secrets and Configuration

- Tracked-secret regression test passed. Manual secret-pattern sweep found placeholders, docs, tests, schema column names, or historical plan text rather than live credentials in tracked application code.
- Dependency audit returned `found 0 vulnerabilities`.
- DB connections enable TLS for non-localhost DB hosts unless `DB_SSL=false` is explicitly set in `apps/web/src/db/index.ts:6-37`; CLI migration/backup helpers use the same TLS policy through `apps/web/scripts/mysql-connection-options.js`.
- Runtime container binds Next to `127.0.0.1`, runs with `TRUST_PROXY=true` behind nginx, and uses host nginx for public ingress, headers, and body/rate limits in `apps/web/docker-compose.yml:1-21`, `apps/web/Dockerfile`, and `apps/web/nginx/default.conf`.

## OWASP Top 10 Coverage

- A01 Broken Access Control: admin pages/actions/API routes reviewed; admin API wrapper lint passed; public data selectors omit admin-only fields; share keys are random, noindex, rate-limited, and expiry-aware.
- A02 Cryptographic Failures: Argon2id password hashing, HMAC session signing, secure cookie flags, production `SESSION_SECRET` requirement, DB TLS for non-localhost, PATs hashed at rest.
- A03 Injection: Drizzle/mysql2 parameter binding used on reviewed queries; restore SQL scanner blocks high-risk statements; CSV/XML/JSON-LD outputs escape dangerous characters; smart collection DSL compiles from allowlisted columns/operators.
- A04 Insecure Design: upload/restore/settings race locks, maintenance mode, queue quiescing, privacy field guards, and route lint gates are explicit design controls.
- A05 Security Misconfiguration: CSP, no-store/nosniff/admin API defaults, nginx request caps/rate limits, HSTS, object-src none, and container non-root runtime reviewed.
- A06 Vulnerable and Outdated Components: `npm audit --workspace=apps/web --audit-level=moderate` returned no vulnerabilities.
- A07 Identification and Authentication Failures: brute-force controls, account-scoped rate limits, session fixation controls, password-change session rotation, and PAT scope checks reviewed.
- A08 Software and Data Integrity Failures: restore header/scanner checks, post-restore migrations, migration journal/test gates, and CLIP model download notes reviewed.
- A09 Security Logging and Monitoring Failures: login success/failure, backup/restore, PAT upload, and share/admin actions log audit events without raw sensitive values on the reviewed paths.
- A10 SSRF: OG derivative fetch path pins configured origin and constructed upload paths; public/image URLs are derived from validated config, not arbitrary request input.

## Final Missed-Issues Sweep

Commands and results:

- `npm run lint:api-auth --workspace=apps/web` -> passed; both admin API route handlers reported `OK`.
- `npm run lint:action-origin --workspace=apps/web` -> passed; all mutating server actions enforce same-origin provenance or carry reviewed read-only/public exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed; public mutating API route scan found rate-limit coverage.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/content-security-policy.test.ts` -> 7 files passed, 107 tests passed.
- `npm audit --workspace=apps/web --audit-level=moderate` -> `found 0 vulnerabilities`.
- `rg` sweeps for `dangerouslySetInnerHTML`, `eval`, `new Function`, `child_process`, `spawn`, SQL destructive patterns, API handler exports, auth wrapper use, exemption comments, and secret-like tokens were reviewed. Hits resolved to JSON-LD insertion with safe serialization, bounded DB backup/restore process execution, migration/test code, vetted SQL scanner patterns, placeholders/docs/tests, or expected admin/API wrappers.

## Residual Risk Notes

- Plaintext DB backups are intentionally stored at rest under owner-only permissions (`data/backups`, `0700` directory and `0600` files). This matches the documented personal-gallery threat model, but operators needing stronger host-level isolation should add encrypted backup storage or short retention outside the app.
- `TRUST_PROXY=true` is correct for the documented nginx topology because nginx overwrites forwarded IP headers; direct exposure of the Node listener would weaken rate-limit attribution. The container config binds `HOSTNAME=127.0.0.1`, so this is not a current finding.

## Stop Condition

Security review prompt 1 is complete: inventory built, relevant files and cross-file interactions reviewed, final missed-issues sweep performed, no confirmed/likely/risk findings requiring source changes found, and evidence recorded here.
