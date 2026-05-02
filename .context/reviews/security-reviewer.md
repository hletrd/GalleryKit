# Security Review — Cycle 1

Scope: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-05-02  
Role: security-reviewer  
Constraint honored: report-only review; no application code edits.

## 1) Inventory of security-relevant files examined

I treated the files below as security-relevant and examined them before writing findings.

### Project, supply-chain, runtime, deployment
- `package.json`, `package-lock.json`, `.nvmrc`, `.gitignore`, `.env.deploy.example`, `README.md`, `CLAUDE.md`
- `.github/workflows/quality.yml`, `.github/dependabot.yml`
- `scripts/deploy-remote.sh`
- `apps/web/package.json`, `apps/web/.gitignore`, `apps/web/.dockerignore`, `apps/web/.env.local.example`, `apps/web/README.md`
- `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/playwright.config.ts`, `apps/web/eslint.config.mjs`
- `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/init-db.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/migrate-admin-auth.ts`, `apps/web/scripts/seed-admin.ts`, `apps/web/scripts/mysql-connection-options.js`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/check-js-scripts.mjs`

### Auth, authorization, session, origin, headers, CSP, rate limits
- `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/bounded-map.ts`
- `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/csp-nonce.ts`, `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/audit.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/revalidation.ts`

### Database, data access, validation, sanitization
- `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/seed.ts`
- `apps/web/src/lib/data.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/base56.ts`, `apps/web/src/lib/tag-records.ts`, `apps/web/src/lib/tag-slugs.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/photo-title.ts`, `apps/web/src/lib/blur-data-url.ts`, `apps/web/src/lib/csv-escape.ts`

### Server actions and API routes
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`

### Pages/routes that expose unauthenticated content or admin surfaces
- Public pages: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, public layout/loading/error/not-found files
- Upload serving routes: `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- Admin pages/components: protected admin layout/dashboard/db/password/users/categories/tags/seo/settings pages and clients, `apps/web/src/components/admin-user-manager.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/upload-dropzone.tsx`, search/load-more/lightbox/photo components that pass user-originated data
- Metadata/static routes: `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/icon.tsx`, `apps/web/src/app/apple-icon.tsx`, app/global error shells

### Uploads, files, images, backup/restore
- `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/image-types.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`

### Security tests/gates consulted
- `apps/web/src/__tests__/action-guards.test.ts`, `request-origin.test.ts`, `session.test.ts`, `auth-rate-limit*.test.ts`, `auth-no-rollback-on-infrastructure-error.test.ts`, `admin-users.test.ts`, `admin-user-create-ordering.test.ts`, `rate-limit.test.ts`, `load-more-rate-limit.test.ts`, `og-rate-limit.test.ts`, `shared-route-rate-limit-source.test.ts`, `sharing-source-contracts.test.ts`, `share-key-length.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`, `backup-filename.test.ts`, `db-restore.test.ts`, `restore-maintenance.test.ts`, `restore-upload-lock.test.ts`, `sql-restore-scan.test.ts`, `mysql-cli-ssl.test.ts`, `sanitize-stderr.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`, `upload-limits.test.ts`, `upload-tracker.test.ts`, `process-image-*.test.ts`, `storage-local.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`, `safe-json-ld.test.ts`, `nginx-config.test.ts`, `next-config.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, plus relevant E2E tests under `apps/web/e2e/`

## 2) Executive summary

The application has many strong controls already: admin server actions mostly require same-origin checks, admin API routes have a shared auth/origin wrapper, sessions are HMAC-signed and DB-backed, public uploads are derivative-only and served through path/symlink checks, restore has maintenance/advisory-lock protections and SQL scanning, CSP is nonce-based in production, and dependency audit currently reports zero known vulnerabilities.

I found one high-severity authorization/availability flaw, three medium-severity operational/security control gaps, and two low-severity hardening/rate-limit accounting issues.

## 3) Findings

### HIGH-1 — Concurrent admin deletion can remove every admin user

- Severity: High
- Status: Confirmed
- Confidence: High
- OWASP: A01 Broken Access Control, A04 Insecure Design
- Evidence:
  - `apps/web/src/app/actions/admin-users.ts:193-196` prevents self-delete only for the current request's own user ID.
  - `apps/web/src/app/actions/admin-users.ts:198-215` says deletion is serialized to protect the “more than one admin” invariant, but the advisory lock is scoped to the target user ID.
  - `apps/web/src/lib/advisory-locks.ts:26-32` defines the delete lock as `gallerykit_admin_delete:${userId}`.
  - `apps/web/src/app/actions/admin-users.ts:227-247` counts all admins, then deletes the target user inside the transaction.

