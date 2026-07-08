# Cycle 36 Security Review - Security Reviewer

Date: 2026-07-08 KST
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `40b7720cade239c407288a7426663d6038c05476`
Scope: whole-repository OWASP/auth/authz/secrets/input-validation/trust-boundary review.
Status: review-only. Production code was not edited.

## Inventory First

Required guidance read before source review: `AGENTS.md`, `CLAUDE.md`, and the local `security-review` skill.

Security-relevant inventory reviewed:

- Auth, session, cookies, password hashing, CSRF/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`.
- Admin API and PAT auth: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/lr-tokens.ts`.
- Mutating server actions and authz boundaries: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/scripts/check-action-origin.ts`.
- Public routes and rate limits: `apps/web/src/app/api/**/route.*`, public feed/upload routes, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`.
- Upload/file/path boundaries: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/storage/local.ts`.
- Privacy/data selects: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, map/share/search/photo public read paths, privacy guard tests.
- SQL/restore/child-process trust boundaries: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/scripts/migrate.js`.
- SSRF/XSS/CSP/OG/feed surfaces: `apps/web/src/app/api/og/**`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`.
- Deployment/supply chain/secrets: `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/package.json`, root `package.json`, env examples, tracked-secret tests.

## Findings

No confirmed or likely current code-level security findings were identified in this cycle.

### Manual-Validation Risk: Edge limiter and client-IP topology are config-applied, not deploy-applied

- Severity: Medium
- Confidence: High for the repo contract; deployment-specific impact requires manual validation.
- Classification: Manual-validation risk, not a confirmed source-code vulnerability.
- File / region:
  - `apps/web/nginx/default.conf:20-28` documents that nginx `limit_req_zone` keys use `$binary_remote_addr`, so LB-fronted installs need real-IP/PROXY-protocol configuration or all visitors share one limiter bucket.
  - `apps/web/nginx/default.conf:59-71` documents that this template overwrites `X-Forwarded-For` with `$remote_addr` and must be changed to append mode plus `TRUSTED_PROXY_HOPS` adjustment when an upstream LB is the TCP peer.
  - `apps/web/nginx/default.conf:274-295` applies the public catch-all limiter and explicitly says this config is not applied by normal deploys and requires an operator reload.
- Concrete failure scenario: production is behind a CDN/LB whose TCP peer is the LB address, but host nginx is left with the shipped `$remote_addr`/`$binary_remote_addr` defaults and is never reloaded after the template changed. App-layer login/search buckets and nginx public/page buckets collapse many users into one shared IP. One abusive client can exhaust login or public page budgets for legitimate users, or operators can believe public SSR flood protection is live when the host is still running an older nginx config.
- Suggested fix: as an operator validation item, verify the live host nginx config with `nginx -T` or equivalent after every nginx-template security change. For LB-fronted topology, configure `real_ip_header`/`set_real_ip_from` or PROXY protocol for nginx limit keys, switch app-facing `X-Forwarded-For` to append mode, and set `TRUSTED_PROXY_HOPS` to the actual trusted chain. Consider adding a deploy/ops smoke that records the live nginx config checksum or emits a warning when the template changed but no host reload evidence exists.

## Evidence Supporting No Code-Level Finding

- Session secret and cookies: `apps/web/src/lib/session.ts:16-36` refuses DB-stored session-secret fallback in production; `apps/web/src/lib/session.ts:82-150` signs HMAC tokens, verifies with `timingSafeEqual`, bounds token age, and stores only token hashes. `apps/web/src/app/actions/auth.ts:240-253` sets `httpOnly`, `secure` in production/HTTPS, `sameSite=lax`, and path-scoped cookies.
- Login brute-force controls: `apps/web/src/app/actions/auth.ts:100-177` applies same-origin, admin mutation barrier, pre-incremented per-IP and account-scoped login buckets, DB-backed checks, and rollback only before auth work.
- Admin API auth: `apps/web/src/lib/api-auth.ts:66-152` wraps all admin APIs, enforces same-origin for cookie auth, accepts PATs only when a route declares a required scope, rate-limits token attempts, clears request-scoped token context, and applies no-store/nosniff defaults.
- PAT storage: `apps/web/src/lib/admin-tokens.ts:53-90` issues random `gk_` tokens and validates format; `apps/web/src/lib/admin-tokens.ts:142-169` hashes presented tokens, joins to existing admins, constant-time compares the stored hash, enforces expiry, and returns scopes only.
- CSRF/origin anchor: `apps/web/src/lib/request-origin.ts:47-68` prefers `BASE_URL`/production `siteConfig.url`; `apps/web/src/lib/request-origin.ts:118-146` fails closed without matching `Origin` or `Referer`.
- Action provenance: `apps/web/src/lib/action-guards.ts:37-43` centralizes same-origin checks for mutating actions; the lint gate passed for all mutating server actions.
- Public rate limits: feed, OG, semantic/similar search, load-more, view-count, and share routes/actions use pre-increment helpers or carry explicit derivative/health exemptions. The public-route lint gate passed.
- Upload and path traversal: `apps/web/src/lib/serve-upload.ts:162-384` limits public serving to `jpeg|webp|avif`, validates every segment, rejects symlinks, verifies realpath containment, stats through the opened fd for GET bodies, and closes streams/handles on errors.
- Private originals and GPS: browser and Lightroom upload paths save originals under private storage, delete originals on rejected HDR/GPS-strip failure, and keep GPS fields out of public selects. `apps/web/src/lib/data.ts:368-488` and `apps/web/src/lib/data.ts:1777-1817` guard public and map GPS data separately.
- Backup/restore: `apps/web/src/app/api/admin/db/download/route.ts:21-109` requires admin auth and realpath containment before streaming backup files; `apps/web/src/app/[locale]/admin/db-actions.ts:789-1027` caps restore size, streams temp files mode `0600`, checks headers/trailer, scans SQL by chunks, imports with `mysql --one-database`, and keeps maintenance active on unsafe failures. `apps/web/src/lib/sql-restore-scan.ts:88-156` blocks dangerous SQL and `apps/web/src/lib/sql-restore-scan.ts:262-342` blocks schema-qualified or non-app write targets.
- SSRF/XSS/CSP: OG photo fetches are canonical-origin bounded and byte/time capped; JSON-LD uses safe escaping; production API CSP is set in `apps/web/next.config.ts:87-92`; normal pages receive nonce CSP through `apps/web/src/proxy.ts:36-52`.
- Secrets: real local `.env.deploy` and `apps/web/.env.local` exist but are untracked. Tracked-secret grep found only placeholders/redacted historical review text, not live tracked credentials. I did not read local secret values.
- Dependencies: `npm run audit:prod` reported `found 0 vulnerabilities`.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/topics-actions.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts`: passed, 9 files / 139 tests.
- `npm run audit:prod`: passed, 0 production dependency vulnerabilities at `moderate`.

## Final Missed-Issue Sweep

Final sweep covered route/action inventories, auth wrappers, origin and proxy handling, admin/PAT scopes, public route rate limits, upload and derivative serving, path traversal/symlink checks, raw SQL and restore scanner patterns, child-process env handling, backup download containment, privacy-sensitive select guards, semantic/similar search result enrichment, CSP/OG/JSON-LD, nginx and Docker deployment surfaces, tracked secret patterns, and current cycle35 diffs.

Skipped or limited areas: `node_modules`, generated build output, binary fixtures, archived screenshots, and local secret values in untracked env files. No product code was changed.
