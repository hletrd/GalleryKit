# Security Reviewer - Cycle 22

Date: 2026-06-30
Requested HEAD reviewed: `ec7cd52883d4973e32f056324620154228190335`
Local HEAD at write time: `e072975c` (source/deploy surface unchanged from `ec7cd528`; intervening changes are review/docs artifacts)

Scope: whole-repository security review from OWASP Top 10, auth/authz, CSRF/same-origin, rate limiting, secrets, file upload, SSRF, path traversal, SQL/raw query, privacy leakage, and deployment security perspectives. Current OWASP Top 10 reference checked: <https://owasp.org/Top10/2025/>. This pass did not edit source code.

## Inventory

Repository and policy context:
- `AGENTS.md`
- `CLAUDE.md`
- `.gitignore`
- `.env.deploy.example`
- `package.json`
- `package-lock.json`
- `apps/web/package.json`
- `.context/reviews/security-reviewer.md` (previous cycle report, replaced by this review)

Auth, sessions, admin APIs, and CSRF/same-origin:
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- all files under `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- all route handlers under `apps/web/src/app/api/**/route.ts(x)`

Uploads, file access, SSRF-adjacent fetches, and storage:
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/validation.ts`

Public routes, public actions, rate limits, privacy, and data exposure:
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/next.config.ts`

Backup, restore, migrations, raw SQL, and deployment:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/.env.local.example`

Broad repository sweeps:
- Source inventory: 512 files under `apps/web/src`; 77 files under `apps/web/src/app`; 6729 repository files excluding `.git`, `node_modules`, and `.next`.
- Searched for raw SQL and manual query construction, command execution, dynamic code execution, `dangerouslySetInnerHTML`, fetch/redirect/URL construction, filesystem path joins, upload serving, cookie/session handling, auth wrappers, origin checks, rate-limit rollback paths, forwarded-header trust, CSP/security headers, and secret-like strings.
- Secrets sweep excluded generated dependency/build directories and found only placeholders, tests, previous review text, and documentation references; no active hardcoded production secret was found.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 3

I found no confirmed high- or medium-severity application vulnerability in auth/authz, CSRF, rate limiting, upload/path traversal, SSRF, SQL injection, privacy filtering, or backup/restore flows. The findings below are deployment and supply-chain hardening risks.

## Findings

### SEC22-01 - Docker image and apt inputs are mutable rather than digest/version pinned

Severity: Low
Confidence: High
Status: Risk
Location: `apps/web/Dockerfile:1`, `apps/web/Dockerfile:4-8`, `apps/web/Dockerfile:10`, `apps/web/Dockerfile:13-16`

The production build uses mutable `node:24-slim` tags for both build and runtime stages and installs unversioned Debian packages (`python3`, `make`, `g++`, `gosu`, `mariadb-client`) during image build. JavaScript dependencies are locked, but the OS and base-image layer can change between two builds of the same git commit.

Concrete scenario: if the upstream `node:24-slim` tag is retargeted, a compromised mirror serves a malicious package, or a new OS package release changes runtime behavior, a deployment from reviewed source can produce an unreviewed container. This does not require an application bug and is most relevant to supply-chain integrity, incident reproducibility, and rollback forensics.

Suggested fix: pin base images by digest, for example `node:24-slim@sha256:<digest>`, and refresh digests through a controlled dependency-update workflow. For stronger reproducibility, build from a periodically refreshed internal base image or pin apt package versions/snapshots, and generate SBOM/provenance metadata for deployed images.

### SEC22-02 - Deploy helper executes shell from a trusted but unchecked env file

Severity: Low
Confidence: Medium
Status: Risk
Location: `scripts/deploy-remote.sh:61-72`; related default command builder at `scripts/deploy-remote.sh:31-52`

The deploy wrapper sources a gitignored env file and then executes `DEPLOY_CMD` through `bash -lc "$deploy_cmd"`. The default derived SSH command is shell-quoted for `DEPLOY_PATH`, but the custom `DEPLOY_CMD` escape hatch intentionally allows arbitrary local shell execution from the env file.

