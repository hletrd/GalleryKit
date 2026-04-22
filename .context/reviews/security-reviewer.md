# Security Review Report

**Scope:** Entire repo, with focused review of auth/session handling, admin/authz flows, uploads/serving paths, sharing links, backup/restore, deploy/env handling, and public data exposure.

**Inventory reviewed:**
- Auth/session/middleware: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`
- Uploads/serving/storage: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/*`
- Public/share/data paths: `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/(public)/**/*`
- Admin/db/backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`
- Deploy/env/infrastructure: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`, `apps/web/scripts/*`, `apps/web/.env.local.example`, `README.md`, `CLAUDE.md`
- Schema/privacy surfaces: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/validation.ts`

**Verification performed:**
- HEAD secrets grep: `rg -n --hidden -S ... 'api[_-]?key|secret|token|password|...` across repo
- Git history secret scan: `git log --all -p -S 'SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555' -- apps/web/.env.local.example`
- Dependency audit: `npm audit --omit=dev --json` → **0 prod vulns**
- Targeted tests passed:
  - `src/__tests__/backup-download-route.test.ts`
  - `src/__tests__/serve-upload.test.ts`
  - `src/__tests__/privacy-fields.test.ts`
  - `src/__tests__/sql-restore-scan.test.ts`
  - `src/__tests__/session.test.ts`
  - `src/__tests__/auth-rate-limit.test.ts`
  - `src/__tests__/request-origin.test.ts`
  - `src/__tests__/restore-maintenance.test.ts`

**Overall risk level:** **MEDIUM**

---

## Summary
- **Confirmed issues:** 2
- **Likely risks:** 1
- **Manual-validation risks:** 1
- **Prod dependency audit:** 0 vulnerabilities
- **Missed-issues sweep:** completed

---

## Findings

### 1) Historical admin secret/default credential exposure in git history
**Status:** Confirmed
**Severity:** HIGH
**Category:** OWASP A02 Cryptographic Failures / A07 Identification and Authentication Failures / Secrets exposure
**Primary citations:**
- Current placeholder state: `apps/web/.env.local.example:17-25`
- Historical exposure confirmed via git history on `apps/web/.env.local.example`:
  - initial commit `d7c3279066285c94e9b1570cb37778b3031378e3`
  - later fix commit `d068a7fbd62642d574d605055afe8df9c223f635`
  - exposed values in history included:
    - `ADMIN_PASSWORD=password`
    - `SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555`

**Issue:**
The current HEAD no longer tracks a live secret in the example file, but repo history contains a fixed `SESSION_SECRET` and a weak default bootstrap admin password. If any environment, fork, or operator copied those historical values into a live deployment, session forgery and trivial admin login become possible.

**Concrete exploit/failure scenario:**
An attacker who knows the historically committed `SESSION_SECRET` can forge valid `admin_session` cookies for any user if a deployment still uses that secret. If a deployment reused `ADMIN_PASSWORD=password`, admin access becomes trivial via the normal login flow.

**Why this matters cross-file:**
- Session signing is HMAC-based in `apps/web/src/lib/session.ts:16-89`.
- Login/session issuance occurs in `apps/web/src/app/actions/auth.ts:146-217`.
- The historical secret directly undermines both when reused.

**Suggested fix:**
- Treat the historical `SESSION_SECRET` as permanently compromised.
- Rotate `SESSION_SECRET` everywhere, invalidate all sessions, and force-reset bootstrap/admin passwords anywhere derived from old examples.
- Add secret scanning in CI/pre-receive to prevent future example-secret commits.
- Consider documenting a one-time secret rotation checklist in `README.md`.

**Confidence:** High

---

### 2) Restore maintenance lock is process-local, not cluster-wide
**Status:** Likely risk
**Severity:** MEDIUM
**Category:** OWASP A04 Insecure Design / A05 Security Misconfiguration / integrity during privileged restore flows
**Primary citations:**
- Process-local flag only: `apps/web/src/lib/restore-maintenance.ts:1-56`
- Restore entrypoint toggles only that in-memory flag: `apps/web/src/app/[locale]/admin/db-actions.ts:243-284`
- Sensitive mutations depend on that flag for blocking:
  - uploads: `apps/web/src/app/actions/images.ts:82-90`
  - sharing: `apps/web/src/app/actions/sharing.ts:78-86`, `164-168`, `269-273`, `306-310`
  - settings: `apps/web/src/app/actions/settings.ts:36-40`
  - password change: `apps/web/src/app/actions/auth.ts:266-269`

**Issue:**
The restore lock uses `GET_LOCK('gallerykit_db_restore', 0)` to serialize DB restore work on one DB session, but the app-wide “maintenance mode” that blocks other writes is only a `globalThis` boolean inside one Node.js process. In a multi-process or multi-instance deployment, sibling workers/instances will not see `restoreMaintenance.active === true` and can continue to accept admin writes while one instance is restoring the database.

**Concrete exploit/failure scenario:**
In a horizontally scaled deployment, admin A starts a restore on instance 1. During the restore window, admin B hits instance 2 and uploads images or changes settings. Those writes can race with the restore stream, causing restored data to diverge immediately, reintroducing deleted rows, or leaving DB/file state inconsistent.

**Suggested fix:**
- Move restore maintenance state to a shared coordination primitive visible to every instance (DB row, Redis key, durable lock table, etc.).
- Gate sensitive write actions on that shared state, not `globalThis`.
- Keep the existing DB advisory lock for restore serialization, but do not rely on it as the only app-wide write fence.

**Confidence:** High

---

