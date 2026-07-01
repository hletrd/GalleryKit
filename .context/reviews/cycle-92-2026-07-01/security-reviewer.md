# Security Reviewer Report — Cycle 92

- **Lane:** security-reviewer
- **Cycle folder:** `cycle-92-2026-07-01`
- **Reviewed HEAD:** `508d35572563705008693da2dbff3e5d85442cdd`
- **Scan date:** 2026-07-02 KST
- **Scope:** Entire repository, with emphasis on OWASP Top 10, authentication/authorization, secrets, injection, SSRF, CSRF/origin, rate limiting, privacy, backup/restore, uploads, and deployment/operational safety.
- **Instruction check:** Read project `AGENTS.md` and `CLAUDE.md` before review. Followed the user constraint to write only this report file.

## Relevant file inventory built first

### Application attack surface

- **Public route handlers**
  - `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
  - `apps/web/src/app/api/health/route.ts`
  - `apps/web/src/app/api/live/route.ts`
  - `apps/web/src/app/api/og/photo/[id]/route.tsx`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/app/api/search/semantic/route.ts`
  - `apps/web/src/app/api/search/similar/[id]/route.ts`
  - `apps/web/src/app/feed.xml/route.ts`
  - `apps/web/src/app/uploads/[...path]/route.ts`
- **Admin/API route handlers**
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
- **Server actions**
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/actions.ts`
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

### Security-critical support files

- **Auth, sessions, origin, API auth:** `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/proxy.ts`
- **Rate limiting:** `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`
- **Upload/file serving:** `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`
- **Backup/restore:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance*.ts`
- **Privacy/public data:** `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/view-retention.ts`
- **Output encoding/CSP:** `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/csv-escape.ts`, `apps/web/next.config.ts`
- **Static analysis/security tests:** `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, plus security-relevant tests under `apps/web/src/__tests__/` including `privacy-fields`, `tracked-secrets`, `request-origin`, `check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`, `search-route-privacy`, `semantic-search-rate-limit`, `restore-*`, `sql-restore-scan`, `strip-gps-from-original`, and `rate-limit*` tests.
- **Operational/deploy:** `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `.github/dependabot.yml`

## Validation performed

- `node --import tsx apps/web/scripts/check-api-auth.ts` — **passed**. Both admin API routes were reported as wrapped by `withAdminAuth(...)`.
- `node --import tsx apps/web/scripts/check-action-origin.ts` — **passed**. Mutating server actions were reported as enforcing `requireSameOriginAdmin()` or carrying approved read-only exemptions.
- `node --import tsx apps/web/scripts/check-public-route-rate-limit.ts` — **passed**. Public mutating/expensive handlers were reported as rate-limited or intentionally exempt.
- `cd apps/web && npx vitest run src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/request-origin.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts --config vitest.config.ts` — **passed**, `6` files / `227` tests.
- Secret pattern sweep across tracked text files found only placeholders, examples, redacted logs, or test fixtures; no committed live secret was confirmed.
- `npm audit --workspace=apps/web --audit-level=low --json` — **not completed** because the sandbox could not resolve `registry.npmjs.org` (`ENOTFOUND`). This is recorded as a manual-validation risk, not as a confirmed vulnerability.
- Final missed-issue sweep covered risky primitives including `dangerouslySetInnerHTML`, `child_process`, `spawn`, `execFile`, `fetch`, URL construction, proxy headers, `TRUST_PROXY`, `requireSameOriginAdmin`, `withAdminAuth`, rate limits, raw SQL fragments, `LIKE`, and `process.env` usage.

## Findings summary

| ID | Category | Severity | Confidence | Status |
| --- | --- | --- | --- | --- |
| — | Confirmed issue | — | — | **None found** |
| — | Likely issue | — | — | **None found** |
| MV-SEC-01 | TLS / reverse-proxy exposure | High if port 80 is public; Low if internal-only as documented | Medium | Manual validation required |
| MV-SEC-02 | Dependency vulnerability freshness | Medium | High | Manual validation required |
| MV-SEC-03 | Proxy-trust / rate-limit attribution | Medium | Medium | Manual validation required |

## Confirmed issues

None found in this cycle.

Security posture was materially supported by enforceable code gates and fresh local validation:

- Admin route scanner passed, and admin handlers use `withAdminAuth(...)` (`apps/web/src/app/api/admin/db/download/route.ts:21`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-85`).
- Mutating server-action origin scanner passed, and the centralized guard checks both provenance and admin state (`apps/web/src/lib/action-guards.ts:37-44`).
- Public route rate-limit scanner passed, with explicit coverage for expensive public routes and documented exemptions.
- Privacy guard tests passed and public selectors omit sensitive/internal fields (`apps/web/src/lib/data.ts:368-408`, `apps/web/src/lib/data.ts:473-489`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`).

## Likely issues

None found.

I did not mark configuration-dependent items as likely issues because the code contains compensating controls and/or explicit deployment assumptions. Those items are listed under manual-validation risks where environment evidence is required.

## Manual-validation risks

### MV-SEC-01 — Verify the nginx HTTP listener is not directly public

- **Status:** Manual validation risk
- **Severity:** High if directly internet-exposed; Low if reachable only from the trusted TLS terminator/internal network
- **Confidence:** Medium
- **OWASP mapping:** A02 Cryptographic Failures, A05 Security Misconfiguration

**Evidence**

- The bundled nginx server listens on plain HTTP port 80 (`apps/web/nginx/default.conf:21-30`).
- The config comments state this is an internal hop behind an upstream TLS terminator and deliberately avoids redirecting HTTP to HTTPS at this layer (`apps/web/nginx/default.conf:21-30`).
- HSTS is set by this nginx config, but HSTS only protects browser clients after an HTTPS response is received from the public edge (`apps/web/nginx/default.conf:49-55`).
- Admin/login/upload routes are proxied through this same HTTP listener with security headers and limits (`apps/web/nginx/default.conf:58-72`, `apps/web/nginx/default.conf:74-89`, `apps/web/nginx/default.conf:91-106`, `apps/web/nginx/default.conf:133-146`).

**Risk**

If this nginx listener is accidentally exposed directly to the internet, admin credentials, session cookies, backup downloads, restore uploads, and admin API traffic can traverse cleartext HTTP. The file comments say it is intended as an internal-only hop, but that guarantee must be verified in the deployed network, not just in repository code.

**Recommended validation**

Verify the production edge terminates TLS before this nginx service and that firewall/security-group/routing rules prevent direct public access to port 80 on the Gallery host/container. If direct public exposure is possible, add a public 443 TLS listener and redirect public port 80 to HTTPS at the first internet-facing layer.

### MV-SEC-02 — Dependency vulnerability audit could not be refreshed in this sandbox

- **Status:** Manual validation risk
- **Severity:** Medium
- **Confidence:** High that audit freshness is incomplete; no confirmed vulnerable package from this review
- **OWASP mapping:** A06 Vulnerable and Outdated Components

**Evidence**

- The app depends on security-sensitive packages and frameworks, including `@huggingface/transformers`, `argon2`, `drizzle-orm`, `geoip-lite`, `mysql2`, `next`, `react`, and `sharp` (`apps/web/package.json:29-68`).
- Dev/build tooling also includes security-relevant packages such as Playwright, ESLint, TypeScript, Vitest, and Drizzle Kit (`apps/web/package.json:70-85`).
- Dependabot is configured for weekly npm and Docker updates (`.github/dependabot.yml:3-19`).
- Local dependency audit could not complete because the sandbox had no DNS access to the npm registry: `getaddrinfo ENOTFOUND registry.npmjs.org`.

**Risk**

This review cannot assert that the dependency graph is free of newly disclosed CVEs as of the scan date. The repository has update automation, but the current vulnerability state still requires a network-enabled audit or CI security scanner.

**Recommended validation**

Run `npm audit --workspace=apps/web --audit-level=low` or the organization’s dependency scanner in a network-enabled environment. Triage any findings against reachable application paths and container build/runtime usage.

### MV-SEC-03 — Verify proxy trust settings match the deployed topology

- **Status:** Manual validation risk
- **Severity:** Medium
- **Confidence:** Medium
- **OWASP mapping:** A04 Insecure Design, A05 Security Misconfiguration, A07 Identification and Authentication Failures

**Evidence**

- Rate-limit IP attribution trusts forwarded headers only when `TRUST_PROXY=true`; otherwise it intentionally falls back to the direct request IP/`unknown` bucket and emits a security warning when proxy headers are present (`apps/web/src/lib/rate-limit.ts:166-196`).
- The number of trusted proxy hops is configurable (`apps/web/src/lib/rate-limit.ts:156-164`).
- Expected-origin calculation similarly trusts forwarded host/proto only under `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:45-68`).
- The production compose file sets `TRUST_PROXY: "true"` (`apps/web/docker-compose.yml:20-22`).
- nginx overwrites forwarded client fields using `$remote_addr`, reducing spoofing risk at that hop (`apps/web/nginx/default.conf:67-71`, `apps/web/nginx/default.conf:141-145`, `apps/web/nginx/default.conf:157-162`, `apps/web/nginx/default.conf:192-197`).
- The example environment documents the safe proxy-hop configurations and warns about spoofing when internet-facing without a trusted proxy chain (`apps/web/.env.local.example:57-70`).

