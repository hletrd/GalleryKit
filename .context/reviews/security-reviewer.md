# Cycle 25 Security Review - Security Reviewer Lane

Date: 2026-07-08
Scope: deep whole-repo security review; no product-code changes.
Workspace: `/Users/hletrd/flash-shared/gallery`

## Inventory Built First

I inventoried docs, app routes, server actions, libs, DB/migration code, scripts, tests, and deployment config before assessing findings. I did not read gitignored runtime secret values such as `.env.local` or `.env.deploy`; I verified their ignore/permission guardrails instead.

Primary source inventory examined:

- Authority/docs: provided `AGENTS.md` instructions, `CLAUDE.md`, `.context/reviews/security-reviewer.md` prior report.
- Routes: every route returned by `find apps/web/src/app -name route.ts -o -name route.tsx`, including public feed/upload/health/live/OG/search routes and admin API routes.
- Server actions: every file in `apps/web/src/app/actions/*.ts` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/session/token/origin/rate-limit: `auth.ts`, `session.ts`, `api-auth.ts`, `admin-tokens.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `proxy.ts`.
- Upload/file/path safety: `images.ts`, `api/admin/lr/upload/route.ts`, `upload-paths.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `upload-filenames.ts`, `validation.ts`, `storage/*`.
- DB/raw SQL/restore: `data.ts`, `smart-collections.ts`, `sql-like.ts`, `db-actions.ts`, `api/admin/db/download/route.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `db/index.ts`, `db/schema.ts`, `drizzle/*`, `scripts/migrate*`, backfill scripts.
- XSS/CSP/XML/SEO: `content-security-policy.ts`, `safe-json-ld.ts`, `seo-og-url.ts`, `atom-feed.ts`, `blur-data-url.ts`, public pages using `dangerouslySetInnerHTML`, `next.config.ts`.
- Secrets/deploy/config: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `Dockerfile`.

## Verification Evidence

- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: passed; admin API exports are wrapped.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating actions enforce origin and restore mutation barrier or documented exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public expensive/mutating route handlers have rate-limit pre-increments or documented exemptions.
- Targeted security tests: `npm test --workspace=apps/web -- --run ...` passed 19 files / 455 tests, covering privacy fields, search-route privacy, request origin, auth/API lint gates, public route rate-limit gate, upload serving, DB restore, SQL restore scan, JSON-LD, CSP, sanitizers, CSV escaping, tracked secrets, smart collections, rate limits, and API auth response headers.
- Secret tracking sweep: tracked files include only examples/tests/token code, not runtime `.env.local` or `.env.deploy`; `git check-ignore -v` confirms root and app env files are ignored.
- Dangerous sink sweep: reviewed `dangerouslySetInnerHTML`, `fetch`, URL building, raw SQL, `process.env` secret use, and public route exemptions.

## Findings

### Confirmed Issues

No confirmed exploitable code-level security vulnerabilities found in this repository state.

### Likely Issues

No likely source-level security issues found.

### Risks Needing Manual Validation

#### RV-25-01 - Reverse-proxy topology and nginx template application are operational security dependencies

Severity: Low-Medium
Confidence: Medium
Status: Manual-validation risk, not a confirmed repo defect
OWASP: A05 Security Misconfiguration, A04 Insecure Design

Evidence:

- `apps/web/docker-compose.yml:15-23` uses host networking, expects nginx/reverse proxy handling, and sets `TRUST_PROXY=true`.
- `apps/web/nginx/default.conf:20-29` warns that `$binary_remote_addr` rate-limit keys need real-IP/PROXY-protocol support when an upstream LB exists.
- `apps/web/nginx/default.conf:52-71` documents that overwriting `X-Forwarded-For` with `$remote_addr` is correct only when the connecting peer is the real client; LB-fronted topology must use append-mode forwarding and real hop counts.
- `apps/web/nginx/default.conf:274-295` applies the public SSR flood limiter in the nginx catch-all and states this config must be manually applied/reloaded.
- `apps/web/src/lib/rate-limit.ts:175-217` trusts proxy headers only with `TRUST_PROXY=true`; otherwise all requests key as `unknown` and the code logs a shared-bucket warning.
- `CLAUDE.md:447-449` documents that public home/topic/photo/share/smart-collection/timeline/year/map pages use `revalidate = 0`, making edge backpressure important for page-level flood control.

Failure scenario:

If production is CDN/LB -> nginx -> app and nginx keeps the shipped overwrite mode without `real_ip`, every visitor shares the LB address for nginx zones and app-side per-IP rate limits. One attacker can consume login/search/share/OG budgets for all users or trigger global 429s. If the committed nginx template was never applied, dynamic public SSR pages lose the documented edge limiter and can be hammered directly.

Suggested fix:

Validate production with `nginx -T`: ensure this template is active, configure `set_real_ip_from` / `real_ip_header` or PROXY protocol for upstream LBs, switch to `$proxy_add_x_forwarded_for` where appropriate, set `TRUSTED_PROXY_HOPS` to the actual right-anchored hop count, and smoke-test distinct client IP attribution at the app. Consider a deploy gate that asserts the expected nginx limiter and forwarding mode.

#### RV-25-02 - Restore hardening is strong but still regex-based; hostile SQL restore should be treated as an admin-trust boundary

Severity: Medium
Confidence: Medium
Status: Manual-validation risk; no bypass found in review/tests
OWASP: A08 Software and Data Integrity Failures, A05 Security Misconfiguration

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:745-821` writes the uploaded restore file to a private temp file, caps size, validates a plausible SQL header, and requires a mysqldump completion trailer for mysqldump artifacts.
- `apps/web/src/app/[locale]/admin/db-actions.ts:823-869` scans the whole file in chunks with rolling tails/raw suffixes and rejects dangerous SQL before import.
- `apps/web/src/app/[locale]/admin/db-actions.ts:871-900` imports through `mysql --one-database` with minimal env and TLS argument validation.
- `apps/web/src/lib/sql-restore-scan.ts:88-156` blocks broad dangerous statements including grants/users, DB/table destruction, routines/triggers/views, `LOAD DATA`, outfile/dumpfile, prepared statements, and global settings.
- `apps/web/src/lib/sql-restore-scan.ts:262-304` rejects schema-qualified writes and write targets outside the known app backup table allowlist.
- `apps/web/src/lib/sql-restore-scan.ts:306-341` carries compacted and raw scan tails to catch chunk-boundary splits.

Failure scenario:

An authenticated admin, compromised admin browser, or stolen session uploads a deliberately crafted SQL file that exploits an unmodeled MySQL grammar edge case in the regex scanner. The likely impact is app data corruption or privilege-impacting statements within the MySQL user's grants. I did not find a concrete bypass, and `sql-restore-scan.test.ts` passed, but regex scanning is still not a complete SQL parser.

Suggested fix:

For stronger integrity, only restore app-generated signed backups, or restore into a temporary isolated database with a least-privileged restore user, then verify schema/table allowlists and row import before swapping. A MySQL parser or strict mysqldump-shape validator would reduce reliance on denylist regexes.

#### RV-25-03 - Runtime secret provenance and rotation cannot be proven from source review

Severity: Low-Medium
Confidence: High
Status: Manual-validation risk
OWASP: A02 Cryptographic Failures, A05 Security Misconfiguration

Evidence:

- `apps/web/.env.local.example:21-33` requires strong `ADMIN_PASSWORD` and `SESSION_SECRET` and warns that historical example values must be rotated.
- `apps/web/.env.local.example:57-70` documents proxy trust settings that alter rate-limit/origin behavior.
- `.env.deploy.example:1-16` instructs operators to copy deploy credentials into a gitignored env file and `chmod 600`.
- `scripts/deploy-remote.sh:55-80` refuses missing or group/world-readable deploy env files before sourcing them.
- `apps/web/deploy.sh:15-43` refuses missing or group/world-readable runtime env files before Docker Compose consumes them.
- `apps/web/src/lib/session.ts:16-35` requires production `SESSION_SECRET` with minimum length and refuses the DB fallback in production.

Failure scenario:

If a production host reused historical example secrets, leaked local env files, or used weak bootstrap credentials, source-level checks would still pass while sessions/admin credentials remain compromised. I intentionally did not inspect gitignored local secret values, so live rotation status remains outside review evidence.

Suggested fix:

Verify production `SESSION_SECRET`, `ADMIN_PASSWORD`, DB credentials, deploy SSH key, PATs, and any historical bootstrap values were generated uniquely and rotated after any exposure. Keep env files mode `600`, owned by the deploy user, and avoid copying runtime envs into logs/backups.

#### RV-25-04 - Database backups are plaintext at rest by design

Severity: Low-Medium
Confidence: High
Status: Manual-validation/accepted-risk candidate
OWASP: A02 Cryptographic Failures

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:189-195` creates `data/backups` with owner-only mode `0700`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:229-244` runs `mysqldump` with password in `MYSQL_PWD`, minimal env, TLS args, and writes the temp backup as mode `0600`.
- `apps/web/src/app/api/admin/db/download/route.ts:21-31` requires `withAdminAuth`, validates the backup filename, and roots downloads under `data/backups`.
- `apps/web/src/app/api/admin/db/download/route.ts:45-67` uses `realpath` containment and `stat().isFile()` before streaming.

Failure scenario:

A host-level compromise, overly broad filesystem permission, or leaked backup directory exposes the full SQL dump, including private image metadata, admin/session/token hashes, analytics, and settings. The app download route is authenticated and path-contained, so this is not a web path traversal finding; it is an at-rest protection gap relative to stronger backup threat models.

Suggested fix:

Encrypt backup artifacts before final rename, preferably with age/GPG/KMS and key material outside the app container. Add retention/rotation guidance and a restore path that decrypts to a temp file under the same scanner/import controls.

## Confirmed Controls Reviewed

- Auth/session: `session.ts:16-35` requires a production session secret; `session.ts:82-150` signs/verifies HMAC tokens, checks age, hashes tokens for storage, and deletes expired sessions. `auth.ts:79-103`, `auth.ts:137-197`, and `auth.ts:240-253` enforce same-origin login, pre-incremented login rate limits, Argon2 verification with dummy hash timing equalization, session rotation, and secure/httpOnly/SameSite cookies.
- Admin page/API auth: `proxy.ts:55-66` blocks obvious unauthenticated admin page access; `admin/(protected)/layout.tsx:15-18` performs full `isAdmin()` before rendering protected children. `api-auth.ts:66-152` wraps admin APIs, enforces same-origin for cookie auth, supports scoped PATs only when configured, and sets no-store/nosniff. `admin-tokens.ts:53-78` generates and compares hashed PATs, and `admin-tokens.ts:142-179` verifies expiry/scope before marking use.
- CSRF/same-origin: `request-origin.ts:71-146` derives expected origin from canonical config/host and fails closed when Origin/Referer are missing for admin actions. The `lint:action-origin` gate passed across all server actions.
- Rate limits: public search/share/OG/load-more/view recording pre-increment or explicitly exempt cheap routes; the public route lint passed. `rate-limit.ts:175-217` avoids trusting spoofed proxy headers unless explicitly configured.
- Upload/path/file serving: `upload-paths.ts:49-88` keeps originals in a private root and safe-deletes only contained, non-symlink filenames; `upload-paths.ts:120-170` enforces basename/path containment. `serve-upload.ts:162-219` validates public derivative paths, whitelists top-level format dirs, rejects symlinks, and uses realpath containment; `serve-upload.ts:265-369` serves with ETag, nosniff, bounded stat/open behavior, and abort cleanup. Browser and PAT uploads validate file counts, byte caps, topic slugs, safe user filenames, disk headroom, and GPS stripping.
- SQL/raw query safety: application data paths use Drizzle parameterization; reviewed `sql.raw` instances are constant separators. `smart-collections.ts:151-248` compiles allowlisted AST predicates with Drizzle bindings; `smart-collections.ts:356-502` validates scalar value types and column/operator semantics before public execution.
- XSS/CSP/XML/CSV: production CSP builds nonce-based script sources in `content-security-policy.ts:139-199`; `safe-json-ld.ts:14-19` escapes JSON-LD script bodies; public `dangerouslySetInnerHTML` uses `safeJsonLd`; `atom-feed.ts:21-29` XML-escapes feed values; `csv-escape.ts:41-64` strips controls/format chars and prefixes spreadsheet formula values.
- Privacy leaks: `data.ts:368-488` derives public select fields from admin fields while omitting sensitive keys and enforcing compile-time guards; `search-enrichment-fields.ts:29-46` has the same compile-time guard for semantic/similar search enrichment. The privacy/search-route tests passed.
- SSRF/open redirect: per-photo OG route pins internal derivative fetches to canonical `BASE_URL` (`api/og/photo/[id]/route.tsx:176-196`) and `seo-og-url.ts:3-43` validates OG image URLs to same-origin http(s), including backslash/scheme-relative bypass protection.
- Secret handling: child DB backup/restore/migrate processes use minimal env and sanitize stderr (`db-actions.ts:229-244`, `db-actions.ts:871-900`, `db-actions.ts:1001-1042`); tracked-secret tests passed.

## Missed-Issue Sweep

Final sweep commands checked all route/action files, public route exemptions, dangerous sinks (`dangerouslySetInnerHTML`, `fetch`, URL construction, raw SQL), env-secret references, tracked secret-like filenames, and TODO/security comments. No additional confirmed issues were found.