Concrete exploit/failure scenario:
1. The site has exactly two admins, A and B.
2. A sends a request to delete B while B sends a request to delete A.
3. The requests take different advisory locks: `gallerykit_admin_delete:B` and `gallerykit_admin_delete:A`.
4. Each transaction can observe `COUNT(*) = 2`, pass the “last admin” check, and delete the other account.
5. The database is left with zero admin users, effectively locking out administration and preventing normal recovery through the UI.

Suggested fix:
- Protect the invariant with one global admin-deletion lock, not a per-target lock; or lock the `admin_users` set transactionally while counting/deleting.
- Add a regression test for two concurrent cross-deletes from a two-admin state.

---

### MEDIUM-1 — Share-key metadata lookups bypass the share-route rate limit

- Severity: Medium
- Status: Confirmed for unthrottled DB work; likely for metadata disclosure on over-limit valid keys
- Confidence: High
- OWASP: A01 Broken Access Control, A04 Insecure Design, A05 Security Misconfiguration
- Evidence:
  - Single-photo share metadata intentionally skips the limiter and then queries by key: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:42-55`, especially `:44-47` and `:54`.
  - The single-photo page-body limiter runs later: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:101-112`.
  - Group share metadata does the same: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37-51`, especially `:40-43` and `:50`.
  - The group page-body limiter runs later: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-123`.
  - The intended share limit is 60 requests/min/IP in `apps/web/src/lib/rate-limit.ts:57-65`, implemented by `preIncrementShareAttempt()` at `apps/web/src/lib/rate-limit.ts:234-243`.

Concrete exploit/failure scenario:
- An unauthenticated bot probes `/s/<random-key>` or `/g/<random-key>` at high volume.
- Even after the page body would return `notFound()` because the IP exceeded 60/minute, `generateMetadata()` has already performed a share-key DB lookup for each request.
- If the bot hits a valid key while over limit, the metadata path may still reveal title/description/OG image data because metadata generation builds those fields before the page-body limiter.

Suggested fix:
- Do not resolve share keys in `generateMetadata()`; return generic noindex metadata for share routes, or make metadata and page rendering share one request-scoped limiter decision before any DB lookup.
- Add tests proving over-limit requests do not call `getImageByShareKeyCached()` / `getSharedGroupCached()` from metadata.

---

### MEDIUM-2 — Spoofed `X-Forwarded-For` defeats per-IP rate limits in the documented nginx deployment

- Severity: Medium
- Status: Confirmed in the shipped nginx + app configuration
- Confidence: High
- OWASP: A05 Security Misconfiguration, A07 Identification and Authentication Failures
- Evidence:
  - The compose file enables proxy trust: `apps/web/docker-compose.yml:18-20`.
  - The app trusts `x-forwarded-for` when `TRUST_PROXY=true` and chooses `validParts.length - hopCount - 1`: `apps/web/src/lib/rate-limit.ts:123-145`.
  - The default trusted hop count is one: `apps/web/src/lib/rate-limit.ts:72-75` and `apps/web/src/lib/rate-limit.ts:116-120`.
  - The shipped nginx config appends incoming client-supplied `X-Forwarded-For` with `$proxy_add_x_forwarded_for` in multiple locations, for example `apps/web/nginx/default.conf:67-69`, `:84-86`, `:101-103`, `:117-119`, `:134-136`, and `:169-171`.
  - The README documents this topology and default `TRUSTED_PROXY_HOPS=1`: `README.md:146-148`.

Concrete exploit/failure scenario:
- A direct internet client sends `X-Forwarded-For: 1.2.3.4` to nginx.
- Nginx forwards `X-Forwarded-For: 1.2.3.4, <real-client-ip>` because `$proxy_add_x_forwarded_for` appends rather than overwrites.
- With `TRUSTED_PROXY_HOPS=1`, `getClientIp()` returns the address before the trusted suffix, i.e. the attacker-controlled `1.2.3.4`.
- The attacker rotates the header to evade public search/load-more/share/OG limits and weakens IP-scoped login/admin write/upload throttles. Account-scoped login throttling still helps, but the per-IP control is bypassable.

Suggested fix:
- In the documented single-nginx deployment, overwrite rather than append untrusted client input, e.g. `proxy_set_header X-Forwarded-For $remote_addr;`, or strip inbound forwarding headers at the outermost trusted edge.
- Alternatively adjust `getClientIp()` and documentation so the app selects only addresses inserted by trusted infrastructure for this topology.
- Add an nginx/app regression test for an incoming spoofed `X-Forwarded-For` header.

---

### MEDIUM-3 — Production Docker builds ignore the lockfile and resolve dependencies dynamically

