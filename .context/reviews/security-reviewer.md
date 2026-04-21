# Security Review Report

**Scope:** `apps/web` Next.js app, auth/session stack, admin DB tooling, upload/share/public data paths, deploy/container config, dependency tree, and secrets/history scans.
**Risk Level:** MEDIUM

## Inventory Reviewed

### Auth / Authz / Session
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/scripts/check-api-auth.ts`

### Admin DB / Backup / Restore
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`

### Public / Share / Upload / Privacy
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`

### Admin mutation surfaces
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`

### Infra / headers / deploy / storage
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `scripts/deploy-remote.sh`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/image-url.ts`

### Dependency / secret review
- `apps/web/package.json`
- `package-lock.json`
- `npm audit --json` (prod + full tree)
- grep scan for secrets / unsafe patterns
- `git log --all -G '(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE KEY|AKIA|SESSION_SECRET|DB_PASSWORD|ADMIN_PASSWORD)'`

## Summary
- Critical issues: 0
- High issues: 0
- Medium issues: 3
- Low issues: 2
- Confirmed issues: 4
- Likely issues: 1
- Risks needing manual validation: 1

No tracked hardcoded secrets were found in committed files or via the git-history regex sweep. Ignored local secret files exist in the working tree (`.env.deploy`, `apps/web/.env.local`) but are not tracked by git in the current repository state.

---

## Confirmed Issues

### 1) Production CSP still allows inline script/style execution, weakening XSS containment
**Severity:** MEDIUM  
**Category:** OWASP A05 Security Misconfiguration / A03 Injection mitigation weakness  
**Location:** `apps/web/next.config.ts:56-92`  
**Exploitability:** Remote, usually chained with any stored/reflected/client-side injection bug  
**Blast Radius:** Full admin or user session compromise if any XSS lands; CSP will not meaningfully contain inline payloads  
**Confidence:** High

**Issue:**
Production responses set:
- `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`
- `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`

This means CSP does not block inline script execution, so it provides limited protection against future markup/script injection bugs. The external `cdn.jsdelivr.net` style allowance also expands supply-chain trust unnecessarily.

**Concrete failure scenario:**
If any future bug lets attacker-controlled HTML land in a page (for example via metadata, translations, admin-editable content, or a dependency regression), an inline payload or event-handler-based payload is far more likely to execute because CSP explicitly permits inline code.

**Suggested fix:**
Move to nonce- or hash-based CSP and remove `unsafe-inline` in production. Self-host any CSS you need instead of allowing a broad CDN origin.

```ts
// BAD
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"
"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net"

// GOOD (example direction)
const nonce = crypto.randomUUID();
const csp = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com`,
  `style-src 'self' 'nonce-${nonce}'`,
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
```

---

### 2) Unauthenticated health endpoint exposes DB liveness and performs attacker-triggerable DB work
**Severity:** LOW  
**Category:** OWASP A05 Security Misconfiguration / information exposure  
**Location:** `apps/web/src/app/api/health/route.ts:1-17`  
**Exploitability:** Remote, unauthenticated  
**Blast Radius:** Operational visibility leakage; low-cost repeated probes hit the DB  
**Confidence:** High

**Issue:**
`GET /api/health` is publicly reachable and directly executes `SELECT 1` against the database, returning `200 {status:'ok'}` or `503 {status:'degraded'}`.

**Concrete failure scenario:**
An attacker can continuously probe this endpoint to:
- monitor DB availability during an attack or outage,
- cheaply confirm whether the backing DB is reachable,
- generate steady DB load from the internet without authentication.

This is not catastrophic, but it unnecessarily exposes operational state.

**Suggested fix:**
Restrict health checks to an internal network, a shared secret, or a reverse-proxy allowlist.

```ts
// BAD
export async function GET() {
  await db.execute(sql`SELECT 1`);
  return Response.json({ status: 'ok' });
}

// GOOD
export async function GET(request: Request) {
  const token = request.headers.get('x-health-token');
  if (token !== process.env.HEALTHCHECK_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  await db.execute(sql`SELECT 1`);
  return Response.json({ status: 'ok' });
}
```

---

### 3) Vulnerable dev/build dependency chain present (`drizzle-kit` -> `esbuild` advisory)
**Severity:** MEDIUM  
**Category:** OWASP A06 Vulnerable and Outdated Components  
**Location:** `apps/web/package.json:56-70` (`drizzle-kit`) plus `npm audit --json` output  
**Exploitability:** Primarily local/dev/build-time; depends on developer using an exposed dev server or vulnerable tooling path  
**Blast Radius:** Developer workstation / CI exposure rather than direct production runtime compromise  
**Confidence:** High

**Issue:**
Full dependency audit reports a moderate advisory in the `drizzle-kit`/`@esbuild-kit`/`esbuild` chain. Reported issue:
- `esbuild enables any website to send any requests to the development server and read the response` (`GHSA-67mh-4wv8-2f99`)

Because `drizzle-kit` is a dev dependency, this is not a direct production-runtime issue, but it still matters for developer and CI environments.

**Concrete failure scenario:**
A developer running vulnerable tooling locally while browsing a malicious site could expose local dev/build endpoints or data, depending on how the tooling is used and network-bound.

**Suggested fix:**
Upgrade away from the vulnerable chain, or pin a safe version if a direct `drizzle-kit` upgrade path exists.

