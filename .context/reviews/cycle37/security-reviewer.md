# Cycle 37 Security Review

Reviewer: security-reviewer
Date: 2026-07-08
Scope: `/Users/hletrd/flash-shared/gallery`

## Result

No confirmed product-code security vulnerabilities were found in this pass.

Finding counts:
- Critical: 0
- High: 0
- Medium: 0 confirmed, 1 risk
- Low: 0 confirmed, 1 risk

The two items below are configuration/topology risks, not confirmed source-code vulnerabilities. They are included because the repository explicitly depends on a trusted edge/proxy contract for rate limiting and public dynamic page flood control.

## Inventory Built Before Review

Repository inventory was built before the manual review:
- `rg --files -g '!node_modules' -g '!test-results' -g '!apps/web/.next' -g '!apps/web/public/uploads/**' -g '!apps/web/data/**'` found 939 review-relevant files.
- App Router route/action/page inventory under `apps/web/src/app` found 35 `route.ts`, `route.tsx`, `actions.ts`, and `page.tsx` files.
- Core library, database, and script inventory under `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, and `scripts` found 149 files.
- Local runtime env files exist at `.env.deploy` and `apps/web/.env.local`, but `git ls-files -- .env.deploy apps/web/.env.local apps/web/.env.local.example .env.deploy.example` shows only the example files are tracked. I did not copy or quote private env contents.

Deep-examined files and areas:
- Instructions and security model: `AGENTS.md`, `CLAUDE.md`.
- Auth/session/admin API: `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`.
- Origin/CSRF/rate limit: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/public.ts`.
- Upload/file serving/path traversal: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- Backup/restore/raw command safety: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-child-watchdog.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/db/index.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/seed-admin.ts`.
- SSRF/open redirect/CSP: `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`.
- Privacy/public data: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/actions/sharing.ts`.
- Deploy/proxy topology: `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `scripts/check-proxy-topology.mjs`, `README.md`, `apps/web/README.md`.

## Findings

### SR37-R1: Proxy client-IP contract can collapse per-IP rate limits if deployment topology drifts

Status: Risk
Severity: Medium
Confidence: Medium
OWASP: A04 Insecure Design / A05 Security Misconfiguration

Evidence:
- App client-IP extraction trusts forwarded headers only when `TRUST_PROXY=true`; otherwise it returns the single key `unknown` and logs a one-time security warning: `apps/web/src/lib/rate-limit.ts:175-217`.
- The documented runtime env table requires `TRUST_PROXY=true` behind a proxy and explains the shared-bucket failure mode: `CLAUDE.md:97-98` and `CLAUDE.md:753`.
- The shipped nginx template explicitly warns that overwriting `X-Forwarded-For` with `$remote_addr` is correct only for the shipped topology; in an upstream-LB topology it collapses app buckets unless XFF append/hop count are changed: `apps/web/nginx/default.conf:59-71`.
- The proxy-topology checker verifies same-origin forwarded-host/proto behavior but says it does not verify effective client-IP bucket or XFF overwrite: `scripts/check-proxy-topology.mjs:7-16` and `scripts/check-proxy-topology.mjs:131-134`.

Concrete failure scenario:
If an operator places a CDN or load balancer in front of the shipped nginx template without enabling real-IP handling or append-mode XFF plus the correct `TRUSTED_PROXY_HOPS`, every visitor can share one rate-limit bucket. Five failed login attempts from one attacker can lock out all admins for the login window, and public/search/share/OG budgets can be depleted by unrelated users. This is a denial-of-service and monitoring-accuracy risk, not an auth bypass.

Suggested fix:
Add a production preflight that fails or health-degrades when proxy headers are present but `TRUST_PROXY`/hop behavior is not proven for the deployed topology. Extend `scripts/check-proxy-topology.mjs` or add a temporary diagnostic route that reports only a non-sensitive hash of the effective client-IP bucket, then require that check in deploy runbooks for any non-shipped proxy chain. For the shipped nginx-only topology, keep `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS=1`; for CDN-to-nginx, configure nginx real-IP or append-mode XFF and set the hop count explicitly.

### SR37-R2: Dynamic public page flood protection is edge-enforced, so direct-app/custom-proxy deployments can bypass it

Status: Risk
Severity: Low
Confidence: Medium
OWASP: A04 Insecure Design / A05 Security Misconfiguration

Evidence:
- The public home page is intentionally dynamic (`revalidate = 0`) and performs multiple DB/config reads before rendering: `apps/web/src/app/[locale]/(public)/page.tsx:17-19` and `apps/web/src/app/[locale]/(public)/page.tsx:155-178`.
- The nginx config defines a dedicated public page limiter and states it is the catch-all backstop for public page navigation, RSC/prefetch fetches, and public non-admin API routes without a longer location: `apps/web/nginx/default.conf:1-10` and `apps/web/nginx/default.conf:274-296`.
- The nginx comment also notes this file is config-only and must be manually applied/reloaded by the operator: `apps/web/nginx/default.conf:291-294`.
- The documented compose/runbook warns not to expose the app port directly and describes the intended single web-instance/single-writer deployment behind the trusted edge: `README.md:175-177`; the proxy checker separately rejects a directly exposed app URL when `--direct-url` responds: `scripts/check-proxy-topology.mjs:79-91`.

Concrete failure scenario:
If the Next.js app is exposed directly, or a custom reverse proxy omits the shipped `zone=public` catch-all limiter, a bot can repeatedly request dynamic public pages such as home/topic/timeline/map/photo views. App-level limiters still protect specific public actions and APIs, but page rendering can consume DB and server-rendering work without the documented edge flood cap.

Suggested fix:
Make the public page limiter a deploy-verifiable prerequisite, not only a documented nginx template. Options: add a deploy check that confirms the shipped nginx config is active, require a CDN/WAF equivalent, or add an optional app-layer public-page limiter for direct/custom proxy deployments. Keep the current edge limiter because it avoids adding DB work to every page request in the normal deployment.

## Confirmed Security Controls

Auth and session safety:
- Production requires a sufficiently long `SESSION_SECRET`; dev/test fallback is DB-persisted and explicitly rejected in production: `apps/web/src/lib/session.ts:16-35`.
- Session tokens are random, HMAC-signed, timestamp-bound, verified with `timingSafeEqual`, stored only as hashes, and checked against DB expiry: `apps/web/src/lib/session.ts:82-151`.
- Login performs same-origin checking, mutation-slot gating, IP and account rate limiting, dummy Argon2 timing equalization, session fixation prevention, and secure cookie issuance: `apps/web/src/app/actions/auth.ts:79-273`.
- Password changes check origin before session work, validate current password, rate-limit, rotate sessions, and issue a new secure cookie: `apps/web/src/app/actions/auth.ts:331-500`.
- PAT tokens are high-entropy, prefixed, SHA-256-hashed at rest, scoped, expiry-checked, and compared in constant time: `apps/web/src/lib/admin-tokens.ts:53-90` and `apps/web/src/lib/admin-tokens.ts:142-168`.
- Admin API routes are centralized behind `withAdminAuth`, with scoped PAT fallback, cookie same-origin checks, admin checks, auth-attempt limiting, and no-store/nosniff headers: `apps/web/src/lib/api-auth.ts:66-152`.

CSRF/origin:
- Canonical origin derivation is fail-closed and uses trusted forwarded headers only when proxy trust is enabled: `apps/web/src/lib/request-origin.ts:47-68`.
- `hasTrustedSameOrigin` requires `Origin` or `Referer` to match the canonical origin: `apps/web/src/lib/request-origin.ts:118-146`.
- Static gates passed: `lint:api-auth`, `lint:action-origin`, and `lint:public-route-rate-limit`.

Rate limiting:
- App rate limits use bounded maps for hot paths and DB-backed atomic buckets where persistence matters: `apps/web/src/lib/rate-limit.ts:280-331`, `apps/web/src/lib/rate-limit.ts:340-397`, `apps/web/src/lib/rate-limit.ts:404-444`, and `apps/web/src/lib/rate-limit.ts:462-563`.
- Semantic search requires same-origin, strict JSON content type, no chunked bodies, content-length limits, pre-increment rate limit, mode gates, and bounded query sizes before embedding/vector work: `apps/web/src/app/api/search/semantic/route.ts:107-245`.
- Similar-image search applies same-origin, maintenance, id validation, pre-increment rate limiting, and production-mode gating before scan/enrichment work: `apps/web/src/app/api/search/similar/[id]/route.ts:68-193`.

Upload and file/path safety:
- Browser upload requires same-origin/admin/maintenance gates, validates file count/names/topics, checks upload quotas and disk space, strips metadata/GPS, cleans up on failure, and queues processing only after DB persistence: `apps/web/src/app/actions/images.ts:87-612`.
- Lightroom upload is wrapped with scoped admin auth, rejects chunked bodies, requires content-length, caps request/file sizes, serializes multipart parsing, validates metadata and filenames, checks restore/upload locks, strips metadata/GPS, and marks token use after commit: `apps/web/src/app/api/admin/lr/upload/route.ts:85-647`.
- Original upload storage is private, creates directories with restrictive mode, validates original filenames, rejects symlinks, and uses realpath containment: `apps/web/src/lib/upload-paths.ts:12-66` and `apps/web/src/lib/upload-paths.ts:120-202`.
- Public upload serving only allows `jpeg`, `webp`, and `avif`, validates path segments/extensions, rejects symlinks, checks realpath containment, and streams by file descriptor after stat validation: `apps/web/src/lib/serve-upload.ts:15-18`, `apps/web/src/lib/serve-upload.ts:162-219`, and `apps/web/src/lib/serve-upload.ts:229-384`.

SSRF/open redirect/CSP:
- Per-photo OG cards pin internal fetches to the canonical origin and validate fallback URLs as same-origin before redirect: `apps/web/src/app/api/og/photo/[id]/route.tsx:176-208` and `apps/web/src/app/api/og/photo/[id]/route.tsx:329-375`.
- OG photo buffer fetching uses canonical `/uploads/jpeg/...` URLs with timeout, response-size, and body-size caps: `apps/web/src/lib/og-photo-fetch.ts:64-118`.
- Configured image base/CSP URLs reject credentials, query strings, hashes, and non-HTTPS production origins: `apps/web/src/lib/content-security-policy.ts:15-40`.
- Next headers set nosniff/referrer/permissions/HSTS and sandbox API CSP: `apps/web/next.config.ts:55-125`.

SQL/raw command/backup-restore:
- Runtime DB TLS fails closed for non-local DB hosts unless `DB_SSL_CA` is provided or TLS is explicitly disabled: `apps/web/src/db/index.ts:7-19`.
- Database dumps require same-origin/admin checks, DB env presence, CLI TLS flags, restrictive temp file permissions, watchdogs, sanitized stderr, and atomic rename after non-empty/header/trailer checks: `apps/web/src/app/[locale]/admin/db-actions.ts:158-406`.
- Restore enters maintenance, takes DB/upload/backfill locks, drains upload work, validates file size/header/trailer/chunks, scans dangerous SQL/write targets, uses minimal child env with `MYSQL_PWD`, and runs migrations after restore: `apps/web/src/app/[locale]/admin/db-actions.ts:421-1106`.
- Restore scanning blocks routines/triggers/events, database changes, privilege changes, disallowed write targets, and cross-chunk keyword hiding: `apps/web/src/lib/sql-restore-scan.ts:12-32`, `apps/web/src/lib/sql-restore-scan.ts:88-156`, and `apps/web/src/lib/sql-restore-scan.ts:262-342`.

Privacy:
- Public selects explicitly omit admin/private fields, and compile-time guards force symmetric updates when sensitive columns change: `apps/web/src/lib/data.ts:251-327`, `apps/web/src/lib/data.ts:368-488`.
- Search and timeline enrichment have separate public-field guards: `apps/web/src/lib/search-enrichment-fields.ts:29-46` and `apps/web/src/lib/data-timeline.ts:21-68`.
- Share pages use generic metadata before lookup, validate base56 keys, rate-limit before DB lookup, and fetch only public image projections: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:39-149`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:44-142`, `apps/web/src/lib/data.ts:1239-1413`.

Secrets:
- Tracked secret scan found placeholders and tests only, not live credentials. Examples: placeholder env docs in `CLAUDE.md:79-82`, `README.md:150-153`, test fixture secret strings in `apps/web/src/__tests__/mysql-runtime-ssl.test.ts:20`, and deploy-contract placeholders in `apps/web/src/__tests__/deploy-script-contract.test.ts:141-199`.
- Local `.env.deploy` and `apps/web/.env.local` exist but are not tracked; contents were intentionally not copied into this review.

## Validation Evidence

Passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run audit:prod`
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate --json` returned 0 vulnerabilities.
- `npm run typecheck --workspace=apps/web`
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/session-verify.test.ts src/__tests__/api-auth-response-headers.test.ts` passed 6 files / 79 tests.

