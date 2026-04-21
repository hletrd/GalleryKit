# Security Review Report

**Scope:** Full repository review of `/Users/hletrd/flash-shared/gallery` for review-plan-fix cycle 3, including app code, admin/server actions, API routes, upload/download flows, storage backends, DB tooling, deployment scripts, nginx/docker config, and repository history.

**Risk Level:** MEDIUM

## Review inventory

Primary review-relevant areas examined:
- Auth/authz/session flow: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- Admin mutations and DB tooling: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/sharing.ts`
- Public data exposure and share paths: `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- Upload/download and file handling: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Storage backends: `apps/web/src/lib/storage/*.ts`
- DB access and migrations: `apps/web/src/db/index.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/migrate-capture-date.js`, `apps/web/scripts/seed-admin.ts`, `apps/web/scripts/init-db.ts`
- Deployment/runtime config: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- Secrets/history/docs: `.gitignore`, `apps/web/.env.local.example`, `README.md`, `CLAUDE.md`, git history for `apps/web/.env.local.example`

## Verification performed
- Secrets/pattern scan across tracked files: `rg -n --hidden -g '!node_modules' ...`
- Git history secret sweep: `git log -p --all ... | rg ...`
- Dependency audit:
  - `npm audit --omit=dev --json` at repo root: **0 vulnerabilities**
  - `npm audit --omit=dev --json` in `apps/web`: **0 vulnerabilities**
- Auth coverage check: `npm run lint:api-auth` in `apps/web`: **passed**
- Targeted security tests: `npx vitest run src/__tests__/session.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/validation.test.ts`: **5 files / 38 tests passed**

## Summary
- Confirmed issues: 2
- Material risks: 3
- Positive controls observed:
  - Admin page protection via `isAdmin()` and protected layout gating
  - Admin API route wrapped by `withAdminAuth`, plus CI check for `/api/admin/*`
  - Session tokens HMAC-signed and compared with `timingSafeEqual`
  - Public/private field separation in `src/lib/data.ts` for EXIF/GPS/original filename privacy
  - Path traversal protection on upload-serving and local storage backends
  - Restore flow scans uploaded SQL dumps for dangerous statements before execution
  - Backup/restore subprocesses avoid leaking DB credentials via CLI args

## Confirmed issues

### 1. Non-TLS database connections remain in migration/startup scripts
**Severity:** HIGH
**Category:** OWASP A02:2021 – Cryptographic Failures
**Location:**
- `apps/web/scripts/migrate.js:531-537`
- `apps/web/scripts/migrate-capture-date.js:24-30`
- Cross-file evidence: `apps/web/src/db/index.ts:5-10,12-24` enforces TLS for normal app DB traffic, while `apps/web/Dockerfile:75-79` runs `node apps/web/scripts/migrate.js` on container startup.
**Exploitability:** Network-adjacent attacker on any path between app host and a non-local MySQL server.
**Blast Radius:** DB credentials disclosure plus plaintext migration traffic exposure/modification during startup or manual migration runs.
**Issue:**
The main runtime DB client intentionally enables TLS for non-local databases:
```ts
const sslConfig = (!isLocalhost && !sslDisabled) ? { ssl: { rejectUnauthorized: true } } : {};
```
but the migration scripts still create direct MySQL connections without any `ssl` option:
```ts
connection = await mysql.createConnection({
  host: getRequiredEnv('DB_HOST'),
  port: Number(getRequiredEnv('DB_PORT')),
  user: getRequiredEnv('DB_USER'),
  password: getRequiredEnv('DB_PASSWORD'),
  database: dbName,
});
```
Because `apps/web/Dockerfile` executes `node apps/web/scripts/migrate.js` before the server starts, this weaker path is part of the normal production boot sequence, not just a dev-only utility.

