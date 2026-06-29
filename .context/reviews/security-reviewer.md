# Cycle 19 Security Review

Date: 2026-06-30
Reviewer: security-reviewer
Scope: whole repository under `/Users/hletrd/flash-shared/gallery`

## Summary

Confirmed findings: 4 total.

- Critical: 0
- High: 0
- Medium: 0
- Low: 4

No confirmed authentication bypass, authorization bypass, CSRF bypass, SQL injection, path traversal, SSRF, upload execution, stored/reflected XSS, tracked-secret, or vulnerable dependency issue was found in this pass.

## Relevant File Inventory

- Auth/session/origin: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/proxy.ts`.
- Admin APIs and server actions: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/*.ts`.
- Public APIs/actions/routes: `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, shared routes under `apps/web/src/app/[locale]/(public)/{s,g,p,c,year,timeline}`.
- Upload/file/path surfaces: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-limits.ts`.
- SQL/database/restore/search: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/sql-like.ts`, `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/drizzle/**/*.sql`, `apps/web/scripts/migrate.js`.
- XSS/CSP/headers/URLs: `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`.
- Rate limits: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, public API route handlers, public server actions, admin token auth.
- Secrets/deploy/config: `.env.deploy.example`, `.gitignore`, `apps/web/.env.local.example`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/src/__tests__/tracked-secrets.test.ts`.
- Review gates/tests: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, targeted security tests under `apps/web/src/__tests__/`.

## Findings

### LOW-1: topic image processing writes scratch originals inside the public resources tree

Severity: Low
Confidence: Medium

Evidence:

- `apps/web/src/lib/process-topic-image.ts:11-26` resolves the default topic resource root to `apps/web/public/resources` or `public/resources`.
- `apps/web/src/lib/process-topic-image.ts:72-90` writes the uploaded topic image to `path.join(RESOURCES_DIR, "tmp-${id}")`, then reads it through Sharp and deletes it after output.
- `apps/web/src/lib/process-topic-image.ts:105-119` documents that orphaned `tmp-*` files can persist after a crash and are cleaned only on startup.
- `apps/web/next.config.ts:29-34` and `apps/web/next.config.ts:102-105` explicitly treat `/resources/**` as a local public image/resource path.

Problem:

The temporary input file is random and mode `0600`, but it still lives under the app's public resources directory. If the process crashes after line 83 and before line 90, the unprocessed admin-uploaded cover image can remain in a public asset tree until the next successful startup cleanup.

Failure scenario:

An admin uploads a topic cover containing private metadata or unwanted pixels. The server crashes or is killed after writing `public/resources/tmp-<uuid>` but before Sharp conversion and cleanup. The UUID makes discovery unlikely and there is no directory listing, so this is not a practical unauthenticated enumeration issue. It is still avoidable exposure of original upload bytes in a public tree if the path is logged, leaked, guessed, or served by a permissive static layer.

Fix:

Write topic-image scratch files to a private temp directory, for example `data/tmp/topic-resources` or `os.tmpdir()`, and atomically move only the final sanitized `.webp` into `public/resources`. Keep startup cleanup for both the private temp dir and any legacy public `tmp-*` files.

### LOW-2: nginx config relies on an external TLS edge while still listening on cleartext port 80

Severity: Low
Confidence: Medium

Evidence:

- `apps/web/nginx/default.conf:21-29` listens on port 80 and documents that this listener must sit behind a TLS-terminating edge, not be exposed directly.
- `apps/web/nginx/default.conf:48-55` adds security headers including HSTS, but HSTS is only meaningful after a browser has reached the HTTPS site.
- `apps/web/nginx/default.conf:57-71` proxies the admin login path over that same HTTP listener.
- `apps/web/docker-compose.yml:14-22` uses host networking, sets `HOSTNAME=127.0.0.1`, and enables `TRUST_PROXY=true`, so the intended topology depends on the host nginx/TLS boundary being correct.

Problem:

The config is clear about its intended placement, but it does not enforce the placement. If port 80 is accidentally reachable as the public edge, login form submissions and other request bodies can traverse cleartext before any application-level cookie hardening matters.

Failure scenario:

During a host migration or firewall change, `gallery.atik.kr:80` becomes Internet-reachable without the upstream TLS terminator. An admin types credentials into the HTTP endpoint or follows an HTTP link before HSTS is established. Production cookies are marked Secure, but the submitted credentials and request bodies have already crossed the network in cleartext.

Fix:

Bind this nginx listener to loopback or the private load-balancer interface, enforce firewall rules that block public port 80 to this process, or add a public-edge server block that redirects HTTP to HTTPS before proxying. If nginx is ever the public edge, terminate TLS in this config and keep the existing HSTS header only on HTTPS responses.

### LOW-3: repo-local deploy secret file is the default path

Severity: Low
Confidence: High

Evidence:

- `.env.deploy.example:1-4` instructs operators to copy the sample to a gitignored repo-root `.env.deploy` by default.
- `.gitignore:18-21` ignores `.env.deploy` while explicitly allowing `.context/reviews/**`.
- `scripts/deploy-remote.sh:22-29` prefers `$ROOT_DIR/.env.deploy` whenever it exists before falling back to `$HOME/.gallerykit-secrets/gallery-deploy.env`.
- `scripts/deploy-remote.sh:61-72` sources the selected env file and executes the resulting deploy command.
- `apps/web/src/__tests__/tracked-secrets.test.ts:28-58` scans only `git ls-files`, so ignored local deploy env files are outside the tracked-secret safety net.

Problem:

The documented default keeps real deploy host/user/key/path values inside the checkout, merely ignored by Git. That is better than committing secrets, but worse than the already-supported external secrets directory because local archives, editor plugins, support bundles, or accidental `git add -f` can capture the file.

Failure scenario:

An operator follows `.env.deploy.example`, creates `.env.deploy` in the repo, then shares or backs up the workspace. The ignored file can expose deployment host metadata, SSH key paths, remote paths, and optional command overrides, helping an attacker target the deploy path.

Fix:

Invert the default precedence: prefer `$HOME/.gallerykit-secrets/gallery-deploy.env` and require `DEPLOY_ENV_FILE=.env.deploy` for repo-local use. Update `.env.deploy.example` to recommend the external path. Add a non-printing preflight warning when repo-local `.env.deploy` exists.

### LOW-4: deploy env can override shell commands without a separate guard

Severity: Low
Confidence: Medium

Evidence:

- `.env.deploy.example:11` exposes `DEPLOY_REMOTE_SCRIPT` as a shell fragment.
- `.env.deploy.example:13-14` documents `DEPLOY_CMD` as a complete command override.
- `scripts/deploy-remote.sh:31-53` interpolates `DEPLOY_REMOTE_SCRIPT` into the remote command after quoting only `DEPLOY_PATH`.
- `scripts/deploy-remote.sh:66-72` lets `DEPLOY_CMD` bypass derived command construction and runs it through `bash -lc`.

Problem:

The deploy env file is executable configuration, not just declarative host/user/path data. That is useful as an escape hatch, but there is no second acknowledgement such as `ALLOW_DEPLOY_CMD=true`, and it compounds LOW-3 if a repo-local ignored env file is stale or tampered with.

Failure scenario:

A malicious or stale deploy env changes `DEPLOY_REMOTE_SCRIPT` or `DEPLOY_CMD` to run extra shell during `npm run deploy`. The command runs with the operator's local privileges and the remote deploy account's privileges, enabling exfiltration or remote checkout damage before the normal deploy script runs.

Fix:

Keep the default path declarative and allowlisted. Require an explicit guard before honoring `DEPLOY_CMD` or a custom `DEPLOY_REMOTE_SCRIPT`, and print the selected mode without echoing secrets.

## Missed-Issues Sweep

