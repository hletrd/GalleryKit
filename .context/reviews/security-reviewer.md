# Security Reviewer Report - Cycle 12

- Repo: `/Users/hletrd/flash-shared/gallery`
- Commit reviewed: `173668ea`
- Date: 2026-07-07
- Lane: security-reviewer
- Scope: full repository security review, docs plus code. No product code was changed.

## Summary

I found two confirmed dependency/supply-chain issues and two deployment hardening risks that need operator validation. I did not find a new direct auth bypass, admin action/API CSRF bug, public file path traversal, restore SQL injection, SSRF, tracked secret, or privacy-field exposure in the reviewed HEAD.

The prior Cycle 11 `IMAGE_BASE_URL` raw-client-leak finding appears fixed: `apps/web/src/lib/constants.ts:6-19` now sanitizes the value, and `apps/web/src/lib/content-security-policy.ts:1-46` rejects non-http(s), credential-bearing, query, hash, and non-HTTPS production values before stamping client-visible or CSP state.

## Findings

### C12-SEC-01 - Next still vendors vulnerable PostCSS below 8.5.10

- Severity: Medium
- Confidence: High
- Status: Confirmed
- OWASP: A06 Vulnerable and Outdated Components, A03 Injection/XSS
- Evidence:
  - `apps/web/package.json:59` declares `next` as `^16.2.10`.
  - `package-lock.json:9194-9205` locks `next@16.2.10` and its private dependency `postcss: 8.4.31`.
  - `package-lock.json:9334-9337` contains `node_modules/next/node_modules/postcss` at `8.4.31`.
  - Root override `package.json:7-9` forces top-level `postcss@8.5.16`, but the lock still contains Next's nested private copy.
  - `npm audit --workspace=apps/web --audit-level=low --json` reports `GHSA-qx2v-qp2m-jg93`, "PostCSS has XSS via Unescaped </style> in its CSS Stringify Output", severity moderate, range `<8.5.10`, affecting `next`.
- Exploit/failure scenario: if any current or future Next/PostCSS path stringifies attacker-influenced CSS into an HTML `<style>` context, a payload containing `</style>` can break out of the style block and execute script. I did not identify a current Gallery feature that accepts arbitrary CSS from users, so this is a dependency exposure rather than a confirmed app-level XSS path.
- Suggested fix: track the upstream Next release that removes or patches the nested PostCSS copy, or use a package-manager override that actually rewrites the nested `next/node_modules/postcss` entry without downgrading Next. Do not apply npm audit's suggested `next@9.3.3` remediation. Keep a production dependency audit gate that fails until this is resolved or explicitly suppressed with an expiry and upstream issue link.

### C12-SEC-02 - Drizzle dev tooling still pulls vulnerable esbuild through deprecated esbuild-kit loader

- Severity: Low
- Confidence: High
- Status: Confirmed
- OWASP: A06 Vulnerable and Outdated Components
- Evidence:
  - `apps/web/package.json:79` declares `drizzle-kit` as `^0.31.10`.
  - `package-lock.json:5874-5884` locks `drizzle-kit@0.31.10`, including `@esbuild-kit/esm-loader`.
  - `package-lock.json:378-387` locks deprecated `@esbuild-kit/core-utils@3.3.2` with `esbuild: ~0.18.20`.
  - `package-lock.json:764-800` locks the nested `@esbuild-kit/core-utils/node_modules/esbuild@0.18.20`.
  - `package-lock.json:802-812` locks deprecated `@esbuild-kit/esm-loader@2.6.5`.
  - `npm audit --workspace=apps/web --audit-level=low --json` reports `GHSA-67mh-4wv8-2f99`, "esbuild enables any website to send any requests to the development server and read the response", severity moderate, range `<=0.24.2`.
- Exploit/failure scenario: if a developer or CI environment exposes an affected esbuild dev server to a browser-accessible network, a malicious website can cause the victim browser to request that dev server and read responses. I did not see evidence that production serves this dev server; the impact is dev/CI-local.
- Suggested fix: upgrade or replace the Drizzle tooling path once a current `drizzle-kit` release no longer depends on the deprecated esbuild-kit loader, or add a precise override/resolution for the transitive esbuild copy if compatible. Until then, keep dev servers bound to loopback and prevent browser-accessible CI/dev hosts from exposing esbuild ports.

### C12-SEC-03 - Proxy trust and per-IP limits depend on an operator topology contract, not an enforceable runtime boundary

