# Security Review Report

**Scope:** Whole-repo security review of the GalleryKit Next.js app, auth/session layer, server actions, API routes, upload/download pipeline, DB backup/restore flow, deployment scripts, nginx/Next security headers, and supporting libraries.

**Risk Level:** MEDIUM

## Inventory Reviewed

Primary attack-surface files reviewed:
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/scripts/*.ts|js`
- `scripts/deploy-remote.sh`
- `apps/web/deploy.sh`

## Scan Summary

- Secrets scan of current tree: **no committed hardcoded credentials confirmed** in tracked source/examples. Ignored local secret files exist (`.env.deploy`, `apps/web/.env.local`) but were not dumped into this report.
- Dependency audit: `npm audit --json` => **0 known vulnerabilities**.
- Git-history targeted grep: no concrete active secret value surfaced from the targeted patterns run during this review.

## Findings

### 1) Production CSP allows inline script/style execution and weakens XSS containment
- **Severity:** MEDIUM
- **Category:** OWASP A05:2021 – Security Misconfiguration
- **Status:** Confirmed
- **Confidence:** High
- **Location:** `apps/web/next.config.ts:63-84`
- **Code region:** production CSP includes:
  - `script-src 'unsafe-inline' 'self' https://www.googletagmanager.com`
  - `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`
- **Exploit / failure scenario:** If any HTML/script injection bug lands elsewhere in the app or in third-party content/config, the CSP will not meaningfully block inline JavaScript execution because `'unsafe-inline'` permits it. This turns CSP from a strong last-line defense into a weak allowlist. The same applies to inline style injection and reliance on a third-party style CDN.
- **Blast radius:** Any successful injection on a page viewed by an authenticated admin can execute in the admin origin, enabling session-riding actions and privileged data access.
- **Suggested fix:** Move to nonce- or hash-based CSP for scripts/styles; remove `'unsafe-inline'`; self-host required CSS where possible.

### 2) `TRUST_PROXY=true` makes security decisions depend on forwarded headers
- **Severity:** MEDIUM
- **Category:** OWASP A05:2021 – Security Misconfiguration / A01:2021 – Broken Access Control (deployment-dependent)
- **Status:** Risk
- **Confidence:** Medium
- **Location:**
  - `apps/web/src/lib/request-origin.ts:32-45, 50-52, 66-89`
  - `apps/web/src/lib/rate-limit.ts:61-79`
- **Code region:** when `TRUST_PROXY === 'true'`, the app trusts `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-for`, and `x-real-ip` for:
  - same-origin enforcement on admin mutations/downloads
  - client-IP derivation for login/search/share/admin-user rate limiting
- **Exploit / failure scenario:** If the Next.js app is ever exposed directly, or deployed behind a proxy/CDN that forwards attacker-supplied `X-Forwarded-*` headers without normalizing them, an attacker can spoof client IPs to evade throttling and can potentially satisfy origin checks with forged forwarded host/proto metadata. This is not exploitable in the documented nginx setup as written, but it is a sharp deployment footgun.
- **Blast radius:** Weakens brute-force protection and origin-based admin mutation defenses across the entire privileged surface.
- **Suggested fix:** Keep the app reachable only through a trusted reverse proxy; ignore `x-forwarded-host` unless the platform guarantees header sanitation; consider deriving expected origin from a fixed config value (for example `BASE_URL`) instead of forwarded host; document `TRUST_PROXY` as unsafe unless the proxy overwrites forwarded headers.

### 3) Public health endpoint discloses internal maintenance and DB-readiness state
- **Severity:** LOW
- **Category:** OWASP A01:2021 / A05:2021 (information exposure via operational endpoint)
- **Status:** Confirmed
- **Confidence:** High
- **Location:** `apps/web/src/app/api/health/route.ts:7-29`
- **Code region:** unauthenticated route returns:
  - `503 { status: 'restore-maintenance' }`
  - `200 { status: 'ok' }`
  - `503 { status: 'degraded' }`
- **Exploit / failure scenario:** External users can poll the endpoint to learn exactly when DB restores are running or when the database is unhealthy, which helps attackers time nuisance traffic, social engineering, or opportunistic probing during maintenance windows.
- **Blast radius:** Low direct impact, but it exposes internal operational state to the public internet.
- **Suggested fix:** Restrict `/api/health` to internal probes / allowlisted networks, or return a generic readiness result without distinguishing maintenance vs DB degradation on the public edge.

## Areas Checked With No Confirmed Vulnerability

- **Secrets in current tracked tree:** no committed API keys, tokens, private keys, or plaintext credentials confirmed.
- **Dependency CVEs:** `npm audit` clean.
- **Authentication:** Argon2id password hashing, HMAC-signed session tokens, hashed session IDs in DB, constant-time signature compare, session invalidation on password change/login all looked sound.
- **Authorization:** admin server actions consistently enforce `isAdmin()` plus same-origin checks; admin API route uses `withAdminAuth` and the backup download route adds extra origin validation.
- **SQL injection:** application queries are parameterized via Drizzle or parameterized mysql2 calls; reviewed raw SQL restore scan and backup/restore child-process argument handling.
- **Command injection:** `spawn()` usage for `mysqldump`/`mysql` passes argv arrays rather than shell strings.
- **Upload/download & path traversal:** upload-serving and backup-download paths enforce containment, filename/path validation, and symlink rejection.
- **SSRF:** no server-side fetch of user-controlled external URLs was confirmed in runtime code.
- **XSS in JSON-LD:** `safeJsonLd()` correctly escapes `<`, U+2028, and U+2029 before `dangerouslySetInnerHTML`.
- **Public/private data separation:** `publicSelectFields` excludes GPS/original filenames/user filenames and has a compile-time guard.

## OWASP Top 10 Coverage

- **A01 Broken Access Control:** reviewed admin actions/routes, share-link access, upload/download path checks
- **A02 Cryptographic Failures:** reviewed Argon2/session token/HMAC/cookie handling
- **A03 Injection:** reviewed SQL/raw SQL, command spawning, XSS/JSON-LD, CSV formula escaping
- **A04 Insecure Design:** reviewed share-link issuance/revocation, restore maintenance locking, queue restore coordination
- **A05 Security Misconfiguration:** reviewed CSP, proxy trust, nginx headers, health endpoint exposure
- **A06 Vulnerable Components:** `npm audit` clean
- **A07 Identification/Auth Failures:** reviewed login, password change, session invalidation, rate limiting
- **A08 Software/Data Integrity Failures:** reviewed restore scanning, backup/restore CLI invocation, deployment scripts
- **A09 Logging/Monitoring Failures:** audit logging present on high-value auth/admin flows; no major gap confirmed
- **A10 SSRF:** no confirmed SSRF sink found

## Final Assessment

The repo is in better-than-average shape for a self-hosted app: auth, path handling, SQL usage, backup/restore command invocation, and privacy separation are all notably hardened. I did **not** find a current-tree critical or high-severity confirmed vulnerability. The main remaining issues are defense-in-depth / deployment-hardening gaps: a permissive production CSP, reliance on forwarded headers when `TRUST_PROXY=true`, and a publicly chatty health endpoint.
