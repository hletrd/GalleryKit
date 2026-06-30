# Cycle 28 Security Reviewer Report

Date: 2026-06-30
Role: security-reviewer
Scope: Entire repository under `/Users/hletrd/flash-shared/gallery`
Mode: Review/report update only. No application source code changes made.

## Inventory

Reviewed the repository under the security-reviewer brief for OWASP Top 10, auth/authz, CSRF/same-origin, rate limits, path traversal, unsafe raw SQL, secrets, SSRF, upload safety, and admin/public privacy separation.

Primary docs and policy sources reviewed:
- `AGENTS.md` instructions provided in the user prompt, including autonomy, commit/deploy policy, security-review output requirements, and project-specific quality gates.
- `CLAUDE.md` security architecture, environment-variable guidance, permanently deferred decisions, schema/migration rules, and lint gates.
- Prior review state in `.context/reviews/security-reviewer.md`, especially Cycle 27 risks and the closed Cycle 26 restore-scanner finding.
- Deferred/permanent-policy references, including `CLAUDE.md:569-570` for 2FA/WebAuthn and paid-download/Stripe non-goals. These are not re-filed.

Repository inventory method:
- `git ls-files` reported 2598 tracked files. The current live review inventory was narrowed by security relevance, not by sampling: all current source, app routes, server actions, API routes, libraries, scripts, migrations, deployment config, CI config, tracked env examples, docs, and security-relevant tests were inventoried.
- The generated current-code/config/doc inventory contained 620 tracked files, covering `.github/**`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/**`, root scripts, package manifests/lockfiles, `apps/web/{Dockerfile,deploy.sh,docker-compose.yml,nginx/default.conf,next.config.ts,drizzle.config.ts,playwright.config.ts,tsconfig*}`, `apps/web/drizzle/**`, `apps/web/messages/**`, `apps/web/public/**`, `apps/web/scripts/**`, `apps/web/e2e/**`, and `apps/web/src/**`.
- `apps/web/src` contains 512 TypeScript/JavaScript source/test files. Security-sensitive application files were reviewed by full inventory plus repo-wide pattern sweeps for route handlers, server actions, auth wrappers, origins, cookies, upload paths, SQL, child processes, filesystem access, secrets, redirects, fetches, and privacy field exposure.
- `.context/reviews/**`, `.context/plans/**`, and `plan/**` historical artifacts were checked for prior security context and regressions, but were not treated as live runtime attack surface.

Review-relevant source categories inventoried and examined:
- Admin API auth wrappers and PAT auth: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/api/admin/**`.
- Server actions and same-origin gates: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`.
- Session/auth/rate-limit internals: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`.
- Upload and image serving: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- DB backup/restore and raw SQL boundaries: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/scripts/*`.
- Public routes and privacy selectors: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/**`, `apps/web/src/app/api/og/**`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- Security headers and deployment proxy config: `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/src/proxy.ts`.
- Secrets/dependency surfaces: tracked repo grep for secret/key/password/token assignment patterns, `npm audit`, package manifests/lockfile.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed. Confirmed both admin API routes export through `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed. Confirmed all scanned mutating server actions enforce `requireSameOriginAdmin()` or carry an explicit exempt comment.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed. Confirmed public mutating API route coverage for rate limiting.
- `npm audit --workspace=apps/web --json`: passed with `total: 0` vulnerabilities across 724 dependencies.
- Focused Vitest suite passed: 25 files, 355 tests.
  - Included `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`, `privacy-fields`, `search-route-privacy`, `sql-restore-scan`, `serve-upload`, `upload-paths`, `uploads-route-method-wiring`, `request-origin`, `api-auth-response-headers`, `session-verify`, `sanitize-stderr`, `csv-escape`, `tracked-secrets`, `admin-tokens`, `semantic-search-rate-limit`, `lr-upload-hdr-gate`, `backup-download-route`, `content-security-policy`, `db-restore`, `gps-exif-strip-isobmff`, `map-privacy`, `restore-upload-lock`, and `mysql-cli-ssl`.
- Tracked secret grep found environment variable names, documentation placeholders, tests, and historical-deferred references, but no committed private key or live token pattern in tracked HEAD.

## Confirmed Issues

None.

## Likely Issues

None.

## Risks Needing Manual Validation

### RV-28-01 - Medium - Proxy/header trust and TLS edge assumptions must match production

Confidence: Medium

Location:
- `apps/web/src/lib/request-origin.ts:5-7`
- `apps/web/src/lib/request-origin.ts:55-68`
- `apps/web/src/lib/request-origin.ts:83-107`
- `apps/web/nginx/default.conf:25-30`
- `apps/web/nginx/default.conf:67-71`
- `apps/web/nginx/default.conf:83-88`
- `apps/web/nginx/default.conf:140-145`
- `apps/web/nginx/default.conf:187-197`

What I verified:
The application fails closed for same-origin checks unless `Origin` or `Referer` matches the expected request origin (`request-origin.ts:83-107`). When `TRUST_PROXY=true`, the expected origin is derived from trusted forwarded headers (`request-origin.ts:5-7`, `request-origin.ts:55-68`). The checked-in nginx config overwrites `X-Forwarded-Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` before proxying to Next (`nginx/default.conf:67-71`, `83-88`, `140-145`, `187-197`) and documents that port 80 is an internal hop behind TLS, not the public cleartext edge (`nginx/default.conf:25-30`).

Failure scenario:
If production runs with `TRUST_PROXY=true` while requests can reach Next.js or an intermediate proxy without header overwrite/sanitization, a client-controlled `X-Forwarded-Host`/`X-Forwarded-Proto` chain could change the origin that same-origin checks compare against. If the nginx listener is exposed as the public HTTP edge instead of being behind TLS termination, the HSTS/header posture would not by itself provide transport security.

Suggested fix / validation:
Operationally validate that the public edge terminates HTTPS, redirects cleartext traffic before the internal nginx hop, and strips or overwrites inbound `X-Forwarded-*` headers. Leave `TRUST_PROXY=false` for direct-to-Next deployments. If this app is deployed behind a different proxy, copy the header-overwrite behavior from `apps/web/nginx/default.conf`.

### RV-28-02 - Medium - DB restore blast radius still depends on MySQL account least privilege

Confidence: Medium

Location:
- `apps/web/src/lib/sql-restore-scan.ts:12-31`
- `apps/web/src/lib/sql-restore-scan.ts:39-59`
- `apps/web/src/lib/sql-restore-scan.ts:210-251`
- `apps/web/src/app/[locale]/admin/db-actions.ts:618-647`
- `apps/web/src/app/[locale]/admin/db-actions.ts:672-678`

What I verified:
The Cycle 26 restore-scanner issue is fixed in current source. The scanner keeps an explicit app-table allowlist (`sql-restore-scan.ts:12-31`), extracts write targets for `CREATE TABLE`, `ALTER TABLE`, `INSERT INTO`, `REPLACE`, and `UPDATE` (`sql-restore-scan.ts:39-59`), rejects schema-qualified targets and writes to tables outside `APP_BACKUP_TABLES` (`sql-restore-scan.ts:210-239`), and applies that check before the dangerous-SQL denylist (`sql-restore-scan.ts:242-251`). The restore action scans the uploaded dump before invoking the MySQL client (`db-actions.ts:618-647`) and still runs `mysql --one-database DB_NAME` for import (`db-actions.ts:672-678`).

Failure scenario:
A future scanner blind spot or MySQL grammar edge case would have a much larger impact if the GalleryKit DB user has grants outside the application schema. `--one-database` is useful defense-in-depth but should not be the only containment layer for a restore process that executes SQL from an uploaded admin file.

Suggested fix / validation:
Verify the production MySQL user has only the minimum needed privileges on `DB_NAME.*` and no grants on sibling schemas, global objects, routines, users, or files. Keep the restore scanner allowlist tests in the focused security suite whenever restore grammar changes.

### RV-28-03 - Low - Gitignored runtime secret files were intentionally not inspected

Confidence: High

Location:
- `apps/web/src/lib/session.ts:19-35`
- `README.md:134-143`
- `CLAUDE.md:79-86`
- `apps/web/deploy.sh:18`
- `apps/web/.env.local.example:18-30`
- `.env.deploy.example:1-14`

What I verified:
Tracked source requires a production `SESSION_SECRET` of at least 32 characters and refuses the DB fallback in production (`session.ts:19-35`). Tracked documentation and env examples use placeholders for DB/admin/session values (`README.md:134-143`, `CLAUDE.md:79-86`, `apps/web/.env.local.example:18-30`, `.env.deploy.example:1-14`). The deploy script requires local env files for real credentials (`apps/web/deploy.sh:18`). I did not read gitignored runtime secret files such as `.env.deploy` or `.env.local`.

Failure scenario:
If a local or production gitignored env file contains weak, reused, or historically leaked credentials, the tracked source review will not detect it. This is an operational secret-management risk, not a confirmed repository leak.

Suggested fix / validation:
Manually validate production `SESSION_SECRET`, DB credentials, admin bootstrap secrets, and PATs in the real secret store. Rotate values if they were ever copied from historical checked-in examples or shared in logs/tickets. Do not commit those files.

## Confirmed Controls And Cross-File Interactions

### Auth, Authz, And CSRF / Same-Origin

- Admin API cookie requests run through `withAdminAuth`, which verifies same-origin before cookie auth (`apps/web/src/lib/api-auth.ts:114-123`) and adds `no-store`/`nosniff` headers on success (`apps/web/src/lib/api-auth.ts:130-141`).
- PAT-authenticated requests are limited to explicitly allowed scopes (`apps/web/src/lib/api-auth.ts:68-84`), are rate-limited before token verification (`apps/web/src/lib/api-auth.ts:75-81`), and clear request-scoped token context after handler completion (`apps/web/src/lib/api-auth.ts:85-91`).
- Same-origin checks fail closed when no matching `Origin` or `Referer` is present (`apps/web/src/lib/request-origin.ts:83-107`).
- Session tokens are HMAC-signed (`apps/web/src/lib/session.ts:82-88`), verified with `timingSafeEqual` (`apps/web/src/lib/session.ts:107-118`), shape-checked after crypto verification (`apps/web/src/lib/session.ts:121-126`), age-limited (`apps/web/src/lib/session.ts:127-134`), and stored as SHA-256 hashes in the DB (`apps/web/src/lib/session.ts:8-11`, `apps/web/src/lib/session.ts:136-150`).
- Production refuses missing/short `SESSION_SECRET` (`apps/web/src/lib/session.ts:19-35`).

### Rate Limits And Request Size Controls

- Admin API token attempts are pre-increment rate-limited in the auth wrapper (`apps/web/src/lib/api-auth.ts:75-81`).
- Public semantic search requires same-origin (`apps/web/src/app/api/search/semantic/route.ts:107-111`), rejects chunked bodies (`semantic/route.ts:136-145`), requires bounded `Content-Length` (`semantic/route.ts:147-167`), rate-limits before DB-backed mode lookup (`semantic/route.ts:173-184`), validates JSON/query size (`semantic/route.ts:206-245`), and caps the embedding scan (`semantic/route.ts:263-279`).
- Edge nginx body caps and rate-limit zones are scoped by route class: login/admin zones (`apps/web/nginx/default.conf:1-4`), small default body cap (`nginx/default.conf:31-35`), restore cap (`nginx/default.conf:74-89`), dashboard upload cap (`nginx/default.conf:91-106`), PAT upload cap (`nginx/default.conf:124-146`), and generic admin API cap (`nginx/default.conf:148-163`).

### Upload Safety And Path Traversal

- Browser uploads require same-origin and current user before file handling (`apps/web/src/app/actions/images.ts:114-127`), reject invalid user filenames using the shared safe filename helper (`images.ts:166-173`), and hold the upload-processing contract lock while reading settings and writing rows (`images.ts:175-190`).
- Browser uploads reject HDR when disabled (`apps/web/src/app/actions/images.ts:360-367`), strip GPS from DB fields and retained originals when configured (`images.ts:388-402`), and re-check restore maintenance after the original is saved (`images.ts:404-416`).
- Delete paths validate all DB filenames before filesystem deletion (`apps/web/src/app/actions/images.ts:651-671`) and then remove originals/derivatives through strict helpers (`images.ts:707-716`).
- PAT Lightroom uploads share the same safety posture: scoped `withAdminAuth(..., { allowTokenScope: 'lr:upload' })` (`apps/web/src/app/api/admin/lr/upload/route.ts:68-75`, `route.ts:553-555`), content-length and per-file/cumulative upload limits (`route.ts:85-137`), safe filename validation (`route.ts:175-186`), topic validation (`route.ts:188-241`), contract lock (`route.ts:243-259`), disk-space check using `bavail` (`route.ts:277-305`), HDR rejection (`route.ts:348-365`), GPS stripping from originals (`route.ts:367-385`), late restore-maintenance cleanup (`route.ts:388-402`), and guaranteed lock release (`route.ts:548-552`).
- Public derivative serving restricts top-level upload dirs to `jpeg`, `webp`, and `avif` (`apps/web/src/lib/serve-upload.ts:14-16`, `serve-upload.ts:136-148`), validates every path segment (`serve-upload.ts:153-160`), rejects symlinks and enforces realpath containment (`serve-upload.ts:169-182`), serves only files from an already opened descriptor (`serve-upload.ts:183-190`, `serve-upload.ts:269-305`), and emits `nosniff` (`serve-upload.ts:237-263`).

### DB Backup / Restore / Raw SQL

- DB export and dump actions require same-origin and admin auth before work (`apps/web/src/app/[locale]/admin/db-actions.ts:80-96`, `db-actions.ts:163-174`).
- Backups are written under `data/backups` with owner-only directory/file modes (`apps/web/src/app/[locale]/admin/db-actions.ts:184-191`, `db-actions.ts:229-230`), use child-process env instead of CLI credential flags (`db-actions.ts:214-227`), and sanitize stderr (`db-actions.ts:712-714`).
- Restore requires same-origin/admin (`apps/web/src/app/[locale]/admin/db-actions.ts:364-370`), takes restore/backfill/upload locks before import (`db-actions.ts:373-446`), enters durable maintenance and quiesces queues before restore (`db-actions.ts:448-504`), writes the upload to a random temp file with mode `0600` (`db-actions.ts:579-590`), checks a plausible SQL dump header (`db-actions.ts:595-616`), scans chunks for disallowed SQL (`db-actions.ts:618-647`), invokes `mysql` with constrained env (`db-actions.ts:665-678`), and cleans up temp files (`db-actions.ts:755-759`).
- Backup downloads use `withAdminAuth` (`apps/web/src/app/api/admin/db/download/route.ts:21`), validate backup filenames against a strict regex (`apps/web/src/lib/backup-filename.ts:3-12`), enforce path and realpath containment (`db/download/route.ts:31-57`), stream from a validated file handle (`db/download/route.ts:58-90`), and add `no-store`/`nosniff` headers (`db/download/route.ts:81-89`).

### SSRF And External Fetch Boundaries

- `IMAGE_BASE_URL` parsing accepts only absolute HTTP(S), requires HTTPS in production, and rejects credentials/query/hash components (`apps/web/src/lib/content-security-policy.ts:1-25`).
- Next image remote patterns are built only from that parsed base URL (`apps/web/next.config.ts:8-28`, `apps/web/next.config.ts:102-106`).
- Public OG routes reviewed did not expose user-controlled arbitrary fetch targets; photo OG fetches are routed through the configured site origin and bounded internal upload paths.

### Admin/Public Privacy Separation

- `publicSelectFields` is derived by explicitly omitting admin-only/sensitive fields, including GPS, original filenames, upload metadata, processing state, HDR/color internals, uploader, and error fields (`apps/web/src/lib/data.ts:368-408`).
- `PrivacySensitiveKeys` and compile-time guards fail the typecheck if a sensitive key enters public selects (`apps/web/src/lib/data.ts:459-488`).
- Public map GPS exposure is the only exception, documented separately and limited to map-visible topics (`apps/web/src/lib/data.ts:410-445`, `apps/web/src/lib/data.ts:1660-1697`).
- Public `getImage`, share-key, shared-group, and search result queries use public field sets or guarded search field sets and require `images.processed = true` (`apps/web/src/lib/data.ts:1024-1044`, `data.ts:1185-1218`, `data.ts:1251-1291`, `data.ts:1490-1633`).

### Security Headers

- Production CSP uses nonce-based script sources when a nonce is supplied, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'` (`apps/web/src/lib/content-security-policy.ts:98-123`).
- Next global headers include `nosniff`, `SAMEORIGIN`, referrer policy, permissions policy, and HSTS outside dev (`apps/web/next.config.ts:74-88`).
- nginx mirrors the core hardening headers and hides `X-Powered-By` (`apps/web/nginx/default.conf:49-56`).

## Not Re-Filed

- Cycle 26 SEC-26-01 is closed by current scanner logic. See `apps/web/src/lib/sql-restore-scan.ts:12-31`, `39-59`, `210-251`, and the passing `sql-restore-scan` tests in the focused suite.
- 2FA/WebAuthn is a documented product non-goal for this personal-gallery threat model (`CLAUDE.md:569`).
- Paid downloads/Stripe are removed and documented not to be reintroduced without a new product decision (`CLAUDE.md:570`).
- Historical checked-in secret exposure remains an operational rotation concern, not a current tracked-HEAD code finding; current tracked docs use placeholders and production session secret enforcement is present.
- Prior build-toolchain/transitive audit concerns were not re-filed because `npm audit --workspace=apps/web --json` currently reports zero vulnerabilities.

## Final Sweep Confirmation

Final sweep completed after validation. Categories reviewed:
- OWASP Top 10 mapping: access control, crypto/session handling, injection, insecure design, security misconfiguration, vulnerable dependencies, auth failures, integrity/config assumptions, logging/monitoring, SSRF.
- Auth/authz: cookie sessions, PAT scopes, admin wrappers, admin pages/actions, API routes.
- CSRF/same-origin: server actions, admin APIs, semantic search, proxy header trust.
- Rate limits: login, password change, admin token auth, public search/load-more/view recording, semantic search, OG/share, upload quotas, nginx edge limits.
- Path traversal and filesystem: upload serving, original/derivative delete, backup download, restore temp files.
- Unsafe raw SQL and child processes: restore scanner, mysqldump/mysql invocation, Drizzle SQL templates, advisory locks.
- Secrets: tracked repository grep, session-secret enforcement, env docs, no local gitignored secret inspection.
- SSRF: image base URL parsing, OG photo fetch, Next remote patterns.
- Upload safety: browser upload, Lightroom PAT upload, Sharp metadata path, GPS stripping, HDR gate, body and disk caps.
- Admin/public privacy separation: public select guards, map-only GPS exception, shared/photo/search/semantic result enrichment.

Result: No confirmed or likely new security defects found in code during Cycle 28. Three deployment/operations checks remain for manual validation. No current live application, deployment, configuration, documentation, migration, script, or security-relevant test file in the review inventory was skipped; archived review/plan artifacts were used for context rather than treated as runtime code.