- Severity: Medium
- Confidence: Medium
- Status: Risk requiring manual validation
- OWASP: A01 Broken Access Control, A05 Security Misconfiguration, A07 Identification and Authentication Failures
- Evidence:
  - `apps/web/docker-compose.yml:15-22` uses host networking, binds the Next server to `HOSTNAME: 127.0.0.1`, and sets `TRUST_PROXY: "true"`.
  - `apps/web/src/lib/request-origin.ts:45-69` trusts the right-most `x-forwarded-proto` and `x-forwarded-host` values when `TRUST_PROXY=true`; these values define the expected origin for CSRF checks.
  - `apps/web/src/lib/rate-limit.ts:175-205` trusts `x-forwarded-for` / `x-real-ip` for client IP selection when `TRUST_PROXY=true`.
  - `apps/web/nginx/default.conf:59-71` documents that every location overwrites `X-Forwarded-For` with `$remote_addr`, which is correct only when nginx's TCP peer is the real client.
  - `apps/web/nginx/default.conf:20-29` separately warns that nginx `limit_req_zone $binary_remote_addr` also collapses to the load balancer IP unless `realip` or PROXY protocol is configured.
  - Representative proxy locations overwrite forwarded headers at `apps/web/nginx/default.conf:99-112`, `117-129`, `174-186`, `191-203`, and `274-306`.
- Exploit/failure scenario: in the intended same-host nginx-to-127.0.0.1 deployment, this is acceptable. If the app port becomes reachable directly while `TRUST_PROXY=true`, an attacker can spoof forwarded IP/host/proto headers and influence app-layer rate-limit identity and expected-origin derivation. If a TLS load balancer fronts nginx but nginx still overwrites XFF with the LB address, every visitor shares one app and nginx rate-limit bucket; a small number of failed login attempts or public-route floods can lock out/429 unrelated users.
- Suggested fix: add a deployment validation runbook or smoke test that sends spoofed `X-Forwarded-*` headers through the public edge and verifies the app sees only the trusted edge values. Consider failing startup unless `TRUST_PROXY=true` is paired with an explicit trusted proxy/hop configuration, and add a first-class nginx template for LB-fronted deployments using `set_real_ip_from`, `real_ip_header`, and append-form XFF. Keep host firewall rules that prevent direct access to the loopback-bound Next service and verify them after deploy.

### C12-SEC-04 - Production Docker base image uses mutable tags rather than reviewed digests

- Severity: Low
- Confidence: Medium
- Status: Risk
- OWASP: A05 Security Misconfiguration, A06 Vulnerable and Outdated Components, A08 Software and Data Integrity Failures
- Evidence:
  - `apps/web/Dockerfile:1` uses `FROM node:24-slim AS build-base`.
  - `apps/web/Dockerfile:15` uses `FROM node:24-slim AS runner-base`.
  - `apps/web/Dockerfile:3-6` says to record the resolved digest in deploy/build logs, but the digest is not pinned in the Dockerfile.
- Exploit/failure scenario: two deploys from the same git commit can resolve different base image contents. A compromised registry path, malicious replacement, or newly introduced vulnerable OS layer can enter production without a source diff or lockfile diff for reviewers to inspect.
- Suggested fix: pin the base to `node:24-slim@sha256:<digest>` and update it deliberately through Renovate/Dependabot or a scheduled base-image refresh process. Keep consuming security updates, but make the image change visible in review.

## Areas Reviewed With No New Finding

