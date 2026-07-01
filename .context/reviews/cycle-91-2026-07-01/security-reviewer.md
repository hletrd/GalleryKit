# Security Reviewer — Cycle 91

Scope: deployed master at `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Inventory built first

Relevant security surfaces inventoried before deep review:

- Admin page/session boundary: `apps/web/src/proxy.ts`, `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`.
- Admin API boundary: `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/scripts/check-api-auth.ts`, `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/api-auth-response-headers.test.ts`.
- Server-action CSRF/origin boundary: `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, all files under `apps/web/src/app/actions/`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/request-origin.test.ts`.
- Public route rate limits: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/scripts/check-public-route-rate-limit.ts`.
- Upload and file serving trust boundaries: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/lib/gps-exif-strip.ts`.
- Backup/restore/process boundaries: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`.
- XSS/CSP/output encoding/privacy: `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/src/lib/safe-json-ld.ts`, public pages using `dangerouslySetInnerHTML`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`.
- SQL/raw query surfaces: `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/*`.
- Secrets/dependency inventory: `CLAUDE.md`, `README.md`, `apps/web/package.json`, `apps/web/drizzle/**`, `apps/web/src/**`, `apps/web/e2e/**`, excluding ignored/runtime data and dependency folders.

## Confirmed findings

No confirmed security findings in this lane.

The reviewed code has explicit controls for the high-risk boundaries requested:

- Admin API exports are wrapped by `withAdminAuth(...)`; the wrapper checks scoped PATs before cookie auth and enforces same-origin for cookie-authenticated requests (`apps/web/src/lib/api-auth.ts:58`, `apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:82`, `apps/web/src/lib/api-auth.ts:116`, `apps/web/src/lib/api-auth.ts:123`).
- Protected admin pages re-run full session validation in the protected layout, not only middleware's cheap cookie-format check (`apps/web/src/app/[locale]/admin/(protected)/layout.tsx:13`, `apps/web/src/proxy.ts:69`).
- Session signing requires production `SESSION_SECRET`, stores only a hash of session tokens, checks HMAC with `timingSafeEqual`, and rejects expired/future tokens (`apps/web/src/lib/session.ts:26`, `apps/web/src/lib/session.ts:94`, `apps/web/src/lib/session.ts:117`, `apps/web/src/lib/session.ts:136`).
- Login/password flows use Argon2, same-origin checks, account/IP rate limits, and pre-increment before expensive verification (`apps/web/src/app/actions/auth.ts:72`, `apps/web/src/app/actions/auth.ts:100`, `apps/web/src/app/actions/auth.ts:129`, `apps/web/src/app/actions/auth.ts:182`, `apps/web/src/app/actions/auth.ts:295`, `apps/web/src/app/actions/auth.ts:352`).
- Mutating non-auth server actions are covered by the scanner and helper contract (`apps/web/src/lib/action-guards.ts:37`, `apps/web/scripts/check-action-origin.ts:8`).
- Public expensive/mutating routes are same-origin or rate-limited where applicable; static derivative serving is explicitly exempted but path-contained (`apps/web/src/app/api/search/semantic/route.ts:109`, `apps/web/src/app/api/search/semantic/route.ts:178`, `apps/web/src/app/api/search/similar/[id]/route.ts:73`, `apps/web/src/app/api/search/similar/[id]/route.ts:102`, `apps/web/src/lib/serve-upload.ts:137`, `apps/web/src/lib/serve-upload.ts:154`, `apps/web/src/lib/serve-upload.ts:182`, `apps/web/src/lib/serve-upload.ts:186`).
- Backup download validates filename and realpath containment before streaming from a file handle (`apps/web/src/app/api/admin/db/download/route.ts:23`, `apps/web/src/app/api/admin/db/download/route.ts:31`, `apps/web/src/app/api/admin/db/download/route.ts:51`, `apps/web/src/app/api/admin/db/download/route.ts:58`).
- Restore is admin/same-origin gated, serialized with advisory and upload-contract locks, size/header checked, scanned for dangerous SQL, then imported with `--one-database` and no password in CLI args (`apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:577`, `apps/web/src/app/[locale]/admin/db-actions.ts:614`, `apps/web/src/app/[locale]/admin/db-actions.ts:637`, `apps/web/src/app/[locale]/admin/db-actions.ts:674`, `apps/web/src/app/[locale]/admin/db-actions.ts:679`).
- JSON-LD injection uses `safeJsonLd`, which escapes script-breaking characters and U+2028/U+2029 (`apps/web/src/lib/safe-json-ld.ts:14`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:270`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:147`).

## Likely / manual-validation risks

### MV-SEC-01 — Confirm the nginx HTTP listener is not public-edge cleartext

- Severity: HIGH if publicly exposed; LOW if the documented TLS-terminating edge is present.
- Confidence: Medium; this is configuration-dependent and not confirmable from the repository alone.
- Evidence: The checked nginx server listens on port 80 (`apps/web/nginx/default.conf:21`) and documents that it is an internal HTTP hop behind TLS, warning not to expose it as the public cleartext edge (`apps/web/nginx/default.conf:25`). HSTS is still emitted (`apps/web/nginx/default.conf:55`).
- Failure scenario: If an operator deploys this nginx config directly as the public internet edge without a separate HTTPS listener and HTTP-to-HTTPS redirect, admin login/session traffic can traverse cleartext despite `Secure` cookie intent and HSTS is ineffective on a first HTTP visit.
- Concrete fix: In deployment validation, verify port 80 is only reachable from the TLS terminator or add a dedicated 443 server block plus a port-80 redirect. Keep the current config only as the internal reverse-proxy hop described in the comments.

### MV-SEC-02 — Dependency CVE status requires a networked audit outside this bounded review

- Severity: Medium.
- Confidence: High that validation is incomplete; no specific vulnerable package confirmed.
- Evidence: Dependency inventory includes network-facing and native packages such as `next`, `@huggingface/transformers`, `argon2`, `mysql2`, `sharp`, and `drizzle-orm` in `apps/web/package.json`. The user explicitly prohibited network, so `npm audit`/registry CVE lookup was not run.
- Failure scenario: A high-severity advisory in one of the server/runtime dependencies could remain undetected by this code-only review.
- Concrete fix: Run `npm audit --workspace=apps/web` or the project's standard dependency scanner in a network-enabled CI/review context and triage any high/critical advisories against the deployed lockfile.

### MV-SEC-03 — Rate-limit IP attribution depends on proxy trust configuration

- Severity: Medium.
- Confidence: Medium; the code warns/fails conservatively, but production config must match topology.
- Evidence: `getClientIp()` trusts forwarded headers only when `TRUST_PROXY === 'true'` (`apps/web/src/lib/rate-limit.ts:166`), otherwise it returns the shared `"unknown"` bucket and logs a production warning when proxy headers are present (`apps/web/src/lib/rate-limit.ts:191`, `apps/web/src/lib/rate-limit.ts:192`). Documentation flags the same single-instance/proxy assumptions (`CLAUDE.md:97`, `CLAUDE.md:235`).
- Failure scenario: If production sits behind nginx/CDN but `TRUST_PROXY`/trusted hops are misconfigured, rate limits can collapse all users into one bucket, causing easy shared lockout/DoS. If trusted hops are set too broadly, spoofed forwarded chains can weaken per-IP limits.
- Concrete fix: Manually verify deployed `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS` match the actual hop chain, and add a deployment smoke check that failed-login attempts from two client IPs land in distinct rate-limit buckets.

## Validation evidence

- `node --import tsx apps/web/scripts/check-api-auth.ts` passed:
  - `OK: apps/web/src/app/api/admin/db/download/route.ts`
  - `OK: apps/web/src/app/api/admin/lr/upload/route.ts`
- `node --import tsx apps/web/scripts/check-action-origin.ts` passed and reported: `All mutating server actions enforce same-origin provenance.`
- `node --import tsx apps/web/scripts/check-public-route-rate-limit.ts` passed all discovered public route files, including OG, semantic search, similar search, feeds, health/live, and upload derivative serving.
- Initial `npm run lint:* --workspace=apps/web` wrappers failed because this sandbox denies `tsx` CLI IPC socket creation (`listen EPERM` on `tsx-501/*.pipe`); direct Node `--import tsx` execution was used as equivalent local validation.
- No networked dependency audit was run because the assignment prohibited network.

## Final missed-issue sweep

Files/categories rechecked in the final sweep:

- Route discovery: all `apps/web/src/app/**/route.ts(x)` files and exported HTTP handlers.
- Admin API boundary: `api/admin/db/download`, `api/admin/lr/upload`, `withAdminAuth`, API-auth scanner and tests.
- Auth/session: login/logout/password change, session token signing/verification, cookie settings, middleware/proxy, protected admin layout.
- CSRF/origin: `request-origin`, `action-guards`, action-origin scanner and its discovered action list.
- Public unauthenticated surfaces: semantic search, similar search, OG image generation, share pages, feed routes, health/live, derivative serving.
- Upload trust boundary: browser upload action, Lightroom PAT upload route, upload filename sanitizer, private original paths, derivative serving helper, GPS-strip path.
- Backup/restore trust boundary: dump/restore actions, backup download route, restore SQL scanner, CLI env/password handling, advisory locks, maintenance marker lifecycle.
- XSS/output encoding: all `dangerouslySetInnerHTML` call sites, `safeJsonLd`, OG sanitizer, CSP builder, nonce use, Next and nginx security headers.
- SQL injection/raw query: Drizzle template use, smart-collection compiler, LIKE escaping, migration/maintenance scripts, admin token queries.
- Secrets: repo-wide grep for password/secret/token/private-key patterns excluding dependency/runtime data; no committed live secret confirmed.
- Privacy/authorization data boundary: public/admin select fields, semantic-search enrichment select, privacy-field tests.

Stop condition: no confirmed issue found with the available local evidence; remaining items are operational/manual-validation risks only.
