# Security Review Report

**Scope:** Entire repository, with focus on auth/session handling, admin/public routes, file upload/serve paths, backup/restore flows, privacy boundaries, reverse-proxy/deployment config, docs/examples, and dependency/secrets hygiene.

**Inventory Reviewed:**
- App routes/pages: `apps/web/src/app/**` including public pages, admin pages, API routes, upload routes, OG route, health/live routes
- Server actions: `apps/web/src/app/actions*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- Security-critical libs: `src/lib/{session,api-auth,request-origin,rate-limit,auth-rate-limit,serve-upload,upload-paths,validation,data,audit,db-restore,sql-restore-scan,safe-json-ld,seo-og-url,process-image,process-topic-image,gallery-config*}.ts`
- Data layer/schema: `apps/web/src/db/{index,schema}.ts`, Drizzle SQL snapshots/migrations
- Deployment/config: `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`
- Scripts/docs/examples: `apps/web/scripts/**`, `README.md`, `CLAUDE.md`, `apps/web/.env.local.example`
- Verification artifacts: auth-route lint check, dependency audit, tracked-source secrets grep, targeted git-history scan

**Risk Level:** MEDIUM

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 2
- Low Issues: 1

## Confirmed Issues

### 1. Historically committed bootstrap/admin secrets remain permanently compromised
**Severity:** MEDIUM  
**Category:** OWASP A02 / Secrets management  
**Location:** `git history -> d7c3279:apps/web/.env.local.example:1-11`  
**Confidence:** High  
**Exploitability:** Remote, unauthenticated, but only against deployments that reused old example values  
**Blast Radius:** Any environment that copied the old `SESSION_SECRET` or bootstrap password can be fully compromised via forged admin sessions or trivial admin login

**Why this is a problem:**
A targeted git-history scan confirmed that the initial commit shipped a real `SESSION_SECRET` plus `ADMIN_PASSWORD=password` and `DB_PASSWORD=password` in the example env file. Even though HEAD now uses placeholders and adds warnings, git history is public/immutable from an attacker’s point of view. Any deployment that ever reused those values must be treated as compromised until rotated.

**Evidence:**
- `git show d7c3279:apps/web/.env.local.example` includes:
  - `DB_PASSWORD=password`
  - `ADMIN_PASSWORD=password`
  - `SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555`
- Current docs/examples now warn about rotation (`README.md`, `CLAUDE.md`, `apps/web/.env.local.example`), so this is a history exposure rather than a HEAD leak.

**Concrete failure scenario:**
An operator bootstraps production from an old clone, backup, or copied `.env.local.example`. An attacker who knows the historic `SESSION_SECRET` can mint valid `admin_session` cookies; if `ADMIN_PASSWORD=password` was reused, normal login is enough.

**Remediation:**
- Treat the historical values as permanently exposed.
- Force rotation of `SESSION_SECRET`, bootstrap/admin credentials, and any DB credentials copied from old examples.
- Keep placeholders non-live-looking in examples.

```env
# BAD (historical example)
DB_PASSWORD=password
ADMIN_PASSWORD=password
SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555

# GOOD
DB_PASSWORD=<environment-specific-secret>
ADMIN_PASSWORD=<generate-a-strong-admin-secret-or-argon2-hash>
SESSION_SECRET=<generate-with: openssl rand -hex 32>
```

## Likely Issues

### 2. Same-origin helper fails open when both `Origin` and `Referer` are missing
**Severity:** MEDIUM  
**Category:** OWASP A01 / CSRF-adjacent request validation weakness  
**Location:** `apps/web/src/lib/request-origin.ts:66-86`, used by `apps/web/src/app/actions/auth.ts:92-95`  
**Confidence:** Medium  
**Exploitability:** Cross-site, browser/proxy-dependent  
**Blast Radius:** Auth flows that rely on this helper (`login`, and the same helper if reused elsewhere) lose their intended source-validation guarantee when source headers are absent

**Why this is a problem:**
`hasTrustedSameOriginWithOptions()` defaults `allowMissingSource` to `true`, and returns success when both `Origin` and `Referer` are absent. That means the auth flow’s explicit source check is effectively bypassed in any edge case where these headers are stripped by privacy tooling, unusual browser behavior, or an intermediate proxy/CDN.

**Concrete failure scenario:**
A deployment sits behind middleware that strips `Referer`, and a browser/request path omits `Origin` on a cross-site POST. `login()` calls `hasTrustedSameOrigin()` and accepts the request because missing-source falls through to `true`, weakening the intended CSRF/login-CSRF barrier.

**Remediation:**
Fail closed by default and only opt into `allowMissingSource: true` for endpoints where missing-source requests are intentionally acceptable.

```ts
// BAD
export function hasTrustedSameOrigin(requestHeaders: HeaderLookup) {
  return hasTrustedSameOriginWithOptions(requestHeaders);
}

export function hasTrustedSameOriginWithOptions(
  requestHeaders: HeaderLookup,
  options: { allowMissingSource?: boolean } = {}
) {
  const { allowMissingSource = true } = options;
  // ...
  return allowMissingSource;
}

// GOOD
export function hasTrustedSameOrigin(requestHeaders: HeaderLookup) {
  return hasTrustedSameOriginWithOptions(requestHeaders, { allowMissingSource: false });
}

export function hasTrustedSameOriginWithOptions(
  requestHeaders: HeaderLookup,
  options: { allowMissingSource?: boolean } = {}
) {
  const { allowMissingSource = false } = options;
  // ...
  return allowMissingSource;
}
```

### 3. Production CSP still permits inline script execution
**Severity:** LOW  
**Category:** OWASP A05 / Security misconfiguration  
**Location:** `apps/web/next.config.ts:72-75`  
**Confidence:** High  
**Exploitability:** Requires a separate HTML/DOM injection path  
**Blast Radius:** Site-wide; weakens XSS containment across every page

**Why this is a problem:**
The production CSP includes `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`. That means any future HTML/script injection bug can execute inline JavaScript instead of being blocked by policy. I did not confirm an active XSS sink beyond controlled JSON-LD serialization, so this is a hardening gap rather than a complete exploit chain.

**Concrete failure scenario:**
A future reflected/stored markup bug lands in a localized string, SEO field, or new UI surface. Because inline scripts are allowed, an attacker can execute payloads that a strict nonce/hash-based CSP would have blocked.

**Remediation:**
Move analytics/bootstrap code to nonce- or hash-based scripts and remove `'unsafe-inline'` from production `script-src`.

```ts
// BAD
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"

// GOOD (example direction)
"script-src 'self' 'nonce-<per-request-nonce>' https://www.googletagmanager.com"
```

## Risks Requiring Manual Validation

1. **Deployment rotation audit for historical secrets**
   - Current tracked files are clean, but operational environments must be checked to ensure none still use the historical `SESSION_SECRET`/bootstrap values from `d7c3279`.

2. **Header preservation on auth POST paths**
   - If the current `allowMissingSource` behavior is kept, validate with real browser/proxy traffic that `Origin` or `Referer` is always present on auth-related requests in production.

## What I checked and did not flag
- **Current tracked-source secrets:** no live secrets found in current repository files.
- **Dependency audit:** `npm audit --json` in `apps/web/` returned `0` vulnerabilities.
- **Admin API auth coverage:** `npm run lint:api-auth` passed; current `/api/admin/*` route is wrapped with `withAdminAuth(...)`.
- **Path traversal / file serving:** upload serving path validation, symlink rejection, directory allowlist, and containment checks look solid.
- **Session handling:** session tokens are HMAC-signed, DB-stored as hashes, compared with `timingSafeEqual`, and production refuses DB-backed secret fallback.
- **Privacy boundary:** public data selection omits GPS, original filenames, and user filenames; compile-time guard in `data.ts` is a strong control.
- **Backup/restore:** authenticated backup download, filename validation, symlink/realpath checks, restricted dump/restore env, restore size cap, and dangerous-SQL scanning are all materially hardened.
- **SQL injection review:** application query paths are parameterized through Drizzle or parameterized mysql2 calls; I did not find a confirmed injection sink.

## Security Checklist
- [x] Secrets scan completed
- [x] Dependency audit completed
- [x] Authentication/session code reviewed
- [x] Authorization on admin/API paths reviewed
- [x] Input validation and file handling reviewed
- [x] Backup/restore and upload/serve paths reviewed
- [x] Final missed-issues sweep completed

## Verification Notes
- Secrets scan: targeted `rg` across source/docs/examples plus git-history spot check
- Dependency audit: `npm audit --json` in `apps/web/` → 0 vulns
- Admin API auth check: `npm run lint:api-auth` → passed
