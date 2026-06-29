# Cycle 12 Security Review

Scope: comprehensive repository security review for `/Users/hletrd/flash-shared/gallery` on `master`.

Reviewer role: security-reviewer. This review is read-only except for this report file. Production code was not edited.

## Result

No critical application-code vulnerabilities were identified.

- Confirmed findings: 1 medium-severity finding, 1 low-severity finding
- Likely findings: none
- Risk findings: 1 high-severity deployment-configuration risk

The reviewed code has strong compensating controls: admin origin gates, auth lint gates, scoped PATs, strict upload/path containment, SQL parameter binding, privacy selector guards, restore SQL scanning, CSP/HSTS headers, and targeted security tests. The material residual issues are at the infrastructure/configuration boundary.

## Inventory Reviewed

Repository inventory was built before manual review:

- Tracked files: 2544
- Application source files under `apps/web/src`: 498
- App route/action files under `apps/web/src/app`: 76
- API route handlers under `apps/web/src/app/api`: 8
- Library/db/script implementation files under `apps/web/src/lib`, `apps/web/src/db`, and `apps/web/scripts`: 125

Review-relevant files examined without sampling included:

- Authentication, sessions, cookies, CSRF/same-origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, admin layouts/pages.
- Admin API auth and PATs: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.
- Server actions: `admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Upload, derivatives, and path containment: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers.
- Database access, backup, restore, migrations: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`, Drizzle migration metadata.
- Public data/privacy/search/share: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`, public pages/routes for photo, topic, smart collection, map, feed, share links, OG, semantic search, and similar search.
- Output encoding/browser policy: `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/csv-escape.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`.
- Deployment/secrets/dependencies: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `.env.deploy.example`, `.dockerignore`, `apps/web/.dockerignore`, `.github/workflows/quality.yml`, `.github/dependabot.yml`, package manifests and lockfile.
- CLIP/model integrity: `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-model-id.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/clip-model-manifest.ts`.
- Security lint/test surfaces: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, and security/privacy tests under `apps/web/src/__tests__/`.

## Findings

### 1. Confirmed: database backup/restore CLI TLS requires encryption but not server identity verification

- Severity: Medium
- Confidence: High
- Type: Confirmed
- Category: OWASP A02 Cryptographic Failures / A05 Security Misconfiguration
- Files/regions:
  - `apps/web/src/lib/mysql-cli-ssl.ts:11-16`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:149-164`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:511-526`
  - Contrast with app/migration DB clients at `apps/web/src/db/index.ts:6-12` and `apps/web/scripts/mysql-connection-options.js:11-23`

`getMysqlCliSslArgs()` returns `['--ssl-mode=REQUIRED']` for non-local database hosts (`apps/web/src/lib/mysql-cli-ssl.ts:11-16`). `dumpDatabase()` passes those args to `mysqldump` (`apps/web/src/app/[locale]/admin/db-actions.ts:149-164`), and restore passes them to `mysql` (`apps/web/src/app/[locale]/admin/db-actions.ts:511-526`). `REQUIRED` encrypts the connection but does not verify the server certificate identity the way `VERIFY_IDENTITY`/CA verification modes do. The main application and migration clients use `ssl: { rejectUnauthorized: true }` for non-local DB hosts (`apps/web/src/db/index.ts:6-12`, `apps/web/scripts/mysql-connection-options.js:11-23`), so backup/restore is weaker than normal app DB traffic.

Concrete exploit/failure scenario: in a deployment with `DB_HOST` pointing to a remote/non-local MySQL endpoint and `DB_SSL` left at its secure default, a network-positioned attacker can present an impostor TLS endpoint during an admin-triggered backup or restore. The CLI connection is encrypted to the impostor but not identity-verified; the attacker can capture DB credentials supplied via `MYSQL_PWD`, read backup data, or alter restore input/output in transit. Impact is full database confidentiality/integrity for backup/restore operations; likelihood depends on remote DB topology and network attacker position.

Suggested fix: make CLI TLS verification match the app DB client. For Oracle MySQL clients, prefer `--ssl-mode=VERIFY_IDENTITY` with a configured CA path when the DB is remote. For MariaDB clients, use the supported equivalent (`--ssl`, `--ssl-ca`, and `--ssl-verify-server-cert`, depending on installed client version). Add explicit env/config such as `DB_SSL_CA`, fail closed for remote DB hosts when a verifying mode cannot be configured, and test both `mysqldump` and `mysql` paths in the production image because `apps/web/Dockerfile` installs `mariadb-client`.

### 2. Risk: shipped nginx config is HTTP-only if used as the public edge

- Severity: High when nginx is internet-facing; none when a TLS-terminating edge is correctly in front
- Confidence: High
- Type: Risk
- Category: OWASP A02 Cryptographic Failures / A05 Security Misconfiguration
- Files/regions:
  - `apps/web/nginx/default.conf:21-28`
  - `apps/web/nginx/default.conf:47-53`
  - `apps/web/src/app/actions/auth.ts:225-238`
  - `apps/web/docker-compose.yml:14-21`

The checked-in nginx server listens on port 80 only (`apps/web/nginx/default.conf:21-23`). The comments state that it is intended to sit behind a TLS-terminating load balancer and that a public-edge deployment must add a 443 server block and cleartext redirect (`apps/web/nginx/default.conf:25-28`). The same HTTP server still emits HSTS (`apps/web/nginx/default.conf:47-53`), which only protects clients after they have reached the site over HTTPS. The app sets admin cookies `Secure` in production (`apps/web/src/app/actions/auth.ts:225-238`), but the login form POST itself would still traverse cleartext if this nginx file were exposed directly. Docker compose uses host networking and trusts the proxy headers (`apps/web/docker-compose.yml:14-21`), so the deployment assumes a correct edge/proxy topology.

Concrete failure scenario: an operator deploys the included nginx config directly on an internet-facing host without an upstream HTTPS terminator. An attacker on the network path can observe or modify admin login requests, session establishment responses, restore/upload requests, and any plaintext content. Secure cookies may fail to persist over HTTP in production, but that does not protect the submitted password from cleartext transport.

Suggested fix: make the shipped edge config fail-safe. Add a default port-80 redirect-only server and a 443 server block with TLS, or split the internal-behind-edge config from a public-edge config so the insecure topology is not copy-paste deployable. Also consider a production startup/config check that refuses admin login when `getTrustedRequestProtocol()` is not `https` in production, except for explicit localhost/dev cases.

### 3. Confirmed: database backups are plaintext at rest under the app data directory

- Severity: Low
- Confidence: High
- Type: Confirmed
- Category: OWASP A02 Cryptographic Failures / backup/restore security
- Files/regions:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:140-147`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:166`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:241-242`
  - `apps/web/src/app/api/admin/db/download/route.ts:22-87`

