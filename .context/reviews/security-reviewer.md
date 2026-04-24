# Security Review Report

**Scope:** Entire repository, with exhaustive review of security-relevant runtime/config/deploy files under `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/{next.config.ts,nginx/default.conf,Dockerfile,docker-compose.yml,drizzle.config.ts,.env.local.example}`, root deployment/workflow files, and security tests.

**Risk Level:** MEDIUM

## Inventory

Reviewed security-relevant files by area:

- **Auth/session/origin/rate limit:**
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/lib/action-guards.ts`
  - `apps/web/src/lib/api-auth.ts`
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/auth-rate-limit.ts`
  - `apps/web/src/proxy.ts`
- **Admin mutation / backup / restore / file ops:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/lib/sql-restore-scan.ts`
  - `apps/web/src/lib/db-restore.ts`
  - `apps/web/src/lib/backup-filename.ts`
  - `apps/web/src/lib/restore-maintenance.ts`
- **Uploads / path traversal / image processing / storage:**
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/process-topic-image.ts`
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/upload-paths.ts`
  - `apps/web/src/lib/storage/local.ts`
  - upload routes under `src/app/**/uploads/[...path]/route.ts`
- **Public data exposure / share surfaces / search:**
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - public/share/gallery/OG page routes under `src/app/[locale]/(public)/**`
  - `apps/web/src/app/api/og/route.tsx`
- **Admin settings/content mutation:**
  - `apps/web/src/app/actions/{admin-users,settings,seo,tags,topics}.ts`
  - `apps/web/src/lib/{validation,sanitize,safe-json-ld,seo-og-url,gallery-config,gallery-config-shared}.ts`
- **DB / migrations / deployment / infra:**
  - `apps/web/src/db/{index,schema}.ts`
  - `apps/web/scripts/{migrate.js,mysql-connection-options.js,entrypoint.sh,init-db.ts,seed-admin.ts,check-api-auth.ts,check-action-origin.ts}`
  - `apps/web/{next.config.ts,nginx/default.conf,Dockerfile,docker-compose.yml,drizzle.config.ts}`
  - `scripts/deploy-remote.sh`, `apps/web/deploy.sh`
  - `.github/workflows/quality.yml`
  - `README.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `.env.deploy.example`
- **Security tests used as evidence:**
  - `apps/web/src/__tests__/{serve-upload,backup-download-route,check-api-auth,check-action-origin,sql-restore-scan,session}.test.ts`
  - selected E2E guards under `apps/web/e2e/**`

## Summary

- Critical Issues: 0
- High Issues: 1
- Medium Issues: 1
- Low Issues: 2

## Findings

### 1. Historical repository secret exposure remains recoverable from git history
**Severity:** HIGH  
**Confidence:** High  
**Status:** Confirmed  
**Category:** OWASP A02:2021 – Cryptographic Failures / Secrets Management  
**Location:** historical `apps/web/.env.local.example` in git history:
- commit `d7c3279` added `SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555` and `ADMIN_PASSWORD=password`
- commit `d068a7f` removed the concrete session secret
- current mitigation guidance: `README.md:133-135`, `apps/web/.env.local.example:18-29`

**Failure scenario:**
If any deployed environment was bootstrapped from the old checked-in example, an attacker with repo-history access can recover the exposed session secret and forge valid admin cookies until the secret is rotated.

**Blast radius:** admin session forgery, full admin takeover, backup/restore/upload/delete access.

**Concrete fix:**
- Treat the historical secret as burned.
- Rotate `SESSION_SECRET` and any bootstrap/admin credentials in every environment that may have copied the old example.
- Document the rotation as mandatory in deployment runbooks.
- If governance permits, rewrite history; otherwise keep the current “compromised forever” warning.

```env
# BAD (historical git state)
ADMIN_PASSWORD=password
SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555

# GOOD
ADMIN_PASSWORD=<generate-a-strong-admin-secret-or-argon2-hash>
SESSION_SECRET=<generate-with: openssl rand -hex 32>
```

### 2. `drizzle-kit push` path can connect to remote MySQL without the TLS protections used by runtime/migrations
**Severity:** MEDIUM  
**Confidence:** Medium  
**Status:** Confirmed  
**Category:** OWASP A05:2021 – Security Misconfiguration / Transport Security  
**Location:** `apps/web/drizzle.config.ts:4-12`

**Issue:**
Runtime DB access (`apps/web/src/db/index.ts:6-25`) and migration scripts (`apps/web/scripts/mysql-connection-options.js:11-23`) enable TLS for non-local DB hosts by default, but `drizzle.config.ts` builds a plain `mysql://user:pass@host:port/db` URL without any TLS options. Anyone using `npm run db:push` against a remote DB may silently bypass the repo’s transport-security posture.

**Failure scenario:**
An operator runs `npm run db:push` against a managed MySQL instance over an untrusted network segment. Credentials and migration traffic can be observed or tampered with if the client falls back to plaintext.

**Blast radius:** DB credential exposure and schema/data tampering during manual admin operations.

**Concrete fix:**
Use the same TLS-aware connection options as the rest of the repo, or fail closed for remote hosts unless an explicit secure config is present.

```ts
// BAD
export default defineConfig({
  dbCredentials: {
    url: `mysql://${user}:${pass}@${host}:${port}/${db}`,
  },
});

// GOOD
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST ?? '');
export default defineConfig({
  dbCredentials: isLocal
    ? { url: `mysql://${user}:${pass}@${host}:${port}/${db}` }
    : {
        host: process.env.DB_HOST!,
        port: Number(process.env.DB_PORT ?? '3306'),
        user: process.env.DB_USER!,
        password: process.env.DB_PASSWORD!,
        database: process.env.DB_NAME!,
        ssl: { rejectUnauthorized: true },
      },
});
```

### 3. Production CSP still allows `'unsafe-inline'` scripts
**Severity:** LOW  
**Confidence:** High  
**Status:** Risk  
**Category:** OWASP A05:2021 – Security Misconfiguration  
**Location:** `apps/web/next.config.ts:73-75`, consumer inline script at `apps/web/src/app/[locale]/layout.tsx:107-117`

**Issue:**
The production CSP allows inline scripts. Current inline use is the Google Analytics bootstrap, not user-controlled content, so this is not a standalone XSS. But it materially weakens CSP as a mitigation if any future injection bug lands.

**Failure scenario:**
A later XSS bug that would otherwise be blocked by a nonce/hash-based CSP becomes executable because inline script is globally allowed.

**Blast radius:** turns minor HTML/script injection into full client-side code execution.

**Concrete fix:**
Move inline script to a nonce/hash-based policy or eliminate inline bootstrapping.

```ts
// Better direction
script-src 'self' https://www.googletagmanager.com 'nonce-<per-request>'
```

### 4. Proxy trust is security-critical; disabling/misconfiguring it collapses rate limits and origin validation
**Severity:** LOW  
**Confidence:** High  
**Status:** Likely / operational risk  
**Category:** OWASP A05:2021 – Security Misconfiguration  
**Location:**
- `apps/web/src/lib/rate-limit.ts:61-87`
- `apps/web/src/lib/request-origin.ts:32-52`
- `apps/web/docker-compose.yml:15-18`
- `README.md:139-141`

**Issue:**
The deployed app is safe only when the documented reverse-proxy contract is preserved. If `TRUST_PROXY` is omitted behind nginx/load balancers, all clients collapse into the shared `"unknown"` bucket and same-origin checks may stop using the real forwarded host/protocol.

**Failure scenario:**
One abusive client exhausts the shared login/search/share budget for all users, or admin mutations/downloads fail unpredictably because forwarded host/proto are not trusted.

**Blast radius:** broad availability impact, degraded auth protections, broken admin operations.

**Concrete fix:**
Keep `TRUST_PROXY=true` only when a trusted proxy overwrites `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`; add deployment assertions/tests so drift is caught before rollout.

## Secrets Assessment

- **Tracked repo HEAD:** no current hardcoded production secrets found.
- **Historical exposure:** confirmed in git history as described in finding #1.
- **Local workspace only:** `.env.deploy` contains real deployment coordinates but is gitignored (`.gitignore:17`), so I did **not** count it as a tracked-repository secret finding.
- **CI workflow secrets:** `.github/workflows/quality.yml:27-37` uses obvious test-only values; not treated as real credential leakage.

## Dependency Audit

- `npm audit --json` in `apps/web/` returned **0 known vulnerabilities**.

## Verification / Evidence

Commands run:

- `rg --files ...` for repo inventory
- `rg -n -i '(api[_-]?key|secret|token|password|...)' ...` for secrets scan
- `git log -p -S 'SESSION_SECRET=5e47...' -- apps/web/.env.local.example`
- `npm audit --json` in `apps/web/`
- `npm run lint:api-auth`
- `npm run lint:action-origin`
- `npx vitest run src/__tests__/serve-upload.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/session.test.ts`

Observed results:

- `lint:api-auth` passed.
- `lint:action-origin` passed.
- targeted security tests: **6 files, 48 tests passed**.
- `npm audit`: **0 vulnerabilities**.

## Files/Areas Reviewed But No Issue Found

- auth/session cookie flags and session hashing/verification
- server-action same-origin enforcement on mutating admin actions
- upload path containment and symlink defenses
- backup filename validation and download containment
- restore SQL dangerous-statement scanning
- public/private field separation for EXIF/privacy-sensitive fields
- share-key generation and revocation race handling
- API auth wrapper coverage for current `/api/admin/**` surface

## Skipped / Non-security-relevant files

I did **not** treat the following as review-relevant after inventory:

- screenshots, browser artifacts, and generated assets under `.context/`
- plan/deferred review notes under `plan/`
- presentational UI primitives under `apps/web/src/components/ui/**` with no trust-boundary logic
- binary fixtures/fonts/images (`*.png`, `*.jpg`, `*.woff2`)
- `node_modules/**`

## Security Checklist

- [x] No current tracked hardcoded secrets in HEAD
- [x] Historical secret exposure checked
- [x] Injection prevention reviewed
- [x] Authentication/authorization reviewed
- [x] XSS/JSON-LD/script injection reviewed
- [x] File upload/path traversal reviewed
- [x] Backup/restore reviewed
- [x] Session/cookie handling reviewed
- [x] Security headers/CSP reviewed
- [x] Dependency audit completed
