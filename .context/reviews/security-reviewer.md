# Security Review Report — PROMPT 1 / cycle 4

**Scope:** Whole-repo security review of GalleryKit (`/Users/hletrd/flash-shared/gallery`).
**Risk Level:** MEDIUM

## Inventory reviewed
Auth/session/admin boundary: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, admin layouts/pages.

Admin mutation surfaces: `apps/web/src/app/actions/{admin-users,images,settings,seo,tags,topics,sharing}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`.

Uploads/path traversal: `apps/web/src/lib/{serve-upload,upload-paths,process-image,storage/local,image-queue}.ts`, upload route handlers.

DB/backup/restore/rate limiting/audit: `apps/web/src/db/*`, `apps/web/src/lib/{db-restore,sql-restore-scan,rate-limit,auth-rate-limit,audit,backup-filename,mysql-cli-ssl}.ts`, scripts and drizzle config.

Public privacy/output/deploy: `apps/web/src/lib/data.ts`, public actions, `safe-json-ld`, `seo-og-url`, OG route, site config, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, Docker/deploy files, `.env.local*`, `.gitignore`, security lint scripts.

## Verification performed
- Secrets scan across source/config/history.
- `npm audit --workspaces --json` → 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web` → pass.
- `npm run lint:action-origin --workspace=apps/web` → pass.

## Findings

### SEC-C4-01 — Live secrets stored in local repo checkout
- **Severity:** HIGH
- **Category:** OWASP A02 / Secrets management
- **Location:** `apps/web/.env.local:2-9`
- **Confidence:** High
- **Status:** Confirmed
- **Issue:** DB, admin bootstrap, and session secrets exist in the workspace-local `.env.local`. The file is gitignored, but still present in the reviewed repo path.
- **Failure scenario:** A shared archive, support bundle, backup leak, screen-share, or local compromise exposes DB credentials, admin bootstrap password, and a session signing secret.
- **Suggested fix:** Rotate the secrets, keep live secrets outside the checkout, and keep only placeholder examples in repo.

### SEC-C4-02 — Deployment nginx config does not enforce HTTPS
- **Severity:** HIGH
- **Category:** OWASP A05 / Deployment security
- **Location:** `apps/web/nginx/default.conf:12-18`, `41-53`, `57-83`, `108-122`
- **Confidence:** Medium
- **Status:** Likely
- **Issue:** The shipped nginx server block listens on port 80 and proxies admin/auth traffic, with no TLS listener or HTTP→HTTPS redirect in this repo config.
- **Failure scenario:** If this config is deployed as the public edge, admin logins/cookies can traverse plaintext HTTP.
- **Suggested fix:** Terminate TLS in this nginx config or explicitly enforce/document an external TLS proxy; redirect port 80 to HTTPS.

### SEC-C4-03 — Production CSP still allows inline script execution
- **Severity:** MEDIUM
- **Category:** OWASP A05 / Unsafe headers
- **Location:** `apps/web/next.config.ts:73-76`
- **Confidence:** High
- **Status:** Risk
- **Issue:** Production CSP permits inline JavaScript via `script-src 'unsafe-inline' ...`, weakening CSP as an XSS containment layer.
- **Failure scenario:** A future stored/reflected injection in metadata, translations, framework output, or third-party snippets can execute inline payloads.
- **Suggested fix:** Remove `'unsafe-inline'` from production `script-src`; use nonces/hashes and consider `strict-dynamic` if compatible.

## Confirmed good controls
Admin auth boundaries, same-origin checks, HMAC/timing-safe session handling, upload path containment, restore scanning/maintenance controls, Drizzle parameterization, dependency audit, API-auth/action-origin lint gates all looked materially hardened.

## Final sweep / skipped files
Skipped generated/vendor/artifact data (`.next`, `node_modules`, `test-results`, historical `.context` artifacts, binary images). No additional high-confidence auth bypass, SQL injection, path traversal, SSRF, unsafe shell interpolation, or public PII leakage was found.
