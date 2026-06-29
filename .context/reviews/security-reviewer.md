# Cycle 15 Security Review

Reviewer: cycle-15 security-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30
Reviewed HEAD: `e87d1bc2ba75d1ec90704920ea0fa240cdba749c`
Baseline checked: prior cycle-14 report reviewed `c2da917d0fe9620bcbef3897570591080445592c`; this pass re-reviewed current HEAD, not only the diff.

## Result

No confirmed exploitable vulnerabilities were found in current HEAD.

No likely source-code security issues were found. The current delta since cycle 14 is mostly hardening: share pages reject malformed Base56 keys before DB lookup, share metadata stays generic, similar-search scans only processed images, DB backup output is header-validated, restore coordinates with upload/backfill locks, and original-upload path helpers now validate basenames, reject symlinks, and realpath-confine both private and legacy roots.

Finding count:

- Confirmed: 0
- Likely: 0
- Risk / manual-validation items: 4

## Security-Relevant Inventory

Inventory method:

- Confirmed current HEAD with `git rev-parse HEAD`.
- Compared current HEAD to the cycle-14 baseline with `git diff --stat c2da917d0fe9620bcbef3897570591080445592c..HEAD`.
- Enumerated route handlers, server actions, security libraries, migrations/scripts, Docker/nginx/deploy assets, env examples, and security tests with `find`, `rg --files`, and targeted `rg` pattern sweeps.
- Reviewed `AGENTS.md`, `CLAUDE.md`, README security/deploy notes, previous security report, changed files, and all relevant source/docs/tests for the requested surfaces.

Reviewed source and config surfaces:

- Auth/authz/sessions: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/proxy.ts`.
- CSRF/origin/rate limits: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, public route/action call sites, and lint scanners in `apps/web/scripts/check-*.ts`.
- Public/admin routes: all 12 `route.ts` / `route.tsx` handlers under `apps/web/src/app`, including non-API upload/feed handlers.
- Server actions: all files under `apps/web/src/app/actions/` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Upload/image/path traversal: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/gps-exif-strip.ts`, storage helpers.
- SQL/raw command/backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, migration scripts, advisory locks, and raw SQL call sites.
- SSRF/open redirect/XSS/XML/CSP: OG routes, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/safe-json-ld.ts`, Atom/feed routes, sitemap/robots, metadata call sites, `dangerouslySetInnerHTML` call sites.
- Public abuse/privacy: semantic/similar search routes, share pages, public view-recording actions, public data select shapes, map privacy, CSV export, smart collections.
- Secrets/dependencies/deploy: env examples, tracked-secret tests, `package-lock.json` via `npm audit`, Dockerfile, compose, nginx, entrypoint, deploy scripts.

## Confirmed Findings

None.

## Likely Findings

None.

## Risk / Manual-Validation Items

### R15-MV-01: Production must preserve the documented single-instance trusted-proxy topology

Severity: High if the app is horizontally scaled or directly exposed behind untrusted forwarded headers; otherwise informational
Confidence: High for the repo assumption, medium for live deployment state
Status: Risk / manual validation
Category: Deployment, CSRF/origin, rate limits, queue/restore coordination

Evidence:

- The app documents a single web-instance / single-writer topology and warns that restore maintenance flags, upload quota tracking, image queue state, and non-login rate-limit buckets are process-local (`CLAUDE.md:228`, `README.md:152`).
- Compose sets `TRUST_PROXY=true` for the documented host-network nginx deployment (`apps/web/docker-compose.yml:21`).
- Nginx overwrites forwarded host/proto/IP headers for proxied locations (`apps/web/nginx/default.conf:67-70`, `apps/web/nginx/default.conf:192-196`).
- Same-origin checks trust forwarded host/proto only when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:6`, `apps/web/src/lib/request-origin.ts:55-68`, `apps/web/src/lib/request-origin.ts:79-107`).
- Per-IP rate limits ignore proxy headers unless `TRUST_PROXY=true`; otherwise requests collapse to `"unknown"` and a warning is logged (`apps/web/src/lib/rate-limit.ts:164-191`).

