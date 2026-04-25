# Security Review Report

**Repo:** `/Users/hletrd/flash-shared/gallery`
**Date:** 2026-04-25
**Reviewer:** Security Reviewer
**Scope:** Entire repository, with full security-sensitive inventory review across `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/nginx/default.conf`, deployment/docker files, tests, docs, root scripts, and dependency manifests/lockfiles.
**Risk Level:** MEDIUM

## Inventory reviewed

### Runtime entry points
- API routes: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`
- Server actions: `apps/web/src/app/actions/{auth,admin-users,images,public,seo,settings,sharing,tags,topics}.ts`
- Admin DB actions: `apps/web/src/app/[locale]/admin/db-actions.ts`
- Upload/file serving routes: `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/lib/serve-upload.ts`

### Security-critical libraries
- Auth/session/origin: `apps/web/src/lib/{session,request-origin,action-guards,api-auth,rate-limit,auth-rate-limit}.ts`, `apps/web/src/proxy.ts`
- Upload/path/file handling: `apps/web/src/lib/{process-image,process-topic-image,upload-paths,storage/local,serve-upload,validation}.ts`
- DB restore/backup/SQL: `apps/web/src/lib/{db-restore,sql-restore-scan,mysql-cli-ssl}.ts`, `apps/web/src/db/index.ts`
- Privacy/data exposure: `apps/web/src/lib/data.ts`, JSON-LD/rendering helpers, SEO helpers
- Headers/CSP: `apps/web/next.config.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/nginx/default.conf`

### Deployment/config/docs/tests
- `apps/web/{Dockerfile,docker-compose.yml,deploy.sh}`
- `scripts/deploy-remote.sh`
- `README.md`, `CLAUDE.md`, `.env.local.example`, workflow config
- Security-relevant tests under `apps/web/src/__tests__/**` and e2e coverage under `apps/web/e2e/**`

## Read-only checks run
- Full-file inventory with `rg --files`
- Secrets scan with repo-wide `rg` for keys/passwords/tokens/private-key markers
- Dangerous-pattern scan (`dangerouslySetInnerHTML`, `spawn`, raw SQL/CLI, file ops)
- Git-history secret scan with `git log --all -p ... | rg ...`
- Dependency audit with `npm audit --json`
- Manual code inspection of all security-relevant routes/actions/libs listed above
- Missed-issues sweep for TODO/FIXME/unsafe/bypass/csrf/origin/eval/raw SQL patterns

---

## Findings

### 1) Transitive vulnerable PostCSS remains installed through Next.js
**Status:** Confirmed  
**Severity:** MEDIUM  
**Confidence:** High  
**Category:** OWASP A06:2021 – Vulnerable and Outdated Components  
**Location:** `apps/web/package.json:45-46,65`, `package-lock.json:7978-7989`, `package.json:7-10`  
**Evidence:** `npm audit --json` reports GHSA-qx2v-qp2m-jg93 / CWE-79 for `postcss <8.5.10`; lockfile still resolves `node_modules/next -> postcss 8.4.31`.

**Failure / exploit scenario:**
If any build-time or server-side path stringifies attacker-controlled CSS through the vulnerable PostCSS version bundled under `next`, crafted CSS can break out of a `<style>` context and become script-capable HTML. The repo already overrides root `postcss`, but that does not replace the nested `next/node_modules/postcss` instance shown in the lockfile.

**Why this matters here:**
This repo generates HTML/OG content and ships a production web app. Even if the vulnerable path is not currently reachable through a known app flow, the vulnerable component is present and `npm audit` confirms it.

**Concrete fix:**
- Upgrade `next` to a release that pulls a patched PostCSS.
- Re-run `npm audit` and verify `package-lock.json` no longer contains `node_modules/next` with `postcss: 8.4.31`.
- If upstream `next` cannot be upgraded immediately, document the exposure and verify no attacker-controlled CSS is ever passed through PostCSS stringify paths in build/runtime tooling.

```ts
// package remediation direction
// BAD: patched root postcss only; nested next copy remains vulnerable
{
  "overrides": {
    "postcss": "^8.5.10"
  }
}

// GOOD: upgrade the package that vendors the vulnerable copy
{
  "dependencies": {
    "next": "<patched-version>",
    "next-intl": "<compatible-version>"
  }
}
```

---

### 2) Historical bootstrap/session secrets and weak defaults remain exposed in git history
**Status:** Confirmed operational risk  
**Severity:** MEDIUM  
**Confidence:** High  
**Category:** OWASP A02:2021 – Cryptographic Failures / Secrets Management  
**Location:** current warning at `apps/web/.env.local.example:18-29`; history scan evidence in prior revisions of `.env` examples and helper scripts (`git log --all -p` scan surfaced prior `ADMIN_PASSWORD=password`, `DB_PASSWORD=password`, and a concrete `SESSION_SECRET` value)

**Failure / exploit scenario:**
Anyone who cloned or forked older history could still recover past bootstrap credentials or secrets and reuse them against environments that copied those historical values. The current tree warns operators to rotate old values, but the repo history itself still contains previously usable-looking secrets/defaults.

**Why this matters here:**
The current repo state is improved, but historical compromise remains relevant for any environment seeded from old examples. This is especially important for `SESSION_SECRET` because leaked historical values enable forged admin session cookies if reused.

**Concrete fix:**
- Treat all historically committed bootstrap/admin/session values as compromised and rotate them anywhere reused.
- If incident-response policy allows, rewrite git history to purge the historical values and force-push with coordinated downstream cleanup.
- At minimum, keep the current explicit rotation warning and add an operator runbook entry that rotation is mandatory for any environment older than the remediation commits.

```bash
# GOOD: rotate immediately in every deployed environment
openssl rand -hex 32   # new SESSION_SECRET
# then replace ADMIN_PASSWORD with a new strong secret or Argon2 hash
```

---

### 3) Reverse-proxy trust is a deployment-critical security assumption; misconfiguration weakens IP-based controls and origin verification
**Status:** Risk / manual validation  
**Severity:** LOW  
**Confidence:** High  
**Category:** OWASP A05:2021 – Security Misconfiguration  
**Location:** `apps/web/src/lib/rate-limit.ts:69-99`, `apps/web/src/lib/request-origin.ts:45-68,79-107`, `apps/web/docker-compose.yml:18-20`, `apps/web/nginx/default.conf:50-58,67-75,82-90,121-124`, `README.md:148`

**Failure / exploit scenario:**
If production is deployed behind a reverse proxy but `TRUST_PROXY` / `TRUSTED_PROXY_HOPS` or header overwrites are wrong, the app may collapse many clients into the shared IP bucket `"unknown"`, degrading login/search/share/upload throttling and making origin/cookie security depend on incorrect host/proto reconstruction. That can turn localized abuse into shared denial-of-service against legitimate users and can break same-origin enforcement assumptions.

**Current code posture:**
The repo documents the requirement well and the shipped Docker compose sets `TRUST_PROXY=true`, so this is not a confirmed code bug. It is a real deployment footgun because several controls depend on the same assumption.

**Concrete fix / validation:**
- In production, verify the edge proxy overwrites `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`.
- Verify `TRUST_PROXY=true` and correct `TRUSTED_PROXY_HOPS` in the deployed environment.
- Add a startup health warning or fail-fast in production when proxy headers are present but trust settings are absent/mismatched.

```ts
// GOOD hardening idea: fail fast in production when proxy trust is required but missing
if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_PROXY_TRUST === 'true' && process.env.TRUST_PROXY !== 'true') {
  throw new Error('TRUST_PROXY=true is required in this deployment');
}
```

---

### 4) Database backups are protected by auth and same-origin checks, but remain plaintext at rest in the app data volume
**Status:** Risk / manual validation  
**Severity:** LOW  
**Confidence:** Medium  
**Category:** OWASP A02:2021 – Cryptographic Failures / Sensitive Data Exposure  
**Location:** `apps/web/src/app/[locale]/admin/db-actions.ts:121-145,193-221`, `apps/web/src/app/api/admin/db/download/route.ts:13-94`, `apps/web/deploy.sh:29-34`, `apps/web/docker-compose.yml:22-25`

**Failure / exploit scenario:**
A host compromise, overly broad filesystem access, or accidental volume exposure would disclose full SQL backups containing admin/session/audit/gallery metadata because dumps are written as plaintext `.sql` files under `data/backups`. File mode `0600` helps locally, but it does not provide cryptographic protection.

**Current code posture:**
The authz/path-traversal checks around backup creation and download are solid. This is an at-rest protection gap, not an auth bypass.

**Concrete fix / validation:**
- Ensure the backing volume is access-controlled and encrypted at the host/storage layer.
- Consider optional backup-at-rest encryption before writing to disk, or automatic expiry/deletion for old dumps.
- Document retention and operator handling requirements.

```ts
// Example direction: encrypt before persistence when backups must live on shared disks
// pseudo-code
const encrypted = encryptAesGcm(sqlDumpBuffer, backupKey);
await fs.writeFile(outputPath, encrypted, { mode: 0o600 });
```

---

## Security-positive observations
- **Auth/session:** Argon2id password verification and hashing are used in admin auth flows (`apps/web/src/app/actions/auth.ts:159-160,361`; `apps/web/src/app/actions/admin-users.ts:143`). Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when HTTPS/production is detected (`apps/web/src/app/actions/auth.ts:210-219`, `385-390`). Session tokens are HMAC signed and compared with `timingSafeEqual` (`apps/web/src/lib/session.ts:82-145`).
- **Origin / CSRF defenses:** Mutating admin actions consistently enforce same-origin checks through `requireSameOriginAdmin()` or explicit auth-path checks. API download route also enforces auth + same-origin (`apps/web/src/lib/action-guards.ts:37-44`, `apps/web/src/app/api/admin/db/download/route.ts:13-32`).
- **Upload/path/file operations:** Public file serving rejects traversal and symlinks (`apps/web/src/lib/serve-upload.ts:32-114`), storage backend blocks traversal (`apps/web/src/lib/storage/local.ts:25-40`), originals are private by default (`apps/web/src/lib/upload-paths.ts:24-40`), and image input size/pixel limits exist (`apps/web/src/lib/process-image.ts:24-27,43,225-261`).
- **DB restore / CLI safety:** restore flow scans uploaded SQL for dangerous statements before piping to `mysql` (`apps/web/src/lib/sql-restore-scan.ts:23-114`, `apps/web/src/app/[locale]/admin/db-actions.ts:362-387`), uses session-scoped advisory locks, enforces file-size/header checks, and avoids credential leakage via CLI args by using env vars (`apps/web/src/app/[locale]/admin/db-actions.ts:130-143,398-410`).
- **Privacy:** public query shapes intentionally omit GPS/internal filename/original-file metadata, with explicit compile-time/privacy-guard comments and tests (`apps/web/src/lib/data.ts:111-200`).
- **CSP/headers:** security headers and CSP are present in Next and nginx config (`apps/web/next.config.ts:34-51`, `apps/web/src/lib/content-security-policy.ts:36-76`, `apps/web/nginx/default.conf:36-43,96-113`). JSON-LD injection points use escaping via `safeJsonLd()` (`apps/web/src/lib/safe-json-ld.ts:1-18`).
- **Admin API/auth coverage:** only one `/api/admin/*` route exists and it uses `withAdminAuth`; repo also ships static lint gates for admin API auth and action-origin coverage (`apps/web/src/lib/api-auth.ts:10-26`, `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`).

## OWASP Top 10 coverage verdict
- **A01 Broken Access Control:** No confirmed authz bypass found. Admin-only actions/routes consistently gate on session auth and/or same-origin.
- **A02 Cryptographic Failures:** One confirmed operational secret-history issue; one low at-rest backup protection gap.
- **A03 Injection:** No confirmed SQL/command/XSS injection found in current runtime code. Raw SQL/CLI surfaces are parameterized or input-gated; JSON-LD sinks are escaped.
- **A04 Insecure Design:** No confirmed design-level break found; restore flow and privacy partitioning are notably defensive.
- **A05 Security Misconfiguration:** One manual-validation deployment risk around proxy trust/header overwrite assumptions.
- **A06 Vulnerable and Outdated Components:** One confirmed dependency finding (`next` → `postcss 8.4.31`).
- **A07 Identification and Authentication Failures:** No confirmed issue found in current auth/session handling.
- **A08 Software and Data Integrity Failures:** No confirmed issue found beyond dependency hygiene/history handling.
- **A09 Security Logging and Monitoring Failures:** Audit logging exists for sensitive admin actions; retention/centralization should be validated operationally.
- **A10 SSRF:** No SSRF sink identified in current server code.

## Secrets scan verdict
- **Current tree:** no active hardcoded production secrets found in tracked source/config examples.
- **Current examples/docs:** placeholders are non-live and explicitly warn about rotation (`apps/web/.env.local.example:18-29`, `README.md:118-149`).
- **History:** prior weak/live-looking values were recoverable from git history and should be considered compromised if ever reused.

## Dependency audit verdict
Command run: `npm audit --json`
- Moderate advisories reported: 3 total
- Material issue retained as finding: `postcss <8.5.10` via `next 16.2.3`
- `npm audit` output also attributes the issue upward to `next` / `next-intl`; verify again after upgrading `next` and regenerating lockfile.

## Final missed-issues sweep
Completed an additional repo-wide grep for:
- secrets markers
- auth/origin/csrf hooks
- dangerous HTML sinks
- child-process usage
- raw SQL / advisory locks / restore logic
- TODO/FIXME/unsafe/bypass markers

No additional confirmed OWASP-grade issue surfaced beyond the findings above.

## Recommended priority order
1. **Upgrade `next` so the bundled PostCSS copy is patched**, then re-run `npm audit`.
2. **Rotate any environment ever seeded from older repo history** (`SESSION_SECRET`, admin/bootstrap credentials).
3. **Operationally validate reverse-proxy trust settings and header overwrite behavior** in production.
4. **Validate backup storage encryption/retention** for `data/backups`.

## Security checklist
- [x] Full repo inventory completed
- [x] Secrets scan completed
- [x] Git-history secret check completed
- [x] Dependency audit completed
- [x] Auth/authz reviewed
- [x] Origin/CSRF reviewed
- [x] Upload/path/file operations reviewed
- [x] DB restore/backup and raw CLI reviewed
- [x] CSP/headers reviewed
- [x] Privacy/PII reviewed
- [x] Missed-issues sweep completed
