# Cycle 14 Security Review

Reviewer: security-reviewer + tracer reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed commit: `14d31ea4`
Date: 2026-07-07
Mode: PROMPT 1 read-only review; the only write was this report.

## Scope And Inventory

I reviewed the repository for OWASP Top 10 exposure, secrets, auth/authz, CSRF/origin enforcement, rate limiting, upload and file serving behavior, privacy-sensitive fields, unsafe rendering and process execution, SQL/data access, dependency posture, causal tracing, race/TOCTOU paths, and competing deployment hypotheses.

Inventory built before detailed review:

- Admin/auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/admin-tokens.ts`.
- Server actions: every file under `apps/web/src/app/actions/`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Admin APIs: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Public APIs and routes: `apps/web/src/app/api/search/**`, `apps/web/src/app/api/og/**`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/uploads/**`, feeds, public share/photo/topic/map/timeline/smart-collection pages, and `apps/web/src/app/actions/public.ts`.
- Upload and file handling: `apps/web/src/lib/process-image.ts`, `gps-exif-strip.ts`, `upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `serve-upload.ts`, `storage/local.ts`, `process-topic-image.ts`, `og-photo-fetch.ts`.
- Data/privacy/SQL: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, `sql-restore-scan.ts`, `db-restore.ts`, `csv-escape.ts`, `sanitize.ts`, `validation.ts`, and `apps/web/src/db/**`.
- Rate limits and topology: `apps/web/src/lib/rate-limit.ts`, `auth-rate-limit.ts`, `bounded-map.ts`, `single-writer-guard.ts`, `upload-tracker*.ts`, `background-db-writes.ts`, `view-retention.ts`, `CLAUDE.md`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`.
- Config/dependencies/secrets: `package.json`, `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/src/lib/content-security-policy.ts`, env examples, deploy and migration scripts.

I enumerated 164 review-relevant TS/TSX/JS/MJS files under `apps/web/src/app/actions`, `apps/web/src/app/api`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, and `scripts`, then examined the security-relevant files and cross-file interactions. I did not intentionally skip any production security surface in that inventory. Tests and historical `.context/reviews/**` files were used only as supporting evidence, not as proof of runtime behavior.

## Findings

### Confirmed Issues

No confirmed exploitable code vulnerability was found in this pass.

### Likely Issues

No likely code issue was found that I would classify as a repository fix in PROMPT 1.

### Risks Needing Manual Validation

#### C14-SEC-01: Multi-instance operation remains warn-only while several controls are process-local

Status: Risk needing manual validation; not confirmed in the documented single-instance deployment
Severity: Medium
Confidence: Medium

Evidence:

- `apps/web/src/lib/single-writer-guard.ts:6-16` states that two live web processes sharing one MySQL database break restore mutation fencing, upload quota tracking, and rate-limit fast paths, and that the guard cannot enforce single-instance operation.
- `apps/web/src/lib/single-writer-guard.ts:218-235` emits a loud topology error when another holder is detected, but explicitly says startup continues.
- `apps/web/src/lib/rate-limit.ts:87-110` keeps OG/share/feed public rate-limit maps in process memory.
- `apps/web/src/lib/rate-limit.ts:393-429` keeps semantic-search rate limiting in process memory.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota state on `globalThis`.
- `apps/web/src/app/actions/images.ts:216-269` relies on that process-local upload tracker for the synchronous quota claim.
- `apps/web/src/lib/data.ts:13-63` buffers shared-group view-count increments in process memory.

Problem:

The code is internally consistent for the documented single-web-instance topology, but the enforcement mechanism is advisory. If production ever runs more than one web process against the same database, some controls become per-process rather than global. This is not a current code exploit unless deployment violates the topology, but the guard itself does not fail closed.

Concrete failure scenario:

An operator starts a second container during a manual restart, blue/green test, or attempted scale-out. The second process logs the singleton warning and continues serving traffic. An attacker can multiply per-process OG/share/feed/semantic budgets by the number of instances, upload quota tracking can diverge per process, and restore/upload coordination assumptions can be weakened around process-local state. DB advisory locks mitigate some restore/backfill paths, but they do not make every listed control global.

Suggested fix:

Keep the current single-instance deployment unless and until the process-local controls are moved to a shared store. For production, either fail closed on persistent singleton-lock contention or promote the warning to a health/deploy failure. If multi-instance deployment is desired, move rate-limit, upload quota, view-count buffer, and restore/upload coordination state to DB/Redis-equivalent shared state before scaling out.

#### C14-SEC-02: Reverse-proxy IP attribution and public page throttling depend on live edge configuration

Status: Risk needing manual validation; deployment-dependent
Severity: Medium
Confidence: Medium

Evidence:

- `apps/web/src/lib/rate-limit.ts:175-205` trusts `X-Forwarded-For`/`X-Real-IP` only when `TRUST_PROXY=true`; otherwise all requests return the `"unknown"` bucket and production logs a warning.
- `apps/web/src/lib/rate-limit.ts:165-173` defaults `TRUSTED_PROXY_HOPS` to `1` when unset.
- `apps/web/src/lib/request-origin.ts:50-80` uses trusted forwarded protocol/host values only under the same proxy-trust gate and otherwise prefers `BASE_URL` or request `Origin`/`Referer`.
- `apps/web/src/lib/request-origin.ts:91-119` correctly fails same-origin checks closed when no trusted expected origin/source can be derived.

Problem:

The application has good spoofing protection by default, but correct per-client rate limits and same-origin reconstruction depend on live reverse-proxy settings that cannot be proven from repository code alone. If production has an upstream load balancer/CDN or a modified nginx chain, the default hop count and real-IP behavior must match reality.

Concrete failure scenario:

If a reverse proxy sends XFF/X-Real-IP but `TRUST_PROXY` is disabled, login and public API budgets collapse to the single `"unknown"` identity, allowing one abusive client to lock out other users or cause broad public-route throttling. If `TRUST_PROXY=true` but `TRUSTED_PROXY_HOPS` does not match the real chain, the selected client IP can be wrong; in the worst case an attacker-controlled XFF segment may become the bucket key, weakening per-IP budgets. If the edge public-page limiter is not installed for the live proxy, dynamic public SSR pages rely on external infrastructure rather than an app-layer limiter.

Suggested fix:

Run the repository's proxy-topology validation against the real public URL during deployment validation, and alert/fail when observed client-IP behavior does not match `TRUST_PROXY` and `TRUSTED_PROXY_HOPS`. Keep `BASE_URL` set in production so origin checks do not depend on forwarded host reconstruction. For any non-shipped CDN/LB/nginx topology, document and test the equivalent real-IP and public-page throttling behavior.

## Positive Security Evidence

Auth/session:

- `apps/web/src/app/actions/auth.ts:99-103` applies same-origin validation to login before credential processing.
- `apps/web/src/app/actions/auth.ts:130-143` pre-increments login IP/account rate limits before password verification.
- `apps/web/src/app/actions/auth.ts:147-184` uses dummy Argon2 work for missing users and avoids user-enumerating login responses.
- `apps/web/src/app/actions/auth.ts:219-246` rotates session tokens through DB transaction and secure cookie flags.
- `apps/web/src/app/actions/auth.ts:297-465` applies same-origin, auth, rate-limit, password verification, password hashing, and session rotation for password changes.
- `apps/web/src/lib/session.ts:16-36` requires a strong `SESSION_SECRET` in production and fails closed if it is absent/weak.
- `apps/web/src/lib/session.ts:82-151` uses random session tokens, HMAC storage, timing-safe digest comparison, max age checks, and DB session lookup.

Admin APIs and authorization:

- `apps/web/src/lib/api-auth.ts:72-111` authenticates scoped admin API tokens, rate-limits token auth attempts, and clears request-local token context after the wrapped handler.
- `apps/web/src/lib/api-auth.ts:114-142` requires same-origin before cookie-admin access and adds no-store/nosniff response headers.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` is wrapped in admin auth, validates backup filenames, enforces realpath containment, and streams through an open file descriptor.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-611` is wrapped in `withAdminAuth(... { allowTokenScope: 'lr:upload' })`, requires content length, bounds multipart parsing, applies upload tracker admission, checks disk space, strips GPS, and releases claims in `finally`.

CSRF/origin:

- `apps/web/src/lib/action-guards.ts:37-44` centralizes mutating action origin enforcement.
- `apps/web/src/lib/request-origin.ts:91-119` fails closed unless `Origin` or `Referer` matches the expected origin.
- `apps/web/src/proxy.ts:55-108` rejects malformed admin session cookies before rendering admin pages.
- `apps/web/src/proxy.ts:112-122` marks admin render responses with a service-worker bypass header.

Upload and file serving:

- `apps/web/src/app/actions/images.ts:129-147` gates uploads on same-origin, admin auth, and restore maintenance state.
- `apps/web/src/app/actions/images.ts:184-194` limits file count and sanitizes user filenames.
- `apps/web/src/app/actions/images.ts:198-292` takes the upload/processing contract lock, snapshots processing settings, preclaims quota synchronously, and rolls back on early failures.
- `apps/web/src/app/actions/images.ts:367-490` saves files, performs late maintenance checks, strips GPS, records privacy-sensitive originals/admin metadata in DB, and avoids public original exposure.
- `apps/web/src/lib/upload-paths.ts:28-57` keeps originals in a private upload root with `0700` directory mode.
- `apps/web/src/lib/upload-paths.ts:81-193` validates basenames, rejects symlinks, and enforces realpath containment before deleting originals.
- `apps/web/src/lib/serve-upload.ts:168-238` restricts served upload paths by directory, extension, basename, lstat, realpath containment, and content type.
- `apps/web/src/lib/serve-upload.ts:304-369` streams via an opened file descriptor and re-stats the descriptor before serving.

Restore, SQL, process execution:

- `apps/web/src/app/[locale]/admin/db-actions.ts:167-238` gates dumps on same-origin/admin auth, requires DB env configuration, uses a MySQL advisory lock, spawns `mysqldump` with argument arrays, and passes the password through a minimal environment.
- `apps/web/src/app/[locale]/admin/db-actions.ts:240-355` writes dumps to `0600` temp files, validates completeness, and atomically renames.
- `apps/web/src/app/[locale]/admin/db-actions.ts:405-648` uses restore/upload/backfill locks and durable maintenance state before restore.
- `apps/web/src/app/[locale]/admin/db-actions.ts:653-883` bounds restore size, validates dump header/trailer, scans for dangerous SQL, uses argument-array `mysql`, and runs post-restore migrations.
- `apps/web/src/lib/sql-restore-scan.ts:61-129` defines destructive SQL patterns and `apps/web/src/lib/sql-restore-scan.ts:235-277` rejects disallowed schema/write targets.
- `apps/web/src/lib/sanitize.ts:117-142` sanitizes stderr before surfacing process errors.

Public endpoints, rate limits, and privacy:

- `apps/web/src/app/actions/public.ts:47-130` applies public load-more/search rate-limit helpers before DB-heavy work.
- `apps/web/src/app/actions/public.ts:341-559` rate-limits public analytics/view mutations and performs bounded background writes.
- `apps/web/src/app/api/search/semantic/route.ts:107-245` requires same-origin, checks maintenance state, enforces content type/content length/body caps, and pre-increments semantic rate limits before embedding/vector work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-131` applies same-origin, maintenance, ID validation, and pre-incremented rate limiting before semantic work.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:100-110` rate-limits before DB lookup and rolls back only invalid IDs.
- `apps/web/src/app/api/og/route.tsx:80-107` validates topic input and rate-limits public OG generation.
- `apps/web/src/app/[locale]/s/[key]/page.tsx:39-111` avoids metadata-based key existence leaks and rate-limits share-key lookup.
- `apps/web/src/app/[locale]/g/[key]/page.tsx:44-119` avoids metadata-based key existence leaks and rate-limits group-key lookup.
- `apps/web/src/lib/data.ts:251-255` documents admin-only privacy fields.
- `apps/web/src/lib/data.ts:1553-1627` selects public search fields explicitly rather than returning admin/original/GPS fields.
- `apps/web/src/lib/data.ts:1741-1792` guards map/GPS exposure through dedicated public mapping logic.

Rendering and headers:

- `apps/web/src/lib/safe-json-ld.ts:14-19` serializes JSON-LD and escapes `<`, `>`, and line separators before `dangerouslySetInnerHTML` use.
- `apps/web/src/app/[locale]/p/[id]/page.tsx:272-284`, `apps/web/src/app/[locale]/page.tsx:214-229`, and `apps/web/src/app/[locale]/smart/[slug]/page.tsx:143-149` use the safe JSON-LD helper at script sinks.
- `apps/web/src/lib/content-security-policy.ts:48-176` builds a nonce-based production CSP with `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and `frame-ancestors 'none'`.
- `apps/web/next.config.ts:51-105` configures global security headers, API CSP, HSTS, referrer policy, permissions policy, and `X-Content-Type-Options`.

Secrets and dependencies:

- Secret-pattern scan of tracked files found no live private keys, OpenAI keys, GitHub tokens, AWS keys, Google API keys, or Slack tokens outside historical review-log pattern text.
- Local secret files `.env.deploy` and `apps/web/.env.local` exist but are untracked and mode `0600`; their contents were not printed into this report.
- `git ls-files` shows the tracked env files are examples only: `.env.deploy.example` and `apps/web/.env.local.example`.
- `npm audit --workspace=apps/web --audit-level=moderate` completed with `found 0 vulnerabilities`.
- `package.json:7-15` uses dependency overrides for `postcss` and nested `esbuild`; `apps/web/package.json:31-87` pins modern major versions for the runtime and dev dependency graph.

## Validation Commands Run

- `npm run lint:api-auth --workspace=apps/web`: passed; admin API exports were wrapped by `withAdminAuth(...)`.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating/expensive API routes were covered or explicitly exempted.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating non-auth server actions enforced same-origin or carried approved exemptions.
- `npm audit --workspace=apps/web --audit-level=moderate`: passed with zero reported vulnerabilities.
- Secret scans over tracked files: no live secret material found; local untracked env files were present with restrictive permissions.

## Final Sweep

- Dangerous rendering sinks were traced to `safeJsonLd`; no raw user-controlled HTML sink was found in the reviewed production paths.
- Filesystem serving/deletion paths were checked for basename, extension, lstat, symlink, and realpath containment behavior.
- Upload quota and restore/barrier paths were checked for preclaim/rollback/finally behavior and TOCTOU races.
- SQL restore scanning was reviewed against comments, literals, conditional comments, write targets, and app table allowlisting.
- Child-process use was reviewed for shell injection; reviewed paths use static executables with argument arrays and minimized environments.
- Public unauthenticated expensive routes were checked against route-level rate-limit gates and the repository lint rule.
- No code changes, CI/deploy edits, commits, pushes, deploys, container stops/removals, or production operations were performed.