**Risk**

If deployed with too few trusted hops or without `TRUST_PROXY` behind a reverse proxy, many users can collapse into one bucket, causing broad lockouts and poor brute-force attribution. If deployed with overly broad trust in a topology where clients can inject forwarded headers before nginx overwrites them, an attacker may weaken IP-based throttling or origin reconstruction.

**Recommended validation**

Confirm the actual production path is `client -> trusted TLS edge -> nginx -> Next app`, that nginx is the only source of forwarded headers seen by the app, and that `TRUSTED_PROXY_HOPS` matches the number of trusted proxy hops. Add an operational smoke test that logs/validates derived client IP and expected origin from a known external request.

## OWASP Top 10 coverage notes

### A01 Broken Access Control

- Admin API routes are statically required to export handlers through `withAdminAuth(...)`; the implementation authenticates either a scoped bearer-like GalleryKit token or a same-origin admin cookie (`apps/web/src/lib/api-auth.ts:58-61`, `apps/web/src/lib/api-auth.ts:72-90`, `apps/web/src/lib/api-auth.ts:114-141`).
- Cookie-authenticated admin API access requires same-origin provenance before `isAdmin()` (`apps/web/src/lib/api-auth.ts:114-129`).
- Admin route middleware protects admin UI paths before render and excludes API routes because API routes own their auth wrappers (`apps/web/src/proxy.ts:65-90`, `apps/web/src/proxy.ts:124-129`).
- Lightroom upload PATs require the `lr:upload` scope via wrapper options (`apps/web/src/app/api/admin/lr/upload/route.ts:592-594`), and token ownership/revocation is user-scoped (`apps/web/src/app/actions/lr-tokens.ts:115-123`, `apps/web/src/lib/admin-tokens.ts:243-249`).
- User deletion protects against deleting the current user and last-admin race conditions with a global advisory lock (`apps/web/src/app/actions/admin-users.ts:186-195`, `apps/web/src/app/actions/admin-users.ts:225-240`).

### A02 Cryptographic Failures

- `SESSION_SECRET` is required in production and DB-secret fallback is explicitly refused in production (`apps/web/src/lib/session.ts:16-35`).
- Session tokens are random, HMAC-hashed, age-bound, future-skew rejected, and compared with `timingSafeEqual` (`apps/web/src/lib/session.ts:82-88`, `apps/web/src/lib/session.ts:94-150`).
- Password hashing uses Argon2id with explicit time, memory, and parallelism parameters (`apps/web/src/lib/password-hashing.ts:10-15`).
- Cookies are `httpOnly`, `secure` in production, and `sameSite: 'lax'` (`apps/web/src/app/actions/auth.ts:239-245`, `apps/web/src/app/actions/auth.ts:413-419`).
- CSV export escapes formulas and control characters (`apps/web/src/lib/csv-escape.ts:41-64`).
- Manual TLS validation remains required for the nginx plain-HTTP internal-hop assumption (MV-SEC-01).

### A03 Injection

- SQL is built through Drizzle parameterization for admin-token, user, rate-limit, and upload paths; reviewed raw SQL fragments are static identifiers or parameterized expressions (`apps/web/src/lib/admin-tokens.ts:141-168`, `apps/web/src/app/actions/admin-users.ts:243-268`, `apps/web/src/lib/rate-limit.ts:439-455`).
- SQL `LIKE` search uses an explicit escape helper instead of string interpolation (`apps/web/src/lib/sql-like.ts:10`).
- Restore uploads are scanned for dangerous statements, schema-qualified writes, comments/literals, and non-allowlisted targets before invoking `mysql` (`apps/web/src/lib/sql-restore-scan.ts:12-31`, `apps/web/src/lib/sql-restore-scan.ts:61-129`, `apps/web/src/lib/sql-restore-scan.ts:210-251`).
- `mysqldump`/`mysql` are invoked with argument arrays and environment variables rather than shell interpolation (`apps/web/src/app/[locale]/admin/db-actions.ts:221-228`, `apps/web/src/app/[locale]/admin/db-actions.ts:651-680`).
- JSON-LD output is escaped with `safeJsonLd` before `dangerouslySetInnerHTML` sites render structured data (`apps/web/src/lib/safe-json-ld.ts:14-19`).

