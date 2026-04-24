# Security Review Report

**Repository:** `/Users/hletrd/flash-shared/gallery`
**Reviewer:** security-reviewer
**Date:** 2026-04-24
**Scope:** Entire tracked repository, excluding generated/vendor artifacts (`node_modules/`, `.next/`, binary fixtures/fonts/images). I built a tracked-file inventory with `git ls-files`, then examined every security-relevant tracked file under app routes/actions, auth/session/origin, upload/file handling, DB/data layer, restore/backup flows, scripts, deployment config, tests, and docs.
**Overall Risk Level:** **MEDIUM**

## Review method
- Built inventory from tracked files under:
  - `apps/web/src/app/**` (all routes, pages, server actions)
  - `apps/web/src/lib/**` (auth, origin, upload, restore, data, validation, storage, rate limiting)
  - `apps/web/src/db/**`
  - `apps/web/scripts/**`
  - `apps/web/{next.config.ts,Dockerfile,docker-compose.yml,nginx/default.conf,playwright.config.ts}`
  - `README.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `CLAUDE.md`
  - relevant tests in `apps/web/src/__tests__/**` and `apps/web/e2e/**`
- Ran a current-tree secrets scan with `rg`.
- Ran `npm audit --json` at repo root.
- Ran a targeted git-history secret scan with `git log -p`.
- Did a final missed-issues sweep for auth/authz, CSRF, origin checks, SQL/data flows, uploads/files, SSRF/XSS/path traversal, deployment, and test/doc mismatches.

## Inventory examined
### 1. Auth / session / provenance / admin gate
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- relevant tests: `session.test.ts`, `request-origin.test.ts`, `check-api-auth.test.ts`, `check-action-origin.test.ts`, `auth-rate-limit*.test.ts`, `admin-users.test.ts`

### 2. Admin actions / API routes / backup / restore
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- relevant tests: `backup-download-route.test.ts`, `backup-filename.test.ts`, `health-route.test.ts`, `live-route.test.ts`, `db-restore.test.ts`, `sql-restore-scan.test.ts`

### 3. Upload / file / image-processing / path handling
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/storage/{index,local,types}.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/validation.ts`
- relevant tests: `serve-upload.test.ts`, `upload-tracker.test.ts`, `validation.test.ts`, `upload-dropzone.test.ts`, `images-actions.test.ts`

### 4. Public/share/data/privacy surface
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/app/api/og/route.tsx`
- relevant tests: `privacy-fields.test.ts`, `public-actions.test.ts`, `safe-json-ld.test.ts`, `seo-actions.test.ts`

### 5. DB / scripts / deploy / docs / E2E
- `apps/web/src/db/{index,schema,seed}.ts`
- `apps/web/scripts/{init-db,migrate,migrate-admin-auth,seed-admin,seed-e2e,mysql-connection-options,entrypoint,ensure-site-config}.ts|js|sh`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `README.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `CLAUDE.md`
- `apps/web/playwright.config.ts`, `apps/web/e2e/helpers.ts`, E2E specs

## Summary
- **Confirmed issues:** 2
- **Likely / defense-in-depth risks:** 2
- **Current tracked hardcoded secrets:** 0 found
- **Dependency audit:** 0 current npm audit findings

---

## Confirmed issues

### 1. Restored database rows can drive path traversal / arbitrary file read-write during background image processing
**Severity:** HIGH  
**Confidence:** HIGH  
**Category:** OWASP A01 Broken Access Control / A05 Security Misconfiguration / file-path trust boundary failure  
**Locations:**
- `apps/web/src/app/[locale]/admin/db-actions.ts:317-410`
- `apps/web/src/lib/upload-paths.ts:48-70`
- `apps/web/src/lib/image-queue.ts:212-244`
- `apps/web/src/lib/process-image.ts:362-380`

**Why this is a problem:**
`restoreDatabase()` blocks dangerous SQL statements, but it still restores arbitrary row data into `images`. After restore, `resumeImageProcessingQueueAfterRestore()` restarts the queue. The queue trusts DB-sourced filenames (`filename_original`, `filename_webp`, `filename_avif`, `filename_jpeg`) without validating them as safe basenames.

`resolveOriginalUploadPath()` and `processImageFormats()` use `path.join(..., filename)` directly. If a crafted SQL dump inserts an unprocessed image row whose filenames are absolute paths or traversal strings, the queue can:
- read an arbitrary local image file as the original input, and/or
- write processed derivatives outside the intended upload directories.

**Concrete exploit scenario:**
An authenticated admin uploads a crafted SQL restore file that inserts:
- `images.processed = false`
- `filename_original = '/some/readable/local/image.jpg'` or `'../../outside.jpg'`
- `filename_jpeg = '/app/data/pwned.jpg'` (or similar absolute/traversal target)

Restore succeeds because the SQL scanner only blocks dangerous statements, not dangerous row values. After restore, the background queue processes the row and uses those untrusted paths. This crosses the intended trust boundary between DB data and filesystem paths.

**Blast radius:**
- arbitrary local image disclosure through generated public derivatives
- arbitrary write/overwrite within paths writable by the app user
- persistent compromise of upload/output directories after a single restore

**Remediation:**
Validate DB-sourced filenames before any filesystem use, and fail closed for restored rows with unsafe names. Prefer basename-only storage plus canonical containment checks.

```ts
// BAD
const originalPath = await resolveOriginalUploadPath(job.filenameOriginal);
await processImageFormats(originalPath, job.filenameWebp, job.filenameAvif, job.filenameJpeg, job.width);

// GOOD
import { isValidFilename } from '@/lib/validation';

function assertSafeStoredFilename(name: string) {
  if (!isValidFilename(name)) {
    throw new Error(`Unsafe stored filename: ${name}`);
  }
  return name;
}

const safeOriginal = assertSafeStoredFilename(job.filenameOriginal);
const safeWebp = assertSafeStoredFilename(job.filenameWebp);
const safeAvif = assertSafeStoredFilename(job.filenameAvif);
const safeJpeg = assertSafeStoredFilename(job.filenameJpeg);

const originalPath = await resolveOriginalUploadPath(safeOriginal);
await processImageFormats(originalPath, safeWebp, safeAvif, safeJpeg, job.width);
```

Also add restore-time validation that rejects dumps containing non-conforming stored filenames in `images` rows, and add regression tests for restored malicious filenames.

---

### 2. Historical real secret and weak bootstrap credentials remain exposed in git history
**Severity:** HIGH  
**Confidence:** HIGH  
**Category:** OWASP A02 Cryptographic Failures / Secrets Management  
**Locations:**
- `git history for apps/web/.env.local.example` (confirmed via `git log -p -S 'SESSION_SECRET=...' -- apps/web/.env.local.example`)
- current operator warnings in `README.md:113-140`
- current example env in `apps/web/.env.local.example:1-25`

**Why this is a problem:**
The current tracked files are clean, but the repository history still contains:
- a fixed real `SESSION_SECRET`
- `ADMIN_PASSWORD=password`
- `DB_PASSWORD=password`

That means any deployment, fork, backup, screenshot, or copied `.env.local.example` that reused those historical values must be treated as compromised.

**Concrete exploit scenario:**
An operator bootstraps a deployment from an old clone, copied wiki snippet, stale fork, or historical example file. An attacker with repository history can forge valid admin session cookies using the leaked historical session secret, or log in directly if the weak bootstrap password was reused.

**Blast radius:**
- full admin-session forgery for any environment still using the historical secret
- trivial admin login where the old bootstrap password was reused
- broad operational impact across forks and old deployments, not just this checkout

**Remediation:**
- Treat the historical values as permanently compromised.
- Force rotation of `SESSION_SECRET`, admin/bootstrap passwords, and any copied DB credentials in every environment ever seeded from older examples.
- Keep the existing warnings in docs/examples, but add an explicit operational runbook/checklist for secret rotation on upgrade.

```env
# BAD (historical pattern)
ADMIN_PASSWORD=password
SESSION_SECRET=<fixed shared secret>
DB_PASSWORD=password

# GOOD
ADMIN_PASSWORD=<generate-a-strong-admin-secret-or-argon2-hash>
SESSION_SECRET=<generate-with: openssl rand -hex 32>
DB_PASSWORD=<environment-specific-secret>
```

---

## Likely risks / defense-in-depth gaps

### 3. Production CSP still allows `unsafe-inline`, weakening XSS containment
**Severity:** LOW  
**Confidence:** HIGH  
**Category:** OWASP A05 Security Misconfiguration  
**Location:** `apps/web/next.config.ts:63-95`

**Issue:**
The production CSP includes:
- `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`
- `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`

I did not confirm an active XSS sink in current application code; most user data is rendered through React text nodes and JSON-LD uses `safeJsonLd()`. But `unsafe-inline` materially reduces CSP’s value as a last-line mitigation if an injection bug appears later.

**Failure scenario:**
A future reflected/stored HTML injection bug that would otherwise be blocked by a strict nonce/hash-based CSP becomes executable because inline scripts/styles are permitted.

**Remediation:**
Move toward a nonce- or hash-based CSP for scripts/styles, especially for admin surfaces.

```ts
// BAD
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"

// BETTER
"script-src 'self' 'nonce-<per-request-nonce>' https://www.googletagmanager.com'"
```

---

### 4. `logout()` lacks the explicit same-origin defense used on other auth-sensitive mutations
**Severity:** LOW  
**Confidence:** MEDIUM  
**Category:** OWASP A01 Broken Access Control / CSRF defense consistency  
**Locations:**
- `apps/web/src/app/actions/auth.ts:70-95` (`login()` explicitly checks `hasTrustedSameOrigin`)
- `apps/web/src/app/actions/auth.ts:243-258` (`logout()` does not)

**Issue:**
`login()` and `updatePassword()` explicitly enforce origin provenance, but `logout()` does not. Next.js server actions provide framework-level CSRF protection, so this is not a confirmed exploitable bypass by itself. Still, it is an inconsistent defense posture on an auth-sensitive state change.

**Failure scenario:**
If framework-level CSRF/origin protections regress, or an allowed-origin/proxy configuration weakens that boundary, cross-site logout becomes easier to trigger than the rest of the auth surface.

**Remediation:**
Apply the same same-origin guard used elsewhere in `auth.ts`.

```ts
// GOOD
const requestHeaders = await headers();
if (!hasTrustedSameOrigin(requestHeaders)) {
  redirect(localizePath(locale, '/admin'));
}
```

---

## No confirmed issue found in these areas
- **Auth/session core design:** Argon2id password hashing, HMAC-signed session tokens, hashed session-token storage, timing-safe signature comparison, production `SESSION_SECRET` enforcement all looked sound.
- **Admin API auth:** `/api/admin/db/download` uses `withAdminAuth()` plus same-origin verification.
- **Current-tree secrets:** no active hardcoded API keys, tokens, or private keys were found in tracked source/config/docs.
- **SQL injection:** application queries are Drizzle/mysql2 parameterized; I did not find direct string-concatenated user-controlled SQL in runtime paths.
- **Upload serving:** public upload routes validate segments, extension-directory mapping, and realpath containment.
- **Public privacy boundary:** `data.ts` correctly maintains separate admin/public projections and tests guard against leaking `latitude`, `longitude`, `filename_original`, etc.
- **Dependency audit:** `npm audit --json` reported **0 vulnerabilities**.

## Tests / docs mismatch notes
- Current docs correctly warn operators to rotate historical secrets and not reuse old examples.
- I did **not** find a regression test covering the restored-malicious-filename case described in Finding 1. That gap materially contributed to the issue surviving current hardening.
- The lint gates for API auth and same-origin checks are strong, but `auth.ts` is intentionally outside the generic action-origin scanner, so auth-specific provenance rules rely on manual consistency.

## Secrets and dependency audit evidence
### Secrets scan
- Current tracked files: **no live hardcoded secrets confirmed**.
- Git history: **historical secret exposure confirmed** for `apps/web/.env.local.example`.

### Dependency audit
- Command: `npm audit --json`
- Result: **0 vulnerabilities** (0 low / 0 moderate / 0 high / 0 critical)

## Final missed-issues sweep
I re-swept for:
- auth/authz bypasses
- missing admin gates on API routes
- origin/CSRF inconsistencies
- upload/path traversal bugs
- SQL/data-flow injection
- SSRF/XSS sinks
- restore/deploy mismatches
- secrets in current tree and git history

**Result:** the two confirmed issues above are the highest-value findings from this pass. The restore-to-filesystem trust-boundary bug is the most important current-code issue to fix first.

## Recommended priority order
1. **Fix Finding 1 immediately**: validate all DB-sourced stored filenames before any queue/filesystem use; add restore-time guards and regression tests.
2. **Operationally close Finding 2**: rotate any environment ever seeded from old examples/history.
3. Tighten CSP to remove `unsafe-inline` where feasible.
4. Make `logout()` origin enforcement consistent with the rest of the auth surface.
