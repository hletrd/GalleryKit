# Cycle 15 Security Review

Reviewer: security-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-07
Mode: review-only; the only intended write is this report. Existing edits in other review files were left untouched.

## Required Instructions Read

- `AGENTS.md`
- `CLAUDE.md` security, privacy, auth, deploy, runtime-topology, upload, backup/restore, and operational sections
- `.context/reviews/prompts/common_review_scope.md`
- `.context/reviews/prompts/security-reviewer.md`

## Inventory Built First

Review-relevant inventory was built before detailed analysis. I examined the listed production security surface and the cross-file interactions between it:

- Auth/session/origin/rate limit: `apps/web/src/proxy.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/pending-session-revocations.ts`.
- All server actions: every file in `apps/web/src/app/actions/`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- All route handlers: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- Public/share surfaces: public photo/topic/home/map/timeline/smart-collection pages, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`.
- Upload/file/image surfaces: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/download-filename.ts`.
- Data/privacy/SQL/restore: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/src/lib/db-child-watchdog.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/advisory-lock*.ts`, `apps/web/src/db/**`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`.
- Rendering/headers/config/deploy/secrets/dependencies: `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/next.config.ts`, `apps/web/public/sw.js`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `.env.deploy.example`, `apps/web/.env.local.example`, package manifests and lockfile.
- Supporting tests/lints reviewed as evidence, not trusted as substitutes for code review: auth/origin/rate-limit/privacy/upload/restore/download lint and test files under `apps/web/src/__tests__/` plus `apps/web/scripts/check-*.ts`.

I explicitly checked the complete route-handler list and complete server-action list. No relevant file in the inventory above was skipped.

## Confirmed Issues

None found.

## Likely Issues

None found.

## Risks Requiring Manual Validation

### C15-SEC-RISK-01: Live proxy topology must match the app's IP and origin trust model

Status: Risk requiring manual validation; not a confirmed repository-code defect
Severity: Medium
Confidence: Medium

Evidence:

- `apps/web/src/lib/rate-limit.ts:165-205` defaults trusted proxy hops to one, trusts `X-Forwarded-For` only when `TRUST_PROXY=true`, and otherwise collapses rate-limit identity to `"unknown"`.
- `apps/web/src/lib/request-origin.ts:47-68` prefers `BASE_URL` / production `siteConfig.url` as the same-origin anchor, while `apps/web/src/lib/request-origin.ts:71-107` uses forwarded proto/host only under the proxy-trust gate.
- `apps/web/src/lib/request-origin.ts:126-145` fails closed unless `Origin` or `Referer` matches the expected origin.
- `apps/web/nginx/default.conf:20-29` documents that nginx `$binary_remote_addr` limiters need real-IP configuration in an LB-fronted topology.
- `apps/web/nginx/default.conf:59-71` documents the `X-Forwarded-For` topology contract, and `apps/web/nginx/default.conf:290-294` states the host nginx config is manually applied, not changed by app deploys.
- `CLAUDE.md:740-742` documents that the shipped compose deployment enables `TRUST_PROXY=true` and that omitting it behind a proxy degrades rate limiting.

Why this matters:

The code prevents simple client spoofing by refusing proxy headers unless explicitly trusted, but correct per-client rate limiting and origin reconstruction depend on the live reverse proxy chain matching the repository assumptions. That cannot be fully proven from source alone.

Concrete failure scenario:

Production is moved behind a CDN/load balancer, but nginx still overwrites `X-Forwarded-For` with its own `$remote_addr` or the app keeps the wrong `TRUSTED_PROXY_HOPS`. Login/share/OG/semantic budgets then key on the proxy, on `"unknown"`, or on the wrong XFF segment. One abusive client can cause broad throttling for legitimate users, or a spoofable segment can weaken per-IP budgets. If the live edge lacks the nginx public-page limiter, dynamic SSR pages do not have an equivalent app-layer page limiter.

Suggested fix:

Validate the live public URL against the intended proxy topology after any edge/CDN/LB change. Keep `BASE_URL` configured in production, set `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS` to the actual trusted suffix length, and ensure the active nginx/CDN config has equivalent real-IP handling, body limits, and public-page throttles. Promote proxy-topology drift to deploy/health failure if this app is operated by multiple people.

### C15-SEC-RISK-02: Plaintext SQL backups rely on host/storage controls

Status: Risk requiring manual validation; documented operator boundary
Severity: Medium
Confidence: Medium

Evidence:

- `CLAUDE.md:223-228` states backups are non-public but plaintext SQL at rest and that host/storage encryption is the operator boundary.
- `apps/web/src/app/[locale]/admin/db-actions.ts:128-164` gates dump creation on maintenance, same-origin, admin auth, DB env presence, and creates `data/backups` with mode `0700`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:186-201` spawns `mysqldump` with argument arrays and writes a temporary dump with mode `0600`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:260-317` checks non-empty/header/trailer completeness and atomically renames only after validation.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` wraps download in admin auth, validates filename, enforces realpath containment, and serves with `no-store`/`nosniff`.

Why this matters:

The web path is well guarded, but SQL dumps contain full database contents, including session/token tables, admin password hashes, image metadata, share keys, settings, audit data, and private operational history. The repository intentionally leaves at-rest protection to the host.

Concrete failure scenario:

A host backup/sync job, local user account, support bundle, or misconfigured bind mount can read `data/backups/*.sql` outside the application. Even without a web vulnerability, the dump can expose share links, admin hashes/tokens, audit history, and private metadata. The app's route-level auth does not protect against host-level readers.

Suggested fix:

Validate production filesystem ownership, mount permissions, host backup targets, and retention for `apps/web/data/backups`. Encrypt backups or move them into an encrypted host backup pipeline if the host has other users, cloud sync, support collection, or untrusted backup operators. Treat downloaded SQL dumps as secrets and rotate sessions/tokens after any suspected exposure.

### C15-SEC-RISK-03: Single-instance assumptions are advisory, not enforced

Status: Risk requiring manual validation; not exploitable in the documented single-web-instance deployment
Severity: Medium
Confidence: Medium

Evidence:

- `CLAUDE.md:244-247` documents a single web-instance/single-writer topology and identifies process-local restore, upload quota, image queue, and rate-limit state.
- `apps/web/src/lib/single-writer-guard.ts:6-16` states that two live processes sharing one DB break restore mutation fencing, upload quota tracking, and several rate-limit fast paths, and that the guard cannot enforce single-instance operation.
- `apps/web/src/lib/single-writer-guard.ts:218-235` emits a loud warning when another instance is detected but explicitly continues startup.
- `apps/web/src/lib/rate-limit.ts:288-429` keeps OG/share/feed/semantic fast-path rate-limit maps in process memory.
- `apps/web/src/lib/upload-paths.ts:49-57` protects private original upload storage locally, while `apps/web/src/lib/upload-tracker-state.ts` and upload actions coordinate quota in-process rather than through a shared store.

Why this matters:

The current deployment contract is internally coherent, but the singleton guard is warn-only. Running more than one web process against the same database changes security behavior because several protections are per-process.

Concrete failure scenario:

An operator starts a second container during a manual restart, blue/green test, or attempted scale-out. The new process logs the singleton warning and still serves traffic. Attackers can multiply in-memory OG/share/feed/semantic budgets by the number of instances, upload quota tracking can diverge, and restore/upload coordination assumptions around process-local state become weaker.

Suggested fix:

Keep production single-instance unless these controls are moved to shared storage. If accidental multi-instance is a realistic operational failure mode, make persistent singleton-lock contention fail startup or fail health checks instead of warning only. For intentional scale-out, move rate-limit fast paths, upload quota/admission, background queues, and restore-maintenance coordination to DB/Redis-equivalent shared state.

## Positive Security Evidence

Auth and admin authorization:

- `apps/web/src/lib/api-auth.ts:58-145` covers token-scoped admin API access, token-auth rate limiting, cookie-admin same-origin checks, admin auth, and default no-store/nosniff headers.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` is auth-wrapped and protects backup download path traversal via filename validation plus realpath containment.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-611` is auth-wrapped with `lr:upload` token scope support and validates size, multipart shape, upload admission, disk space, GPS stripping, cleanup, and audit behavior.
- `apps/web/src/app/actions/auth.ts` applies same-origin before credential work, rate-limits login, uses dummy Argon2 work for missing users, rotates sessions on password change, and sets httpOnly/secure/sameSite cookies.

CSRF/origin and route coverage:

- `apps/web/src/lib/action-guards.ts:37-44` centralizes same-origin checks for mutating server actions.
- `apps/web/src/lib/request-origin.ts:126-145` fails closed when no trusted expected origin/source match exists.
- `apps/web/src/proxy.ts` guards admin page rendering, while API routes self-authenticate rather than relying on middleware.
- `npm run lint:api-auth --workspace=apps/web` passed for both admin API routes.
- `npm run lint:action-origin --workspace=apps/web` passed for all mutating server actions and approved exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed for public mutating/expensive route handlers.

Public routes, sharing, and privacy:

- `apps/web/src/app/actions/public.ts` applies public load-more/search/view-record rate limits before expensive or mutating work.
- `apps/web/src/app/api/search/semantic/route.ts` and `apps/web/src/app/api/search/similar/[id]/route.ts` require same-origin, maintenance checks, bounded input, and pre-increment semantic rate limits before embedding/vector work.
- `apps/web/src/app/api/og/route.tsx` and `apps/web/src/app/api/og/photo/[id]/route.tsx` pre-increment OG rate limits before DB or image work.
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` avoid metadata-time key existence lookups and rate-limit actual share-key resolution.
- `apps/web/src/lib/data.ts:368-407` derives public image fields by omitting GPS, original filenames, user filenames, processing internals, and admin-only fields.
- `apps/web/src/lib/data.ts:409-444` isolates map GPS fields into a dedicated map select, and `apps/web/src/lib/data.ts:1777-1805` filters map output to `topics.map_visible=true`.
- `apps/web/src/lib/data.ts:1249-1316` and `apps/web/src/lib/data.ts:1322-1413` validate share keys and use public field sets for unauthenticated share lookups.
- `apps/web/src/lib/data.ts:1553-1627` keeps public search results on an explicit privacy-guarded field set.

Upload, file serving, SSRF, and rendering:

- `apps/web/src/lib/upload-paths.ts:27-57` stores originals outside the public upload root with owner-only directory mode.
- `apps/web/src/lib/serve-upload.ts:168-238` allows only derivative directories/extensions, rejects unsafe segments, rejects symlinks, and enforces realpath containment.
- `apps/web/src/lib/serve-upload.ts:304-369` opens and stats the served file descriptor before streaming, reducing rename/TOCTOU races.
- `apps/web/src/lib/process-image.ts` uses UUID disk names, file-size and Sharp pixel limits, private originals, derivative-only public output, atomic writes, and fail-closed GPS stripping behavior.
- `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/image-url.ts`, and `apps/web/src/lib/seo-og-url.ts` pin OG/internal image fetches and redirects to canonical same-origin URLs instead of request-derived hosts.
- `apps/web/src/lib/safe-json-ld.ts` escapes JSON-LD script sinks, and `apps/web/src/lib/content-security-policy.ts` builds a nonce-based production CSP with `object-src 'none'`.

Backup, restore, process execution, and SQL:

- `apps/web/src/app/[locale]/admin/db-actions.ts:369-540` gates restore with same-origin/admin auth, advisory locks, durable restore maintenance, upload/backfill locks, and foreground/background write drains.
- `apps/web/src/app/[locale]/admin/db-actions.ts:650-830` validates restore headers/trailers, scans chunks before import, uses `mysql --one-database`, argument-array spawns, minimal env, sanitized stderr, and post-restore migrations.
- `apps/web/src/lib/sql-restore-scan.ts:61-129` blocks dangerous SQL primitives, and `apps/web/src/lib/sql-restore-scan.ts:235-277` rejects schema-qualified or non-app write targets.
- Child process paths reviewed for shell injection use static executables and argument arrays rather than shell command strings.

Secrets, dependencies, and local environment:

- Tracked env files are examples only: `.env.deploy.example` and `apps/web/.env.local.example`.
- Real local `.env.deploy` and `apps/web/.env.local` were present, untracked/ignored, and mode `0600`; contents were not printed.
- `apps/web/deploy.sh` refuses group/world-readable runtime secret files.
- `npm audit --workspace=apps/web --audit-level=moderate` returned `found 0 vulnerabilities`.

## Validation Commands Run

- `rg` route/action/file-surface sweeps over `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, and `scripts`.
- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/auth-rate-limit-ordering.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts`: 9 files passed, 289 tests passed.
- `npm audit --workspace=apps/web --audit-level=moderate`: passed with zero reported vulnerabilities.

## Final Sweep

- OWASP Top 10 classes were checked across auth, authorization, input validation, SSRF, path traversal, uploads, unsafe rendering, secrets, logging, dependency posture, and security misconfiguration.
- Admin API routes, public route handlers, server actions, public share routes, upload serving, DB backup/restore, settings/SEO/topics/tags/users/tokens/sharing actions, and deployment docs/config were cross-checked against each other.
- Tests, comments, and docs were not treated as authoritative; behavior was validated from code first, then supported by lint/test evidence.
- No relevant file in the inventory was skipped.
- No code, deploy, commit, push, production, container, database, DNS, or external communication action was performed.
