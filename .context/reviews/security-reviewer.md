# Security Review Report

**Scope:** Entire repository review of `/Users/hletrd/flash-shared/gallery` with emphasis on OWASP Top 10, authentication/authorization, input validation, file handling, session management, data leakage, secrets exposure, and dependency risk.

**Inventory reviewed:**
- App/router/API surfaces under `apps/web/src/app/**`
- Auth/session/rate-limit/helpers under `apps/web/src/lib/**`
- DB schema/connection/migrations under `apps/web/src/db/**`, `apps/web/drizzle/**`, `apps/web/scripts/**`
- Deployment/security config under `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/.env.local.example`, `.env.deploy.example`, `README.md`
- Dependency manifests (`apps/web/package.json`, `package-lock.json`) and git history for secret exposure

**Methods used:**
- Repository inventory and targeted code review of auth, session, upload, sharing, backup/restore, search, admin actions, data-layer privacy boundaries, and deployment config
- Secrets scan (`rg` across repo + tracked env files + git history review)
- Dependency audit (`npm audit --omit=dev --json` at repo root and `apps/web/`)
- Pattern sweep for dangerous sinks (`dangerouslySetInnerHTML`, child_process, file I/O, direct SQL, cookie/session handling)

**Overall Risk Level:** MEDIUM

## Summary
- **Confirmed Issues:** 2
- **Likely Issues:** 2
- **Risks Requiring Manual Validation:** 2
- **Notable strengths:** I did **not** confirm a direct SQL injection, path traversal in public upload serving, auth bypass on protected admin pages, or public leakage of GPS / original filenames from the main public data paths. The privacy split in `lib/data.ts`, session hashing in `lib/session.ts`, and containment checks in file-serving/download routes are materially good.

---

## Confirmed Issues

### 1. Historically committed bootstrap secret and weak admin password remain permanently compromised
**Severity:** HIGH  
**Category:** OWASP A02 Cryptographic Failures / Secrets Management  
**Location:**
- Historical file revision: `apps/web/.env.local.example` in commit `d7c3279`, lines 1-11
- Current example file: `apps/web/.env.local.example:1-25`
- Current docs: `README.md:113-133`

**Confidence:** High  
**Why this is a problem:** The repo history contains an actual fixed `SESSION_SECRET` and a weak default `ADMIN_PASSWORD=password`. Even though HEAD now uses placeholders, secrets committed to git history must be treated as publicly disclosed forever.

**Evidence:**
- `git show d7c3279:apps/web/.env.local.example` shows:
  - `ADMIN_PASSWORD=password`
  - `SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555`
- Current HEAD still encourages a weak placeholder for DB auth in `apps/web/.env.local.example:1-6` (`DB_PASSWORD=password`), which increases the chance operators reuse insecure examples.

**Concrete exploit / failure scenario:** If any deployment, fork, screenshot, copied `.env`, or operator workflow ever reused the historical `SESSION_SECRET`, an attacker with repo access/history could mint valid `admin_session` cookies and fully impersonate admins. If the old bootstrap password was reused, admin login becomes trivial.

**Suggested fix:**
- Treat the historical `SESSION_SECRET` as compromised everywhere.
- Rotate `SESSION_SECRET` in every environment and invalidate all sessions.
- Force-reset bootstrap/admin passwords in any environment seeded from older examples.
- Avoid weak live-looking defaults even in examples (`DB_PASSWORD=password`).

```env
# BAD (historically committed)
ADMIN_PASSWORD=password
SESSION_SECRET=5e47a072d912b3cf7976d4b13bb75a7f20f7524eb5f7083b188de0a95ffbc555

# GOOD
ADMIN_PASSWORD=<generate-a-strong-admin-secret-or-argon2-hash>
SESSION_SECRET=<generate-with: openssl rand -hex 32>
DB_PASSWORD=<environment-specific-secret>
```

---

### 2. Vulnerable AWS SDK dependency chain is present in production dependencies
**Severity:** MEDIUM  
**Category:** OWASP A06 Vulnerable and Outdated Components  
**Location:**
- `apps/web/package.json:22-24`
- `package-lock.json` dependency graph pulled in by those packages
- Audit evidence: `npm audit --omit=dev --json`

