# Security Review Report — Cycle 81/100

**Reviewer:** security-reviewer lane
**Date:** 2026-07-01
**Repo:** `/Users/hletrd/flash-shared/gallery`
**HEAD:** `4733d475be8f`
**Scope:** OWASP risks, auth/authz, sessions/PATs, server actions, admin/public API routes, rate limits, file/path safety, SSRF, privacy fields, raw SQL, child processes, secrets handling, deploy safety, and security test gaps.

## Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

No new actionable security findings. I did not re-raise prior deferred/non-exploitable items because current evidence does not change severity or exit criteria.

## Security-Relevant Inventory

- Auth/session/PAT: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`
- Admin/server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Admin API routes: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public API routes: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, upload route handlers, health/live routes
- File/path handling: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/process-topic-image.ts`
- SQL/restore/process spawning: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/mysql-connection-options.js`
- Privacy/data selection: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, privacy tests
- Headers/deploy: `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `apps/web/Dockerfile`

## Reviewed Controls

| Area | Evidence | Confidence | Failure scenario checked | Fix if regressed |
|---|---|---:|---|---|
| Admin API auth/authz | `apps/web/src/lib/api-auth.ts:72-123` accepts scoped PATs only when `allowTokenScope` is set, otherwise enforces same-origin then `isAdmin()`. `apps/web/src/app/api/admin/db/download/route.ts:21-29` and `apps/web/src/app/api/admin/lr/upload/route.ts:84-94` use the wrapper. | High | New admin route bypasses auth, accepts token without scope, or cookie path skips CSRF origin check. | Keep every `/api/admin/**` method exported as `withAdminAuth(...)`; use `allowTokenScope` only per route scope. |
| Session/token handling | `apps/web/src/lib/session.ts:16-35` requires `SESSION_SECRET` in production; `session.ts:94-150` verifies HMAC with constant-time compare and DB hash lookup. `apps/web/src/lib/admin-tokens.ts:52-89` generates 32-byte PATs and validates format; `admin-tokens.ts:141-168` verifies hash/expiry/scopes. | High | DB compromise yields forgeable cookies, PAT plaintext is stored, or malformed tokens trigger unsafe comparison. | Preserve env-only prod secret, hash-only storage, constant-time compare, and expiry/scope checks. |
| Login/password defenses | `apps/web/src/app/actions/auth.ts:77-188` same-origin gates login, uses IP + account buckets, pre-increments before Argon2, and dummy-hash timing equalization. `auth.ts:290-453` gates password change, rate-limits current-password verification, rotates sessions. | High | Cross-site login/password mutation, distributed brute force, or stolen session survival after password rotation. | Keep origin check before auth reads, dual-bucket rate limiting, and delete+insert session rotation. |
| Server action CSRF | `apps/web/src/lib/action-guards.ts:37-44` centralizes same-origin checks; `lint:action-origin` reports every mutating export guarded. | High | Future server action mutates after only `isAdmin()` or before origin verification. | Maintain `requireSameOriginAdmin()` early return on mutating actions and the lint gate. |
| Public route rate limits | Semantic route gates/charges at `apps/web/src/app/api/search/semantic/route.ts:107-184`; similar route at `apps/web/src/app/api/search/similar/[id]/route.ts:68-126`; OG route at `apps/web/src/app/api/og/route.tsx:83-99`; photo OG at `apps/web/src/app/api/og/photo/[id]/route.tsx:100-110`. | High | Anonymous CPU/DB/image endpoints become unmetered DoS or enumeration paths. | Keep pre-increment helpers before shared work; keep the public-route lint scanner. |
| Path traversal/symlink safety | Upload originals validate basename and realpath containment at `apps/web/src/lib/upload-paths.ts:120-170`; derivative serving validates allowlisted dirs/extensions/segments and realpath at `apps/web/src/lib/serve-upload.ts:133-190`; backup download validates filename + realpath at `apps/web/src/app/api/admin/db/download/route.ts:23-58`. | High | Crafted filename or symlink reads private originals/backups or arbitrary files. | Preserve allowlists, basename checks, `lstat` symlink rejection, and realpath containment. |
| SSRF/open redirect | Per-photo OG fetch is pinned to canonical `BASE_URL` at `apps/web/src/app/api/og/photo/[id]/route.tsx:176-196`; fallback redirects validate same-origin `ogImageUrl` at `route.tsx:329-374`. | High | Attacker-controlled Host/XFH coerces server-side fetch or fallback redirect. | Never derive internal fetch origin from `req.url`; keep canonical-origin validation. |
| DB restore and process spawning | Backup/restore use `spawn` arg arrays and sanitized env at `apps/web/src/app/[locale]/admin/db-actions.ts:221-228` and `:674-680`; restore locks/maintenance at `:365-565`; SQL upload scan at `:570-649`; dangerous SQL denylist/write-target scanner at `apps/web/src/lib/sql-restore-scan.ts:61-129` and `:210-251`. | High | Crafted dump writes outside app schema, runs routines/users/FILE operations, or child command leaks credentials. | Keep scanner + `--one-database`, advisory locks, no shell, no `HOME`, and stderr redaction. |
| Privacy leaks | Public select derivation omits sensitive fields at `apps/web/src/lib/data.ts:368-408`; map-only GPS exception is documented/guarded at `data.ts:410-488`; public search enrichment uses guarded safe fields at `apps/web/src/lib/search-enrichment-fields.ts:29-47`; tests pin the contract at `apps/web/src/__tests__/privacy-fields.test.ts:86-131`. | High | GPS/original filenames/admin ids/internal color/HDR fields leak through public routes. | Add new admin-only columns to `PrivacySensitiveKeys`, omit blocks, and fixtures before exposing data. |
| XSS/CSP | Production CSP omits `unsafe-inline`/`unsafe-eval` and uses nonce/script self at `apps/web/src/lib/content-security-policy.ts:98-123`; global headers in `apps/web/next.config.ts:75-87`. Dangerous HTML sinks are JSON-LD only and covered by `safe-json-ld`/OG sanitizer tests. | High | Admin-controlled strings break out of JSON-LD or scripts run without nonce. | Keep `safeJsonLd`, sanitizer imports, CSP nonce flow, and no generic `dangerouslySetInnerHTML`. |
| Deploy/secrets safety | Deploy refuses group/world-readable runtime env files at `apps/web/deploy.sh:15-43`; Docker prune runs after health and avoids `volume prune -a` at `deploy.sh:79-104`; nginx body caps/rate limits are scoped at `apps/web/nginx/default.conf:31-56` and `:133-150`. | High | Secrets file is readable, deploy cleanup removes persistent data, or large unauthenticated bodies bypass edge caps. | Keep env permission refusal, bind-mount persistence model, post-health prune, and endpoint-specific body caps. |

## Verification Evidence

- `npm run lint:api-auth --workspace=apps/web` → OK, 2 admin API route files wrapped.
- `npm run lint:action-origin --workspace=apps/web` → OK, all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web` → OK, public mutating/expensive routes covered or explicitly exempted.
- `npm --workspace=apps/web exec vitest run ...` targeted auth/privacy/rate-limit/restore tests → 9 files passed, 262 tests passed.
- `npm --workspace=apps/web exec vitest run ...` secrets/sanitizer/path tests → 7 files passed, 59 tests passed.
- `npm audit --workspace=apps/web --audit-level=high` → found 0 vulnerabilities.
- Secrets grep had one fixture-only hit: `apps/web/src/__tests__/blur-data-url.test.ts:190` contains an intentionally fake attacker URL/token string.

## Notes Not Re-Filed

- Prior postcss bundled-transitive note: not re-filed; current `npm audit --audit-level=high` reports 0 vulnerabilities.
- Prior run-9 convergence findings and carried polish items: not re-raised; I found no new evidence changing severity or exit criteria.

## Disposition

No scheduled security fixes from this lane. No source files were modified.