`dumpDatabase()` writes SQL backups to `data/backups` with an owner-only directory (`0o700`) and file mode (`0o600`) (`apps/web/src/app/[locale]/admin/db-actions.ts:140-147`, `:166`). The admin receives an authenticated download URL for the plaintext `.sql` file (`apps/web/src/app/[locale]/admin/db-actions.ts:241-242`), and the download handler validates filename shape, containment, realpath, and admin auth before streaming (`apps/web/src/app/api/admin/db/download/route.ts:22-87`). Those are good controls, but the backup file itself remains unencrypted on disk.

Concrete failure scenario: a host-level compromise, backup-sync misconfiguration, or accidental archive of `apps/web/data/backups` exposes full database contents, including private originals metadata, admin tables, session hashes, token hashes, and audit data. File permissions protect against casual multi-user reads, not host compromise or off-host backup leakage.

Suggested fix: if the threat model includes host backups or shared operators, encrypt backups at creation time with an operator-controlled key, or store them outside the web app data tree in a restricted backup system with encryption-at-rest and retention policy. If plaintext backups remain an intentional personal-gallery tradeoff, document the operational boundary beside the DB backup UI/runbook.

## Positive Security Evidence

- Auth/session: production refuses weak/missing `SESSION_SECRET` fallback in `apps/web/src/lib/session.ts:19-35`; session tokens are HMAC-signed, timestamped, DB-hash checked, and timing-safe verified in `apps/web/src/lib/session.ts:82-150`; login/password-change paths enforce same-origin, rate limits, Argon2id, session fixation prevention, and session rotation in `apps/web/src/app/actions/auth.ts`.
- Cookies/CSRF: production cookies are `httpOnly`, `Secure`, `SameSite=Lax`, and path-scoped to `/` (`apps/web/src/app/actions/auth.ts:225-238`); origin checks fail closed without explicit Origin/Referer (`apps/web/src/lib/request-origin.ts:83-107`).
- Admin API/PATs: cookie-authenticated admin API requests require same-origin before `isAdmin()` (`apps/web/src/lib/api-auth.ts:111-120`); token-authenticated LR upload pre-increments an IP limiter before DB token verification (`apps/web/src/lib/api-auth.ts:69-80`); tokens are 256-bit random, stored hashed, scope-checked, expiry-checked, and never query-param logged (`apps/web/src/lib/admin-tokens.ts`).
- Server actions: the action-origin lint gate passed; reviewed mutating actions return early on `requireSameOriginAdmin()` or carry narrow read-only/public exemptions.
- Rate limits: login/password/search/load-more/share/OG/semantic/admin-token/user-create paths have bounded in-memory and/or DB-backed limiters; nginx adds per-IP request/connection limits and small default body caps.
- Uploads: browser and LR upload paths require admin auth, reject chunked/oversized bodies, validate topics/filenames/metadata, use generated storage names, check disk space, strip GPS when configured, gate HDR ingest, and clean up original files on post-save failures.
- Path traversal/file serving: derivative serving only allows `jpeg`, `webp`, and `avif`, validates safe path segments and extension/type consistency, rejects symlinks/non-files, and enforces realpath containment in `apps/web/src/lib/serve-upload.ts`.
- SQL/command injection: application queries use Drizzle/mysql2 parameter binding; smart collections compile from an allowlisted, depth-limited AST; LIKE predicates now use explicit `ESCAPE '\\'` in `apps/web/src/lib/sql-like.ts:9-10`; backup/restore command execution uses `spawn()` with argv arrays, minimal env, no shell, and sanitized stderr.
- Restore safety: restore upload is admin+same-origin gated, size/header checked, SQL chunk-scanned for dangerous constructs, protected by restore/upload/backfill locks, and followed by migrations.
- Privacy/PII: public selectors omit admin-only/internal fields and have compile-time guards in `apps/web/src/lib/data.ts:367-506`; public map GPS exposure is limited to `topics.map_visible = true` plus a runtime guard in `apps/web/src/lib/data.ts:1658-1688`; search enrichment has a separate privacy guard in `apps/web/src/lib/search-enrichment-fields.ts`.
- Browser/output safety: production CSP is nonce-based for scripts with `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'`; JSON-LD escapes script-breaking characters; CSV export strips control/bidi characters and guards formula injection.
- Model/dependency integrity: CLIP runtime is offline-only (`env.allowRemoteModels = false`) and uses a pinned revision; the downloader verifies key artifacts against a SHA-256 manifest and checks loader-fatal files before short-circuiting.
- Secrets: active app/config secret-pattern hits resolved to placeholders, CI-only dummy credentials, tests, schema names, or env variable names. Gitignored `.env.deploy`/`.env.local` values were not printed or reviewed as source content.