**Confidence:** High  
**Why this is a problem:** The production dependency tree contains a moderate advisory affecting the AWS SDK XML builder chain (`fast-xml-parser` advisory `GHSA-gh4j-gqv2-49f6`). The codebase includes S3/MinIO support, so the vulnerable packages are not dead dependencies.

**Concrete exploit / failure scenario:** If this storage path is enabled and the vulnerable XML builder path is reached during object operations, specially crafted values can affect generated XML. Even when exploitability is context-dependent, shipping known-vulnerable production packages increases blast radius and complicates incident response.

**Suggested fix:** Upgrade to a non-vulnerable AWS SDK version and re-run audit in CI.

```json
// BAD
"@aws-sdk/client-s3": "^3.1032.0",
"@aws-sdk/s3-request-presigner": "^3.1032.0"

// GOOD
"@aws-sdk/client-s3": "<patched version>",
"@aws-sdk/s3-request-presigner": "<patched version>"
```

**Notes:** `npm audit` reported 20 moderate findings in this chain, centered on `fast-xml-parser <5.7.0` via the AWS SDK packages.

---

## Likely Issues

### 3. Production CSP still allows inline script execution, materially weakening XSS containment
**Severity:** MEDIUM  
**Category:** OWASP A05 Security Misconfiguration / XSS defense-in-depth  
**Location:** `apps/web/next.config.ts:59-79`

**Confidence:** Medium  
**Why this is a problem:** The production CSP includes `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com` and `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`. This means any server-side or stored HTML/script injection that lands in the DOM is much easier to turn into active script execution. CSP is supposed to be a backstop; here it is permissive enough that it would not meaningfully contain many DOM/script injection mistakes.

**Concrete exploit / failure scenario:** If a future bug slips through in admin-editable SEO fields, a new share/metadata surface, or a client-side DOM sink, the current CSP will not block inline payload execution. That turns a minor injection bug into a full admin-session compromise opportunity.

**Suggested fix:** Move to nonce- or hash-based CSP and remove `unsafe-inline` from production.

```ts
// BAD
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"

// BETTER
const nonce = crypto.randomUUID();
"script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com"
```

**Why only “Likely”:** I did not confirm a current exploitable XSS sink beyond the JSON-LD usage, which is correctly escaped by `safeJsonLd`. This is a real hardening gap, but exploitability depends on another injection source.

---

### 4. Unauthenticated health endpoint exposes backend readiness state to the internet
**Severity:** LOW  
**Category:** OWASP A01 Broken Access Control / A05 Security Misconfiguration / Information Disclosure  
**Location:** `apps/web/src/app/api/health/route.ts:6-18`

**Confidence:** High  
**Why this is a problem:** Anyone can query `/api/health` and learn whether the database is reachable (`200 {status:"ok"}` vs `503 {status:"degraded"}`). That gives external parties a free oracle for outages, maintenance windows, restore operations, or DB instability.

**Concrete exploit / failure scenario:** An attacker can poll this route to detect restore windows or DB stress, then time credential attacks or nuisance traffic for maximum operational impact. Even without direct compromise, it leaks internal service state unnecessarily.

**Suggested fix:** Keep `/api/live` public for liveness and restrict DB-readiness to trusted monitors only (auth, IP allowlist, secret header, or internal network).

```ts
// BAD
export async function GET() {
  const dbOk = await checkDb();
  return Response.json({ status: dbOk ? 'ok' : 'degraded' }, { status: dbOk ? 200 : 503 });
}

// GOOD
export async function GET(request: NextRequest) {
  if (request.headers.get('x-health-token') !== process.env.HEALTHCHECK_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  const dbOk = await checkDb();
  return Response.json({ status: dbOk ? 'ok' : 'degraded' }, { status: dbOk ? 200 : 503 });
}
```

---

## Risks Requiring Manual Validation

