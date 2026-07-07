# Security Reviewer Report - review-plan-fix cycle 5 prompt 1

Date: 2026-07-07
Reviewer lane: security-reviewer
HEAD reviewed: `591b44bdaa7fb51c2c0ff8aa12d9274563147561`
Scope: read-only source review plus this artifact.

## Result Summary

- Confirmed issues: 1 Medium
- Likely issues: 1 Low
- Manual-validation risks: 4
- Confirmed Critical/High app vulnerabilities found: 0

The app's main security boundaries are cohesive: admin API routes route through `withAdminAuth`, mutating server actions enforce same-origin provenance, public expensive routes are rate-limited or explicitly exempted with bounded/cacheable behavior, upload serving rejects traversal/symlinks, originals are private, and restore/download paths are strongly constrained. The one confirmed issue is a moderate advisory in the dev/build dependency graph, not in the production runtime image.

## Inventory Built First

Review-relevant files inventoried before detailed inspection:

- API routes: `apps/web/src/app/api/**/route.ts`, `apps/web/src/app/api/**/route.tsx`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/uploads/[...path]/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`.
- Server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/session/rate-limit/request guards: `apps/web/src/lib/session.ts`, `api-auth.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `admin-tokens.ts`, `proxy.ts`.
- Upload/path/image handling: `upload-paths.ts`, `upload-filenames.ts`, `serve-upload.ts`, `process-image.ts`, upload routes, delete/cleanup flows in `actions/images.ts`.
- Backup/restore/SQL tooling: `db-actions.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `backup-filename.ts`, `scripts/migrate.js`, `scripts/mysql-connection-options.js`.
- XSS/data exposure: `sanitize.ts`, `validation.ts`, `safe-json-ld.ts`, `content-security-policy.ts`, `data.ts`, `search-enrichment-fields.ts`, OG routes.
- Deployment/dependency surfaces: `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/next.config.ts`, env examples and docs for secret placeholders.

## Confirmed Issues

### SR-C01 - Medium - Vulnerable dev/build transitive dependency remains in `drizzle-kit`

Confidence: High

Evidence:

- `apps/web/package.json:70-85` keeps `drizzle-kit` as a dev dependency.
- `npm audit --workspace=apps/web --audit-level=low` reports GHSA-67mh-4wv8-2f99 for `esbuild <=0.24.2`, reached via `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild@0.18.20`.
- `npm ls esbuild @esbuild-kit/core-utils @esbuild-kit/esm-loader drizzle-kit --workspace=apps/web` confirms `drizzle-kit@0.31.10` still pulls `@esbuild-kit/core-utils@3.3.2 -> esbuild@0.18.20`.
- `npm view drizzle-kit version dependencies --json` shows `0.31.10` is the current latest and still depends on `@esbuild-kit/esm-loader`.
- Production runtime risk is reduced because Docker installs production deps with `npm ci --omit=dev --workspace=apps/web` in `apps/web/Dockerfile:67-84` and the runner copies only the `prod-deps` tree in `apps/web/Dockerfile:163-169`.

Concrete failure scenario:

A developer or operator runs affected dev tooling in an environment where esbuild's development server is reachable from a browser/network interface. A malicious website visited by that browser can send requests to the dev server and read responses. This does not appear to ship in the production container, but it is still a real workstation/build-host exposure.

Suggested fix:

Track and upgrade `drizzle-kit` when it removes or patches the `@esbuild-kit/esm-loader` chain. Until then, do not expose dev tooling on non-loopback interfaces. Consider an `overrides` test spike only if `drizzle-kit` still works with a patched replacement; do not run `npm audit fix --force` blindly because npm proposes a breaking downgrade to `drizzle-kit@0.18.1`.

## Likely Issues

### SR-L01 - Low - Production CSP allows inline styles

Confidence: Medium

Evidence:

- `apps/web/src/lib/content-security-policy.ts:138-150` builds the production CSP and includes `style-src 'self' 'unsafe-inline'` at line 141.
- Script execution is more tightly controlled by nonce-based `script-src` on the same block, so this is not a direct script-XSS finding.

Concrete failure scenario:

If a future HTML/style injection bug appears in user-controlled content, the current policy would allow injected CSS. Depending on browser behavior and page content, injected CSS can support UI redress, click deception, or limited data inference even when JavaScript remains blocked.

Suggested fix:

When feasible with Next/Tailwind rendering, replace inline style allowance with hashes/nonces or move inline styles to static classes. If retaining it is required by the framework, document it as an accepted CSP tradeoff and keep other XSS controls strict.

## Manual-Validation Risks

### SR-M01 - SQL restore scanner is strong but should remain fixture-tested

Confidence: Medium

Evidence:

- Restore scans uploaded SQL chunks before invoking mysql in `apps/web/src/app/[locale]/admin/db-actions.ts:712-741`.
- The scanner blocks dangerous statements in `apps/web/src/lib/sql-restore-scan.ts:61-129` and rejects schema-qualified or non-app write targets in `apps/web/src/lib/sql-restore-scan.ts:223-265`.
- The restore process uses `mysql --one-database` in `apps/web/src/app/[locale]/admin/db-actions.ts:759-772`.

Risk scenario:

Restore is admin-only and intentionally powerful. The scanner is defense-in-depth around an inherently dangerous operation, so future changes to accepted dump syntax, comments, character sets, or table names could create bypasses even when current code is careful.

Suggested validation:

Keep malicious restore fixtures for privileged statements, schema-qualified writes, comment-obfuscated routines/triggers/views, `CALL`, `LOAD DATA`, `SOURCE`, and non-app table writes. Re-run them whenever restore parsing or migration shape changes.

### SR-M02 - Proxy trust must match the real nginx/CDN chain

Confidence: Medium

Evidence:

- Same-origin reconstruction trusts forwarded host/proto only when proxy trust is enabled in `apps/web/src/lib/request-origin.ts:45-68`.
- Same-origin checks fail closed without matching `Origin` or `Referer` in `apps/web/src/lib/request-origin.ts:87-107`.
- Client IP rate-limit keys trust proxy headers only with `TRUST_PROXY=true` and a configured hop count in `apps/web/src/lib/rate-limit.ts:175-205`.
- The local compose file runs host networking with `TRUST_PROXY: "true"` in `apps/web/docker-compose.yml:15-23`.

Risk scenario:

If an upstream proxy forwards client-controlled `X-Forwarded-Host`, `X-Forwarded-Proto`, or a malformed `X-Forwarded-For` chain without overwriting them, same-origin expectations or rate-limit attribution can be wrong. The code is designed for a trusted reverse proxy, but correctness depends on deployment header hygiene.

Suggested validation:

Confirm nginx/CDN overwrites, rather than appends untrusted values for, host/proto headers and that `TRUSTED_PROXY_HOPS` matches the actual chain. Add a deployment smoke test that sends spoofed forwarded headers through the public edge and verifies they do not change app origin or per-client rate buckets.

### SR-M03 - Public in-memory rate limits assume single app instance

Confidence: Medium

Evidence:

- Public OG/share/feed/search limiter buckets are in-memory maps in `apps/web/src/lib/rate-limit.ts:78-110` and `apps/web/src/lib/rate-limit.ts:124-133`.
- The project architecture currently runs a single host-networked app service in `apps/web/docker-compose.yml:3-23`.

Risk scenario:

If the app is horizontally scaled without a shared rate-limit store or edge limiter, public unauthenticated route budgets multiply by instance count. That affects CPU-heavy OG generation, share-key probes, feed miss probes, semantic search, and other public expensive surfaces.

Suggested validation:

Keep the current single-instance assumption documented. Before adding multiple app replicas, move public rate limits to MySQL/Redis/edge middleware or enforce equivalent nginx/CDN limits.

### SR-M04 - Plaintext backups are protected by filesystem mode, not encryption

Confidence: Medium

Evidence:

- Backup directories are created owner-only in `apps/web/src/app/[locale]/admin/db-actions.ts:196-200`.
- Backup temp files are written with mode `0o600` in `apps/web/src/app/[locale]/admin/db-actions.ts:238`.
- Completed backups are atomically renamed after header/trailer validation in `apps/web/src/app/[locale]/admin/db-actions.ts:296-353`.

Risk scenario:

Database backups contain gallery metadata and administrative state. The app protects local file permissions, but compromise of the host account, bind mount, disk, or backup copy location exposes plaintext contents.

Suggested validation:

Confirm host volume permissions, backup retention, and any off-host copies are encrypted or stored in an access-controlled location. Treat downloaded backups as sensitive operator artifacts.

## Cross-File Security Observations

- Auth and sessions: Session tokens are HMAC-bound and timestamped in `apps/web/src/lib/session.ts:82-150`, stored as SHA-256 hashes via `apps/web/src/lib/session.ts:8-10`, and production rejects missing/short secrets in `apps/web/src/lib/session.ts:19-35`. Login/password flows apply same-origin checks and pre-increment rate limits before credential verification in `apps/web/src/app/actions/auth.ts:77-265` and rotate sessions after password changes in `apps/web/src/app/actions/auth.ts:399-410`.
- Admin APIs/actions: `withAdminAuth` gates admin API routes and requires same-origin for cookie auth while allowing scoped PATs only through explicit route scope in `apps/web/src/lib/api-auth.ts:72-141`. Mutating server actions use `requireSameOriginAdmin` from `apps/web/src/lib/action-guards.ts:37-44`. The lint gates passed for admin API wrapping and action-origin enforcement.
- Public APIs: Semantic and similar search require same-origin, content-length/type validation, small body caps, production mode gates, and rate limits in `apps/web/src/app/api/search/semantic/route.ts:109-245` and `apps/web/src/app/api/search/similar/[id]/route.ts:73-131`. OG routes rate-limit before expensive rendering and sanitize rendered text in `apps/web/src/app/api/og/route.tsx:73-152` and `apps/web/src/app/api/og/photo/[id]/route.tsx:93-159`.
- Uploads and path handling: User filenames are basename-normalized and control-stripped in `apps/web/src/lib/upload-filenames.ts:27-34`; original filenames are random UUIDs and validated in `apps/web/src/lib/process-image.ts:459-475` and `apps/web/src/lib/process-image.ts:887-980`; private original path containment and symlink rejection live in `apps/web/src/lib/upload-paths.ts:124-170`; public serving allows only transformed image directories and rejects symlink/traversal attempts in `apps/web/src/lib/serve-upload.ts:168-233`.
- SSRF: Per-photo OG fetches build URLs from the configured site origin and app-controlled image filename/size in `apps/web/src/lib/og-photo-fetch.ts:64-87`, while the fallback URL validator requires configured OG URLs to stay same-origin in `apps/web/src/app/api/og/photo/[id]/route.tsx:329-375`.
- SQL injection: Reviewed DB accessors and actions use Drizzle query builders or parameterized SQL for user-controlled values; restore is the intentionally privileged SQL import path and is covered above.
- XSS and data exposure: JSON-LD escapes HTML-sensitive characters in `apps/web/src/lib/safe-json-ld.ts:14-19`; sanitizer utilities strip control/format characters in `apps/web/src/lib/sanitize.ts:19-93`; public image selects omit admin/private fields in `apps/web/src/lib/data.ts:368-446`; semantic enrichment has a compile-time privacy guard in `apps/web/src/lib/search-enrichment-fields.ts:29-47`.
- Secrets: Static scan found only placeholders/redacted values in docs, env examples, tests, and historic review text. No committed live secret material was identified in the scanned patterns.

## OWASP Sweep

| Category | Result | Notes |
| --- | --- | --- |
| A01 Broken Access Control | Pass | Admin cookie auth requires same-origin; PAT auth is scoped; admin route lint passed. |
| A02 Cryptographic Failures | Pass | Session secrets are required in production; tokens are HMAC-bound and hash-stored. |
| A03 Injection | Pass with manual restore risk | App SQL usage is parameterized/query-builder based; restore scanner remains fixture-sensitive. |
| A04 Insecure Design | Pass with deployment assumptions | Single-instance and trusted-proxy assumptions are explicit but need operational validation. |
| A05 Security Misconfiguration | Low likely issue | CSP allows inline styles; proxy header trust must be matched by edge config. |
| A06 Vulnerable/Outdated Components | Medium confirmed | Vulnerable esbuild dev transitive dependency via current latest `drizzle-kit`. |
| A07 Identification/Auth Failures | Pass | Login, logout, password update, session expiry, and rate limits are covered. |
| A08 Software/Data Integrity Failures | Pass with restore caution | Backup/restore has locking, maintenance, header/trailer checks, and SQL scanning. |
| A09 Logging/Monitoring Failures | Pass | Auth/admin events are audited; stderr is sanitized before logging. |
| A10 SSRF | Pass | OG internal fetch is same-origin and size/time bounded. |

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm audit --workspace=apps/web --audit-level=low` - failed only on the confirmed moderate dev/build `esbuild` advisory chain through `drizzle-kit`.
- `npm ls esbuild @esbuild-kit/core-utils @esbuild-kit/esm-loader drizzle-kit --workspace=apps/web` - confirmed the vulnerable transitive path.
- `npm view drizzle-kit version dependencies --json`, `npm view esbuild version`, and `npm view @esbuild-kit/core-utils version dependencies` - confirmed latest upstream state as of 2026-07-07.
- Secret pattern scan across tracked files - only placeholders/redacted examples found.

## File Groups Examined

- Authentication, sessions, cookies, admin PATs, login/logout/password actions.
- Admin API wrappers, mutating server actions, action-origin and same-origin guard code.
- Public APIs: health/live, OG, per-photo OG, semantic search, similar search, Atom feeds, upload serving.
- Upload ingestion, image processing, original storage, transformed upload serving, delete cleanup, filename/path validators.
- Backup export, backup download, restore import, SQL dump scanning, migration reconciliation, mysql CLI option handling.
- Data access and privacy projections, semantic enrichment field guards, JSON-LD and text sanitizers.
- Deployment, Docker runtime dependency shape, reverse-proxy assumptions, Next security headers, CSP, package/dependency audit surface.