### A04 Insecure Design

- Upload code uses quota/claim contracts before expensive image processing (`apps/web/src/app/actions/images.ts:218-256`, `apps/web/src/app/api/admin/lr/upload/route.ts:130-158`).
- Restore is protected by durable maintenance state, advisory locks, upload/backfill quiescing, size caps, SQL scanning, and post-restore migration verification (`apps/web/src/app/[locale]/admin/db-actions.ts:390-447`, `apps/web/src/app/[locale]/admin/db-actions.ts:451-506`, `apps/web/src/app/[locale]/admin/db-actions.ts:577-680`, `apps/web/src/app/[locale]/admin/db-actions.ts:718-746`).
- Semantic-search route work is bounded by body, query-length, model availability, and scan caps (`apps/web/src/app/api/search/semantic/route.ts:117-167`, `apps/web/src/app/api/search/semantic/route.ts:189-201`, `apps/web/src/app/api/search/semantic/route.ts:270-279`).
- Similar-search route validates ID, rate-limits, requires production-ready embeddings, and scans within bounds (`apps/web/src/app/api/search/similar/[id]/route.ts:68-108`, `apps/web/src/app/api/search/similar/[id]/route.ts:114-177`).

### A05 Security Misconfiguration

- CSP sets `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'`; dev-only unsafe directives are gated to development (`apps/web/src/lib/content-security-policy.ts:68-124`).
- Global headers include `nosniff`, frame protection, referrer policy, permissions policy, and production HSTS (`apps/web/next.config.ts:51-90`).
- Server action body size is capped (`apps/web/next.config.ts:92-100`).
- Deploy helper refuses unsafe secret-file permissions and keeps deploy target data in bind mounts while pruning only after the live container is up (`scripts/deploy-remote.sh:55-85`, `apps/web/deploy.sh:15-43`, `apps/web/deploy.sh:79-104`).
- Manual validation remains required for TLS edge exposure and proxy-trust topology (MV-SEC-01, MV-SEC-03).

### A06 Vulnerable and Outdated Components

- Weekly Dependabot is configured for npm and Docker (`.github/dependabot.yml:3-19`).
- Current dependency freshness could not be fully validated because `npm audit` could not reach the npm registry from this sandbox (MV-SEC-02).

### A07 Identification and Authentication Failures

- Login uses same-origin validation before rate limiting and Argon2 verification (`apps/web/src/app/actions/auth.ts:77-102`, `apps/web/src/app/actions/auth.ts:129-142`).
- Dummy hash verification is used to reduce username-enumeration timing differences (`apps/web/src/app/actions/auth.ts:180-183`).
- Session creation is transactional and prunes old sessions (`apps/web/src/app/actions/auth.ts:218-230`).
- Password change pre-increments rate limits before expensive verification and rotates all sessions after successful password update (`apps/web/src/app/actions/auth.ts:344-360`, `apps/web/src/app/actions/auth.ts:399-410`).
- Account/user creation validates username/password length and rate-limits before hashing (`apps/web/src/app/actions/admin-users.ts:97-142`).

### A08 Software and Data Integrity Failures

- Backup file download validates filename shape, path containment, realpath containment, and file type before streaming (`apps/web/src/lib/backup-filename.ts:3-11`, `apps/web/src/app/api/admin/db/download/route.ts:23-67`).
- Restore upload files are written mode `0600`, size capped, plausibility checked, SQL-scanned, and fed to `mysql` without shell interpolation (`apps/web/src/app/[locale]/admin/db-actions.ts:577-680`).
- Image-original storage rejects unsafe legacy public paths in production and enforces private-root containment (`apps/web/src/lib/upload-paths.ts:49-56`, `apps/web/src/lib/upload-paths.ts:120-170`, `apps/web/src/lib/upload-paths.ts:173-194`).
- Docker/runtime deploy scripts contain a clear separation between immutable image assets and bind-mounted persistence (`apps/web/docker-compose.yml:24-28`, `apps/web/deploy.sh:79-104`).

### A09 Security Logging and Monitoring Failures

