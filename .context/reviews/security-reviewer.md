# Security Reviewer - Cycle 23

Review date: 2026-06-30
Reviewed HEAD: `45208b2181add5db64395e4dac30134cfd1fcf35`
Role: security-reviewer
Scope: full-repository security review for OWASP Top 10, auth/authz, CSRF/origin, SSRF, path traversal, upload handling, secrets, DB backup/restore, rate limits, public routes, admin APIs, dependency/config risks, scripts, migrations, tests, and cross-file interactions.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the active security-relevant repository surface rather than sampling only a subset. Tracked inventory at this commit is 2,578 files, including 513 files under `apps/web/src` and 77 files under `apps/web/src/app`.

Reviewed active implementation and contracts:

- App Router pages, route handlers, and server actions under `apps/web/src/app/**`, including public routes, admin routes, upload/download endpoints, OG/image endpoints, semantic search, shared-photo/group routes, and all mutating server actions.
- Security libraries under `apps/web/src/lib/**`, including auth/session, API auth, origin guards, rate limits, upload path containment, public data omission, OG URL handling, CSP, smart collections, advisory locks, backup/restore helpers, SQL restore scanning, MySQL TLS CLI arguments, EXIF/GPS handling, image queueing, semantic search, and audit logging.
- Database schema and migrations under `apps/web/src/db/**` and `apps/web/drizzle/**`, including schema privacy interactions and migration journal behavior.
- Operational scripts and config under `apps/web/scripts/**`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, root `scripts/**`, `.env.deploy.example`, and `apps/web/.env.local.example`.
- Security tests and source-contract tests under `apps/web/src/__tests__/**` and selected e2e/config coverage where relevant.
- Delta since the previous security report commit `e072975c`, especially smart-collection predicate validation and advisory-lock result normalization.

Skipped/unavoidable:

- I did not manually line-review `node_modules`, `.git`, build outputs, binary media/font fixtures, or every generated lockfile line. Dependency risk was covered through `npm audit` on the committed graph and direct inspection of `package.json`/Docker install paths.
- I did not read real gitignored secret files such as `.env.deploy` or `apps/web/.env.local`; tracked examples and secret-detection tests were reviewed instead to avoid exposing secrets.
- Historical `.context/**` review/plan archives were not treated as active application code, except for the previous security review used as comparison context.

No active source route/action/auth/upload/restore/deploy surface was intentionally skipped.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 3

The three findings are the same low-severity configuration/supply-chain risks that remain present after cycle 22. I did not find a confirmed application-level auth bypass, CSRF bypass, SSRF, path traversal, public data leak, unsafe restore primitive, or missing mutating-route rate limit in the reviewed active code.

## Findings

### SEC23-01 - Mutable Docker base image and apt package inputs

Severity: Low
Confidence: High
Status: Likely supply-chain/configuration risk
Location: `apps/web/Dockerfile:1`, `apps/web/Dockerfile:4-16`, `apps/web/Dockerfile:10`

The production image still builds from floating `node:24-slim` tags and installs Debian packages without version or digest pinning:

- `FROM node:24-slim AS build-base` at `apps/web/Dockerfile:1`
- `apt-get install` of build tools at `apps/web/Dockerfile:4-8`
- `FROM node:24-slim AS runner-base` at `apps/web/Dockerfile:10`
- `apt-get install` of `gosu` and `mariadb-client` at `apps/web/Dockerfile:13-16`

Failure scenario: a future rebuild can silently pick up a different Node image digest or changed Debian package versions. That can introduce a compromised package, a regression in runtime behavior, or a vulnerable binary without a source change in this repository. The npm native platform packages are explicitly versioned at `apps/web/Dockerfile:50-56`, but the OS image and apt packages remain mutable.

Concrete fix: pin the base image by digest, for example `node:24-slim@sha256:...`, and either pin apt package versions from a controlled snapshot repository or build from a reviewed internal base image. Add an image provenance/SBOM step to CI or deploy verification so rebuilt artifacts can be compared against the reviewed inputs.

### SEC23-02 - Deploy helper executes commands sourced from an unchecked env file

Severity: Low
Confidence: Medium
Status: Likely local-operator risk
Location: `scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:61-72`

The deploy helper selects `.env.deploy` or an override env file at `scripts/deploy-remote.sh:22-29`, sources it directly at `scripts/deploy-remote.sh:61-64`, then executes `DEPLOY_CMD` or a derived command through `bash -lc` at `scripts/deploy-remote.sh:66-72`.

Failure scenario: if a local deploy env file is writable by another user, accidentally edited with malicious shell syntax, or replaced on a shared workstation, running the deploy helper executes arbitrary local shell commands before or during deployment. This is not a remote unauthenticated bug, but it expands the blast radius of a compromised deploy configuration file.

Concrete fix: before sourcing, require the env file to be owned by the current user and not group/world-writable. Prefer parsing only allowed `KEY=value` names instead of shell-sourcing arbitrary syntax. Avoid `DEPLOY_CMD` as raw shell where possible; construct an argv array from validated `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_KEY`, and a fixed remote script allowlist.

