# Security Review Report

**Scope:** Full repository security review of `gallerykit`, centered on `apps/web` code/config/scripts plus root deploy/config surfaces.
**Date:** 2026-04-25
**Risk Level:** MEDIUM

## Review method
- Built a security-relevant inventory across app routes, server actions, auth/session libs, upload/storage/image pipeline, DB restore/backup flows, deploy/runtime config, and dependency manifests.
- Read the relevant code paths under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/scripts`, `apps/web/nginx`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `scripts/deploy-remote.sh`, `README.md`, and `apps/web/README.md`.
- Ran secrets scans on the current tree and targeted git history grep.
- Ran dependency audit: `npm audit --json` and `npm ls postcss next next-intl --all --depth=2`.
- Re-ran a final missed-issues sweep for auth, CSRF/origin, uploads, shell/SQL, XSS, backup/restore, session/cookie, and deployment flags.

## Summary
- Critical issues: 0
- High issues: 0
- Medium issues: 2
- Low issues: 1

## Findings

### 1. Stateful SQL restore scanner can be bypassed across chunk boundaries
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Likely
- **Category:** OWASP A08:2021 – Software and Data Integrity Failures / backup-restore hardening
- **Location:** `apps/web/src/lib/sql-restore-scan.ts:83-125`, `apps/web/src/app/[locale]/admin/db-actions.ts:362-384`
- **Issue:** The restore scanner only carries the last `1 MiB` of raw text between chunks (`SQL_SCAN_TAIL_BYTES`) and scans `previousTail + chunk`. Because comments/literals are stripped *after* chunk concatenation, a crafted dump can separate a blocked token sequence with more than the retained tail of removable padding, causing the first token to be dropped before the dangerous statement is reconstructed.
- **Exploit / failure scenario:** An authenticated admin, compromised admin browser, or malicious “backup” file provider uploads a dump containing `CREATE` + >1 MiB of removable comment/literal padding + `TRIGGER` / `PROCEDURE` / `EVENT`. The scanner misses it, then `mysql` executes the blocked statement during restore. If the DB user has broad privileges, this can create persistent server-side logic outside the intended app-backup surface.
- **Suggested fix:** Replace the fixed-window regex scan with a streaming SQL tokenizer/parser that preserves parse state across chunks after comment/literal stripping. At minimum, preserve partial-token state rather than a raw byte tail and add regression coverage for >1 MiB split payloads.

### 2. Known vulnerable PostCSS remains in the dependency graph
- **Severity:** MEDIUM
- **Confidence:** High
- **Status:** Confirmed
- **Category:** OWASP A06:2021 – Vulnerable and Outdated Components
- **Location:** `apps/web/package.json:45-46,65`
- **Evidence:** `npm audit --json` reports `postcss` `<8.5.10` (`GHSA-qx2v-qp2m-jg93`, XSS via unescaped `</style>` in stringify output). `npm ls` shows direct `postcss@8.5.9` plus `next@16.2.3` carrying nested `postcss@8.4.31`.
- **Exploit / failure scenario:** If attacker-controlled CSS is ever passed into a PostCSS stringify path in build/tooling/runtime helpers, generated output can break out of a `<style>` context and create XSS. The current app does not obviously expose end-user CSS authoring, which limits exploitability, but the component remains a confirmed supply-chain risk.
- **Suggested fix:** Upgrade to a patched `postcss` version (`>=8.5.10`) and refresh the lockfile. Re-check whether the installed `next` / `next-intl` versions still pull a vulnerable nested PostCSS and bump them if needed until `npm audit` clears.

### 3. Reverse-proxy security controls rely on operator-set `TRUST_PROXY=true`
- **Severity:** LOW
- **Confidence:** High
- **Status:** Risk
- **Category:** OWASP A05:2021 – Security Misconfiguration
- **Location:** `apps/web/src/lib/rate-limit.ts:61-87`, `apps/web/src/lib/request-origin.ts:45-68`, `apps/web/docker-compose.yml:19-20`, `README.md:145-147`
- **Issue:** Client-IP derivation, trusted host/proto origin checks, and secure-cookie protocol inference all depend on `TRUST_PROXY=true`. The documented compose deployment sets it, but manual/proxy deployments can still omit it.
- **Exploit / failure scenario:** A manual deployment behind nginx/Caddy/LB forgets `TRUST_PROXY=true`. Then `getClientIp()` collapses traffic into the shared `"unknown"` bucket, allowing one attacker to exhaust login/search/share quotas for everyone behind the site. The same misconfiguration can also mis-derive host/protocol during same-origin enforcement and secure-cookie decisions.
- **Suggested fix:** Keep the current docs/compose defaults, but harden further by failing closed in production when proxy headers are present and `TRUST_PROXY` is unset, or by validating a known deployment mode before startup.

## Cross-file trust-boundary notes
- **Auth/session boundary:** `proxy.ts` only performs a cookie-shape precheck; real auth is enforced by `isAdmin()` / `verifySessionToken()` in `auth.ts` + `session.ts`. This is sound as long as new protected entry points keep using those server-side checks.
- **CSRF/origin boundary:** Login/logout/password change explicitly use `hasTrustedSameOrigin()`, and mutating admin server actions are centralized through `requireSameOriginAdmin()`. `/api/admin/db/download` also re-checks same origin.
- **Upload boundary:** User files flow through `uploadImages()` -> `saveOriginalAndGetMetadata()` -> background `image-queue.ts` -> `serve-upload.ts`. Path traversal and symlink serving are defensively blocked in the public file-serving path.
- **Public/private data boundary:** `data.ts` separates `adminSelectFields` from `publicSelectFields`; GPS/original filename/user filename remain excluded from public share/photo queries.
- **Backup/restore boundary:** `db-actions.ts` uses same-origin + admin auth + advisory lock + temp-file scanning before `mysql` restore, but the scanner state issue above weakens this boundary.

## OWASP Top 10 sweep
- **A01 Broken Access Control:** No confirmed authz bypass found in reviewed admin actions/routes. Admin API download route is wrapped with auth and same-origin checks.
- **A02 Cryptographic Failures:** Session signing, cookie flags, Argon2 password hashing, and hashed session IDs look sound. No confirmed crypto flaw found.
- **A03 Injection:** No confirmed SQL injection or shell injection found in live request paths reviewed; SQL shell-outs use fixed binaries and env vars instead of interpolated password flags.
- **A04 Insecure Design:** No confirmed new design break beyond the restore-scanner trust-boundary weakness above.
- **A05 Security Misconfiguration:** `TRUST_PROXY` remains an operator-sensitive security setting (risk above). Nginx / Next headers and CSP are otherwise reasonably hardened.
- **A06 Vulnerable and Outdated Components:** Confirmed `postcss` advisory remains open.
- **A07 Identification and Authentication Failures:** Login/password/session invalidation flows are materially hardened; no confirmed bypass found.
- **A08 Software and Data Integrity Failures:** Restore scanner boundary issue remains likely exploitable with crafted oversized token splits.
- **A09 Security Logging and Monitoring Failures:** Audit logging exists for major admin actions; no high-priority gap confirmed.
- **A10 SSRF:** `seo_og_image_url` and `IMAGE_BASE_URL` validations restrict hostile origins; no confirmed SSRF sink found.

## Secrets scan
- **Tracked tree:** No committed API keys, private keys, DB passwords, or session secrets confirmed in current tracked source/config files.
- **Local gitignored files:** A root `.env.deploy` exists in the workspace, but this review did not print sensitive values. Its presence means deployment metadata is stored locally in the checkout, not in tracked files.
- **Git history targeted grep:** No concrete active secret value was confirmed from the targeted patterns run during this review.

## Dependency audit
- `npm audit --json`: 3 moderate findings reported (`postcss`, `next`, `next-intl` chain).
- Most actionable root cause from the current manifests is the vulnerable PostCSS chain described above.

## What I specifically checked and did **not** confirm as vulnerable
- Hardcoded secrets in tracked app code/config
- SQL injection in app request paths
- Raw shell injection in backup/restore flows
- CSRF/origin gaps on mutating admin server actions
- Public path traversal / symlink traversal in upload serving
- Public leakage of GPS/original filename/user filename through share/photo pages
- Session fixation or plaintext session storage in DB
- Unauthenticated access to `/api/admin/db/download`
- Direct exposure of original uploads under `/uploads/original/`

## Missed-issues final sweep
I re-ran targeted sweeps for:
- secret material (`api key`, `secret`, `token`, `password`)
- dangerous sinks (`spawn`, `exec`, `query`, `dangerouslySetInnerHTML`)
- auth/origin hooks (`isAdmin`, `requireSameOriginAdmin`, `withAdminAuth`, `hasTrustedSameOrigin`)
- deployment flags (`TRUST_PROXY`, `SESSION_SECRET`, `UPLOAD_ORIGINAL_ROOT`)
- restore/backup controls (`GET_LOCK`, `RELEASE_LOCK`, SQL scanner patterns)

No additional confirmed security issues surfaced beyond the findings above.

## Files reviewed
### Root / deploy / workflow
- `package.json`
- `package-lock.json`
- `scripts/deploy-remote.sh`
- `.github/workflows/quality.yml`
- `README.md`
- `.gitignore`
- `.env.deploy.example`
- local gitignored `.env.deploy` presence checked without dumping values

### App config / runtime / deploy
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/drizzle.config.ts`
- `apps/web/README.md`
- `apps/web/src/site-config.json`
- `apps/web/src/site-config.example.json`
- `apps/web/src/proxy.ts`
- `apps/web/src/instrumentation.ts`

### Auth / origin / session / rate-limit libs
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/csp-nonce.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/backup-filename.ts`

### Upload / storage / image pipeline / restore libs
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/validation.ts`

### Data / privacy / sharing / metadata libs
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/revalidation.ts`

### DB layer / scripts
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`

### Server actions / admin surfaces / routes
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/*` page/client surfaces relevant to auth/mutation flows
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/tag-input.tsx`

### Public pages / metadata surfaces
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
