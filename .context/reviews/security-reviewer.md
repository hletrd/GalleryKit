# Cycle 19 Prompt 1 Security Review

Date: 2026-07-08 KST
Role lane: `security-reviewer`
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `6efd737b`
Mode: review-only. No fixes, commits, pushes, or deploys performed.
Write scope: this file only.

## Scope And Method

Read first:

- `AGENTS.md` and the project-specific AGENTS block supplied for `/Users/hletrd/flash-shared/gallery`.
- `CLAUDE.md` security, deploy, schema, lint-gate, migration, and operations sections.
- `README.md`, root `package.json`, `apps/web/package.json`, `.context/plans/README.md`, and existing review conventions under `.context/reviews/`.
- Local `security-review` skill instructions.

The review focused on OWASP Top 10, auth/authz, admin API guards, server-action same-origin guards, public-route rate limits, uploads, image processing, SQL/data access, secrets, CSP/headers, deployment scripts, backups/restore, session/token handling, privacy, and metadata exposure. I did not read live secret files such as `.env.local` or `.env.deploy`.

## Security Inventory

API routes reviewed:

- Public upload/feed/OG/search/health routes: `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/health/route.ts`, and `apps/web/src/app/api/live/route.ts`.
- Admin routes: `apps/web/src/app/api/admin/db/download/route.ts` and `apps/web/src/app/api/admin/lr/upload/route.ts`.

Server actions reviewed:

- `apps/web/src/app/actions/auth.ts`, `admin-users.ts`, `admin-backfill.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, and `apps/web/src/app/[locale]/admin/db-actions.ts`.

Core security modules reviewed:

- Auth/session/tokens/origin: `apps/web/src/lib/session.ts`, `api-auth.ts`, `admin-tokens.ts`, `auth-rate-limit.ts`, `request-origin.ts`, `action-guards.ts`, and `rate-limit.ts`.
- Data/privacy/SQL: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `sql-like.ts`, `smart-collections.ts`, schema/migrations under `apps/web/drizzle/**`, and migration helper `apps/web/scripts/migrate.js`.
- Uploads/image processing: `serve-upload.ts`, `process-image.ts`, `gps-exif-strip.ts`, `upload-paths.ts`, `upload-filenames.ts`, `process-topic-image.ts`, and `og-photo-fetch.ts`.
- Backup/restore: `db-actions.ts`, `api/admin/db/download/route.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, restore-maintenance helpers, and child-process helpers.
- Headers/deploy/supply chain: `apps/web/src/proxy.ts`, `content-security-policy.ts`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, env examples, package lockfiles, CI/dependabot, and lint/test guard scripts.

## Findings Summary

- Total findings: 3
- Medium: 2
- Low: 1
- Confirmed source risks: 2
- Manual-validation / security-ops risks: 1

No missing admin API auth wrapper, missing mutating server-action origin guard, upload path traversal, direct SQL injection, confirmed privacy projection leak, direct secret leak, unauthenticated admin action, or confirmed backup/restore command-injection flaw survived this source review.

## Findings

### SEC-19-01 - Semantic search/similar endpoints rely on process-local rate limiting for expensive public work

- Severity: Medium
- Confidence: High for the code property; Medium for production exploitability because it depends on semantic search being enabled and exposed.
- Status: Confirmed source risk, availability/DoS.
- OWASP: A04 Insecure Design / A05 Security Misconfiguration.
- File/region:
  - `apps/web/src/lib/rate-limit.ts:393-415` defines `SEMANTIC_RATE_LIMIT_MAX = 30` per 60 seconds in a process-local bounded map.
  - `apps/web/src/app/api/search/semantic/route.ts:107-184` gates the public POST with same-origin, body admission, and `preIncrementSemanticAttempt`.
  - `apps/web/src/app/api/search/semantic/route.ts:247-279` performs CLIP embedding and scans up to `SEMANTIC_SCAN_LIMIT` embeddings after the local limiter.
  - `apps/web/src/app/api/search/semantic/route.ts:292-368` decodes/scores/enriches the scanned rows.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:68-131` gates the public GET with same-origin, ID validation, and the same semantic limiter.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:137-190` loads a target vector and scans production embeddings.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:199-285` scores/enriches results.
  - `apps/web/src/lib/clip-embeddings.ts:36-48` defaults `SEMANTIC_SCAN_LIMIT` to 2,000 rows and allows an env-tuned hard cap of 25,000 rows.
  - `CLAUDE.md:244-247` documents that semantic fast paths are process-local and weaken under scale-out.
- Security impact: The limiter is not shared across processes or instances and resets on restart. Same-origin protects browser CSRF, but non-browser clients can send matching `Origin` or `Referer` headers. Each admitted request can consume CLIP inference, database reads, vector decoding, scoring, and enrichment work.
- Concrete failure scenario: An attacker sends direct HTTP requests with the configured site origin header and rotates IPs or hits multiple/restarted app processes. Each request stays under the per-process 30/minute/IP bucket but forces semantic embedding plus a 2,000-row vector scan, or more if the operator raised `SEMANTIC_SCAN_LIMIT`. The result is CPU/DB saturation and degraded public/admin availability.
- Suggested fix: Move semantic search limiting to a shared DB-backed or edge-backed limiter, matching the stronger login/search/load-more posture. Add a process-wide semaphore for semantic inference/vector scans, consider caching normalized text embeddings for repeated queries, and fail closed or degrade when the queue is saturated. If semantic search remains production-only and expensive, add a deploy-verified edge limit for these exact routes and keep the app-layer shared limiter as the fallback.

### SEC-19-02 - Public SSR page flood protection depends on manually applied host nginx config

- Severity: Medium
- Confidence: High that deploy does not apply nginx; Medium for live exposure because it requires manual host validation.
- Status: Manual-validation/security-ops risk, availability.
- OWASP: A05 Security Misconfiguration.
- File/region:
  - `CLAUDE.md:247` states public pages are intentionally throttled only at the nginx edge and that per-iteration deploys do not touch host nginx.
  - `apps/web/nginx/default.conf:274-306` applies the public `limit_req` only in the catch-all `location /`.
  - `apps/web/nginx/default.conf:290-293` explicitly says this is a config-only change and an operator must manually test and reload nginx.
  - `apps/web/deploy.sh:51-55` rebuilds/starts the Docker Compose service but does not install, compare, test, or reload host nginx.
  - Public pages are fresh SSR with data loads, for example `apps/web/src/app/[locale]/(public)/page.tsx:17-19` and `page.tsx:175-177`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20` and `:191`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-15` and `:42-46`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42` and `:62-67`, and `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17` and `:110-111`.
- Security impact: If host nginx is stale, replaced, bypassed, or not reloaded after a config change, unauthenticated page navigation can hit uncached DB-backed SSR without an app-layer page limiter. This does not expose admin data by itself, but it weakens availability and leaves the protection state outside the deploy evidence chain.
- Concrete failure scenario: A deployment succeeds through `npm run deploy`, but the live host is still running an older nginx config or a different proxy path. An attacker floods `/`, `/map`, `/timeline`, topic pages, photo pages, or smart collections. Since the app intentionally has no public-page limiter, the requests fan into Next SSR and database work until the app or DB is saturated.
- Suggested fix: Add a deploy verification step that fails if `nginx -T` on the host does not include the expected public `limit_req` catch-all, or automate installation/reload of the managed nginx config. As defense in depth, add a low-overhead app-layer fallback limiter around the public page data loaders so a proxy misconfiguration cannot remove the last availability control.

### SEC-19-03 - Production CSP still allows inline styles

- Severity: Low
- Confidence: High.
- Status: Confirmed defense-in-depth issue, not a confirmed XSS.
- OWASP: A05 Security Misconfiguration.
- File/region:
  - `apps/web/src/lib/content-security-policy.ts:182-190` documents the production style allowance and emits `style-src 'self' 'unsafe-inline'`.
- Security impact: Scripts remain nonce-gated, and I did not find a direct XSS sink in the reviewed code. However, `style-src 'unsafe-inline'` leaves CSP weaker against future HTML/style injection bugs. Inline CSS can support UI redress, data-adjacent CSS exfiltration patterns in vulnerable DOM contexts, and phishing overlays even when script execution is blocked.
- Concrete failure scenario: A future feature accidentally renders attacker-controlled HTML or style attributes in a public or admin page. The script nonce blocks JavaScript, but the inline-style allowance still lets the attacker manipulate layout, hide warnings, overlay controls, or abuse CSS selectors against sensitive on-page state.
- Suggested fix: Keep the current allowance only if framework/component constraints require it, but track it as a CSP debt item. Test a stricter policy using nonced/hashable style tags, framework-supported style nonce propagation, or extracted CSS, then remove `'unsafe-inline'` once hydration and component sizing coverage passes.

## Confirmed Positive Security Evidence

Auth/session/admin boundary:

- `apps/web/src/lib/session.ts:16-36` requires a strong `SESSION_SECRET` in production; `session.ts:82-150` signs/verifies session tokens with HMAC-SHA256, constant-time comparison, hash-only DB lookup, age limits, and expired-session cleanup.
- `apps/web/src/lib/api-auth.ts` centralizes admin API auth, scoped PAT auth for the Lightroom upload path, same-origin checks for cookie-auth admin APIs, invalid-token rate limiting, and no-store/nosniff response defaults.
- `apps/web/src/lib/admin-tokens.ts` creates high-entropy `gk_` tokens, stores SHA-256 hashes, validates scopes/expiry, and uses timing-safe comparison.
- `apps/web/src/app/actions/auth.ts` same-origin-gates login/logout/password updates, charges rate limits before expensive Argon2 verification, rotates sessions, and sets httpOnly/secure/sameSite cookies.

CSRF/origin and lint guard coverage:

- `apps/web/src/lib/request-origin.ts` anchors production origin checks to canonical configured origin and fails closed on missing/mismatched browser provenance.
- `apps/web/src/lib/action-guards.ts` centralizes same-origin enforcement for mutating non-auth server actions.
- `npm run lint:api-auth --workspace=apps/web` passed and reported both admin API routes wrapped by `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web` passed and reported mutating server actions same-origin guarded.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed and reported public API/action rate-limit posture matched the scanner contract.

Uploads/path traversal/file handling:

- `apps/web/src/app/api/admin/lr/upload/route.ts` wraps Lightroom upload in admin/PAT auth, rejects chunked uploads, requires bounded `Content-Length`, uses multipart admission slots, validates filenames/topic metadata, and marks token usage after auth/admission.
- `apps/web/src/lib/upload-paths.ts` keeps originals under a private root, validates filenames, rejects symlinks, uses `realpath`, and enforces root containment.
- `apps/web/src/lib/serve-upload.ts` only serves derivative directories/extensions, validates each path segment, rejects symlinks, checks realpath containment, and streams a validated file descriptor with no-store/nosniff style headers.
- `apps/web/src/lib/process-image.ts` bounds Sharp input pixels, rejects RAW-like formats, stores originals with restrictive modes, strips GPS metadata, and cleans partial files on failure.

Backup/restore/SQL:

- `apps/web/src/app/[locale]/admin/db-actions.ts` same-origin/admin-gates export, backup, and restore; uses static child-process executable/argument arrays; creates backup/temp paths with restrictive modes; validates dump headers/trailers; scans restore SQL; drains risky background work; and keeps restore maintenance active on failure.
- `apps/web/src/lib/sql-restore-scan.ts` allowlists app tables and rejects dangerous SQL patterns and non-app write targets.
- `apps/web/src/app/api/admin/db/download/route.ts` wraps backup download in admin auth, validates backup filenames, checks realpath containment, and streams from a validated descriptor.
- Reviewed user-controlled SQL paths use Drizzle/sql parameterization or static SQL. Smart collection predicates compile through allowlisted fields/operators and bounded query shapes.

Privacy/metadata/CSP/headers:

- `apps/web/src/lib/data.ts`, `data-timeline.ts`, and `search-enrichment-fields.ts` use explicit public select fields with type-level privacy guards for sensitive/admin-only columns.
- `apps/web/src/__tests__/privacy-fields.test.ts` covers the symmetric privacy denylist and public projection surfaces.
- Public map data intentionally exposes GPS only where topic `map_visible` is true.
- OG image fetch code uses configured same-origin URLs, timeouts, and byte caps; I did not find a general SSRF primitive.
- `apps/web/next.config.ts` and `proxy.ts` set no-sniff, frame, referrer, permissions, HSTS in production, CSP nonce handling, and stricter `/api/*` sandbox-style headers.

Secrets/supply chain/deploy:

- Env examples contain placeholders, not live secrets. I did not inspect local secret files.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` reported 0 production vulnerabilities.
- Docker uses a digest-pinned Node 24 slim base and non-root runtime via entrypoint/gosu.
- Deploy scripts check secret env file permissions before sourcing; no plaintext secret echo path survived source review.

## Validation Evidence

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` - passed with 0 vulnerabilities.
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/request-origin.test.ts src/__tests__/session.test.ts src/__tests__/session-verify.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/semantic-search-rate-limit.test.ts src/__tests__/sanitize-stderr.test.ts src/__tests__/tracked-secrets.test.ts` - passed, 11 files / 219 tests.

Not run:

- Full `npm test`, `npm run build`, `npm run typecheck`, and Playwright e2e. This was a review-only lane with no code changes; targeted security/privacy/guard validation passed.

## Final Sweep

Examined categories:

- API routes, admin routes, public routes, server actions, auth/session/token modules, origin/CSRF guards, rate-limit helpers, upload routes, derivative serving, image processing, GPS stripping, public data projections, SQL helpers, smart collections, migrations/schema guidance, backup/export/restore/download flows, child-process invocation, CSP/headers/proxy, Docker/deploy/nginx, dependency metadata, tracked-secret tests, and security lint/test guards.

Skipped/manual-only categories:

- Live production nginx/proxy configuration, TLS certificates, deployed DB users/grants, host filesystem encryption, actual backup contents, live CLIP model/weight files, and local secret env files. These require operator/live-host validation and were not read or modified.

Stop condition:

- Review artifact written with findings, positive evidence, validation output, and skipped/manual categories. No source fixes or commits were made.
