# Cycle 13 Security Review

Reviewer: security-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed commit: `711a0a71`  
Date: 2026-07-07

## Scope And Inventory

Reviewed the security-relevant implementation and config surfaces for OWASP Top 10 coverage, auth/authz, admin APIs, server actions, rate limits, uploads/file serving, sharing/privacy, secrets, CSRF/origin, SQL/data access, dependencies, and deployment topology.

Inventory built before detailed review:

- Admin/auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/admin-tokens.ts`.
- Server actions: all files under `apps/web/src/app/actions/` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Admin APIs: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Public APIs/routes/actions: `apps/web/src/app/api/search/**`, `apps/web/src/app/api/og/**`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, public upload routes, feeds, public share/photo/topic/map/timeline/smart-collection pages, and `apps/web/src/app/actions/public.ts`.
- Upload/file handling: `apps/web/src/lib/process-image.ts`, `gps-exif-strip.ts`, `upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `serve-upload.ts`, `storage/local.ts`, `process-topic-image.ts`, `og-photo-fetch.ts`.
- Data/privacy/SQL: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-restore-scan.ts`, `db-restore.ts`, `csv-escape.ts`, `sanitize.ts`, `validation.ts`, `apps/web/src/db/**`.
- Rate limits and topology: `apps/web/src/lib/rate-limit.ts`, `auth-rate-limit.ts`, `bounded-map.ts`, `single-writer-guard.ts`, `upload-tracker*.ts`, `background-db-writes.ts`, `view-retention.ts`, `CLAUDE.md`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`.
- Config/dependencies/secrets: `package.json`, `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/src/lib/content-security-policy.ts`, env examples, deploy/migration scripts.

I also enumerated 210 TS/TSX/JS/MJS files under the security-relevant app/lib/db/script directories and used targeted grep sweeps for raw SQL, filesystem operations, auth headers, public-route exemptions, origin exemptions, dangerous rendering sinks, secrets, and deployment config.

## Findings

### C13-SEC-01: Multi-instance operation remains warn-only while several controls are process-local

Status: Likely risk, not a confirmed issue in the documented single-instance deployment  
Severity: Medium  
Confidence: Medium

Evidence:

- `apps/web/src/lib/single-writer-guard.ts:6-16` documents that two live web processes sharing one MySQL DB break restore mutation fencing, upload quota tracking, and rate-limit fast paths, and that the guard "cannot enforce single-instance operation".
- `apps/web/src/lib/single-writer-guard.ts:218-235` emits a loud error when another holder is detected, but explicitly says startup continues.
- `CLAUDE.md:244-247` states the shipped topology is single web instance/single writer; upload quota tracking, image queue state, admin-backfill status, view-count buffering, and OG/share/semantic fast paths are process-local; public page limiting is expected at the NGINX edge.
- `apps/web/docker-compose.yml:3-23` ships one `web` service with `TRUST_PROXY=true`; this is consistent with the documented topology but does not technically prevent a second process/container from being started against the same DB.

Exploit/failure scenario:

An operator accidentally runs two GalleryKit web processes against the same database during a migration, manual restart, blue/green test, or horizontal scale-out. The second process logs a warning and continues. An attacker can then multiply per-process OG/share/semantic fast-path budgets by the number of instances, and admin operations can race around process-local restore/upload coordination. The DB advisory locks mitigate some backfill/restore cases, but the documented process-local controls are still weakened.

Suggested fix:

Keep the current single-instance deployment, but make the invariant enforceable in production: either fail closed on persistent singleton-lock contention, or move the remaining rate-limit/upload/queue/restore coordination state to a shared store before allowing more than one instance. Add a deployment/health check that alerts on singleton contention instead of relying only on container logs.

### C13-SEC-02: Reverse-proxy IP attribution and public page throttling depend on live edge config that this repo cannot verify

Status: Likely risk, deployment-dependent  
Severity: Medium  
Confidence: Medium

Evidence:

- `apps/web/src/lib/rate-limit.ts:175-205` trusts `X-Forwarded-For`/`X-Real-IP` only when `TRUST_PROXY=true`; otherwise requests collapse into the `"unknown"` bucket and log a production warning.
- `apps/web/docker-compose.yml:20-23` sets `TRUST_PROXY=true` for the shipped host-networked container.
- `apps/web/nginx/default.conf:20-28` warns that NGINX `limit_req_zone` keys use `$binary_remote_addr`, so an LB-fronted topology needs `realip`/PROXY-protocol configuration or all visitors share one NGINX bucket.
- `apps/web/nginx/default.conf:59-71` documents the XFF overwrite contract and says `$proxy_add_x_forwarded_for` plus correct `TRUSTED_PROXY_HOPS` is required behind an upstream LB.
- `apps/web/nginx/default.conf:274-295` applies the only public SSR page limiter at the catch-all NGINX location; `apps/web/nginx/default.conf:290-293` says applying this file is manual host config, not part of container deploys.
- `CLAUDE.md:247` explicitly says public pages have no app-layer limiter and operators using another proxy/CDN must supply an equivalent edge limit.
- Validation gap: `npm run check:proxy-topology` could not run locally because no `--url`/`PROXY_TOPOLOGY_URL` was available.

Exploit/failure scenario:

If the live host is behind another load balancer without matching real-IP config, every visitor can share one app/NGINX rate-limit identity, enabling trivial lockout/DoS of login, public pages, or public APIs. If an operator changes XFF forwarding but misconfigures trusted hop count, an attacker may be able to influence the selected client IP and bypass per-IP budgets. If the shipped NGINX limiter is not applied, dynamic public pages remain bounded only by upstream infrastructure.

Suggested fix:

Make `check:proxy-topology` part of deployment validation against the real public URL, and fail/alert when the observed client IP chain does not match the configured `TRUST_PROXY`/`TRUSTED_PROXY_HOPS`/NGINX topology. For non-shipped proxies/CDNs, document and test the equivalent public-page limiter and real-IP behavior. Consider an app startup warning when production lacks an explicit `TRUSTED_PROXY_HOPS` value.

### C13-SEC-03: Dependency vulnerabilities are currently patched by npm overrides, but the dependency graph remains invalid under `npm ls`

Status: Confirmed config/tooling risk; no active npm-audit vulnerability found  
Severity: Low  
Confidence: High

Evidence:

- `package.json:7-15` overrides `postcss` to `8.5.16` and `@esbuild-kit/core-utils@3.3.2`'s `esbuild` to `0.28.1`.
- `apps/web/package.json:59-87` depends on `next@^16.2.10`, `drizzle-kit@^0.31.10`, `postcss@^8.5.16`, and the modern build/test stack.
- `package-lock.json:378-388` still records `@esbuild-kit/core-utils@3.3.2` declaring `esbuild: ~0.18.20`.
- `package-lock.json:8809-8820` still records `next@16.2.10` declaring `postcss: 8.4.31`.
- `npm audit --workspace=apps/web --audit-level=low --json` reported zero vulnerabilities.
- `npm ls postcss esbuild --workspace=apps/web --all` exited `ELSPROBLEMS`, showing installed `postcss@8.5.16` and `esbuild@0.28.1` as override-forced but "invalid" against the transitive package declarations.

Exploit/failure scenario:

The currently installed/audited graph is patched, but this state depends on npm override semantics. A future installer, lockfile regeneration, Docker change, or security scanner that ignores overrides could reintroduce or report the vulnerable declared transitive versions. Separately, any CI/security job that treats `npm ls` as a dependency-health gate will fail even though `npm audit` is clean.

Suggested fix:

Keep the overrides while upstream packages still declare vulnerable ranges, but track the upstream fix/upgrade path for Next and Drizzle tooling so the graph can become naturally valid again. Add a dependency-health check that explicitly accepts the override-patched state, or replace it with a stricter check that verifies the installed versions (`postcss@8.5.16`, `esbuild@0.28.1`) rather than relying on `npm ls` success.

## Confirmed Secure Areas Reviewed

- Authentication/session handling: `apps/web/src/app/actions/auth.ts:99-170` pre-increments IP and account login buckets before Argon2 verification, falls back to in-memory caps if DB checks fail, and does not refund infrastructure errors. `apps/web/src/app/actions/auth.ts:181-246` uses dummy Argon2 verification, session rotation, and `httpOnly`/`secure`/`sameSite=lax` cookies. `apps/web/src/lib/session.ts:16-36` refuses DB-stored session-secret fallback in production; `apps/web/src/lib/session.ts:94-150` verifies HMAC tokens with constant-time comparison, shape checks, age checks, DB hash lookup, and expiry cleanup.
- Admin API auth: `npm run lint:api-auth --workspace=apps/web` passed, confirming both admin API routes wrap `withAdminAuth`. Manual review confirmed PAT scope restriction on Lightroom upload and session/token auth response hardening.
- Server-action CSRF/origin: `npm run lint:action-origin --workspace=apps/web` passed. Mutating admin actions use `requireSameOriginAdmin()`, `isAdmin()`, restore-maintenance checks, and mutation barriers. Public actions with mutations are explicitly rate-limited.
- Public API rate limits: `npm run lint:public-route-rate-limit --workspace=apps/web` passed. Share pages rate-limit before share-key DB lookup and keep `generateMetadata` generic/noindex (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:44-112`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:49-120`).
- Upload/file handling: upload paths use UUID filenames, size/pixel limits, private originals, safe path resolution, symlink checks, allowed derivative directories, non-SVG content types, and GPS stripping/fail-closed behavior. Public original serving is blocked by both route/path policy and NGINX (`apps/web/nginx/default.conf:206-208`).
- Privacy/data access: public selects omit sensitive fields and have compile-time guards (`apps/web/src/lib/data.ts:368-488`); semantic/similar search enrichment has its own privacy guard (`apps/web/src/lib/search-enrichment-fields.ts:29-47`); timeline public selects mirror the guarded public field subset (`apps/web/src/lib/data-timeline.ts:20-67`).
- SQL/restore/export: reviewed raw SQL hotspots in admin-token verification, restore/dump, SQL restore scanning, CSV export escaping, backup download path containment, and DB TLS config. No untrusted SQL concatenation or path traversal issue was confirmed.
- Secrets: tracked-file secret scan found placeholders and historical review/log references only, not live credentials. Production session-secret fallback is fail-closed.
- Security headers/CSP: Next config disables `X-Powered-By`, applies nosniff/frame/referrer/permissions/HSTS headers, API CSP sandboxing, nonce-based production script CSP, and validates/sanitizes `IMAGE_BASE_URL` (`apps/web/next.config.ts:44-121`, `apps/web/src/lib/content-security-policy.ts:1-176`).
- Container/deploy supply chain: prior mutable-base concern is resolved in current source: `apps/web/Dockerfile:1-7` and `apps/web/Dockerfile:16-22` pin `node:24-slim` by digest and document deliberate digest refresh.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed; every mutating server action enforces same-origin provenance or has a documented exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/request-origin.test.ts src/__tests__/shared-route-rate-limit-source.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/semantic-search-rate-limit.test.ts src/__tests__/og-rate-limit.test.ts`: 10 files, 93 tests passed.
- `npm audit --workspace=apps/web --audit-level=low --json`: zero vulnerabilities.
- `npm ls postcss esbuild --workspace=apps/web --all`: failed with `ELSPROBLEMS` because override-patched installed versions are considered invalid against transitive declared ranges; captured as C13-SEC-03.
- `git ls-files -z | xargs -0 rg ...`: found only documented placeholders, historical review/log mentions, and tests using dummy secrets.
- `npm run check:proxy-topology`: not run to completion because no deployment URL was provided; captured as a validation gap in C13-SEC-02.

## Final Sweep

No confirmed OWASP/auth/authz/CSRF/upload/path traversal/share-key/privacy/secret/SQL-injection vulnerability was found in the reviewed source. Remaining risk is concentrated in deployment topology and dependency-health hygiene rather than an immediately exploitable code path in the documented single-instance deployment.

Skipped or not fully provable locally:

- Live reverse-proxy topology, real client IP attribution, and NGINX public-page limiter application require a deployed URL and host config access.
- Full `npm run lint`, `npm run typecheck`, `npm run build`, and full `npm test` were not rerun because this was a read-only security review; targeted security gates/tests were run instead.