- Severity: Medium
- Status: Confirmed configuration risk
- Confidence: High
- OWASP: A06 Vulnerable and Outdated Components, A08 Software and Data Integrity Failures
- Evidence:
  - `apps/web/Dockerfile:21-30` explicitly copies only `package.json` files and runs `npm install --workspace=apps/web` without `package-lock.json`.
  - `apps/web/Dockerfile:32-36` repeats the pattern for production dependencies.
  - The app package uses broad semver ranges for production dependencies such as `argon2`, `drizzle-orm`, `mysql2`, `next`, `react`, and `sharp`: `apps/web/package.json:27-57`.
  - CI uses the lockfile with `npm ci`: `.github/workflows/quality.yml:48-49`, so CI/audit does not necessarily test the same dependency tree as the production image.

Concrete exploit/failure scenario:
- CI passes and `npm audit` is clean for the committed lockfile.
- A later Docker build resolves a newer transitive or direct dependency inside the allowed semver ranges.
- If that package is compromised or newly vulnerable, production can run code that was not reviewed, locked, or audited in CI.

Suggested fix:
- Copy `package-lock.json` into Docker dependency stages and use `npm ci --workspace=apps/web`.
- If Linux optional packages were the original blocker, regenerate/verify the lockfile on Linux or use npm's optional dependency support instead of discarding the lockfile.
- Consider pinning base images by digest as a further supply-chain hardening step.

---

### LOW-1 — Authenticated write rate-limit counters are rolled back on successful/no-op operations

- Severity: Low
- Status: Confirmed
- Confidence: High
- OWASP: A04 Insecure Design, A05 Security Misconfiguration
- Evidence:
  - Admin creation claims to rate-limit for brute-force/CPU DoS: `apps/web/src/app/actions/admin-users.ts:113-115`.
  - It pre-increments before Argon2 hashing and DB insert: `apps/web/src/app/actions/admin-users.ts:116-139`.
  - On successful creation it rolls back the rate-limit attempt: `apps/web/src/app/actions/admin-users.ts:151-154`.
  - Share no-op handling calls `rollbackShareRateLimitFull()` before any pre-increment for that request: `apps/web/src/app/actions/sharing.ts:95-105`.
  - The rollback helper decrements/deletes an existing in-memory bucket and decrements DB state: `apps/web/src/app/actions/sharing.ts:55-76`.

Concrete exploit/failure scenario:
- A compromised admin session or malicious admin can create many unique admin users and force repeated Argon2 hashing/DB writes without consuming the documented hourly `user_create` budget, because successes are subtracted back out.
- Repeated calls to create an already-existing photo share link can decrement an existing share bucket even though the current request was never incremented, making the share-write limiter's state unreliable.

Suggested fix:
- Count successful expensive/admin-mutating operations against their write budgets.
- Only roll back requests that were actually pre-incremented and then rejected before the protected operation ran.
- For existing share links, remove rollback or move it after a real pre-increment if the no-op is intended to consume budget.

---

### LOW-2 — Argon2id password hashing policy is not centralized or explicitly parameterized

- Severity: Low
- Status: Risk / hardening issue
- Confidence: Medium
- OWASP: A07 Identification and Authentication Failures, A02 Cryptographic Failures
- Evidence:
  - Password changes use only `{ type: argon2.argon2id }`: `apps/web/src/app/actions/auth.ts:379`.
  - Admin creation uses only `{ type: argon2.argon2id }`: `apps/web/src/app/actions/admin-users.ts:138`.
  - Bootstrap/migration paths also rely on library defaults: `apps/web/scripts/seed-admin.ts:46-49`, `apps/web/scripts/migrate-admin-auth.ts:45-50`, and `apps/web/scripts/migrate.js:515-520`.

Concrete exploit/failure scenario:
- If the database is exfiltrated, password resistance depends on whatever Argon2 defaults the installed package version uses.
- Because Docker production builds are not lockfile-pinned, those defaults could also vary across builds.
- Operators cannot review or tune memory/time/parallelism tradeoffs centrally.

Suggested fix:
- Define one shared password hashing policy with explicit `memoryCost`, `timeCost`, and `parallelism` based on production capacity and current OWASP/ASVS guidance.
- Use it for dummy hashes, password changes, admin creation, seed, and migration scripts.
- Add a test asserting all password-hashing call sites use the shared options.

## 4) Area-by-area review notes

