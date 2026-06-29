# Cycle 11 Security Review

Scope: comprehensive repository security review for `/Users/hletrd/flash-shared/gallery` on `master`.

Reviewer role: security-reviewer, prompt 1 only. This review is read-only except for this report file. Production code was not edited.

## Result

No high- or medium-severity security findings were identified.

- Confirmed findings: 1 low-severity finding
- Likely findings: none
- Risk findings: 1 low-severity risk

The findings below are residual hardening items. The reviewed code already has meaningful compensating controls, including nginx rate limits, strict admin route lint gates, origin checks, upload containment, privacy selector guards, and targeted security tests.

## Inventory Reviewed

Repository inventory was built before manual review:

- Tracked files: 2540
- Application source files under `apps/web/src`: 498
- Admin API handlers: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public API/route handlers: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/feed.xml/route.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- Server actions: `apps/web/src/app/actions/admin-backfill.ts`, `admin-users.ts`, `auth.ts`, `collections.ts`, `embeddings.ts`, `images.ts`, `lr-tokens.ts`, `public.ts`, `seo.ts`, `settings.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, plus `apps/web/src/app/[locale]/admin/db-actions.ts`

Primary security surfaces reviewed:

- Authentication, sessions, and password hashing: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`
- Admin API auth and PATs: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Upload and file serving: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`
- Database backup/restore/migrations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`
- Public search/share/data privacy: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/smart-collections.ts`, public share/photo/topic/timeline/map pages
- Output encoding and browser policy: `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/csv-escape.ts`, `apps/web/src/lib/og-sanitize.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`
- Configuration/deployment: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`, `apps/web/src/db/index.ts`, `CLAUDE.md`, `AGENTS.md`
- Security lint/test gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, and security/privacy tests under `apps/web/src/__tests__/`

## Findings

### 1. Confirmed: PAT authentication reaches the database before any app-level rate limit

- Severity: Low
- Confidence: High
- Category: OWASP A05 Security Misconfiguration / A07 Identification and Authentication Failures
- Files/regions:
  - `apps/web/src/lib/api-auth.ts:64-72`
  - `apps/web/src/lib/admin-tokens.ts:79-85`
  - `apps/web/src/lib/admin-tokens.ts:137-148`
  - Mitigation already present at `apps/web/nginx/default.conf:131-161`

`withAdminAuth` accepts bearer-token authentication for token-enabled admin APIs. When an `Authorization: Bearer ...` header is present, it calls `verifyToken(presented)` before performing any same-origin check or app-level rate-limit check (`apps/web/src/lib/api-auth.ts:64-72`). `verifyToken` cheaply rejects malformed tokens (`apps/web/src/lib/admin-tokens.ts:79-85`), but any syntactically valid `gk_` token is hashed and looked up by `token_hash` in the database (`apps/web/src/lib/admin-tokens.ts:137-148`).

Concrete failure scenario: an attacker sends a high rate of syntactically valid but bogus `gk_` bearer tokens to `/api/admin/lr/upload` or any future PAT-enabled admin endpoint. Each request performs an indexed DB lookup before rejection. This is not a practical token brute-force issue because tokens are 256-bit random values and stored hashed, but it can amplify unauthenticated traffic into database work if the Node app is exposed directly, a future deployment bypasses nginx, or the nginx `/api/admin/` limits drift from the app topology. Current nginx limits for LR upload and generic admin API paths reduce this risk in the documented production path (`apps/web/nginx/default.conf:131-161`).

Suggested fix: add a lightweight pre-auth limiter in `withAdminAuth` for token-auth attempts before `verifyToken`, keyed by `getClientIp(request.headers)` and path/scope. Keep malformed-token rejection cheap, use a generous budget for legitimate Lightroom bursts, and retain nginx as a second layer. A DB-backed limiter is acceptable if it is cheaper than token verification under attack; a bounded in-memory limiter is also useful for direct-app exposure.

### 2. Risk: public LIKE escaping depends on MySQL backslash semantics