## OWASP Top 10 Coverage

- A01 Broken Access Control: admin route layouts, server actions, API wrappers, PAT scopes, share-key expiry, public selectors, map visibility, and middleware guard reviewed.
- A02 Cryptographic Failures: password hashing, HMAC sessions, cookie flags, PAT hashing, DB TLS, backup plaintext-at-rest, and HTTP/TLS deployment posture reviewed. Findings 1-3 live here.
- A03 Injection: Drizzle/mysql2 binding, smart-collection DSL, LIKE escaping, restore SQL scanner, CSV/XML/JSON-LD escaping, and child-process argv usage reviewed.
- A04 Insecure Design: upload quotas/locks, restore maintenance mode, queue quiescing, privacy guards, rate limits, and lint gates reviewed.
- A05 Security Misconfiguration: nginx headers/body caps/rate limits, CSP/HSTS, Docker runtime user, proxy trust model, `.dockerignore`, env examples, and DB TLS reviewed. Finding 2 is the main residual risk.
- A06 Vulnerable and Outdated Components: production dependency audit found no vulnerabilities.
- A07 Identification and Authentication Failures: login/password-change throttling, dummy-hash timing posture, session rotation, PAT scope/expiry/usage, and admin wrappers reviewed.
- A08 Software and Data Integrity Failures: restore scanner, migration assertions, CLIP artifact checks, local script paths, and deployment scripts reviewed.
- A09 Security Logging and Monitoring Failures: audit logging and stderr sanitization were reviewed; no plaintext credential logging was identified in active paths.
- A10 SSRF: OG derivative fetches are constructed from configured site origin and generated derivative paths; SEO OG URL validation restricts external values to same-origin; no request-input arbitrary fetch path was identified.

## Verification Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` -> passed; admin API exports are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web` -> passed; mutating server actions enforce same-origin provenance or carry reviewed exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed; public mutating API route scan found required pre-increment coverage.
- `npm audit --omit=dev --workspace=apps/web --audit-level=moderate` -> `found 0 vulnerabilities`.
- `npm test --workspace=apps/web -- --run src/__tests__/api-auth-response-headers.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/smart-collections.test.ts` -> 10 files passed, 165 tests passed.

Final missed-issues sweep:

- Reviewed `rg` sweeps for admin API exports, server-action origin checks, public mutating routes, token/session/password helpers, path joins/realpath/unlink/writeFile/readFile, `spawn`/`exec`/shell use, raw SQL/`sql`` templates, `fetch`/URL construction, privacy-sensitive fields, backup/restore flows, upload paths, and secret-like strings.
- Hits resolved to expected wrappers, parameterized SQL, vetted restore patterns, test fixtures, placeholders, CI-only dummy values, docs/plans/review history, or the findings above.
- No skipped review-relevant source files were intentionally sampled out. Untracked gitignored secrets files were not opened or quoted.

## Stop Condition

Security review prompt is complete: inventory was built first, review-relevant files were examined directly from code, final sweeps were performed, current findings were documented with exact code regions, exploit/failure scenarios, severity, confidence, type, and suggested fixes, and validation evidence was recorded.