Not run:
- Full `npm test`, `npm run build`, and Playwright e2e were not run because this was a read-only review artifact with focused security/privacy validation.

## Final Missed-Issues Sweep

I re-swept before closing:
- OWASP Top 10: auth/session, access control, injection, insecure design, misconfiguration, vulnerable dependencies, identification/auth failures, integrity-sensitive backup/restore flows, logging/audit surfaces, and SSRF were covered by the file groups above.
- Secrets: tracked files only surfaced placeholders/test fixtures; private env files were present but untracked and not quoted.
- Auth/authz: admin routes and server actions are covered by static lint gates plus manual review of wrappers/actions.
- CSRF/origin: mutating server actions and admin APIs fail closed on same-origin checks; read-only exemptions are explicit.
- Rate limiting: app-layer hot paths and shipped edge limiter were checked; only deployment-topology risks SR37-R1 and SR37-R2 remain.
- SSRF/open redirect: OG/image URL paths are origin-pinned and fallback-validated.
- Path traversal/upload: public serving and private originals use allowlists, safe segments, symlink rejection, and realpath containment.
- Session/token safety: HMAC session tokens and scoped PATs are hash-only at rest, expiry-checked, and timing-safe.
- SQL/raw commands: raw SQL is parameterized or controlled migration/restore code; `mysqldump`/`mysql` use fixed argv, minimal env, TLS policy, stderr sanitization, timeouts, and restore scanning.
- Backup/restore safety: maintenance mode, advisory locks, upload drain, SQL scanning, and migration reconciliation were verified.
- Privacy leaks: public projections and compile-time privacy guard tests passed; share pages avoid lookup in metadata and rate-limit before DB lookup.