- Admin token use, upload events, backup download, token creation/revocation, and user deletion are audited in reviewed paths (`apps/web/src/lib/api-auth.ts:84-90`, `apps/web/src/app/api/admin/lr/upload/route.ts:564-579`, `apps/web/src/app/api/admin/db/download/route.ts:69-73`, `apps/web/src/app/actions/lr-tokens.ts:87-99`, `apps/web/src/app/actions/admin-users.ts:243-268`).
- Sensitive subprocess stderr is sanitized before surfacing (`apps/web/src/lib/sanitize.ts:117-142`, `apps/web/src/app/[locale]/admin/db-actions.ts:714-715`, `apps/web/src/app/[locale]/admin/db-actions.ts:781-820`).

### A10 Server-Side Request Forgery

- OG photo fetching uses canonical `BASE_URL`/site origin rather than request-origin input and fails closed on invalid origin derivation (`apps/web/src/app/api/og/photo/[id]/route.tsx:176-196`).
- The image fetch helper constructs URLs from that supplied trusted origin and enforces byte and timeout caps (`apps/web/src/lib/og-photo-fetch.ts:31-41`, `apps/web/src/lib/og-photo-fetch.ts:64-93`, `apps/web/src/lib/og-photo-fetch.ts:102-118`).
- SEO OG image URLs are constrained to the configured site origin before use (`apps/web/src/lib/seo-og-url.ts:28-38`).

## Privacy review notes

- Public image selectors intentionally omit admin-only, source-path, hash, dimensions, processing, status, failure, and internal metadata fields (`apps/web/src/lib/data.ts:368-408`).
- Map exposure is separately constrained to selected public fields plus latitude/longitude and guarded by a compile-time privacy assertion (`apps/web/src/lib/data.ts:410-489`).
- Map query output is limited and requires public map visibility plus non-null coordinates (`apps/web/src/lib/data.ts:1698-1743`).
- Search enrichment uses its own public field list with a symmetric privacy guard (`apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Upload flows strip or reject GPS-bearing originals before saving originals in the Lightroom path and dashboard path (`apps/web/src/app/api/admin/lr/upload/route.ts:406-424`, `apps/web/src/app/actions/images.ts:371-408`).
- Public analytics validates targets and rate-limits event recording without storing full IPs in the reviewed action code (`apps/web/src/app/actions/public.ts:417-505`).

## Secrets review notes

- `.gitignore` ignores local environment files, deployment env, logs, and runtime data paths (`.gitignore:6-18`, `.gitignore:81-88`).
- `.env.local.example` contains placeholders and documents strict local permissions rather than real credentials (`apps/web/.env.local.example:2-7`, `apps/web/.env.local.example:27-33`).
- Deploy env loading refuses missing env files and unsafe permissions before sourcing secrets (`scripts/deploy-remote.sh:55-85`, `apps/web/deploy.sh:15-43`).
- Local secret pattern sweep did not identify committed live credentials. Hits were placeholders, redacted examples, docs, or tests.

## Final missed-issue sweep

- Re-ran a repo grep sweep for risky primitives: `dangerouslySetInnerHTML`, child-process execution, subprocess spawn/exec, `fetch`, URL parsing, forwarded headers, `TRUST_PROXY`, admin auth wrappers, origin guards, rate-limit gates, raw SQL markers, `LIKE`, and direct environment reads.
- Confirmed `dangerouslySetInnerHTML` usage is limited to structured-data rendering paths covered by `safeJsonLd` (`apps/web/src/lib/safe-json-ld.ts:14-19`).
- Confirmed fetch-like SSRF-relevant code is centered in OG image fetching and uses canonical-origin construction plus byte/time caps (`apps/web/src/app/api/og/photo/[id]/route.tsx:176-207`, `apps/web/src/lib/og-photo-fetch.ts:31-41`).
- Confirmed subprocess use in backup/restore uses argument arrays, explicit env, no inherited `HOME`, SSL args, and sanitized stderr in the reviewed production path (`apps/web/src/app/[locale]/admin/db-actions.ts:221-230`, `apps/web/src/app/[locale]/admin/db-actions.ts:651-680`, `apps/web/src/app/[locale]/admin/db-actions.ts:714-715`).
- Confirmed public expensive handlers are covered by the static public-route rate-limit scanner and targeted tests in the validation section.

## Conclusion

No confirmed or likely repository-code security defects were found in cycle 92. The remaining security work is environmental validation: prove the HTTP nginx hop is internal-only, refresh dependency vulnerability data from a network-enabled scanner, and verify production proxy trust/header topology matches the assumptions encoded in `TRUST_PROXY` and nginx.