- Severity: Low
- Confidence: High
- Category: OWASP A03 Injection / A05 Security Misconfiguration
- Files/regions:
  - `apps/web/src/lib/data.ts:1491-1499`
  - `apps/web/src/lib/data.ts:1549-1554`
  - `apps/web/src/lib/data.ts:1589-1594`
  - `apps/web/src/lib/smart-collections.ts:217-221`
  - `apps/web/src/lib/smart-collections.ts:259-266`

The public text-search path escapes `%`, `_`, and `\` with backslashes before using Drizzle `like(...)` (`apps/web/src/lib/data.ts:1491-1499`, then used at `apps/web/src/lib/data.ts:1549-1554` and tag/alias paths at `apps/web/src/lib/data.ts:1589-1594`). Smart collection `contains` operators use the same backslash escaping pattern (`apps/web/src/lib/smart-collections.ts:217-221`, `apps/web/src/lib/smart-collections.ts:259-266`).

The code correctly notes that this relies on the MySQL default where backslash is the implicit LIKE escape character. If a database is started with `NO_BACKSLASH_ESCAPES`, user input containing `%` or `_` is no longer neutralized as intended. In the public search path, a visitor could broaden matching or force expensive wildcard scans despite rate limits. In smart collections, an admin-authored rule saved under a changed SQL mode could also broaden public collection results.

This is a risk finding rather than a confirmed current exploit because the documented MySQL default mode makes the current escaping effective, and the code comment explicitly calls out the deployment assumption. The residual issue is that the invariant is not enforced by the app.

Suggested fix: centralize LIKE predicates in a helper that emits an explicit `ESCAPE '\\'` clause via Drizzle `sql`, or verify at startup/migration time that `@@SESSION.sql_mode` does not include `NO_BACKSLASH_ESCAPES` and fail closed if it does. A longer-term alternative is to route public text search through full-text/search-index primitives instead of wildcard LIKE scans.

## Positive Security Evidence

- Auth/session: production refuses weak/missing `SESSION_SECRET` fallback in `apps/web/src/lib/session.ts:19-35`; session tokens are HMAC-signed and verified with constant-time comparison in `apps/web/src/lib/session.ts:94-151`; login and password changes use same-origin checks, rate limits, Argon2id, session fixation defenses, and session rotation in `apps/web/src/app/actions/auth.ts`.
- Admin API: cookie-authenticated admin API paths require same-origin before `isAdmin()` in `apps/web/src/lib/api-auth.ts:103-118`; successful admin API responses get `no-store` and `nosniff` defaults in `apps/web/src/lib/api-auth.ts:123-130`.
- Server actions: the action-origin lint gate passed, and reviewed mutating actions return early on `requireSameOriginAdmin()` or are explicitly public and rate-limited.
- Uploads: LR upload requires scoped admin PAT/cookie auth, rejects chunked uploads, enforces declared-size quotas before body parsing, sanitizes filenames/metadata/topic slugs, strips GPS when configured, checks disk space, uses generated names, and cleans up originals on post-save failure in `apps/web/src/app/api/admin/lr/upload/route.ts`.
- File serving: derivative serving is constrained to `jpeg`, `webp`, and `avif`, validates safe path segments and extension/type consistency, rejects symlinks/non-files, and enforces realpath containment in `apps/web/src/lib/serve-upload.ts:15-17` and `apps/web/src/lib/serve-upload.ts:127-189`.
- DB backup/restore: backup and restore actions require admin auth plus same-origin, use owner-only file modes, avoid shell invocation for database commands, sanitize stderr, hold restore/upload/backfill locks, scan restore SQL chunks, and run post-restore migrations from local paths in `apps/web/src/app/[locale]/admin/db-actions.ts` and `apps/web/src/lib/sql-restore-scan.ts`.
- Privacy: public selectors omit admin-only/internal fields with runtime and compile-time guard coverage in `apps/web/src/lib/data.ts:367-506`; search enrichment fields have a separate privacy guard in `apps/web/src/lib/search-enrichment-fields.ts:29-47`.
- Browser/output safety: JSON-LD uses safe serialization in `apps/web/src/lib/safe-json-ld.ts`; CSV export strips control/bidi characters and guards formula injection in `apps/web/src/lib/csv-escape.ts`; production CSP is nonce-based for scripts and includes object-src none, base-uri, form-action, and frame-ancestor constraints in `apps/web/src/lib/content-security-policy.ts`.
- Dependencies/secrets: dependency audit found no known vulnerabilities; tracked secret regression tests passed; manual secret-pattern review resolved hits to placeholders, docs, tests, schema names, or historical review/plan text.

## OWASP Top 10 Coverage

- A01 Broken Access Control: admin route wrappers, same-origin server action gates, admin page proxy guard, public selector privacy guards, and share-key expiry/lookup paths reviewed.
- A02 Cryptographic Failures: Argon2id passwords, HMAC sessions, secure cookies, DB TLS policy, hashed PATs, and production secret requirements reviewed.
- A03 Injection: Drizzle/mysql2 parameter binding, restore SQL scanner, CSV/XML/JSON-LD escaping, safe OG text sanitation, and smart-collection DSL allowlists reviewed. Residual LIKE escape risk is finding 2.
- A04 Insecure Design: upload/restore locks, maintenance mode, queue quiescing, quota preclaims, privacy guards, and lint gates reviewed.
- A05 Security Misconfiguration: CSP, HSTS, no-store/nosniff, nginx request caps/rate limits, non-root container runtime, DB TLS defaults, and proxy trust model reviewed. Residual direct-app PAT throttling gap is finding 1.
- A06 Vulnerable and Outdated Components: `npm audit --workspace=apps/web --audit-level=low` returned no vulnerabilities.
- A07 Identification and Authentication Failures: login/password-change rate limits, dummy hash verification, session fixation prevention, session rotation, PAT scope checks, and admin wrappers reviewed.
- A08 Software and Data Integrity Failures: restore scanner, migration assertions, local script path execution, backup/restore locking, and queue resume behavior reviewed.
- A09 Security Logging and Monitoring Failures: audit events were reviewed for login, admin/PAT upload, backup/restore, share/admin actions, and failure paths; no raw sensitive values were identified in reviewed audit logs.
- A10 SSRF: OG derivative fetches are constructed from configured site origin and validated derivative paths; no arbitrary request-input URL fetch path was identified.

## Verification Evidence

Commands run:

- `npm audit --workspace=apps/web --audit-level=low` -> `found 0 vulnerabilities`
- `npm run lint:api-auth --workspace=apps/web` -> passed; both admin API route handlers reported `OK`
- `npm run lint:action-origin --workspace=apps/web` -> passed; all mutating server actions enforce same-origin provenance or carry reviewed read-only/public exemptions
- `npm run lint:public-route-rate-limit --workspace=apps/web` -> passed; public mutating API route scan found required pre-increment rate-limit coverage
- `npm test --workspace=apps/web -- --run src/__tests__/api-auth-response-headers.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/tracked-secrets.test.ts` -> 9 files passed, 131 tests passed

Final missed-issues sweep:

- Reviewed `rg` sweeps for `dangerouslySetInnerHTML`, `eval`, `new Function`, `child_process`/`spawn`, SQL restore/destructive patterns, admin API handler exports, server-action origin exemptions, public mutating route handlers, token/session/password helpers, upload file paths, privacy-sensitive field names, and secret-like strings.
- Hits resolved to safe JSON-LD insertion, test fixtures, migration/restore helpers with bounded process execution, vetted SQL scanner patterns, docs/plans/review history, placeholders, schema column names, or expected route/action wrappers.
- No production code was edited.

## Stop Condition

Security review prompt 1 is complete: inventory was built first, the whole repository was inspected from OWASP/secrets/auth/authz/privacy angles, a final missed-issues sweep was performed, two low-severity residual items were documented with exact code regions and fixes, and validation evidence was recorded.