- Auth/session: `apps/web/src/app/actions/auth.ts:78-315`, `apps/web/src/lib/session.ts:16-151`, and `apps/web/src/lib/password-hashing.ts` enforce same-origin login/logout/password-change checks, HMAC-signed session tokens, production `SESSION_SECRET` requirement, hashed DB session IDs, 24-hour expiry, one-session replacement, and Argon2id policy.
- Admin API authorization: `apps/web/src/lib/api-auth.ts:58-144` wraps cookie-auth admin APIs with same-origin plus `isAdmin()` and token-auth APIs with explicit scope checks and token auth rate limiting. `npm run lint:api-auth --workspace=apps/web` passed.
- Admin server actions: mutating actions in `apps/web/src/app/actions/**` and `apps/web/src/app/[locale]/admin/**` were reviewed against `requireSameOriginAdmin()` / `hasTrustedSameOrigin()` ordering. `npm run lint:action-origin --workspace=apps/web` passed.
- Public route rate limits: public API routes under `apps/web/src/app/api/**` were reviewed with `apps/web/src/lib/rate-limit.ts`; semantic/similar search, OG, share/group, feed/load-more, and upload derivative routes either pre-increment app limits before expensive work or carry a documented exemption. `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Upload/file safety: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, and `apps/web/src/lib/gps-exif-strip.ts` were reviewed for size caps, safe filenames, private original storage, realpath/lstat containment, symlink rejection, derivative-only public serving, GPS stripping, and disk-space gates.
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, and `apps/web/src/lib/sql-restore-scan.ts` were reviewed for admin + origin checks, validated backup filenames, realpath containment, safe file-handle streaming, mysqldump/mysql spawn argument separation, stderr redaction, restore maintenance locking, SQL allowlisting, and post-restore migration behavior.
- SQL/ORM: Drizzle query construction in reviewed route/action/data files uses parameterized helpers for user inputs; raw SQL reviewed was constant-fragment or identifier-controlled in migration/restore paths. No new interpolation-driven SQL injection was found.
- SSRF: external fetches reviewed in OG/photo and semantic-search paths are either same-origin configured assets or Hugging Face/local model operations; I did not find user-controlled arbitrary URL fetch.
- Privacy/data exposure: public select shapes in `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts:29-46`, and `apps/web/src/lib/data-timeline.ts:35-67` keep `filename_original`, `user_filename`, precise GPS, upload attribution, admin color diagnostics, and private processing fields out of anonymous public cards/search/timeline surfaces. Public map latitude/longitude exposure is an intended feature path and is separated from original filename/private metadata.
- Secrets/logs: tracked secret sweep found examples, docs, and tests but no active tracked `.env` secret file. `.env.deploy` and `apps/web/.env.local` are ignored by `.gitignore` / `apps/web/.gitignore` and were intentionally not opened. Restore/dump stderr redaction paths were reviewed.
- Deployment scripts: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, and `apps/web/nginx/default.conf` were reviewed. No service/container stop/kill/remove commands were run.

## Cross-File Interactions Reviewed

- Cookie admin API path: route exports under `apps/web/src/app/api/admin/**` -> `withAdminAuth` -> `hasTrustedSameOrigin` -> `isAdmin` -> no-store/nosniff response defaults.
- PAT external upload path: `apps/web/src/app/api/admin/lr/upload/route.ts` -> `withAdminAuth(... allowTokenScope: 'lr:upload')` -> `apps/web/src/lib/admin-tokens.ts` -> scoped token verification and `markTokenUsed`.
- CSRF/origin path: server actions -> `requireSameOriginAdmin` / `hasTrustedSameOrigin` -> proxy-derived expected origin in `request-origin.ts` -> nginx `X-Forwarded-*` settings.
- Per-IP rate limiting: public/admin handlers -> `getClientIp` in `rate-limit.ts` -> `TRUST_PROXY` / `TRUSTED_PROXY_HOPS` -> nginx XFF topology.
- Upload serving path: upload actions/API -> UUID/private originals under `UPLOAD_ORIGINAL_ROOT` -> derivative writers -> public `/uploads/(jpeg|webp|avif)` route -> nginx blocks `/uploads/original`.
- Backup/restore path: admin DB page actions -> restore maintenance locks -> SQL scanner -> mysql/mysqldump child process with minimal env -> migration reconciliation.
- Privacy-sensitive fields: schema fields -> `PrivacySensitiveKeys`/select guards -> public search/timeline/map/share renderers -> privacy fixture tests.
- CSP/image base path: `IMAGE_BASE_URL` env -> `sanitizeImageBaseUrlSafely` -> layout `data-image-base` / CSP builder / next remote patterns.

## Verification Evidence

- Passed: `npm run lint:api-auth --workspace=apps/web`
- Passed: `npm run lint:action-origin --workspace=apps/web`
- Passed: `npm run lint:public-route-rate-limit --workspace=apps/web`
- Passed: `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/csp-malformed-image-base-url.test.ts src/__tests__/image-url.test.ts` - 6 files, 58 tests.
- Failed as expected due findings: `npm audit --workspace=apps/web --audit-level=low --json` - 6 moderate advisories: Next/PostCSS and Drizzle/esbuild-kit/esbuild chains.

## Files And Directories Reviewed

- Required docs: `AGENTS.md`, `CLAUDE.md`.
- Context docs/plans: `.context/plans/README.md`, `.context/plan/plan-c12.md`, `.context/plans/archive/196-deferred-cycle12-ultradeep-review.md`, prior `.context/reviews/security-reviewer.md`.
- Application routes/actions: `apps/web/src/app/**`, including admin pages/actions, admin API routes, public API routes, upload route, share/group routes, OG routes, sitemap/feed/robots/live/health endpoints.
- Security/data libraries: `apps/web/src/lib/**`, `apps/web/src/db/**`, `apps/web/src/components/**` where public data rendering touched sensitive fields.
- Upload/storage/image pipeline: `apps/web/src/lib/upload-*`, `serve-upload.ts`, `process-image.ts`, `gps-exif-strip.ts`, image actions, Lightroom upload API, image queue/backfill entry points.
- Backup/restore/migrations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/**`.
- Tooling/deploy/config: `package.json`, `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/scripts/**`, `apps/web/nginx/default.conf`, `next.config.ts`, `proxy.ts`.
- Tests reviewed/executed selectively: `apps/web/src/__tests__/**` security/privacy/source-contract coverage.
- Excluded from content review: `node_modules/**`, local ignored secret files `.env.deploy` and `apps/web/.env.local`.

## Final Missed-Issue Sweep

- Searched for admin auth wrappers, same-origin guards, public rate-limit exemptions, path resolution/realpath/lstat/open/createReadStream usage, spawn/fetch call sites, privacy-sensitive schema fields, and image base URL propagation.
- Searched tracked text for secret-looking assignments and verified local secret files are ignored without opening them.
- Compared Cycle 11 findings against current code; the raw `IMAGE_BASE_URL` client leak is fixed, while dependency advisories remain.
- Rechecked public routes that are intentionally exempt from app-layer rate limits; the remaining risk is deployment topology, not a newly identified missing handler guard.
- Remaining known uncertainty: C12-SEC-03 requires live deployment validation because source review cannot prove the production host firewall, upstream load balancer, and nginx `realip` topology.
