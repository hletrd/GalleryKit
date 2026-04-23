# Security Review Report

**Scope:** Full repository review of docs/manifests plus review-relevant application/config/runtime files, including `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, package manifests, Next.js app routes/actions/libs, DB/auth/session code, upload/restore/backup paths, Docker/nginx/deploy scripts, and dependency audit output.

**Risk Level:** MEDIUM

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 1
- Low Issues: 2
- Secrets scan: **no hardcoded secrets confirmed in tracked files**. Live secrets are present in ignored local files (`apps/web/.env.local`, `.env.deploy`), which is operationally expected but should stay out of archives/support bundles.
- Dependency audit: `npm audit --json` reports **4 moderate advisories**, all centered on `drizzle-kit` → `@esbuild-kit/*` → `esbuild`.

## Inventory / review coverage
Reviewed code and configs across these security-relevant surfaces:
- **Auth/session:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`
- **Admin mutations:** `apps/web/src/app/actions/{admin-users,images,settings,seo,sharing,tags,topics}.ts`
- **Public/data/privacy:** `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/safe-json-ld.ts`, `apps/web/src/lib/validation.ts`, `apps/web/src/lib/sanitize.ts`
- **File handling/uploads:** `apps/web/src/lib/{serve-upload,upload-paths,process-image,process-topic-image,image-queue,storage/local}.ts`, upload routes
- **Backup/restore:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`
- **Deployment/runtime/docs:** `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `scripts/deploy-remote.sh`, `.dockerignore`, `.gitignore`, env examples, READMEs, manifests
- **Tests used as evidence:** `apps/web/src/__tests__/request-origin.test.ts`, `backup-download-route.test.ts`, plus repository-wide pattern sweeps

## Findings

### 1. Vulnerable dev-tool chain (`drizzle-kit` / `esbuild`) remains in the lockset
**Severity:** MEDIUM  
**Category:** Vulnerable and Outdated Components (OWASP A06)  
**Confidence:** High  
**Status:** Confirmed  
**Location:** `apps/web/package.json:54-68` (`drizzle-kit`), confirmed by `npm audit --json`

**Why this is a problem:**  
The repository currently resolves a dependency chain with a published advisory in `esbuild` (`GHSA-67mh-4wv8-2f99`), surfaced through `drizzle-kit` / `@esbuild-kit/*`. This is mainly a **developer/CI workstation** risk rather than a production-runtime bug, but it still matters because local tooling often runs against real development data, env files, and internal network access.

**Concrete failure scenario:**  
A developer runs the affected tooling locally and visits a malicious page. The vulnerable dev server/tooling can be induced to service attacker-controlled requests, exposing local responses or internal resources reachable from the developer machine.

**Suggested fix:**  
Upgrade or replace the vulnerable chain so the installed `esbuild` is not in the affected range. Re-run `npm audit` after the change and document whether the remaining advisory is accepted risk or fully remediated.

```json
// current risk surface
{
  "devDependencies": {
    "drizzle-kit": "^0.31.10"
  }
}

// target state
{
  "devDependencies": {
    "drizzle-kit": "<patched version with non-vulnerable esbuild chain>"
  }
}
```

**Blast Radius:** Dev/CI hosts that run the affected tooling; lower than a production RCE, but still security-relevant because those environments often hold credentials and internal network reachability.

---

### 2. Backup download route accepts requests with no `Origin`/`Referer`, weakening CSRF protection for a sensitive file download
**Severity:** LOW  
**Category:** CSRF / Broken Access Control (OWASP A01/A05)  
**Confidence:** High  
**Status:** Confirmed  
**Location:** `apps/web/src/lib/request-origin.ts:62-78`, used by `apps/web/src/app/api/admin/db/download/route.ts:13-29`; behavior is also codified in `apps/web/src/__tests__/request-origin.test.ts:94-99`

**Why this is a problem:**  
`hasTrustedSameOrigin()` returns `true` when both `Origin` and `Referer` are absent. That fallback is then used to protect `/api/admin/db/download`. For a **high-sensitivity response** (database backup download), treating “missing provenance headers” as trusted is too permissive.

**Concrete failure scenario:**  
If an attacker learns or predicts a valid backup filename and gets a logged-in admin to follow a crafted top-level link that suppresses/refuses referrer metadata, the browser can send the admin’s `SameSite=Lax` session cookie and the route will allow the download because the header check falls back to `true`. This is primarily a **forced download** risk rather than straightforward exfiltration, but it is still a protection gap around a database dump.

**Suggested fix:**  
For this route, require a positively validated `Origin` or `Referer` instead of allowing the fallback. Better still, make the download a POST-backed action or issue one-time signed download tokens.

```ts
// BAD
if (!origin && !referer) {
  return true;
}

// GOOD for sensitive routes
if (!origin && !referer) {
  return false;
}
```

**Blast Radius:** Logged-in admins; sensitive DB backup artifacts.

---

### 3. `IMAGE_BASE_URL` intentionally permits plaintext `http:` origins, creating a transport-security footgun
**Severity:** LOW  
**Category:** Security Misconfiguration (OWASP A05)  
**Confidence:** High  
**Status:** Likely risk  
**Location:** `apps/web/next.config.ts:7-27`; operator guidance in `apps/web/README.md:27-29` and `README.md:123-135`

**Why this is a problem:**  
The config parser explicitly accepts both `http:` and `https:` for remote image hosting. In production, that makes it easy to accidentally serve gallery assets, OG images, and metadata-linked resources over plaintext transport even when the main site is HTTPS.

**Concrete failure scenario:**  
An operator sets `IMAGE_BASE_URL=http://cdn.example.com` during deployment. Public pages and metadata now reference plaintext image URLs, exposing request paths and potentially share-link-derived page traffic to interception or manipulation on hostile networks.

**Suggested fix:**  
Reject `http:` in production, or reject it entirely unless the app is in local development.

```ts
// BAD
if (!['http:', 'https:'].includes(parsed.protocol)) {
  throw new Error('IMAGE_BASE_URL must use http or https');
}

// GOOD
if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
  throw new Error('IMAGE_BASE_URL must use https in production');
}
```

**Blast Radius:** All public asset requests if misconfigured.

## What I did not confirm as issues
- **No hardcoded secrets in tracked source/docs/manifests** were confirmed during the repository scan.
- **No auth bypass** was confirmed in server actions; for Next.js server actions, framework-level Origin/Host checks provide baseline CSRF protection by default (reviewed against official Next.js docs and current config).
- **No SQL injection** was confirmed; data access is Drizzle-based and raw DB restore paths are scanner-gated plus filename/path constrained.
- **No path traversal/symlink breakout** was confirmed in public upload serving or backup download after reviewing containment and `realpath`/`lstat` checks.
- **No reflected/stored XSS** was confirmed in the reviewed app flows; React escaping plus `safeJsonLd()` and input validators materially reduce exposure in the examined paths.

## Missed-issues sweep
I did a final sweep across the repo for:
- auth/authz entry points
- secrets patterns
- `dangerouslySetInnerHTML`
- file-system operations (`realpath`, `lstat`, `unlink`, `mkdir`, path joins)
- child-process use (`mysqldump`, `mysql`, `execSync`, `spawn`)
- CSP / header config
- public/private field separation in data queries
- backup/restore and upload-route tests

No additional confirmed security vulnerabilities surfaced beyond the three items above.

## Security Checklist
- [x] No hardcoded secrets confirmed in tracked files
- [x] Inputs broadly validated/sanitized in reviewed mutation paths
- [x] Injection prevention reviewed
- [x] Authentication/authorization reviewed
- [x] Dependencies audited (`npm audit --json`)
- [x] Final missed-issues sweep completed