Concrete failure scenario:

If the web service is scaled horizontally without moving process-local state into DB/Redis, attackers can multiply OG/share/search/semantic rate-limit budgets across instances and race process-local maintenance/status checks. If the app is exposed directly with `TRUST_PROXY=true`, a client can supply `X-Forwarded-*` values that influence same-origin comparison, cookie secure detection, and per-IP identity.

Concrete fix / validation:

Validate the live path: public TLS edge must overwrite forwarded headers, nginx should remain the trusted direct hop, `TRUSTED_PROXY_HOPS` should match the actual normalized chain, and only one web process should handle writes. Before scale-out, move upload quota tracking, restore maintenance, image queue coordination, public route rate limits, and admin-backfill status to shared storage.

### R15-MV-02: SQL backups are plaintext and DB-only by design

Severity: Low to Medium depending on host/storage controls
Confidence: High
Status: Risk / manual validation
Category: Backup/restore, data protection, privacy

Evidence:

- The security model states DB backups are plaintext SQL at rest and host/storage encryption is the operator boundary (`CLAUDE.md:209`).
- Backup creation writes under `data/backups`, uses `MYSQL_PWD` instead of command-line passwords, and creates files with mode `0600` (`apps/web/src/app/[locale]/admin/db-actions.ts:138-172`).
- Restore temp files are also written mode `0600`, scanned for dangerous SQL, restored with `--one-database`, and run through post-restore migrations (`apps/web/src/app/[locale]/admin/db-actions.ts:466`, `apps/web/src/app/[locale]/admin/db-actions.ts:550-554`, `apps/web/src/lib/sql-restore-scan.ts:39-105`).
- Backup download is admin-authenticated through `withAdminAuth`, validates filename shape, rejects symlinks, realpath-confines the file, and streams from the resolved path (`apps/web/src/app/api/admin/db/download/route.ts:22-25`, `apps/web/src/app/api/admin/db/download/route.ts:44-75`).

Concrete failure scenario:

If the deploy user account, host filesystem, off-host backup copy, or storage snapshot is exposed, the SQL dump can reveal admin password hashes, session/token hashes, audit rows, settings, image metadata, and share records. A DB-only restore without matching filesystem snapshots can also leave rows pointing at missing or stale originals, derivatives, or resources.

Concrete fix / validation:

Confirm `apps/web/data/backups` and any copied backups are on encrypted storage and covered by access controls. Pair DB dumps with filesystem snapshots for `data/uploads/original`, `public/uploads`, `public/resources`, and `site-config.json`. If the threat model needs stronger guarantees, encrypt dumps before writing or immediately after creation with a key outside the app/DB trust boundary.

### R15-MV-03: Admin authorization is all-root by product decision

Severity: Medium if multiple admins are not equally trusted; otherwise informational
Confidence: High
Status: Risk / manual validation
Category: Authorization, privilege separation, destructive operations

Evidence:

- The app describes multiple root-admin accounts and no role separation (`CLAUDE.md:5`, `README.md:40`).
- The security model explicitly says any admin can upload, edit, export/restore backups, change settings, and manage other admins (`CLAUDE.md:229`).
- Representative privileged paths check same-origin plus admin identity, not per-capability roles: admin-user creation/deletion (`apps/web/src/app/actions/admin-users.ts:75-82`, `apps/web/src/app/actions/admin-users.ts:182-290`), DB dump/restore (`apps/web/src/app/[locale]/admin/db-actions.ts:119-130`, `apps/web/src/app/[locale]/admin/db-actions.ts:288-299`), and PAT minting/revocation (`apps/web/src/app/actions/lr-tokens.ts:28-46`, `apps/web/src/app/actions/lr-tokens.ts:108-123`).

Concrete failure scenario:

A compromised or lower-trust admin account can mint Lightroom upload tokens, upload content, create other admins, delete other admins subject to self/last-admin protections, export plaintext SQL backups, restore old/malicious DB snapshots, and change global settings.

Concrete fix / validation:

Validate that every admin account is intended to be fully trusted. If not, introduce roles/capabilities for backup/restore, token management, user management, upload, settings, and destructive photo operations. Consider step-up authentication or dual control for backup download and restore.

### R15-MV-04: Historical secrets still require operator rotation validation

Severity: Medium if any production secret came from historical examples; otherwise informational
Confidence: High that current HEAD is clean, low/unknown for production provenance
Status: Risk / manual validation
Category: Secrets, incident response

Evidence:

- Current docs and examples use placeholders and instruct rotation if older checked-in examples were ever used (`CLAUDE.md:80-85`, `README.md:122-145`, `apps/web/.env.local.example:20-30`).
- Production refuses a missing/short `SESSION_SECRET` instead of falling back to DB-stored dev secret (`apps/web/src/lib/session.ts:19-35`).
- Tracked secret scanning is covered by `apps/web/src/__tests__/tracked-secrets.test.ts`; the targeted security test pass included it.

Concrete failure scenario:

If production, staging, or an admin bootstrap flow reused old committed example values, anyone with repo history could attempt session forgery or credential reuse depending on which value was copied.

Concrete fix / validation:

Confirm production `SESSION_SECRET`, admin passwords, DB password, deploy key, and PATs were independently generated and never copied from historical examples. Rotate values with uncertain provenance. Git history rewriting is optional incident-response work and should be coordinated explicitly because it requires destructive history changes.

## Positive Security Evidence

- Admin API route exports are lint-enforced to wrap `withAdminAuth`; cookie-authenticated admin API requests require same-origin, while PAT requests require a valid scoped token (`apps/web/src/lib/api-auth.ts:55-140`).
- Session tokens are HMAC-signed, timing-safe verified, age-limited, stored hashed in DB, and production refuses weak/missing `SESSION_SECRET` (`apps/web/src/lib/session.ts:16-35`, `apps/web/src/lib/session.ts:82-150`).
- Login uses same-origin validation, IP and account rate-limit buckets, DB-backed pre-increment before Argon2 verification, dummy-hash timing equalization, audit logging, and secure/HttpOnly/SameSite cookies (`apps/web/src/app/actions/auth.ts:70-245`).
- Password changes require same-origin, session, current-password verification, pre-incremented rate limits, and session rotation (`apps/web/src/app/actions/auth.ts:283-428`).
- Mutating server actions are covered by `requireSameOriginAdmin()` and the action-origin lint gate (`apps/web/src/lib/action-guards.ts:37-44`, validation output below).
- Public mutating API routes are covered by the public route rate-limit scanner; current public semantic search pre-increments before body materialization and expensive embedding work (`apps/web/scripts/check-public-route-rate-limit.ts:292-303`, `apps/web/src/app/api/search/semantic/route.ts:106-259`).
- Share pages validate Base56 keys before DB lookup, rate-limit the page-body lookup, and keep metadata generic/noindex without unthrottled key-validity DB queries (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:35-101`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:40-115`).
- Browser and Lightroom uploads validate origin/auth/token scope, filename shape, file count/bytes, topic existence, disk space, restore-maintenance windows, upload contract locks, Sharp decode limits, and GPS stripping policy (`apps/web/src/app/actions/images.ts:114-293`, `apps/web/src/app/api/admin/lr/upload/route.ts:72-547`, `apps/web/src/lib/process-image.ts:887-1037`).
- Original upload path resolution now rejects unsafe basenames/symlinks and realpath-confines private and legacy roots (`apps/web/src/lib/upload-paths.ts:58-160`).
- Public derivative serving allows only `jpeg`/`webp`/`avif`, validates each segment and extension, rejects symlinks/non-files, realpath-confines reads, streams from resolved paths, and sends `nosniff` (`apps/web/src/lib/serve-upload.ts:15-18`, `apps/web/src/lib/serve-upload.ts:137-188`, `apps/web/src/lib/serve-upload.ts:237-296`).
- Nginx blocks `/uploads/original/`, constrains large body budgets to upload/restore endpoints, and applies edge request/connection limits (`apps/web/nginx/default.conf:57-185`).
- Backup/restore uses same-origin/admin auth, advisory locks, restore maintenance, upload-processing contract locks, SQL header/size/dangerous-statement checks, MySQL CLI TLS args for non-local hosts, `MYSQL_PWD`, sanitized stderr, and post-restore migrations (`apps/web/src/app/[locale]/admin/db-actions.ts:119-260`, `apps/web/src/app/[locale]/admin/db-actions.ts:288-676`, `apps/web/src/lib/mysql-cli-ssl.ts:1-24`).
- Smart collection SQL is compiled from allowlisted columns/operators with scalar/type validation and Drizzle parameter binding; LIKE wildcards are escaped (`apps/web/src/lib/smart-collections.ts:148-270`, `apps/web/src/lib/smart-collections.ts:313-466`, `apps/web/src/lib/sql-like.ts:5-10`).
- Public image select fields omit admin-only/private fields and enforce the omission with compile-time privacy guards; semantic/similar search enrichment has a separate type-only privacy guard (`apps/web/src/lib/data.ts:368-489`, `apps/web/src/lib/search-enrichment-fields.ts:1-47`).
- JSON-LD call sites use `safeJsonLd()` before `dangerouslySetInnerHTML`, and Atom feeds XML-escape text/attributes plus strip XML-forbidden controls (`apps/web/src/lib/safe-json-ld.ts:14-19`, `apps/web/src/lib/atom-feed.ts:21-29`, `apps/web/src/lib/atom-feed.ts:107-164`).
- Production CSP uses a per-request nonce for scripts, no `unsafe-inline` scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and strict image/CDN URL validation (`apps/web/src/lib/content-security-policy.ts:68-123`, `apps/web/src/proxy.ts:21-49`).
- Per-photo OG internal fetches are pinned to `BASE_URL` / canonical origin with byte and timeout caps; fallback redirects are same-origin validated (`apps/web/src/app/api/og/photo/[id]/route.tsx:101-132`, `apps/web/src/lib/og-photo-fetch.ts:30-118`, `apps/web/src/lib/seo-og-url.ts:3-43`).
- Docker runtime binds the standalone server to `127.0.0.1`, runs through an entrypoint that drops to `node`, and persists mutable data via bind mounts (`apps/web/Dockerfile:85-150`, `apps/web/docker-compose.yml:14-27`, `apps/web/scripts/entrypoint.sh:4-42`).