- OWASP access control: Admin API exports are centrally wrapped by `withAdminAuth` (`apps/web/src/lib/api-auth.ts:58-144`), and the API auth lint passed. Admin cookie API access checks same-origin before `isAdmin()` (`apps/web/src/lib/api-auth.ts:114-129`). Admin page middleware performs a fast cookie-format redirect only; full authorization stays server-side (`apps/web/src/proxy.ts:80-115`).
- Auth/session: Login requires same-origin (`apps/web/src/app/actions/auth.ts:91-95`), uses IP and account pre-increment rate limits before Argon2 verification (`apps/web/src/app/actions/auth.ts:122-154`), uses dummy-hash verification for missing users (`apps/web/src/app/actions/auth.ts:173-181`), rotates sessions in a transaction (`apps/web/src/app/actions/auth.ts:201-223`), and sets `httpOnly`, `secure`, `sameSite=lax` cookies (`apps/web/src/app/actions/auth.ts:225-238`). Production refuses missing/short `SESSION_SECRET` (`apps/web/src/lib/session.ts:16-36`), HMAC tokens are timing-safe verified and DB-backed (`apps/web/src/lib/session.ts:82-150`).
- CSRF/same-origin: `hasTrustedSameOrigin` fails closed unless Origin or Referer matches the trusted expected origin (`apps/web/src/lib/request-origin.ts:79-107`). Proxy host/proto handling is explicit and only trusts forwarded values when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:45-68`).
- PAT/non-browser auth: Admin tokens are random 32-byte base64url values, only hashes are stored, format is validated, hash comparison is timing-safe, expiry and scopes are enforced (`apps/web/src/lib/admin-tokens.ts:1-9`, `apps/web/src/lib/admin-tokens.ts:48-85`, `apps/web/src/lib/admin-tokens.ts:137-163`). Token-authenticated admin API calls are rate-limited and scope-gated (`apps/web/src/lib/api-auth.ts:68-111`).
- Rate limiting: Login constants and bounded maps are defined (`apps/web/src/lib/rate-limit.ts:65-85`, `apps/web/src/lib/rate-limit.ts:112-121`), client IP parsing only trusts proxy headers when configured (`apps/web/src/lib/rate-limit.ts:163-194`), and DB-backed login buckets use atomic insert/update/decrement patterns (`apps/web/src/lib/rate-limit.ts:391-517`). Public OG/search routes carry per-IP limits (`apps/web/src/app/api/og/route.tsx:46-62`, `apps/web/src/app/api/og/photo/[id]/route.tsx:44-60`, `apps/web/src/app/api/search/semantic/route.ts:172-183`, `apps/web/src/app/api/search/similar/[id]/route.ts:84-94`).
- Upload/path traversal: Originals are stored outside the public upload root by default (`apps/web/src/lib/upload-paths.ts:25-47`), original paths reject unsafe filenames, symlinks, and realpath escapes (`apps/web/src/lib/upload-paths.ts:110-160`), public derivative serving allowlists directories/extensions and realpath containment (`apps/web/src/lib/serve-upload.ts:127-189`), and local storage rejects absolute/dotdot keys and refuses public URLs for originals (`apps/web/src/lib/storage/local.ts:22-48`, `apps/web/src/lib/storage/local.ts:130-138`). Main image upload uses UUID filenames, mode `0600`, Sharp pixel limits, metadata validation, and cleanup on failure (`apps/web/src/lib/process-image.ts:887-1036`).
- Backup/restore: Backup and restore actions require same-origin admin checks (`apps/web/src/app/[locale]/admin/db-actions.ts:119-130`, `apps/web/src/app/[locale]/admin/db-actions.ts:309-316`). Backups are written under `data/backups` mode `0700`/`0600`, use env-based MySQL credentials rather than CLI password args, sanitize stderr, and verify non-empty plausible dumps (`apps/web/src/app/[locale]/admin/db-actions.ts:138-183`, `apps/web/src/app/[locale]/admin/db-actions.ts:185-277`). Backup downloads validate filename and containment, reject symlinks, audit, and send no-store/nosniff (`apps/web/src/app/api/admin/db/download/route.ts:22-89`). Restore enforces file type/size, temp mode `0600`, header validation, dangerous-SQL scanning, advisory locks, queue quiescing, and `mysql --one-database` (`apps/web/src/app/[locale]/admin/db-actions.ts:462-635`; scanner at `apps/web/src/lib/sql-restore-scan.ts:39-168`).
- SQL/raw commands: Application queries use Drizzle builders or tagged `sql` templates with parameter interpolation. Search LIKE patterns escape `%`, `_`, and backslash (`apps/web/src/lib/sql-like.ts:1-10`). Raw command execution is confined to known backup/restore/e2e/dev scripts; production backup/restore commands avoid passing passwords on argv (`apps/web/src/app/[locale]/admin/db-actions.ts:170-183`, `apps/web/src/app/[locale]/admin/db-actions.ts:559-572`).
- SSRF/open redirect: The per-photo OG route validates positive numeric IDs, pins internal fetches to `BASE_URL` rather than request Host, and fails closed if the canonical origin is invalid (`apps/web/src/app/api/og/photo/[id]/route.tsx:51-60`, `apps/web/src/app/api/og/photo/[id]/route.tsx:101-126`). OG fetches have per-attempt timeout, total budget, and 1 MiB caps (`apps/web/src/lib/og-photo-fetch.ts:30-94`, `apps/web/src/lib/og-photo-fetch.ts:102-118`). Image base URL and CSP image base reject non-http(s), production http, credentials, query, and hash (`apps/web/src/lib/content-security-policy.ts:1-25`; `apps/web/next.config.ts:8-28`).
- XSS/CSP/headers: JSON-LD scripts use a dedicated serializer that escapes script-breaking characters (`apps/web/src/lib/safe-json-ld.ts:14-19`) and pages pass that value into nonce-bearing JSON-LD scripts (`apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:260-274`). Production CSP uses nonce/self scripts, `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'` (`apps/web/src/lib/content-security-policy.ts:98-123`), with middleware nonce injection (`apps/web/src/proxy.ts:21-49`). Global response headers include nosniff, frame, referrer, permissions, and HSTS in production (`apps/web/next.config.ts:75-88`; nginx mirrors at `apps/web/nginx/default.conf:48-55`).
- Privacy/public data: Public field sets omit GPS, original filenames, user filenames, internal processing state, and HDR/color internals, with compile-time guards (`apps/web/src/lib/data.ts:368-507`). Shared group lookup validates base56 keys, checks expiry, returns public fields plus blur only, and caps group reads (`apps/web/src/lib/data.ts:1243-1283`). Public search validates length and uses compile-time privacy guards (`apps/web/src/lib/data.ts:1482-1555`). Semantic/similar enrichment uses a shared compile-guarded select (`apps/web/src/lib/search-enrichment-fields.ts:1-47`).
- Semantic search: Public semantic POST is same-origin, rejects non-JSON/chunked/missing or oversized bodies, caps query length/topK, mode-gates service, scans a bounded number of embeddings, and no-stores responses (`apps/web/src/app/api/search/semantic/route.ts:106-335`). Similar search is same-origin, positive-integer-only, production-mode-only, bounded-scan, and no-store (`apps/web/src/app/api/search/similar/[id]/route.ts:63-240`).
- Secrets/dependencies: Tracked secret hygiene test passed, and dependency audit reported zero vulnerabilities. `git ls-files` showed only example env files and non-secret key-named route/test files, not private key material.