Concrete scenario: if `.env.deploy`, `$HOME/.gallerykit-secrets/gallery-deploy.env`, or a caller-supplied `DEPLOY_ENV_FILE` is group/world writable, accidentally edited with untrusted content, or replaced on a developer machine, running the helper executes arbitrary local commands before or instead of deployment. The current code treats the env file as trusted operator configuration, so this is not a remote unauthenticated vulnerability.

Suggested fix: before sourcing the env file, reject files not owned by the current user or files with group/world write bits. Prefer the structured SSH command path over `DEPLOY_CMD`, or restrict `DEPLOY_CMD` to an explicitly named opt-in mode. Document the required `0600` permissions next to `.env.deploy.example`.

### SEC22-03 - Nginx template is unsafe if exposed as the public HTTP edge

Severity: Low
Confidence: Medium
Status: Risk
Location: `apps/web/nginx/default.conf:21-29`, `apps/web/nginx/default.conf:48-54`

The nginx template listens on cleartext port 80 and explicitly documents that it must sit behind a TLS-terminating edge. It also sends HSTS on that listener. HSTS is only honored over HTTPS, so if this template is accidentally exposed directly as the public edge, it will not force HTTPS and public traffic can be served over cleartext.

Concrete scenario: an operator copies the container/nginx template to a host without the intended upstream TLS terminator. Public pages and non-authenticated routes are available over HTTP. Secure admin cookies reduce credential exposure for login/session flows, but cleartext public traffic and request metadata remain exposed, and the HSTS header on HTTP does not repair that deployment mistake.

Suggested fix: either split the template into a private-behind-edge config and a public-edge config, or add a public-edge 443 server block plus a port-80 redirect-only block. Keep HSTS only on the HTTPS server. If this file must remain edge-internal, add deployment validation that fails when the nginx listener is exposed outside localhost/private network paths.

## Positive Security Evidence / Non-Findings

Auth/authz:
- Admin API authorization is centralized in `apps/web/src/lib/api-auth.ts:58-144`. Token requests are scoped and rate-limited before handler execution, cookie requests require same-origin at `apps/web/src/lib/api-auth.ts:114-121`, and successful admin responses receive no-store/nosniff defaults at `apps/web/src/lib/api-auth.ts:130-142`.
- Session handling in `apps/web/src/lib/session.ts:16-36` and `apps/web/src/lib/session.ts:82-150` requires a strong production `SESSION_SECRET`, signs tokens with HMAC-SHA256, compares signatures with `timingSafeEqual`, stores only token hashes, and applies expiry cleanup.
- Login/password-change flows in `apps/web/src/app/actions/auth.ts:80-445` use Argon2 verification, dummy-hash timing equalization, auth rate limiting with rollback/reset, same-origin checks, secure cookie attributes, and session rotation after password change.
- PAT verification in `apps/web/src/lib/admin-tokens.ts:1-242` enforces token format, SHA-256 storage, scope normalization, expiry, and parameterized lookup/update paths. Lightroom token actions in `apps/web/src/app/actions/lr-tokens.ts:1-141` are same-origin admin-only.

CSRF and same-origin:
- Same-origin enforcement fails closed by default in `apps/web/src/lib/request-origin.ts:79-107`. Expected-origin construction uses trusted forwarded host/proto only when proxy trust is enabled at `apps/web/src/lib/request-origin.ts:45-68`.
- Mutating server actions reviewed call `requireSameOriginAdmin()` near entry, including image upload/delete/update paths in `apps/web/src/app/actions/images.ts:114-125`, DB export/dump/restore paths in `apps/web/src/app/[locale]/admin/db-actions.ts:79-88`, `apps/web/src/app/[locale]/admin/db-actions.ts:162-171`, and `apps/web/src/app/[locale]/admin/db-actions.ts:448-457`.
- `npm run lint:action-origin --workspace=apps/web` passed and confirmed no scanned mutating server action is missing the same-origin return-early guard or an explicit exemption.

