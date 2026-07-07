# Cycle 17 Security Review

Reviewer: security-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08
Mode: review-only; no fixes implemented.

## Required Instructions Read

- `AGENTS.md` from the prompt, including Gallery workspace rules, deploy rules, schema rules, and blocking quality gates.
- `CLAUDE.md`, focusing on auth/session, CSRF/origin, privacy, uploads, backup/restore, CLIP semantic-search, deployment, proxy topology, and operational safety.
- Security-review skill instructions from `/Users/hletrd/.agents/skills/security-review/SKILL.md`.

## Inventory Built First

I built this inventory before judging behavior and then reviewed the cross-file interactions between auth wrappers, actions, API routes, public routes, upload paths, DB/restore code, service worker caching, deployment scripts, and docs.

- Governance/docs/context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.context/**` security-relevant review/plan notes surfaced by search.
- CI/dependency/config: `.github/workflows/*.yml`, `.github/dependabot.yml`, root and app `package.json` / lockfile, `apps/web/next.config.ts`, `apps/web/tsconfig*.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`.
- Secrets/env/deploy: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/nginx/default.conf`.
- Auth/session/origin/rate limits: `apps/web/src/proxy.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/pending-session-revocations.ts`.
- Admin and mutating server actions: every file in `apps/web/src/app/actions/`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- API and public route handlers: all security-relevant handlers under `apps/web/src/app/api/**/route.*`, upload routes, feed routes, health/live routes, OG routes, semantic/similar search routes, and admin DB/LR upload routes.
- Public/share surfaces: public home/topic/photo/map/timeline/year/smart-collection pages, `/s/[key]`, `/g/[key]`, public actions, metadata routes, and service-worker behavior.
- Upload/file-serving/storage: `apps/web/src/lib/upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `upload-tracker*.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`, `storage/*`, `og-photo-fetch.ts`, `image-url.ts`, `download-filename.ts`.
- SQL/privacy/restore: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-like.ts`, `sql-restore-scan.ts`, `db-restore.ts`, `backup-filename.ts`, `mysql-cli-ssl.ts`, `db-child-watchdog.ts`, `restore-maintenance*.ts`, advisory lock helpers, `apps/web/src/db/**`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`.
- Rendering/cache/CSP/CLIP: `content-security-policy.ts`, `safe-json-ld.ts`, `og-sanitize.ts`, `seo-og-url.ts`, `apps/web/public/sw.template.js`, generated `sw.js`, CLIP model/download/manifest/path files, and semantic-search routes.
- Security lints/tests: API auth, action-origin, public-route-rate-limit, tracked secrets, privacy-fields, request-origin, upload serving, restore scanner, backup download, semantic search, OG rate-limit, and service-worker/cache tests were used as evidence where relevant.

## Findings Summary

- Confirmed issues: none found.
- Likely issues: none found.
- Risks needing manual validation: 3 operational risks below. These are not confirmed repository-code vulnerabilities under the documented single-instance deployment, but they are security-relevant production assumptions that code review cannot prove.

## Risks Needing Manual Validation

### C17-SEC-RISK-01: Live proxy topology must match app and nginx client-IP trust assumptions

Status: Manual-validation risk, not a confirmed code defect
Severity: Medium
Confidence: High

Evidence:

- `apps/web/src/lib/rate-limit.ts:175-206` only trusts `x-forwarded-for` / `x-real-ip` when `TRUST_PROXY=true`, validates header shape, and otherwise keys requests as `"unknown"`.
- `apps/web/nginx/default.conf:20-28` explicitly warns that nginx `$binary_remote_addr` limits need `real_ip` configuration when a load balancer or CDN sits in front of nginx.
- `apps/web/nginx/default.conf:59-71` says the shipped `X-Forwarded-For $remote_addr` overwrite is correct only when the connecting peer is the real client.
- `scripts/check-proxy-topology.mjs:12-16` states the topology check cannot prove the effective client-IP bucket or XFF overwrite.
- `scripts/check-proxy-topology.mjs:131-134` prints `not-verified=effective client-IP bucket or X-Forwarded-For overwrite`.

Why this is a problem:

The repository has strong header-scrubbing assumptions, but rate-limit correctness depends on live proxy topology. If nginx is later placed behind a CDN/LB without `real_ip` or the app has the wrong `TRUSTED_PROXY_HOPS`, per-client limits can collapse to the proxy address, `"unknown"`, or the wrong XFF segment.

Concrete failure scenario:

An operator adds a CDN in front of nginx and leaves the shipped `X-Forwarded-For $remote_addr` behavior unchanged. All visitors share one app/nginx rate-limit bucket or a proxy-derived bucket. One abusive client can lock out legitimate login/search/share/OG/semantic traffic, and security monitoring will attribute abuse to the edge rather than the client.

Suggested fix:

Keep `BASE_URL` set in production, set `TRUST_PROXY=true` only behind a scrubbed trusted proxy, set `TRUSTED_PROXY_HOPS` to the actual trusted suffix length, and configure nginx/CDN `real_ip` behavior for any upstream proxy. Extend the deploy/topology check or add a private diagnostic that proves the effective client key after every edge/CDN/LB change.

### C17-SEC-RISK-02: Plaintext SQL backups rely on host and backup-storage controls

Status: Manual-validation risk; documented operator boundary
Severity: Medium
Confidence: Medium

Evidence:

- `CLAUDE.md:226-228` documents that DB dumps are non-public but plaintext at rest, and that host/storage encryption is the operator boundary.
- `apps/web/src/app/[locale]/admin/db-actions.ts:128-163` gates backup creation on same-origin, admin auth, DB env presence, and owner-only backup directory creation.
- `apps/web/src/app/[locale]/admin/db-actions.ts:186-201` runs `mysqldump` with argument arrays and writes the temporary dump with `0600`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:263-316` rejects empty, implausible, or truncated dumps before atomically publishing the file.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` wraps backup download in admin auth, validates filenames, enforces realpath containment, streams from a validated file descriptor, and returns no-store/nosniff headers.

Why this is a problem:

The web path is guarded, but SQL dumps contain admin password hashes, session/token hashes, image metadata, share keys, audit logs, settings, and analytics. Route auth does not protect against host-level users, host backup jobs, cloud sync tools, support bundles, or misconfigured bind mounts.

Concrete failure scenario:

A host backup job syncs `data/backups/*.sql` to a less restricted destination, or a local support process reads the bind mount. The attacker does not need a web exploit to obtain private metadata, share keys, and credential hashes.

Suggested fix:

Validate production ownership and permissions for `data/backups`, host backup destinations, retention, and support collection paths. Encrypt backup storage or move dumps into an encrypted host backup pipeline where the host is multi-user, cloud-synced, or operator-shared. Treat downloaded SQL dumps as secrets and rotate sessions/tokens after suspected exposure.

### C17-SEC-RISK-03: Single-instance assumptions are advisory rather than enforced

Status: Manual-validation risk; not exploitable in the documented single-web-instance topology
Severity: Medium
Confidence: Medium

Evidence:

- `CLAUDE.md:244-246` documents the single web-instance / single-writer topology and process-local restore, upload quota, image queue, and rate-limit assumptions.
- `apps/web/src/lib/rate-limit.ts:288-429` keeps several public-route fast-path rate limits in process memory.
- `apps/web/src/lib/clip-model.ts:53-64` keeps CLIP inference concurrency and pending-queue limits process-local.
- `apps/web/src/lib/clip-model.ts:117-173` enforces that queue in memory.
- `apps/web/docker-compose.yml:15-32` defines a single web service with host networking and bind mounts, matching the documented topology.

Why this is a problem:

The current deployment is coherent as one web process. If an operator accidentally starts a second web container or attempts scale-out, some security and availability controls are multiplied or weakened because their state is per-process.

Concrete failure scenario:

During a blue/green test or manual restart, two web processes serve the same DB and filesystem. Attackers can multiply in-memory OG/share/feed/semantic budgets and CLIP queue capacity by instance count, while upload/restore/background work may no longer match the single-writer assumptions documented by the project.

Suggested fix:

Keep production single-instance unless these controls are moved to shared storage. If accidental multi-instance operation is plausible, fail startup or health checks on singleton-lock contention. For intentional scale-out, move rate-limit fast paths, upload quota/admission, CLIP queueing, background queues, and restore-maintenance coordination to DB/Redis-equivalent shared state.

## Positive Security Evidence

Auth and authorization:

- `apps/web/src/lib/api-auth.ts:58-145` centrally enforces admin auth for admin API routes, scoped PAT auth for allowed token flows, same-origin checks for cookie-auth admin APIs, token-auth rate limiting, and no-store/nosniff response defaults.
- `apps/web/src/lib/session.ts:16-36` requires a real `SESSION_SECRET` in production; `session.ts:82-150` signs/verifies session tokens with HMAC-SHA256, constant-time comparison, hash-only DB storage, and DB expiry checks.
- `apps/web/src/app/actions/auth.ts:101-177` rate-limits login by IP/account before Argon2 work; `auth.ts:216-255` rotates sessions and sets httpOnly/secure/sameSite cookies.
- `apps/web/src/lib/password-hashing.ts:10-15` uses Argon2id with explicit memory/time/parallelism parameters.
- `apps/web/src/lib/admin-tokens.ts:53-90` creates random bearer tokens, stores SHA-256 hashes, validates token format, and compares hashes with `timingSafeEqual`.

CSRF/origin and route coverage:

- `apps/web/src/lib/request-origin.ts:81-145` anchors origin checks to canonical `BASE_URL`/site config where available and fails closed unless `Origin` or `Referer` matches.
- `apps/web/src/lib/action-guards.ts:37-40` centralizes same-origin checks for mutating server actions.
- `apps/web/src/proxy.ts:55-122` gates admin page rendering and marks admin-rendered responses for service-worker cache exclusion.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Uploads, file serving, symlinks, and traversal:

- `apps/web/src/app/api/admin/lr/upload/route.ts:84-128` wraps LR upload in admin auth, rejects chunked uploads, and enforces valid `Content-Length` before multipart parsing.
- `apps/web/src/app/actions/images.ts:135-215` applies same-origin/admin checks, validates topic/tags/file counts/safe filenames, locks the upload contract, and reserves upload quota before expensive work.
- `apps/web/src/lib/serve-upload.ts:162-238` allows only derivative directories/extensions, validates every segment, rejects symlinks, and enforces realpath containment.
- `apps/web/src/lib/serve-upload.ts:304-318` opens and stats the file descriptor before streaming.
- `apps/web/src/lib/upload-paths.ts:49-57` creates the private originals directory and attempts owner-only permissions.
- `apps/web/src/lib/upload-paths.ts:120-170` resolves original filenames through validation, `lstat`, `realpath`, and root containment.
- `apps/web/src/lib/storage/local.ts:23-61` normalizes storage keys and blocks absolute/path-traversal keys; `local.ts:159-167` refuses public URLs for originals.

Public routes, SSRF, redirects, and rendering:

- `apps/web/src/app/api/search/semantic/route.ts:107-184` enforces same-origin, content-type, non-chunked/body-size limits, and rate limiting before semantic-search work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:72-131` applies same-origin, maintenance checks, ID validation, rate limiting, and production feature gates.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:176-196` builds internal derivative fetches from canonical `BASE_URL`, not request-derived host headers.
- `apps/web/src/lib/og-photo-fetch.ts:31-86` caps internal image fetch size and timeouts.
- JSON-LD `dangerouslySetInnerHTML` sinks call `safeJsonLd`, for example `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:272-284` and `apps/web/src/app/[locale]/(public)/page.tsx:214-230`.
- `apps/web/src/lib/safe-json-ld.ts:14-20` JSON-serializes and escapes `<`, `>`, U+2028, and U+2029.
- `apps/web/src/lib/content-security-policy.ts:139-199` builds a nonce-based production CSP with `object-src 'none'`; `next.config.ts:87-91` adds a restrictive sandbox CSP to `/api/*`.

SQL, privacy, backup/restore, and process execution:

- `apps/web/src/db/index.ts:7-19` requires CA-backed TLS for non-local DB connections unless `DB_SSL=false`.
- Reviewed raw SQL paths use static SQL or parameter binding for untrusted values; smart collections compile through allowlisted columns/operators.
- `apps/web/src/lib/data.ts:368-407` defines public field sets that omit GPS, original/user filenames, upload attribution, processing internals, and admin-only fields.
- `apps/web/src/lib/data.ts:458-488` carries a type guard for privacy-sensitive keys.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` uses a narrow public enrichment field set plus a privacy guard for semantic/similar results.
- `apps/web/src/lib/smart-collections.ts:142-248` bounds predicate size/depth and compiles allowed predicates through Drizzle helpers.
- `apps/web/src/lib/sql-restore-scan.ts:12-155` allowlists app tables and rejects dangerous SQL patterns, schema-qualified writes, and non-app write targets.
- Backup/restore child processes are invoked with static executables and argument arrays; DB credentials are passed by environment and child stderr is sanitized before surfacing.

Cache/privacy/service worker:

- `apps/web/public/sw.template.js:43-63` identifies admin routes, image derivative routes, and revocable share/map routes.
- `apps/web/public/sw.template.js:439-474` only caches successful non-admin-rendered HTML and stamps offline-cache timestamps.
- `apps/web/public/sw.template.js:539-552` bypasses admin routes and revocable public object pages, reducing stale-cache exposure after revoke/delete/expiry.
- `apps/web/src/proxy.ts:112-122` sets `x-gk-admin-render: 1` for admin-session-rendered non-admin pages so the service worker can avoid caching them.

Secrets, dependencies, CLIP, and deployment:

- Tracked secret scan found examples/placeholders and historical notes, but no committed runtime `.env` secret values in tracked files.
- Ignored local secret files `.env.deploy` and `apps/web/.env.local` exist and were intentionally not opened to avoid disclosing operator secrets.
- `apps/web/deploy.sh:15-43` and `scripts/deploy-remote.sh:61-80` reject group/world-readable env files before use.
- `apps/web/nginx/default.conf:90-97` sets security headers; route blocks apply body caps/rate zones for admin login, admin DB, dashboard upload, LR upload, admin API, uploads, Next image optimizer, and public pages.
- `apps/web/src/lib/clip-model.ts:203-220` loads CLIP models offline with `env.allowRemoteModels=false` and a pinned revision.
- `apps/web/scripts/download-clip-models.ts:66-93` verifies an existing seeded CLIP cache before short-circuiting; `download-clip-models.ts:127-139` verifies checksums and deletes mismatched artifacts after download.
- `apps/web/scripts/clip-model-manifest.ts:29-34` pins SHA-256 for large CLIP artifacts; `clip-model-manifest.ts:145-190` verifies loader-fatal files.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` returned zero vulnerabilities.

## Validation Commands Run

- Repository inventory and targeted source inspection with `git ls-files`, `rg --files`, and `rg` sweeps over routes, server actions, auth wrappers, same-origin helpers, public route exemptions, secrets, raw SQL, process execution, redirects, CSP, service worker caches, uploads, and CLIP model handling.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`: passed, zero vulnerabilities.

## Final Missed-Issues Sweep

- OWASP Top 10 coverage: broken access control, auth/session failures, cryptographic failures, injection, insecure design, misconfiguration, vulnerable dependencies, integrity failures, logging/monitoring, SSRF, and path traversal were reviewed against source and docs.
- Requested areas covered: secrets, auth/authz, CSRF/origin, public route rate limits, uploads/resources, SSRF/path traversal, SQL/ORM use, cache/privacy boundaries, deployment scripts, and production operational safety.
- Skipped surfaces: generated/dependency/runtime artifacts (`node_modules`, `.next`, Playwright/test-results output), binary/media/font/ICC fixtures, local ignored `.env*` secret contents, and historical review/plan archives not surfaced by security searches. Current tracked source, tests/lints, scripts, migrations, docs, config, deployment, and CI security surfaces were reviewed.
- Final status: no confirmed or likely repository-code vulnerability found in cycle 17. The remaining items are production/operator validation risks.