## Verification Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed; admin API routes listed as OK.
- `npm run lint:action-origin --workspace=apps/web`: passed; all mutating server actions enforce same-origin provenance or have explicit reviewed exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; mutating public route coverage OK.
- `npm test --workspace=apps/web -- src/__tests__/tracked-secrets.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts`: 5 files, 99 tests passed.
- `npm audit --workspace=apps/web --audit-level=moderate`: `found 0 vulnerabilities`.
- Static grep sweep covered `dangerouslySetInnerHTML`, `eval`, `new Function`, `child_process`, `spawn`, `exec`, Drizzle `sql` templates, `fetch`, and outbound HTTP client patterns under `apps/web/src` and `apps/web/scripts`.
- Independent external security-review consultation was attempted through tool discovery, but no callable ask-Codex/MCP review tool was available in this session; review proceeded with local source inspection and project gates.

## Coverage Confirmation

Final missed-issue sweep covered OWASP Top 10 themes, auth/authz, sessions, CSRF/same-origin, PAT scope auth, rate limits, file upload/path traversal, public file serving, SQL/raw command usage, backup/restore, secrets, dependency audit, SSRF/open redirects, XSS/CSP, unsafe headers, privacy projections, and deployment configuration. The only confirmed issues are low-severity hardening or operational-footgun items listed above.