**Concrete exploit/failure scenario:**
A deployment points `DB_HOST` at a managed MySQL instance over a routed network. Normal app queries use TLS, but every container restart runs the migration script over plaintext. An attacker with network visibility can capture `DB_USER` / `DB_PASSWORD`, read migrated schema/data, or tamper with migration responses before the app comes up.

**Suggested fix:**
Centralize DB connection options and reuse the same non-local TLS policy in all scripts.

```ts
// BAD
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// GOOD
const dbHost = process.env.DB_HOST ?? '127.0.0.1';
const isLocalhost = ['127.0.0.1', 'localhost', '::1'].includes(dbHost);
const sslDisabled = process.env.DB_SSL === 'false';

const connection = await mysql.createConnection({
  host: dbHost,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ...((!isLocalhost && !sslDisabled)
    ? { ssl: { rejectUnauthorized: true } }
    : {}),
});
```

**Confidence:** High

---

### 2. The repository history contains a real session secret and insecure bootstrap defaults
**Severity:** MEDIUM
**Category:** OWASP A02:2021 – Cryptographic Failures / Secrets Management
**Location:**
- Git history for `apps/web/.env.local.example`
- Confirmed by `git log -p -S 'SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555' -- apps/web/.env.local.example`
- Relevant commits:
  - `d7c3279` (initial commit) introduced:
    - `ADMIN_PASSWORD=password`
    - `SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555`
  - `d068a7f` later replaced them with placeholders
**Exploitability:** Anyone with access to this repository history, old clones, mirrors, backups, or CI artifacts.
**Blast Radius:** If any environment ever used the exposed secret value, session forgery becomes possible; the documented weak default also increases odds of insecure bootstrap on older installs.
**Issue:**
The current tracked example file is fixed, but the git history still preserves a concrete session secret and insecure default admin password guidance. Even after removal from HEAD, secrets in history remain recoverable.

**Concrete exploit/failure scenario:**
An older deployment copied the historical example value into production. A user with access to repo history or leaked CI artifacts recovers the secret and forges valid admin cookies for 24 hours at a time, bypassing login entirely.

**Suggested fix:**
- Treat the historical `SESSION_SECRET` as compromised and ensure no environment still uses it.
- Rotate any derived or copied secrets.
- Consider repo history rewrite only if governance allows it; otherwise document the secret as burned and irrecoverable.
- Keep placeholders only in examples and avoid real-looking seeded secrets.

```env
# BAD
ADMIN_PASSWORD=password
SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555

# GOOD
ADMIN_PASSWORD=<generate-a-strong-admin-secret-or-argon2-hash>
SESSION_SECRET=<generate-with: openssl rand -hex 32>
```

**Confidence:** High

## Risks / hardening gaps

### R1. Production CSP still allows inline script execution
**Severity:** MEDIUM
**Category:** OWASP A05:2021 – Security Misconfiguration / XSS defense-in-depth
**Location:** `apps/web/next.config.ts:68-80`
**Risk:**
The production policy includes `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`. Current reviewed code does not show a confirmed script injection sink, but this weakens CSP materially: any future HTML/script injection bug becomes much easier to weaponize.

**Failure scenario:**
A later bug introduces a reflected or stored HTML/script gadget. Because `'unsafe-inline'` is allowed, injected inline JavaScript executes immediately instead of being blocked by CSP.

**Suggested fix:**
Prefer nonces or hashes for the small amount of inline script content, and remove `'unsafe-inline'` from `script-src`.

**Confidence:** Medium

---

### R2. Rate limiting degrades to a shared `unknown` bucket when `TRUST_PROXY` is omitted
**Severity:** MEDIUM
**Category:** OWASP A05:2021 – Security Misconfiguration
**Location:** `apps/web/src/lib/rate-limit.ts:58-89`
**Risk:**
When `TRUST_PROXY` is not set, the app intentionally ignores `X-Forwarded-For` and uses `'unknown'` as the client key. The documented docker/nginx path sets `TRUST_PROXY=true`, so this is not a bug in the checked-in deployment example, but it remains an easy production footgun if someone deploys behind a reverse proxy without carrying that setting forward.

