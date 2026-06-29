# Security Reviewer — review-plan-fix cycle 4

Role: `security-reviewer`
HEAD reviewed: `0fa5beb107ff232ce6a004887ad7c574dd0e2963`
Date: 2026-06-29
Scope: current HEAD only; report-only pass. No application code was edited.

## Inventory Coverage

- Read first: `AGENTS.md`, `CLAUDE.md`, and `/Users/hletrd/.agents/skills/security-review/SKILL.md`.
- Consulted prior context only to avoid stale duplicates: current cycle-3 report, selected archived security reports, and the color-management security review. Prior findings were revalidated against current code before carry-forward.
- Inventory snapshot: 2,497 tracked files; 483 tracked files under `apps/web/src`; 176 directly security-relevant tracked files across `apps/web/src/app/api`, `apps/web/src/app/actions`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, and `.dockerignore`.
- Additional render/privacy sweep covered public/admin page and route surfaces under `apps/web/src/app`, including JSON-LD emitters, feeds, share pages, upload routes, admin pages, and OG routes.
- Security domains reviewed from code, not comments/tests alone: OWASP Top 10, auth/authz, sessions/cookies, admin personal access tokens, CSRF/origin, public/admin rate limiting, SQL/raw queries, restore SQL scanning, file upload/processing, path traversal, symlink handling, SSRF, XSS/JSON-LD/XML escaping, secrets, backup/restore, Docker/nginx/deploy safety, privacy-sensitive fields, and destructive/data-loss risks.
- Tracked secret sweep found no live committed secrets in HEAD. Tracked env files reviewed are examples/placeholders only.

## Validation Evidence

- `npm audit --workspace=apps/web --audit-level=low`: pass; 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: pass; admin API routes are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: pass; mutating server actions enforce `requireSameOriginAdmin()` or carry an explicit read-only exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; public mutating API route scan passes.
- `npm test --workspace=apps/web -- request-origin api-auth-response-headers backup-download-route sql-restore-scan semantic-route-production semantic-search-rate-limit similar-route og-photo-fallback privacy-fields safe-json-ld sanitize-stderr`: pass; 11 files / 108 tests.

## Findings

### SEC-C4-01 — Process-local security state is unsafe if production is horizontally scaled

Status: manual-validation
Original severity: Medium
Confidence: High
OWASP mapping: A04 Insecure Design, A05 Security Misconfiguration, A01 Broken Access Control

Code region:
- `apps/web/src/lib/restore-maintenance.ts:1-56` stores restore-maintenance state on `globalThis`.
- `apps/web/src/lib/upload-tracker-state.ts:7-79` stores active upload claims and cumulative upload bytes in a process-local `Map`.
- `apps/web/src/lib/rate-limit.ts:68-89`, `apps/web/src/lib/rate-limit.ts:103-108`, and `apps/web/src/lib/rate-limit.ts:314-318` keep public OG/share/search/semantic limiter state in process-local bounded maps.
- `apps/web/docker-compose.yml:14-21` ships one loopback-bound web service, which matches the documented single-instance topology, but there is no code-level shared-state mode if operators add replicas.

Why this is a problem:
The security controls above are correct only when all requests hit the same Node.js process. In a multi-process or multi-replica deployment, these controls diverge per instance. The code does not use a shared database/Redis lease for public rate-limit buckets, restore-maintenance state, or upload quota claims.

Concrete exploit/failure scenario:
An operator scales the web service to two replicas behind a load balancer. During an admin database restore on replica A, an authenticated upload or Lightroom token upload lands on replica B. Replica B sees `isRestoreMaintenanceActive()` as false and has no active upload claims from replica A, so it can accept writes while the restore is fencing only A. Separately, an attacker can multiply public search/OG/share request budgets by distributing requests across replicas, weakening DoS throttles.

Concrete fix:
Either enforce single-instance/single-writer as a hard production invariant, or move these controls to shared storage before scale-out. The robust fix is DB/Redis-backed public rate-limit buckets, a shared restore-maintenance lease/flag checked by every instance, and shared upload-claim accounting. Add a startup/deploy guard that fails when multiple replicas are configured without the shared-state mode enabled.