- Auth/session/cookies: Strong baseline. Session tokens are HMAC-SHA256 signed and random (`apps/web/src/lib/session.ts:82-88`), verified with `timingSafeEqual` (`apps/web/src/lib/session.ts:107-118`), capped at 24h (`apps/web/src/lib/session.ts:121-128`), stored by hash (`apps/web/src/lib/session.ts:8-10`, `:130-132`), and cookies are `httpOnly`, `secure` in production/TLS, `SameSite=Lax`, and 24h max age (`apps/web/src/app/actions/auth.ts:223-235`).
- Authz/admin protection: Protected admin pages have middleware cookie-shape gating (`apps/web/src/proxy.ts:81-116`), and server-side actions/API routes re-check auth. The high-severity admin deletion race is the main authz issue found.
- CSRF/same-origin: Mutating server actions use `requireSameOriginAdmin()` and the admin API wrapper enforces origin before auth (`apps/web/src/lib/api-auth.ts:26-55`). `npm run lint:action-origin` confirmed all mutating server actions enforce same-origin provenance.
- Injection: Drizzle parameterization is used broadly; raw `conn.query()` call sites reviewed are parameterized. Search/tag LIKE handling and validation helpers were reviewed; no SQL injection finding confirmed.
- XSS: Raw rendering is limited to JSON-LD script tags discovered by scan, and those use `safeJsonLd()` escaping (`apps/web/src/lib/safe-json-ld.ts:14-18`). React rendering otherwise escapes user-originated text. CSP is nonce-based in production (`apps/web/src/proxy.ts:37-50`, `apps/web/src/lib/content-security-policy.ts:78-90`).
- Upload/path traversal/symlink: Uploaded originals are not publicly served; derivative serving validates top-level directories, extensions, safe path segments, `lstat()`, `realpath()`, and streams from the resolved path (`apps/web/src/lib/serve-upload.ts:32-105`). Image processing/upload limits and storage paths were reviewed with no traversal finding confirmed.
- SSRF: No general server-side URL fetcher was found in the app path. Configurable `IMAGE_BASE_URL` is parsed as an origin-only URL and rejects credentials/query/hash; production requires HTTPS (`apps/web/src/lib/content-security-policy.ts:1-25`).
- Secrets/privacy: Production `SESSION_SECRET` is required and DB fallback is refused in production (`apps/web/src/lib/session.ts:19-35`). Secret scan found placeholders/docs/test strings but no committed active private keys or production secrets.
- Backup/restore: Backup download route, dump/restore actions, advisory lock, temp-file handling, stderr sanitization, SQL dangerous-statement scan, and maintenance mode were reviewed. No backup/restore security finding confirmed.
- Headers/CSP: Next/nginx set CSP, no-sniff, frame, referrer, permissions, and HSTS headers in the reviewed deployment. CSP still allows inline styles, which is common for the framework; no concrete exploit was found.
- Rate limits: Login has IP and account buckets; public search/load/share/OG and admin write/upload rate limits exist. Findings above cover the share metadata bypass, proxy IP spoofing, and two low-impact accounting inconsistencies.
- Supply chain/config/deploy: `npm audit` was clean, Dependabot exists, and CI runs security lint gates. The Docker lockfile omission is the main supply-chain finding.

## 5) Final missed-issues sweep

Commands/checks performed after manual review:

- `npm audit --json`: 0 total vulnerabilities across 554 dependencies.
- `npm run lint:api-auth`: passed; confirmed `src/app/api/admin/db/download/route.ts` is covered by admin API auth/origin wrapper.
- `npm run lint:action-origin`: passed; confirmed all mutating server actions enforce same-origin provenance; read-only admin getters are explicitly exempt.
- Dangerous rendering/dynamic execution scan: found only JSON-LD `dangerouslySetInnerHTML` sites in public pages; these use `safeJsonLd()`.
- Filesystem/raw SQL/child process hotspot scan: reviewed DB restore/dump subprocess usage, upload serving, image processing, advisory-lock raw SQL, and storage local file paths.
- Secret keyword scan excluding dependencies/generated output: found placeholders, docs, tests, and env-variable references; no active committed secrets confirmed.

## 6) Confirmed skipped files

Skipped as non-source, generated, third-party, binary, or not security-relevant to this review:

- Dependency/build/generated directories: `node_modules/`, `apps/web/node_modules/`, `.next/`, `apps/web/.next/`, `dist/`, coverage, Playwright reports, test-results.
- Git/internal/runtime state: `.git/`, `.omx/`, `.omc/`, local DB/data directories ignored by `.gitignore`, local `.env*` files not present in the checkout.
- Binary/static assets and screenshots: images, fonts, icons, visual-regression artifacts.
- Historical planning notes under `plan/` and existing `.context/` artifacts, except for targeted secret-keyword sweep references and this report.
- Pure presentational UI primitives were not line-by-line audited unless they handled auth, uploads, user-originated rendering, forms, routing, or admin mutations.

## 7) Counts by severity

- Critical: 0
- High: 1
- Medium: 3
- Low: 2
- Informational: 0
- Total findings: 6