Rate limiting and proxy trust:
- Client IP extraction avoids spoofable proxy headers unless `TRUST_PROXY=true`, validates forwarded entries, and selects the client before the trusted proxy suffix in `apps/web/src/lib/rate-limit.ts:164-195`.
- Auth-specific rate limiting is separated in `apps/web/src/lib/auth-rate-limit.ts:1-146`, with reset/rollback paths used by login code.
- Public expensive endpoints are pre-increment rate limited, including semantic search at `apps/web/src/app/api/search/semantic/route.ts:41-119`, similar search at `apps/web/src/app/api/search/similar/[id]/route.ts:59-125`, public actions in `apps/web/src/app/actions/public.ts:23-460`, and OG topic rendering in `apps/web/src/app/api/og/route.tsx:61-103`.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Upload, file serving, path traversal, and image processing:
- Browser upload handling in `apps/web/src/app/actions/images.ts:114-293` requires same-origin admin auth, validates topic/tag input, caps file count/bytes, sanitizes filenames, pre-claims cumulative upload quota before awaited work, checks disk space, and rolls back reservations on failure.
- Per-file processing in `apps/web/src/app/actions/images.ts:340-563` uses UUID-based storage names, topic existence checks, restore-maintenance checks, GPS stripping, HDR policy gates, DB insertion, derivative job enqueueing, and cleanup on partial failures.
- Lightroom upload handling in `apps/web/src/app/api/admin/lr/upload/route.ts:68-186` is behind `withAdminAuth` with the `lr:upload` token scope, rejects chunked uploads, requires safe `Content-Length`, enforces cumulative quota, and sanitizes user filenames. It then verifies topic existence and lock invariants at `apps/web/src/app/api/admin/lr/upload/route.ts:225-259`.
- Private originals path handling in `apps/web/src/lib/upload-paths.ts:1-183` rejects unsafe filenames, avoids legacy public originals, validates realpath containment, and rejects symlinked originals.
- Public derivative serving in `apps/web/src/lib/serve-upload.ts:1-313` allowlists derivative directories and extensions, rejects unsafe path segments, checks realpath containment and symlinks, maps content types explicitly, and supports HEAD/ETag without exposing originals.
- `apps/web/src/app/uploads/[...path]/route.ts:1-28` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-25` delegate to the shared safe serving helper.
- Image ingest in `apps/web/src/lib/process-image.ts:352-418` applies pixel and extension caps, and `apps/web/src/lib/process-image.ts:887-1037` writes originals with UUID filenames, `0600` mode, Sharp input limits, metadata validation, and cleanup on errors.

SSRF and URL handling:
- Photo OG rendering fetches only from the configured internal/base URL contract and does not derive the backend target from attacker-controlled request origin: see `apps/web/src/app/api/og/photo/[id]/route.tsx:111-206`.
- Topic OG rendering validates topic/tag inputs and bounds tag parsing at `apps/web/src/app/api/og/route.tsx:36-117`.
- `apps/web/src/lib/content-security-policy.ts:1-123` validates configured image base URLs and emits restrictive CSP including `object-src 'none'` and `frame-ancestors 'self'`.

SQL/raw query and restore safety:
- Smart collection query construction is AST/allowlist based in `apps/web/src/lib/smart-collections.ts:1-340`; collection mutations in `apps/web/src/app/actions/collections.ts:1-139` are admin/same-origin guarded.
- Backup download is admin-only and validates backup filename/path containment before streaming in `apps/web/src/app/api/admin/db/download/route.ts:1-109`.
- Backup creation in `apps/web/src/app/[locale]/admin/db-actions.ts:162-354` requires same-origin admin auth, owner-only backup directory creation, env-based MySQL credentials, TLS argument validation, lock awareness, process watchdogs, stderr redaction, and post-dump header verification.
- Restore import in `apps/web/src/app/[locale]/admin/db-actions.ts:448-745` enforces admin/same-origin auth, advisory restore locking, maintenance mode, queue quiescing, size caps, temp file mode `0600`, plausible dump headers, chunked dangerous-SQL scanning, `mysql --one-database`, TLS args, watchdog cleanup, stderr redaction, and post-restore migrations.
- Dangerous restore SQL patterns are blocked in `apps/web/src/lib/sql-restore-scan.ts:1-168`, including user/privilege changes, database drops, file IO, routines/triggers/views/events, dynamic SQL, global variables, and other out-of-contract statements.

Privacy and data exposure:
- Public field selection omits sensitive/admin-only fields in `apps/web/src/lib/data.ts:368-408`; compile-time and fixture guards cover sensitive keys at `apps/web/src/lib/data.ts:459-489`.
- Public feed/list/detail paths use public selectors, including `apps/web/src/lib/data.ts:785-854`, `apps/web/src/lib/data.ts:1024-1048`, and shared-group selection in `apps/web/src/lib/data.ts:1247-1291`.
- GPS-bearing map data is isolated to the map-visible selector in `apps/web/src/lib/data.ts:410-445` and guarded at runtime in `apps/web/src/lib/data.ts:1660-1697`.
- Semantic/similar enrichment uses a separate public projection with sensitive-key type guards in `apps/web/src/lib/search-enrichment-fields.ts:1-47`.
- Public share pages use generic metadata and rate-limited key lookup in `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:1-142` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:1-240`.