### SEC23-03 - Nginx template is unsafe if exposed as the public cleartext edge

Severity: Low
Confidence: Medium
Status: Manual-validation deployment risk
Location: `apps/web/nginx/default.conf:21-29`, `apps/web/nginx/default.conf:48-55`, `apps/web/docker-compose.yml:15-23`

The nginx template listens on cleartext port 80 at `apps/web/nginx/default.conf:21-23` and explicitly documents that it is intended to sit behind a TLS-terminating edge at `apps/web/nginx/default.conf:25-29`. It also emits HSTS at `apps/web/nginx/default.conf:54`. The compose file indicates host networking and a host reverse proxy arrangement at `apps/web/docker-compose.yml:15-23`.

Failure scenario: if this nginx template is promoted to the public edge without a separate HTTPS server block and HTTP-to-HTTPS redirect, first-time visitors can use cleartext HTTP before HSTS is learned. Because the same file sends HSTS, an operator may incorrectly assume TLS is enforced by this config alone.

Concrete fix: either add a managed `listen 443 ssl http2` server block with certificates and a port-80 redirect, or add a startup/deploy assertion that fails when this nginx instance is configured as a public edge without upstream TLS termination. Keep the current comments, but make the deployment invariant mechanically enforced.

## Confirmed Positive Security Evidence

Auth, session, and origin controls:

- Admin API routes are wrapped through `withAdminAuth`, with PAT scope handling and cookie-session auth at `apps/web/src/lib/api-auth.ts:58-144`.
- Cookie-authenticated admin API calls require same-origin provenance before `isAdmin()` at `apps/web/src/lib/api-auth.ts:114-129`.
- `requireSameOriginAdmin()` combines origin validation and admin validation at `apps/web/src/lib/action-guards.ts:37-43`.
- Origin validation fails closed unless `Origin` or `Referer` matches the expected origin; proxy headers are only trusted when configured at `apps/web/src/lib/request-origin.ts:45-107`.
- Session tokens are HMAC signed, checked with `timingSafeEqual`, capped to 24 hours, and backed by DB session rows at `apps/web/src/lib/session.ts:16-150`.
- Login, logout, and password-change actions enforce same-origin checks and rate limiting at `apps/web/src/app/actions/auth.ts:70-445`.

CSRF and mutating action coverage:

- `npm run lint:action-origin --workspace=apps/web` passed and reported that all mutating server actions enforce same-origin provenance or carry explicit read-only/public exemptions.
- Representative mutating admin actions re-check same-origin and admin before state changes, including smart collections at `apps/web/src/app/actions/collections.ts:15-126`, admin users at `apps/web/src/app/actions/admin-users.ts:77-292`, embeddings at `apps/web/src/app/actions/embeddings.ts:57-114`, and topics at `apps/web/src/app/actions/topics.ts:90-655`.

Admin API coverage:

- `npm run lint:api-auth --workspace=apps/web` passed for the admin DB download and Lightroom upload routes.
- DB backup downloads validate the backup filename, resolve and realpath-check containment, stream from an opened file handle, and add no-store/nosniff headers at `apps/web/src/app/api/admin/db/download/route.ts:21-90`.
- The Lightroom upload API is behind `withAdminAuth(..., { allowTokenScope: "lr:upload" })`, rejects chunked uploads, requires a capped content length, rate/preclaim-limits upload volume, validates metadata, and runs the same storage contract checks as browser uploads at `apps/web/src/app/api/admin/lr/upload/route.ts:68-554`.

Upload handling and path traversal:

- Upload filenames are constrained to safe basenames, non-absolute names, and allowed extensions, with symlink and realpath containment checks at `apps/web/src/lib/upload-paths.ts:58-160`.
- Public upload serving permits only derivative directories, validates every path segment, rejects SVG, checks lstat/realpath containment, and emits nosniff/cache headers at `apps/web/src/lib/serve-upload.ts:15-300`.
- Browser uploads require same-origin admin auth, strict upload size/body settings, disk-space prechecks, safe topic/tag validation, GPS stripping, HDR gating, DB insertion after processing, queueing, and cleanup on failure at `apps/web/src/app/actions/images.ts:114-563`.

Public routes, rate limits, and privacy:

- Public mutating API route lint passed: `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Public load-more, smart-collection pagination, and search actions validate input and use public rate-limit helpers at `apps/web/src/app/actions/public.ts:120-372`.
- Semantic search POST requires same-origin, content-type, content-length, body-size, rate-limit, mode/config gates, query validation, and no-store response headers at `apps/web/src/app/api/search/semantic/route.ts:107-360`.
- Similar-photo search requires same-origin, id validation, rate limit, production-mode gate, embedding checks, and public-field enrichment at `apps/web/src/app/api/search/similar/[id]/route.ts:68-260`.
- Public data selection omits admin-only/sensitive fields with runtime and type-level guards at `apps/web/src/lib/data.ts:368-489`, and semantic enrichment uses its own public selection guard at `apps/web/src/lib/search-enrichment-fields.ts:29-47`.
- Share-key pages validate key format, rate-limit lookup, avoid metadata enumeration, and use noindex behavior at `apps/web/src/app/[locale]/s/[key]/page.tsx:30-107` and `apps/web/src/app/[locale]/g/[key]/page.tsx:35-132`.

SSRF, URL handling, JSON-LD, and CSP:

- OG photo generation pins internal fetches to the configured `BASE_URL` origin and fails closed on invalid origin at `apps/web/src/app/api/og/photo/[id]/route.tsx:98-129`.
- OG fallback redirects only to same-origin canonical URLs at `apps/web/src/app/api/og/photo/[id]/route.tsx:249-295`.
- OG image fetching builds relative upload URLs from the trusted origin, caps response size, and times out requests at `apps/web/src/lib/og-photo-fetch.ts:64-94`.
- SEO OG URLs reject cross-origin absolute URLs and unsafe relative backslash forms at `apps/web/src/lib/seo-og-url.ts:3-43`.
- JSON-LD output is stringified and escapes `<`, `>`, and line separators before use in `dangerouslySetInnerHTML` at `apps/web/src/lib/safe-json-ld.ts:14-19`; public pages using structured data call that helper.
- Production CSP and security headers are set centrally at `apps/web/src/lib/content-security-policy.ts:68-123` and `apps/web/next.config.ts:51-90`.

DB backup, restore, and raw SQL boundaries:

- Backup creation runs under same-origin admin auth, checks required DB env, uses MySQL TLS CLI arguments, writes `0600` backup files, uses advisory restore locks, sanitizes stderr, and validates plausible dump headers at `apps/web/src/app/[locale]/admin/db-actions.ts:162-353`.
- Restore requires same-origin admin auth, acquires restore/upload/backfill locks with normalized advisory-lock handling, begins maintenance before restore, quiesces the upload queue, runs restore, runs post-restore migrations, and releases locks/maintenance in finally blocks at `apps/web/src/app/[locale]/admin/db-actions.ts:363-805`.
- Restore uploads are size-capped, written to a random temp file with mode `0600`, checked for plausible dump headers, scanned for dangerous SQL before execution, and piped to `mysql --one-database` with TLS args at `apps/web/src/app/[locale]/admin/db-actions.ts:554-740`.
- SQL restore scanning strips comments/literals/conditional comments and blocks dangerous or non-allowlisted statements at `apps/web/src/lib/sql-restore-scan.ts:12-168`.
- Non-local MySQL CLI use fails closed unless `DB_SSL_CA` is configured or SSL is explicitly disabled at `apps/web/src/lib/mysql-cli-ssl.ts:1-23`.

Changed-code checks since cycle 22:

- Smart collection parsing now enforces JSON byte limits, node budgets, allowlisted columns/operators, parameterized predicates, and per-column semantic value validation at `apps/web/src/lib/smart-collections.ts:142-505`.
- Advisory lock acquisition now treats only `1`, `1n`, and `"1"` as successful at `apps/web/src/lib/advisory-locks.ts:1-56`, and changed DB restore/admin/backfill/topic code uses that helper rather than truthy lock rows.

## Validation Commands

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=low` - 0 vulnerabilities
- `npm audit --workspace=apps/web --omit=dev --audit-level=low` - 0 vulnerabilities
- `npm test --workspace=apps/web -- tracked-secrets privacy-fields rate-limit request-origin nginx-config og-route-source-contracts og-photo-fallback load-more-rate-limit semantic-search-route similar-route backup-download-route smart-collections db-restore sql-restore-scan mysql-cli-ssl` - 24 test files passed, 285 tests passed

Additional manual sweeps:

- Searched for dynamic-code and HTML sinks (`eval`, `new Function`, `dangerouslySetInnerHTML`, `innerHTML`) and found no active unsafe dynamic-code execution. JSON-LD injection sites use `safeJsonLd`.
- Searched auth/origin/rate-limit wrappers across all app routes and actions, then cross-checked with the repository lint gates above.
- Searched secret-like strings in tracked files; active production secrets were not found in tracked source. Real gitignored env files were intentionally not read.

## Missed-Issues Sweep

I performed a final pass over the highest-risk cross-file interactions:

- Admin route exports versus `withAdminAuth`
- Mutating server actions versus `requireSameOriginAdmin`
- Public mutating handlers versus rate-limit pre-increment
- Upload write paths versus public serve paths and symlink/realpath containment
- Public data selects versus sensitive DB fields
- Share-key pages versus enumeration and metadata leakage
- OG image generation versus SSRF/open redirect/CSP
- DB backup/download/restore versus path traversal, shell injection, destructive SQL, maintenance locks, and TLS
- Smart collection JSON predicates versus raw SQL, parameter binding, and type confusion
- Advisory locks after the cycle 22 fix
- Secrets, dependency audit, Docker/deploy/nginx configuration

Residual risk is limited to the three low-severity findings above and normal operational risk that cannot be proven from repository state alone, such as whether production TLS termination and deploy-file permissions match the intended configuration.