### 5. CSRF protection is inconsistent across authenticated mutation surfaces
**Severity:** MEDIUM (if framework protections are absent or bypassable)  
**Category:** OWASP A01 Broken Access Control / CSRF  
**Location:**
- Login origin check present: `apps/web/src/app/actions/auth.ts:91-95`
- Password change does **not** perform the same origin check: `apps/web/src/app/actions/auth.ts:272-290`
- `hasTrustedSameOrigin()` is only referenced in `login()`: `apps/web/src/lib/request-origin.ts`, `apps/web/src/app/actions/auth.ts`
- Backup download route is cookie-authenticated GET without origin validation: `apps/web/src/app/api/admin/db/download/route.ts:12-62`

**Confidence:** Medium  
**Why this needs manual validation:** Next.js Server Actions may provide some built-in origin/call-site protections, and the cookie is `SameSite=Lax`, which blocks many cross-site POSTs. However, this repo itself only applies explicit same-origin validation to `login()`, not to other state-changing admin actions. The GET backup download route is definitely cookie-authenticated without CSRF validation.

**Concrete exploit / failure scenario:** If any authenticated server action endpoint or the backup download route is reachable in a browser context where cookies are sent, a third-party site could induce an admin browser to perform unintended actions (or at least unwanted backup downloads) without reauthentication.

**Suggested fix:**
- Apply explicit same-origin / CSRF token validation consistently to all authenticated mutations.
- For backup download, prefer POST + CSRF token or signed one-time URLs.

```ts
// GOOD pattern
const requestHeaders = await headers();
if (!hasTrustedSameOrigin(requestHeaders)) {
  return { error: t('unauthorized') };
}
```

---

### 6. Rate-limit identity collapses to `"unknown"` when proxy trust is misconfigured
**Severity:** MEDIUM (deployment dependent)  
**Category:** OWASP A05 Security Misconfiguration / A07 Identification and Authentication Failures  
**Location:**
- `apps/web/src/lib/rate-limit.ts:61-86`
- Operational guidance in `apps/web/.env.local.example:34-39`
- Related docs in `README.md:124-133`

**Confidence:** High  
**Why this needs manual validation:** In proxied deployments, if `TRUST_PROXY=true` is omitted, `getClientIp()` returns `'unknown'` for everyone. That means login/search/password-change/user-create/share throttles can become global rather than per-client. This is partly documented, but it remains a real deployment hazard with security impact.

**Concrete exploit / failure scenario:** One client can exhaust the shared `'unknown'` bucket and lock out all users behind the proxy, or hide brute-force traffic inside a global anonymous bucket that is not attributable to real source IPs.

**Suggested fix:** Fail closed in production when proxy headers are present but `TRUST_PROXY` is unset, rather than just warning once.

```ts
// BETTER
if (process.env.NODE_ENV === 'production' && hasProxyHeaders(headerStore) && process.env.TRUST_PROXY !== 'true') {
  throw new Error('TRUST_PROXY must be true behind a reverse proxy');
}
```

---

## Missed-Issue Sweep / What I Re-checked

Final sweep focused on likely high-impact classes that are easy to miss:

- **SQL injection:** I did not confirm direct string-built SQL in request paths. The main data access uses Drizzle predicates or `mysql2` placeholders (`?`) in the few raw-query spots.
- **Auth/authz bypass:** Protected admin pages redirect through `isAdmin()` in layout code, and the only `/api/admin/*` route is wrapped in `withAdminAuth()`. I did not confirm a direct bypass.
- **Session handling:** Session cookies are `httpOnly`, `sameSite=lax`, and `secure` in production / TLS-forwarded requests. Session IDs are DB-stored as SHA-256 hashes. I did not find plaintext session storage.
- **File handling / traversal:** Public upload serving and backup download both perform extension/path validation plus `lstat`/`realpath` containment checks. I did not confirm a current traversal bug there.
- **Public data leaks:** The split between `adminSelectFields` and `publicSelectFields` in `apps/web/src/lib/data.ts` correctly omits GPS, original filenames, and user filenames from public/share queries.
- **Current hardcoded secrets in HEAD:** I did **not** confirm a live tracked production secret in current HEAD. The secret problem I confirmed is historical exposure in git history.

---

## Security Checklist
- [x] Secrets scan completed
- [x] Dependency audit completed
- [x] Authentication/session code reviewed
- [x] Authorization checks on admin routes/actions reviewed
- [x] Input validation and file-handling paths reviewed
- [x] Public/private data-boundary review completed
- [x] Final missed-issue sweep completed