## Rechecked Prior Issues

- Historical AVIF/EXIF privacy leak class is not present in current code: image variants are created with explicit ICC handling and without broad metadata copying in `apps/web/src/lib/process-image.ts`; GPS stripping is centralized in `apps/web/src/lib/gps-exif-strip.ts`.
- Historical login username/control-character handling is fixed: `apps/web/src/app/actions/auth.ts` strips/rejects control input before rate-limit and Argon2 work.
- Historical health-route disclosure remains intentionally minimal: `apps/web/src/app/api/health/route.ts` returns only `ok`/`unavailable`, probes DB only when `HEALTH_CHECK_DB=true`, and sends `no-store` plus `nosniff`.
- Historical Docker build-context leakage is fixed in current HEAD: `.dockerignore` excludes `.context`, `.omx`, `.agent`, `.claude`, env files, data, uploads, and docs not required for the build.
- Historical OG SSRF/fallback risk is fixed: `apps/web/src/app/api/og/photo/[id]/route.tsx` pins internal image fetches to canonical site config instead of request origin, and fallback image URLs must stay same-origin.

## Security Posture Notes

- Auth/session: production requires a strong `SESSION_SECRET`; session tokens are HMAC-signed, timestamped, timing-safe verified, DB-hashed, and expired; admin cookies are `httpOnly`, `sameSite=lax`, and secure in production.
- Authz/API: admin API routes are covered by `withAdminAuth`; cookie-auth API requests require trusted same-origin provenance; token-auth API requests require valid hashed PATs and scope checks.
- CSRF/origin: mutating server actions call `requireSameOriginAdmin()`; public semantic/similar search routes also require same-origin before body parsing or expensive work.
- Rate limiting: login/password/user creation use pre-increment patterns with DB-backed controls where needed; public route lints passed. The remaining scale-out caveat is captured in SEC-C4-01.
- Injection: raw SQL reviewed uses Drizzle parameterization or mysql2 placeholders for runtime inputs; smart-collection SQL compiles from allowlisted AST columns and bound values; restore SQL scanning blocks dangerous statements before invoking `mysql --one-database`.
- File/path handling: upload derivative serving and backup downloads validate filenames/path segments, reject symlinks, enforce `realpath` containment, and stream the resolved path.
- Upload/image safety: upload paths use generated filenames, file-size and input-pixel caps, Sharp `failOn: 'error'`, RAW rejection unless handled as original-only, private original storage, disk-space checks, and cleanup on failure paths.
- XSS/privacy: JSON-LD uses `safeJsonLd`; XML feeds escape text; privacy-sensitive fields are guarded by the privacy fixture; public search enrichment uses the shared public projection.
- SSRF: OG photo generation does not trust request origin and caps/validates internal image fetches.
- Secrets/deploy: no live tracked secrets found; deploy secrets are gitignored; Docker runs loopback-bound behind nginx; nginx blocks original uploads and adds core security headers/rate limits.
- Backup/restore/destructive risk: dump/restore actions are admin and same-origin gated, use dedicated locks, temporary files mode `0600`, sanitized stderr, non-empty dump checks, and cleanup paths.

## Final Missed-Issues Sweep

- Negative-pattern sweeps covered `dangerouslySetInnerHTML`, JSON-LD emitters, XML feeds, `new URL`, `fetch`, child process spawn, direct shell execution, raw SQL, realpath/lstat file access, browser storage, target-blank links, env/secrets, upload roots, destructive deploy commands, and route inventories.
- Every API route under `apps/web/src/app/api` was checked for auth/origin/rate-limit posture.
- Mutating server actions were checked by source review plus the origin lint gate.
- No confirmed Critical/High code-level vulnerability was found in current HEAD.

Finding count: 1 total — 0 Critical, 0 High, 1 Medium, 0 Low. The single finding is a manual-validation operational risk, not a confirmed defect under the documented single-instance deployment.