### 3) Health endpoint publicly discloses backend state
**Status:** Confirmed
**Severity:** LOW
**Category:** OWASP A05 Security Misconfiguration / A01 Broken Access Control (information exposure)
**Primary citations:**
- Public route behavior: `apps/web/src/app/api/health/route.ts:6-16`
- Container health check depends on it: `apps/web/Dockerfile:75-77`
- nginx proxies arbitrary `/api/*` traffic by default: `apps/web/nginx/default.conf:108-122`

**Issue:**
`/api/health` is unauthenticated and returns `200 {"status":"ok"}` when DB is reachable and `503 {"status":"degraded"}` when it is not. This gives any internet client a live signal about application/database availability.

**Concrete exploit/failure scenario:**
An attacker can continuously probe `/api/health` to detect DB outages, maintenance windows, or partial failures, then time brute-force or availability attacks when the service is already degraded.

**Suggested fix:**
- Prefer localhost-only or reverse-proxy-restricted health checks.
- If remote probing is required, require a secret header/token enforced at nginx or the platform LB.
- If a public health endpoint must remain public, return a generic `ok`/`error` without revealing DB-specific state.

**Confidence:** High

---

### 4) Backup files are stored as plaintext on a persistent volume with no in-app retention or encryption controls
**Status:** Manual-validation risk
**Severity:** LOW-MEDIUM
**Category:** OWASP A02 Cryptographic Failures / A05 Security Misconfiguration / sensitive data exposure
**Primary citations:**
- Backup creation to disk: `apps/web/src/app/[locale]/admin/db-actions.ts:118-143`
- Backup file kept under persistent app data: `apps/web/src/app/[locale]/admin/db-actions.ts:120-123`
- Persistent volume mount: `apps/web/docker-compose.yml:19-21`
- Authenticated download path: `apps/web/src/app/api/admin/db/download/route.ts:19-62`

**Issue:**
Database backups are written as plaintext `.sql` files into `data/backups` on a persistent volume. The app enforces download auth and file permissions, but the codebase does not implement encryption-at-rest, key wrapping, automatic retention, or purge of old backups.

**Concrete exploit/failure scenario:**
If host-level backups, shared volumes, snapshot tooling, or operator access expose `data/backups`, an attacker gets a full SQL dump containing admin password hashes, sessions table contents, audit data, image metadata, and any sensitive config rows.

**Suggested fix:**
- Encrypt backups before writing them to persistent storage (for example age/GPG/KMS-managed envelope encryption).
- Add retention and purge policy for old dumps.
- Store backups outside the general app volume when possible, with dedicated access controls and auditability.
- If infra already guarantees encrypted volumes and snapshot controls, document that explicitly; otherwise this remains an exposure gap.

**Confidence:** Medium

---

## Notable defenses / things that looked good
- **Session secret handling is hardened in production:** `apps/web/src/lib/session.ts:19-36` refuses DB-stored fallback in production.
- **Session cookies are `httpOnly` + `secure` (prod/TLS) + `sameSite: 'lax'`:** `apps/web/src/app/actions/auth.ts:204-215`.
- **Admin API download route is auth-wrapped and traversal/symlink checked:** `apps/web/src/lib/api-auth.ts:9-18`, `apps/web/src/app/api/admin/db/download/route.ts:12-42`.
- **Upload serving path has dir allowlist, extension allowlist, symlink checks, and containment checks:** `apps/web/src/lib/serve-upload.ts:32-114`.
- **Public image/share queries intentionally omit privacy-sensitive fields:** `apps/web/src/lib/data.ts:110-200`, validated by `apps/web/src/__tests__/privacy-fields.test.ts:13-38`.
- **Restore scanner blocks multiple dangerous SQL classes and has test coverage for comment/literal stripping:** `apps/web/src/lib/sql-restore-scan.ts:1-75`, `apps/web/src/__tests__/sql-restore-scan.test.ts:5-42`.
- **Production dependency audit was clean:** `npm audit --omit=dev --json` returned 0 prod vulns.

---

## OWASP-focused coverage notes
- **A01 Broken Access Control:** reviewed admin route protection, server actions, backup download auth, share-link public access boundaries.
- **A02 Cryptographic Failures:** reviewed session signing, password hashing, secret handling, backup data exposure.
- **A03 Injection:** reviewed SQL usage, restore scanning, CSV escaping, shell/child-process usage in dump/restore/deploy flows.
- **A04 Insecure Design:** reviewed restore orchestration, public/private image separation, sharing design.
- **A05 Security Misconfiguration:** reviewed health exposure, proxy/deploy settings, TLS defaults.
- **A06 Vulnerable Components:** `npm audit --omit=dev --json` clean.
- **A07 Identification/Auth Failures:** reviewed Argon2 usage, session invalidation, rate limiting, admin-user lifecycle.
- **A08 Software/Data Integrity Failures:** reviewed backup/restore, queue/restore interactions, integrity checks around image processing.
- **A09 Logging/Monitoring Failures:** audit logging exists for login/share/backup/restore/user actions.
- **A10 SSRF / request trust boundaries:** reviewed URL/base-url config and image base URL validation in `apps/web/next.config.ts:7-27`.

---

## Missed-issues sweep / residual checks
I did a second-pass sweep specifically for likely misses in uploads, share links, backup download traversal, API auth wrapping, and public PII leakage. I did **not** find a current HEAD bypass for:
- upload path traversal into private originals,
- unauthenticated backup download,
- public GPS/`filename_original` leakage in the public data selectors,
- or a prod dependency CVE in current `npm audit` output.

Remaining manual-validation items outside tracked code:
- Untracked real env files (`apps/web/.env.local`, `.env.deploy`) were intentionally **not** inspected.
- Reverse-proxy/LB policy for `/api/health` should be validated in the deployed environment.
- If deployment is single-instance only, finding #2 becomes lower risk; if scaled, it should be treated as real.
- Volume/snapshot encryption and retention policy for `data/backups` should be validated operationally.