Deployment security:
- `apps/web/next.config.ts:1-109` disables powered-by headers, applies security headers, constrains server action body size, and limits image remote/local patterns.
- `apps/web/nginx/default.conf:1-202` adds connection/request limits, overwrites forwarded IP headers instead of appending user-controlled chains, applies upload/restore body caps by route, denies `/uploads/original/`, and uses a tighter CSP for static derivatives.
- `apps/web/docker-compose.yml:1-28` binds the app to `HOSTNAME=127.0.0.1`, sets `TRUST_PROXY=true` for the nginx edge path, and mounts persistence explicitly.
- `apps/web/scripts/entrypoint.sh:1-42` fixes runtime ownership and drops to the `node` user through `gosu`.
- `apps/web/deploy.sh:55-58` prunes Docker objects only after `docker compose up -d`; the volume prune is non-`-a`, preserving the documented persistence model.

## Validation Evidence

- `git diff --stat ec7cd528..HEAD -- apps/web scripts package.json package-lock.json CLAUDE.md AGENTS.md .env.deploy.example`: no output; source/deploy files reviewed are unchanged from the requested HEAD.
- `npm run lint:api-auth --workspace=apps/web`: passed; admin API route exports are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating server actions return early on `requireSameOriginAdmin()` or carry an explicit exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating route scan found no missing pre-increment helper.
- `npm audit --workspace=apps/web --omit=dev --audit-level=low`: passed; 0 production vulnerabilities.
- `npm audit --workspace=apps/web --audit-level=low`: passed; 0 vulnerabilities across production and development dependencies.
- `npm test --workspace=apps/web -- tracked-secrets privacy-fields rate-limit request-origin nginx-config og-route-source-contracts og-photo-fallback load-more-rate-limit semantic-search-route similar-route backup-download-route`: passed; 20 files, 220 tests.
- Secret-pattern sweep across the repository, excluding `.git`, `.next`, `node_modules`, package lock bulk output, binaries, and media fixtures: no active hardcoded production secret found.

## Final Sweep / Skipped Files

Final sweep covered route/action inventory, public unauthenticated endpoints, admin auth wrappers, same-origin gates, IP trust and rate-limit paths, file upload and derivative serving, OG/semantic URL handling, raw SQL and child-process surfaces, backup/restore flows, privacy projections, JSON-LD/CSP sinks, dependency audit output, secret patterns, nginx forwarding/body limits, Docker runtime assumptions, and deploy scripts.

Skipped from manual line-by-line review: generated/dependency/build artifacts (`node_modules`, `.next`, `.git`), binary/media/font/image fixtures, historical `.context/reviews/**` and `.context/plans/**` archives other than the prior security report context, and full lockfile line-by-line inspection. Those areas were covered only by targeted inventory, secret grep/audit, dependency audit, and source reference checks where applicable. I did not skip any active security-relevant source route, server action, auth/session module, upload/path module, database restore/download module, or deployment script identified in the inventory.