**Failure scenario:**
A proxied production deployment forgets `TRUST_PROXY=true`. All login/search/upload throttles collapse onto the same shared bucket, causing either ineffective attacker-specific throttling or app-wide denial of service from one noisy client.

**Suggested fix:**
Fail closed in production when proxy headers are present but `TRUST_PROXY` is unset, or expose an explicit startup health check/error rather than just logging a warning.

**Confidence:** High

---

### R3. Public health endpoint leaks live DB availability to unauthenticated callers
**Severity:** LOW
**Category:** OWASP A01/A05 reconnaissance aid
**Location:** `apps/web/src/app/api/health/route.ts:6-16`
**Risk:**
`/api/health` is intentionally public and returns whether the DB is reachable (`200 {status:"ok"}` vs `503 {status:"degraded"}`). This is useful operationally, but it also gives external scanners a free liveness/DB-dependency oracle.

**Failure scenario:**
An attacker polls `/api/health` to identify maintenance windows, DB failures, or restart timing before attempting brute-force or availability attacks.

**Suggested fix:**
If external health checks are unnecessary, restrict this route to internal networks/reverse proxy auth. Otherwise keep the response as minimal as possible and document the exposure.

**Confidence:** Medium

## Auth/authz assessment
- **No confirmed admin authz bypass found** in the reviewed code.
- Protected admin pages are gated in `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:12-15`.
- Session verification in `apps/web/src/lib/session.ts:94-145` checks format, HMAC, age, DB presence, and expiry.
- API route auth coverage is narrow but currently enforced: `apps/web/src/app/api/admin/db/download/route.ts:12` uses `withAdminAuth`, and `npm run lint:api-auth` passed.
- Middleware in `apps/web/src/proxy.ts:35-53` only does a cookie shape check for page routes, which is acceptable because authoritative verification happens server-side in `verifySessionToken()`.

## Upload/download and data exposure assessment
- Upload path traversal defenses look solid in `apps/web/src/lib/serve-upload.ts:32-100` and `apps/web/src/lib/storage/local.ts:25-31`.
- Admin DB backup download route validates filenames and blocks symlinks: `apps/web/src/app/api/admin/db/download/route.ts:14-31`.
- Public/private field separation in `apps/web/src/lib/data.ts:106-197` is strong; GPS/original filenames are deliberately excluded from unauthenticated queries.
- SQL restore flow includes file size cap, header check, and dangerous-SQL scanning before invoking `mysql`: `apps/web/src/app/[locale]/admin/db-actions.ts:263-391`.

## Secrets assessment
- **Current tracked files:** no live hardcoded API keys/private keys found in tracked source/config files.
- **Historical exposure:** confirmed for the old `SESSION_SECRET` in git history as documented above.
- `.env.deploy` exists locally in the workspace but is gitignored (`.gitignore:17`), so I did **not** treat it as a repository-tracked secret issue.

## Dependency audit
- `npm audit --omit=dev --json` at repo root: no advisories
- `npm audit --omit=dev --json` in `apps/web`: no advisories

## Final sweep / missed-issue check
I did a final pass over:
- child process usage (`mysqldump`, `mysql`, `execSync`)
- `dangerouslySetInnerHTML` sinks
- admin/API route coverage
- rate-limit and proxy interactions
- storage/path handling
- deploy/runtime scripts and repository history

No additional confirmed OWASP-class vulnerabilities surfaced beyond the issues above.

## Overall assessment
The current application code is materially better than a typical small Next.js admin app: auth/session handling, privacy field separation, file path containment, and rate-limit logic are mostly thoughtful and well-tested. The main remaining **confirmed** problem is transport-security drift in the migration/startup scripts, plus the **historical** secret exposure in git history. After those are addressed, the remaining items are mostly hardening/configuration risks rather than clear exploitable bugs.