```json
// BAD
"devDependencies": {
  "drizzle-kit": "^0.31.10"
}

// GOOD (example direction; pick a version that clears the audit)
"devDependencies": {
  "drizzle-kit": "<patched-version>"
}
```

Also re-run:
- `npm audit --json`
- any migration / schema-generation workflows

---

### 4) Public share routes still accept short legacy keys
**Severity:** MEDIUM  
**Category:** OWASP A01 Broken Access Control / token entropy weakness  
**Location:**
- `apps/web/src/lib/data.ts:492-495`
- `apps/web/src/lib/data.ts:534-540`
- current generators are `10` chars only in `apps/web/src/app/actions/sharing.ts:17-18,109,214`
**Exploitability:** Remote, unauthenticated, only if short legacy keys still exist in the database  
**Blast Radius:** Unauthorized access to shared photos or groups that still use legacy low-entropy tokens  
**Confidence:** Medium

**Issue:**
New share keys are generated at length `10`, but public read paths still accept:
- photo keys of length `5` or `10`
- group keys of length `6` or `10`

That preserves backward compatibility, but also preserves much weaker token spaces for any legacy rows that were never rotated.

**Concrete failure scenario:**
If legacy 5-character photo share keys or 6-character group keys still exist, an unauthenticated attacker can brute-force or enumerate them far more cheaply than the 10-character scheme. That could expose private shared albums or images without admin access.

**Suggested fix:**
Either rotate all legacy keys to 10-character values and then reject short lengths, or gate legacy-key support behind a one-time migration flag.

```ts
// BAD
if (!isBase56(trimmedKey, [5, 10])) return null;
if (!isBase56(trimmedKey, [6, 10])) return null;

// GOOD
if (!isBase56(trimmedKey, 10)) return null;
```

If legacy compatibility is temporarily required, add a migration to enumerate and rotate all short keys before removing support.

---

## Risks Needing Manual Validation

### 5) Proxy trust misconfiguration collapses all rate limits to `unknown`
**Severity:** LOW  
**Category:** OWASP A05 Security Misconfiguration  
**Location:** `apps/web/src/lib/rate-limit.ts:59-82`; deployment expectation in `apps/web/docker-compose.yml:13-18`  
**Exploitability:** Remote if production is behind a proxy but `TRUST_PROXY=true` is not set  
**Blast Radius:** One actor can consume the shared `unknown` bucket and throttle login/search/share/upload actions for everyone  
**Confidence:** High (behavior confirmed, deployment status needs validation)

**Issue:**
When `TRUST_PROXY` is not explicitly `true`, proxy headers are ignored and the app uses the literal key `unknown` for rate-limited actions.

**Concrete failure scenario:**
If production traffic really arrives through nginx/load balancers but `TRUST_PROXY` is missing, one remote client can burn the shared `unknown` bucket and cause cross-user throttling or admin lockout side effects.

**Suggested fix:**
Validate every deployed environment sets `TRUST_PROXY=true` only when the proxy chain is trusted and actually injects `X-Forwarded-For` / `X-Real-IP`.

```ts
// Current defensive behavior
if (process.env.TRUST_PROXY === 'true') {
  // trust forwarded headers
}
return 'unknown';
```

Operationally, add a startup check in production that warns or fails closed when proxy headers are present but `TRUST_PROXY` is absent.

---

## What I Checked and What Held Up

### Secrets scan
- No tracked hardcoded secrets found in committed files reviewed.
- Git history regex scan did not surface committed secret material in tracked project files.
- Ignored local secret files exist in the working tree (`.env.deploy`, `apps/web/.env.local`), but `git ls-files` confirms they are currently untracked.

### Auth/authz
- Admin route protection exists both at page/layout level and API-wrapper level.
- `/api/admin/db/download` is wrapped with `withAdminAuth(...)`.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and conditionally `Secure`.
- Session secrets correctly refuse DB fallback in production.
- Session tokens are HMAC-signed and verified with `timingSafeEqual`.
- Password hashing uses Argon2id.
- Login and password-change flows include DB-backed + in-memory rate limiting.

### File/path handling
- Uploaded derivative serving includes segment validation, realpath containment, symlink rejection, and type/extension checks.
- Backup download route includes filename validation, symlink rejection, and realpath containment.
- Restore flow streams to disk, caps size, and scans SQL for dangerous statements before invoking `mysql`.

### DB child-process handling
- Backup/restore tooling correctly avoids leaking DB creds in argv by using `MYSQL_*` env vars instead of command-line password flags.
- `HOME` is intentionally excluded from child-process env to avoid accidental `~/.my.cnf` injection.

---

## Missed-Issues Sweep

I did a final sweep across:
- all route handlers under `src/app/api/**/route.ts(x)`
- all server actions under `src/app/actions/**`
- auth/session/rate-limit helpers
- upload/share/privacy data paths
- deploy/container config
- secret regex scan
- dependency audit

I did **not** find:
- confirmed SQL injection in application query code,
- confirmed auth bypass in admin routes/actions,
- confirmed path traversal in upload/download handlers,
- confirmed committed plaintext secrets in tracked files,
- confirmed public leakage of GPS/original filenames from the public data selectors.

## Security Checklist
- [x] No tracked hardcoded secrets found in reviewed committed files
- [x] Input validation reviewed across auth/admin/public/share/upload flows
- [x] Injection prevention reviewed
- [x] Authentication/authorization reviewed
- [x] Dependency audit run