## Verification Evidence

Commands run and passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=low --json` — 0 vulnerabilities.
- `npm test --workspace=apps/web -- tracked-secrets privacy-fields api-auth-response-headers request-origin upload-paths serve-upload db-restore sql-restore-scan backup-download-route check-public-route-rate-limit shared-route-rate-limit-source similar-route sitemap-robots` — 14 files / 138 tests passed.
- `npm run lint --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm test --workspace=apps/web` — 259 files passed, 2 skipped; 2404 tests passed, 4 skipped.

## Final Missed-Issues Sweep

Final sweep covered:

- All route handlers, including non-API feed/upload routes that bypass page middleware.
- All server actions and action-origin exemptions.
- Admin API auth wrappers and public mutating route rate-limit coverage.
- Public GET abuse surfaces not covered by the mutating-route lint: OG, similar search, feeds, sitemap, share pages.
- `dangerouslySetInnerHTML`, JSON-LD, XML/Atom escaping, OG image generation, metadata URL construction, and `_blank` links.
- Raw SQL, advisory locks, migration reconciliation, MySQL CLI invocation, and SQL restore scanning.
- Upload path construction, public derivative serving, original-file handling, symlink/realpath checks, filename validation, and delete/unlink paths.
- SSRF/open-redirect levers: OG photo fetch, canonical URL handling, SEO OG image URL validation, fetch call sites.
- Secrets/env examples, tracked secret patterns, deploy scripts, Dockerfile, compose, nginx, entrypoint, backup/restore scripts, dependency audit.

No security-relevant tracked source/config/script/migration files were intentionally skipped. I did not manually review third-party dependency source under `node_modules`, generated build output, or runtime uploaded/data files; dependencies were covered by `npm audit`, and runtime artifacts are outside current-HEAD source review.
