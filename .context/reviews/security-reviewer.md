# Security Reviewer - Cycle 24

Review date: 2026-06-30
Reviewed HEAD: `0cc094dd76d51e88fe163c0b7075e3f0b341f74c`
Role: security-reviewer
Scope: full-repository security review for OWASP Top 10, secrets, unsafe patterns, auth/authz, CSRF/origin, SSRF, path traversal, upload safety, backup/restore, rate limiting, privacy leaks, and deploy/runtime security.

## Inventory First

I reviewed current `HEAD`, not prior-cycle assumptions. I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the active security-relevant implementation before judging findings.

Security-relevant tracked inventory examined:

- App routes/pages/actions: all files under `apps/web/src/app/**`, including public pages, admin pages, route handlers, localized upload routes, admin DB actions, and every `apps/web/src/app/actions/*.ts` server action.
- Security libraries: all files under `apps/web/src/lib/**`, including auth/session, API auth, origin guards, rate limits, upload containment, image processing, GPS stripping, public data/privacy guards, CSP/JSON-LD, OG URL/fetch handling, semantic search, smart collections, backup/restore helpers, SQL restore scanning, MySQL TLS helpers, audit, queue/lock helpers, and storage backends.
- Database and migrations: `apps/web/src/db/**`, `apps/web/drizzle/**`, `apps/web/drizzle.config.ts`, and `apps/web/scripts/migrate.js`.
- Runtime/deploy/config: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/package.json`, root package/lock files, `apps/web/scripts/**`, and root `scripts/deploy-remote.sh`.
- Security tests and guard scripts: auth/origin/rate-limit lint scripts, tracked-secret tests, privacy guards, upload/path tests, restore SQL scanner tests, CSP/OG tests, and source-contract tests relevant to the reviewed controls.
- Tracked env examples and documentation: `.env.deploy.example`, `apps/web/.env.local.example`, `README.md`, and relevant `CLAUDE.md` operational sections.

Skipped/unavoidable:

- I did not read `node_modules`, `.git`, build output, binary media/font fixtures, or every generated lockfile line manually. Dependency risk was covered by `npm audit` and direct manifest/Docker review.
- I did not print or inspect real gitignored secret files such as `apps/web/.env.local` or `.env.deploy`. I verified tracked examples/tests and ignore posture instead.
- Historical `.context/**`, `.omx/**`, and `.claude/worktrees/**` files were not treated as active application code, except existing review/plan context needed to distinguish known operational risks from current HEAD code.

No active source route/action/auth/upload/restore/deploy surface in the inventory above was intentionally skipped.

## Findings Summary

- Confirmed issues: 1 Low
- Likely issues: 1 Low
- Risks needing manual validation: 1 High-impact deployment assumption
- Confirmed Critical/High application vulnerabilities: 0

I did not find a confirmed auth bypass, CSRF/origin bypass, SSRF, path traversal, public original-file exposure, unsafe restore primitive, committed active secret, privacy-field leak, or missing mutating-route rate limit in current HEAD.

## Confirmed Issues

### SEC24-01 - Raw auth error messages are written to server logs

Severity: Low
Confidence: Medium
Status: Confirmed unsafe logging pattern; data sensitivity depends on runtime error content
Location: `apps/web/src/app/actions/auth.ts:246-248`, `apps/web/src/app/actions/auth.ts:430-439`

Code region:

- Login catches unexpected auth verification failures and logs `e.message` at `apps/web/src/app/actions/auth.ts:246-248`.
- Password update catches unexpected failures and logs `e.message` at `apps/web/src/app/actions/auth.ts:430-439`.

Exploit/failure scenario:

An attacker who can trigger infrastructure or driver errors on auth paths cannot read these messages directly, but the messages can enter centralized logs. Depending on the thrown error, logs may include DB host/user/database names, SQL fragments, connection details, or other operational metadata. Backup/restore stderr already has a dedicated redaction helper, but these auth logs do not use it.

Concrete fix:

Replace raw auth-path error messages with a small structured code and sanitize any detail before logging. For example, log `{ event: "login_verification_failed", code: mysqlCodeOrErrorName }` and avoid driver messages unless routed through a generalized redaction helper that removes configured DB host/user/name and secret-like values.

## Likely Issues

### SEC24-02 - Container base image and OS package inputs are mutable

Severity: Low
Confidence: High
Status: Likely supply-chain/configuration risk
Location: `apps/web/Dockerfile:1`, `apps/web/Dockerfile:9-21`

Code region:

- Build and runner stages use floating `node:24-slim` tags at `apps/web/Dockerfile:1` and `apps/web/Dockerfile:15`.
- Build/runtime packages are installed from current Debian repositories at `apps/web/Dockerfile:9-21`.

Exploit/failure scenario:

A rebuild can silently resolve a different base-image digest or different Debian package versions without a repository diff. That can introduce compromised packages, vulnerable binaries, or runtime behavior changes after review. The Dockerfile comment documents the intent to stay on latest Node 24 LTS and consume security updates, so this is a controlled tradeoff only if deploy/build logs record the resolved digests and operators review provenance.

Concrete fix:

Pin `node:24-slim` by digest for release builds or record and verify the resolved digest in CI/deploy provenance. If digest pinning is rejected to keep automatic security updates, add SBOM/provenance output and vulnerability scanning for the built image as a release gate.

## Risks Needing Manual Validation

### SEC24-03 - Bundled nginx config is unsafe if exposed as the public cleartext edge

Severity: High if misdeployed; not confirmed in repository state
Confidence: Medium
Status: Manual-validation deployment risk
Location: `apps/web/nginx/default.conf:21-30`, `apps/web/nginx/default.conf:55`, `apps/web/docker-compose.yml:15-22`

Code region:

- The nginx template listens on port 80 at `apps/web/nginx/default.conf:21-23`.
- The comments correctly state it is an internal HTTP hop behind TLS termination at `apps/web/nginx/default.conf:25-30`.
- HSTS is emitted at `apps/web/nginx/default.conf:55`, but HSTS does not create TLS for first-time cleartext requests.
- Compose uses host networking and states that the host reverse proxy handles rate limiting/security headers at `apps/web/docker-compose.yml:15-22`.

Exploit/failure scenario:

If this nginx config is exposed directly as the public edge instead of sitting behind a TLS-terminating proxy/load balancer, first-time visitors and admin users can send login/session traffic over HTTP. HSTS is only effective after a browser receives it over HTTPS, so the header in this port-80 server block can create a false sense that TLS is enforced.

Concrete fix:

Validate production topology: public traffic must terminate TLS before this listener, or nginx must get a `listen 443 ssl` server block plus a port-80 redirect. Add a deploy/startup check or documented ops assertion that fails when this config is used as the public edge without TLS termination.

## Positive Security Evidence

Auth/session/origin:

- `withAdminAuth` centralizes admin API auth, supports scoped PATs, and requires same-origin for cookie-authenticated admin API calls in `apps/web/src/lib/api-auth.ts`.
- `requireSameOriginAdmin()` and `hasTrustedSameOrigin()` fail closed on mutating server actions unless `Origin`/`Referer` matches the trusted host in `apps/web/src/lib/action-guards.ts` and `apps/web/src/lib/request-origin.ts`.
- Sessions are HMAC-signed, timing-safe compared, DB-backed, production-require `SESSION_SECRET`, and expire after 24 hours in `apps/web/src/lib/session.ts`.
- Login/password-change flows pre-increment rate limits before expensive Argon2 work and use Argon2id parameters from `apps/web/src/lib/password-hashing.ts`.

CSRF and authz gates:

- `npm run lint:action-origin --workspace=apps/web` passed and reported every mutating server action as guarded or explicitly read-only/public-rate-limited.
- `npm run lint:api-auth --workspace=apps/web` passed for all admin API route handlers.
- Admin user, topic/tag/settings/SEO/share/collection/backfill/image actions all re-check same-origin then admin state before mutation.

Public routes/rate limits/privacy:

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. The semantic search mutating public API uses a pre-increment rate-limit helper.
- Public share pages validate Base56 keys, rate-limit the lookup path, avoid key-validity metadata lookups, and mark pages noindex.
- Public data accessors use privacy-guarded select fields; map GPS fields are only returned for map-visible topics; semantic/search enrichment has its own sensitive-key guard.
- Public analytics stores referrer host/country/bot metadata and rate-limits by request IP without storing raw IP in analytics rows.

Upload/path traversal/original safety:

- Upload filenames are generated or sanitized as basenames; original uploads are stored under private `UPLOAD_ORIGINAL_ROOT`.
- Public upload serving allows only derivative directories, validates path segments/extensions, rejects symlinks, checks realpath containment, and never serves originals.
- Browser and Lightroom uploads enforce auth, size/body caps, disk checks, safe metadata validation, upload processing locks, GPS stripping, HDR policy, DB insertion after processing, and cleanup on failure.
- Startup/migration code refuses production with legacy public originals still under `public/uploads/original`.

Backup/restore:

- DB backup and restore actions require same-origin admin auth, advisory locks, restore maintenance, queue quiescing, size caps, random `0600` temp files, sanitized stderr, TLS CLI args for non-local MySQL, and post-restore migration checks.
- Restore SQL is scanned after comment/literal stripping and blocks dangerous statements outside the app backup allowlist.
- Backup download validates filename shape and realpath containment before streaming from an opened file handle.

SSRF/XSS/CSP:

- OG photo fetches are pinned to configured `BASE_URL` origin, not request origin; fallback redirects are same-origin only.
- Admin-configured OG image URLs reject cross-origin absolute URLs and unsafe relative backslash forms.
- JSON-LD injection sites use `safeJsonLd`; no unsafe dynamic-code execution was found in runtime code.
- Production CSP is nonce-based for scripts with `object-src none`, `base-uri self`, and `frame-ancestors self`.

Secrets/dependencies/runtime:

- Tracked secret sweep found no active committed credentials; local secret files are gitignored.
- `npm audit --workspace=apps/web --omit=dev --json` and root `npm audit --json` reported 0 vulnerabilities.
- Runtime container drops to `node` via entrypoint after permission setup; app binds `HOSTNAME=127.0.0.1` in compose.
- CLIP production model loading disables remote models at runtime and reads from the configured local model cache.

## Validation Evidence

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --omit=dev --json` - 0 vulnerabilities
- `npm audit --json` - 0 vulnerabilities
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/sanitize-stderr.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/upload-paths.test.ts src/__tests__/seo-og-url.test.ts src/__tests__/tracked-secrets.test.ts` - 11 files passed, 178 tests passed
- `node -c apps/web/scripts/migrate.js`

Manual sweeps performed:

- Dynamic-code/HTML sinks: `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`, `outerHTML`, `document.write`.
- Command/process/file sinks: `spawn`, `exec`, `execFile`, `fetch`, `new URL`, stream/open/read/write/unlink/rename/realpath/lstat calls.
- Request/body/auth primitives: `formData`, `request.json`, `request.text`, `headers`, `cookies`, `withAdminAuth`, `requireSameOriginAdmin`, action exemptions, and public rate-limit exemptions.
- Secret-like strings: secret/password/token/key patterns across tracked files, excluding gitignored env files and generated lock/journal noise.
- Cross-file checks: admin API exports, mutating actions, public mutating routes, upload write/serve split, original-file privacy, share-key enumeration, OG SSRF/open redirect, restore SQL scanner, public field privacy guards, and deploy/runtime assumptions.

## Missed-Security-Issues Sweep

Final sweep results:

- Admin API routes: no missing `withAdminAuth` wrappers found by lint or manual check.
- Mutating server actions: no missing `requireSameOriginAdmin()` found by lint or manual check.
- Public mutating route handlers: no missing pre-increment rate-limit helper found by lint or manual check.
- Upload serving: no public route found that serves originals; derivative serving remains allowlisted and realpath-contained.
- Restore/download: no path traversal, shell interpolation of user-controlled arguments, or unscanned restore SQL path found.
- SSRF/open redirects: no request-origin-derived server fetch or cross-origin OG redirect found in active OG/search code.
- Privacy leaks: no public select set found exposing original filenames, user filenames, latitude/longitude except the explicit map-visible GPS flow.
- Secrets: no active committed secret material found in tracked source; historical secret exposure remains an operational rotation concern documented elsewhere, not a current HEAD code leak.

Skipped-file confirmation:

- I did not skip any active security-relevant source/config/script file in the inventoried runtime surface.
- I intentionally skipped only generated/vendor/binary/build artifacts, git internals, unrelated historical session state, and real gitignored secret files.
- Existing unrelated modified review files in the working tree were left untouched.
