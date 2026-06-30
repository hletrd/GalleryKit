# Security Reviewer - Cycle 25

Review date: 2026-06-30
Reviewed HEAD: `4cb1258ba0b2cca689846a85423264edc2d96b90`
Role: cycle-25 security-reviewer
Scope: whole-repo security review for OWASP Top 10, auth/authz, CSRF/same-origin, public route rate limiting, secret handling, upload/download privacy, backup/restore, Docker/deploy, SSRF/path traversal/XSS/SQL injection.

User constraint: do not commit or push. I only wrote this report.

## Inventory First

I read `AGENTS.md` and `CLAUDE.md` first, then built the active source inventory before judging issues.

Tracked inventory observed:

- Total tracked files: 2585.
- Active app route tree: 77 tracked files under `apps/web/src/app`.
- Active shared security/data library tree: 97 tracked files under `apps/web/src/lib`.
- Route handlers found in active source:
  - `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
  - `apps/web/src/app/api/health/route.ts`
  - `apps/web/src/app/api/live/route.ts`
  - `apps/web/src/app/api/og/photo/[id]/route.tsx`
  - `apps/web/src/app/api/og/route.tsx`
  - `apps/web/src/app/api/search/semantic/route.ts`
  - `apps/web/src/app/api/search/similar/[id]/route.ts`
  - `apps/web/src/app/feed.xml/route.ts`
  - `apps/web/src/app/uploads/[...path]/route.ts`

Security-relevant source/docs/scripts inspected:

- Auth/session/admin API: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, admin action files.
- Public routes/actions/rate limits: public pages, share pages, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/rate-limit.ts`, semantic/similar/OG API routes.
- Upload/download/privacy: upload route handlers, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, public data field allowlists, GPS/EXIF stripping and tests.
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, SQL restore scanner, MySQL CLI SSL helper, migration scripts.
- XSS/CSP/SSRF/SQLi: CSP builder, JSON-LD helper, OG image routes/fetch helper, smart collections, Drizzle data access, raw SQL call sites, process spawn call sites.
- Deploy/runtime/secrets: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`, env examples, ignore rules, package manifests.
- Tests/lint scripts relevant to security contracts, including auth/origin/rate-limit/privacy/upload/restore/secret scans.

Skipped by design:

- I did not read secret values. I only verified metadata/ignore posture for `.env.deploy` and `apps/web/.env.local`.
- I did not manually inspect `node_modules`, `.git`, generated build output, binary media/font fixtures, or every historical `.context/**` review artifact as active app code.
- I used `npm audit` and manifest/Docker review for dependency risk instead of manually reviewing every lockfile entry.

No active app route/action/auth/upload/restore/deploy surface in the inventory above was intentionally skipped.

## Findings Summary

- Critical: 0
- High: 0 confirmed
- Medium: 0 confirmed, 1 high-impact deployment assumption requiring validation
- Low: 6 confirmed or accepted residual risks

I did not find a confirmed auth bypass, CSRF/same-origin bypass, SSRF reachable from user-controlled request origin, upload/download path traversal, public original-file exposure, SQL injection, unsafe restore primitive, committed active secret, privacy-field leak, or missing mutating public-route rate limit in current HEAD.

## Findings

### SEC25-01 - Raw auth exception messages are logged on sensitive auth paths

Severity: Low
Confidence: Medium
Location: `apps/web/src/app/actions/auth.ts:246-248`, `apps/web/src/app/actions/auth.ts:430-439`

Scenario:

Login and password-change catch blocks log `e.message` for unexpected errors. An attacker cannot read these responses directly, but the raw driver/framework error text can enter centralized logs. Depending on the thrown error, that may disclose DB host/user/database names, SQL fragments, connection failures, or other operational metadata. Backup/restore stderr has dedicated sanitization, but these auth logs do not.

Suggested fix:

Log structured event codes on auth paths and avoid raw driver messages. If detail is operationally needed, pass it through a shared sanitizer that redacts configured DB host/user/name and secret-like substrings before logging.

### SEC25-02 - Container runtime lacks defense-in-depth hardening

Severity: Low
Confidence: High
Location: `apps/web/docker-compose.yml:12-28`, `apps/web/scripts/entrypoint.sh:4-25`, `apps/web/scripts/entrypoint.sh:41-42`, `apps/web/Dockerfile:147-157`

Scenario:

The container starts through an entrypoint that recursively `chown`s bind-mounted data/uploads/resources and `.next`, then drops to `node`. Compose does not set `read_only`, `cap_drop`, `security_opt: no-new-privileges`, `pids_limit`, or memory/CPU limits. If a Next.js, image-processing, or dependency RCE is found later, the attacker gets a broader writable/persistence surface and fewer container boundaries than necessary. Writable bind mounts are required for this app, but the root filesystem and Linux capabilities do not all need to remain broad.

Suggested fix:

Move ownership repair to a one-time deploy/init step where possible, or narrow it to expected directories only. Add Compose hardening: `read_only: true` with explicit writable `tmpfs`/cache paths, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, `pids_limit`, and memory/CPU limits. Keep only the bind mounts that are required by the documented persistence model.

### SEC25-03 - Bundled nginx config depends on external TLS termination

Severity: Medium if misdeployed; not confirmed in repository state
Confidence: Medium
Location: `apps/web/nginx/default.conf:21-30`, `apps/web/nginx/default.conf:49-55`, `apps/web/nginx/default.conf:187-202`, `apps/web/docker-compose.yml:15-22`

Scenario:

The nginx config listens on port 80 and correctly comments that it is intended as an internal HTTP hop behind TLS termination. It also emits HSTS. If an operator exposes this file directly as the public edge, first-time visitors and admins can send login/session traffic over cleartext HTTP; HSTS on the port-80 response does not establish TLS for that first request.

Suggested fix:

Add a committed public-edge example with `listen 443 ssl` and a port-80 redirect, or add a deploy/startup assertion documenting/failing when this listener is used as the public edge without upstream TLS termination. At minimum, keep this config bound to a private interface or behind a verified TLS-terminating proxy/load balancer.

### SEC25-04 - Per-IP rate limiting is highly sensitive to proxy topology configuration

Severity: Low
Confidence: High
Location: `apps/web/src/lib/rate-limit.ts:164-195`, `apps/web/.env.local.example:54-67`, `apps/web/docker-compose.yml:20-22`, `apps/web/nginx/default.conf:67-71`

Scenario:

`getClientIp()` intentionally ignores proxy headers unless `TRUST_PROXY=true`; without it, all clients are keyed as `unknown`, so one attacker can burn shared login/search/OG buckets and cause global denial of service. The documented Docker/nginx deployment sets `TRUST_PROXY=true` and nginx overwrites `X-Forwarded-For`, which is the safe path. The failure mode appears when the app is run behind a proxy without setting `TRUST_PROXY`, or when `TRUST_PROXY=true` is used while the app is directly reachable and attackers can spoof forwarding headers.

Suggested fix:

Add an explicit production startup/health warning or failure mode when proxy headers are observed but `TRUST_PROXY` is unset. Document that `TRUST_PROXY=true` requires the app port to be private and reachable only through the trusted proxy. If multi-hop edges are used, prefer proxy real-IP normalization at nginx and keep `TRUSTED_PROXY_HOPS` pinned to the resulting topology.

### SEC25-05 - All admins are root admins with no capability separation

Severity: Low
Confidence: High
Location: `CLAUDE.md:5`, `CLAUDE.md:236`, `CLAUDE.md:568`, `apps/web/src/app/[locale]/admin/db-actions.ts:162-172`, `apps/web/src/app/[locale]/admin/db-actions.ts:363-370`, `apps/web/src/app/actions/admin-users.ts:77-84`

Scenario:

The design intentionally treats every admin as fully trusted. Any compromised admin account can create more admins, upload/edit content, export/download SQL backups, restore arbitrary accepted SQL dumps, change settings, and manage tokens. For a personal gallery this may be acceptable, but it is an authorization blast-radius risk once multiple human admins or external publish tokens enter the operational model.

Suggested fix:

If the app is used by more than one equally trusted operator, add role/capability checks around the highest-impact operations first: backup download, restore, admin-user management, token management, settings, and bulk uploads. If role work is out of scope, keep this as an explicit accepted risk in deployment docs and require stronger account protections operationally.

### SEC25-06 - SQL backups are plaintext at rest

Severity: Low
Confidence: High
Location: `CLAUDE.md:216-218`, `CLAUDE.md:578`, `apps/web/src/app/[locale]/admin/db-actions.ts:181-190`, `apps/web/src/app/api/admin/db/download/route.ts:21-31`, `apps/web/src/app/api/admin/db/download/route.ts:81-89`

Scenario:

Backups are owner-only (`0700` directory, `0600` file) and served only through authenticated admin download with no-store headers. They are still plaintext SQL on disk. A host-level compromise, misconfigured host backup, or accidental copy of `data/backups` exposes gallery metadata, admin records, password hashes, sessions table contents, and private operational data present in the DB dump.

Suggested fix:

Keep the current permissions, but add optional encryption-at-rest for generated dumps using an operator-managed key, or document a mandatory encrypted host-backup/storage layer. Consider retention controls and an admin UI warning that SQL exports are sensitive plaintext.

### SEC25-07 - Build inputs are intentionally mutable without a provenance gate

Severity: Low
Confidence: High
Location: `apps/web/Dockerfile:1-21`, `apps/web/Dockerfile:49-61`, `apps/web/Dockerfile:63-67`

Scenario:

The Dockerfile intentionally consumes floating `node:24-slim` images and current Debian package updates. That aligns with the repo preference for latest security updates, but it means a rebuild can resolve different OS/image content without a repository diff. If the resolved base image or package repository state changes unexpectedly, production behavior or vulnerability posture can change outside code review.

Suggested fix:

Do not necessarily freeze updates permanently. Instead, record the resolved image digest in deploy logs, generate SBOM/provenance for release builds, and scan the built image as a release gate. If reproducibility becomes more important than automatic updates, pin release builds by digest and update that digest intentionally.

## Positive Security Evidence

Auth/session/origin:

- Production refuses DB-stored session-secret fallback when `SESSION_SECRET` is missing or too short: `apps/web/src/lib/session.ts:19-35`.
- Session tokens are HMAC signed and token hashes are stored server-side rather than raw cookie tokens: `apps/web/src/lib/session.ts:8-10`, `apps/web/src/lib/session.ts:82-89`.
- Admin API cookie auth enforces same-origin before admin checks, while PAT-auth routes require scope and rate-limit token auth attempts: `apps/web/src/lib/api-auth.ts:68-121`.
- Login and password-change paths use same-origin checks, rate-limit pre-increment, Argon2 verification, and secure/httpOnly/sameSite cookies in the reviewed regions of `apps/web/src/app/actions/auth.ts`.

CSRF and route authorization:

- `npm run lint:api-auth --workspace=apps/web` passed. Both admin API handlers are wrapped by `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web` passed. Mutating server actions either enforce `requireSameOriginAdmin()` or are explicitly public/read-only with rate-limit posture.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. The mutating public semantic route calls a pre-increment rate-limit helper; GET routes were manually inspected separately.

Public route rate limiting:

- Semantic search requires same-origin, JSON content type, non-chunked transfer, content length, max body size, and charges before DB-backed mode lookup: `apps/web/src/app/api/search/semantic/route.ts:107-180`.
- OG routes and similar search are rate-limited; share-key and public view/search actions use pre-increment helpers in `apps/web/src/lib/rate-limit.ts`.
- The shipped nginx config adds edge rate/body limits for login, admin pages, DB restore, dashboard uploads, admin APIs, and Lightroom upload: `apps/web/nginx/default.conf:58-163`.

Upload/download privacy and path traversal:

- Original upload filename handling rejects absolute/path-containing names and resolves through realpath/lstat containment checks, including symlink rejection: `apps/web/src/lib/upload-paths.ts:110-160`.
- Production startup fails when legacy public originals exist under the old public-original path: `apps/web/src/lib/upload-paths.ts:163-184`.
- Public derivative serving validates route segments, extension/type alignment, realpath containment, symlink rejection, and already-opened file handles in `apps/web/src/lib/serve-upload.ts`.
- Backup download validates filenames, uses `realpath` containment, opens the validated descriptor, sets no-store/nosniff, and requires admin auth: `apps/web/src/app/api/admin/db/download/route.ts:21-89`.

Backup/restore:

- DB dump requires same-origin plus admin, uses owner-only backup directory/file permissions, avoids putting DB password on the command line, and requires MySQL CLI TLS configuration for non-local DB hosts in the reviewed helpers.
- Restore requires same-origin plus admin, uses advisory locks/maintenance mode, validates SQL headers, scans for dangerous SQL, runs `mysql --one-database`, and sanitizes stderr before user/log exposure.

XSS/CSP/SSRF:

- Production CSP uses nonce-based scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and self-limited connect sources unless GA is configured: `apps/web/src/lib/content-security-policy.ts:98-123`.
- `dangerouslySetInnerHTML` occurrences in public pages are JSON-LD script tags using the shared JSON serializer or precomputed safe JSON-LD.
- `safeJsonLd()` escapes script-breaking characters before JSON-LD injection: `apps/web/src/lib/safe-json-ld.ts:14-19`.
- Per-photo OG internal fetches are pinned to configured canonical `BASE_URL` rather than request `Host`, fail closed when the canonical origin is invalid, and cap per-photo fetch time and bytes: `apps/web/src/app/api/og/photo/[id]/route.tsx:97-122`, `apps/web/src/lib/og-photo-fetch.ts:64-94`.

SQL injection and command execution:

- Drizzle parameterization and allowlisted smart-collection fields are used for DB reads/writes; ad hoc user SQL string concatenation was not found in active app code.
- Child-process use is concentrated in backup/restore/migration and test scripts. The production DB dump/restore spawns fixed binaries with argument arrays and environment variables rather than shell interpolation in the reviewed regions.

Secrets and dependencies:

- `npm audit --workspace=apps/web --audit-level=low --json` reported 0 vulnerabilities.
- Tracked secret filename sweep found no committed `.env`, private keys, certs, or SSH keys.
- Local secret-bearing files were only checked by metadata/ignore status: `.env.deploy` is ignored by `.gitignore:18`; `apps/web/.env.local` is ignored by `apps/web/.gitignore:35`. Values were not read.
- Pattern scan found only test literals/comments for password/token-like strings, not active tracked secrets.

## Validation Evidence

Commands run:

- `git rev-parse HEAD`
- `git ls-files`
- `find apps/web/src/app -type f \( -name 'route.ts' -o -name 'route.tsx' \)`
- `npm audit --workspace=apps/web --audit-level=low --json`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- Targeted `rg` sweeps for route handlers, auth/origin/rate-limit usage, secrets, `dangerouslySetInnerHTML`, `fetch`, raw SQL, child-process execution, and env/key filenames.

Not run:

- Full `npm test`, `npm run build`, and Playwright e2e. This was a read-only security review, not an implementation change. The targeted security lint gates and dependency audit did run and passed.

## Final Missed-Issue Sweep

- Rechecked all active route handlers after the first pass, including feed/upload GET routes that the public mutating-route lint does not scan.
- Rechecked dangerous API patterns. The remaining `dangerouslySetInnerHTML` hits are JSON-LD only; remaining `spawn`/child-process hits are DB backup/restore/migration/test helpers; remaining `fetch` hits are client-side API calls or the OG internal derivative fetch with canonical-origin pinning and time/byte caps.
- Rechecked secret posture without reading real secret values. No tracked active secret files or private-key files were present; ignored local env files exist but were not opened.
- Rechecked authz and CSRF shape against both lint gates and source: admin mutations re-check same-origin and admin status, cookie-auth admin APIs require same-origin, and scoped PATs are limited to explicitly allowed API flows.
- Rechecked upload/download containment: public derivatives and private originals both use basename/segment validation plus realpath containment/symlink protections; backup download uses filename allowlisting plus realpath containment.

Stop condition: no confirmed Critical/High application vulnerability found in current HEAD; remaining findings are deployment hardening, accepted design risks, or low-severity logging/supply-chain controls.
