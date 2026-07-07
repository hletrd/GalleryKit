# Security Reviewer Report - Cycle 9

Date: 2026-07-07 KST
Reviewer: security-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed commit: `e2d32e1d`

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the full repository from an OWASP/security/privacy/authz/secrets/trust-boundaries angle. This was a report-only review; no application code was changed.

Inventory built before review:

- Project policy and operations: `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `apps/web/.gitignore`, deploy/env examples, Docker, nginx, migration scripts, backup/restore scripts.
- Auth and authorization: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, admin route files under `apps/web/src/app/[locale]/admin/`, and all `apps/web/src/app/api/admin/**`.
- Server actions and public/admin routes: all files under `apps/web/src/app/actions/**`, `apps/web/src/app/api/**`, and locale public routes under `apps/web/src/app/[locale]/(public)/**`.
- Uploads and path handling: `apps/web/src/lib/upload-paths.ts`, `serve-upload.ts`, `upload-filenames.ts`, `upload-limits.ts`, `image-types.ts`, `process-image.ts`, `gps-exif-strip.ts`, upload actions and Lightroom upload API.
- DB backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `backup-filename.ts`, `download-filename.ts`, `sanitize.ts`.
- SSRF and server-side fetch surfaces: OG routes, `og-photo-fetch.ts`, SEO/base URL helpers, CLIP/model download scripts, semantic search routes.
- Rate limits and headers: `rate-limit.ts`, `auth-rate-limit.ts`, public route rate-limit linter, `next.config.ts`, `content-security-policy.ts`, `csp-nonce.ts`, `apps/web/nginx/default.conf`.
- Privacy fences: `data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, privacy tests, map/search route privacy tests.
- Dependency and secret exposure: root and workspace `package.json`/`package-lock.json`, env examples, gitignore coverage, local env-file metadata only.

## Findings

### C9-SEC-01 - Next bundles vulnerable PostCSS despite root override

Severity: Medium
Confidence: High
Status: Confirmed dependency advisory / risk

Code regions:

- `apps/web/package.json:57` declares `next` as `^16.2.10`.
- `apps/web/package.json:80` declares top-level `postcss` as `^8.5.16`.
- `package.json:7-9` attempts a root override to `postcss` `8.5.16`.
- `package-lock.json:9194-9205` still installs `node_modules/next` `16.2.10` with nested `postcss` `8.4.31`.

Why this matters:

`npm audit --workspace=apps/web --omit=dev --audit-level=moderate` still fails on `postcss <8.5.10` through Next's nested dependency. The root override and direct workspace dependency do not replace the PostCSS copy bundled under Next in the production dependency graph. The advisory is a moderate line-return parsing issue that can enable CSS-to-HTML escaping when an application stringifies attacker-controlled CSS into HTML.

Concrete failure scenario:

Today I did not find a route that accepts arbitrary public CSS and feeds it into PostCSS. The exposure becomes real if a future feature adds user-configurable CSS, theme snippets, or style-generation based on untrusted input and renders the stringified CSS into an HTML `<style>` context through Next's nested PostCSS. In that case, an attacker can craft CSS containing `</style>`-style control text and trigger stored or reflected XSS in a public or admin page.

Suggested fix:

Upgrade Next to a stable version that no longer carries `postcss` `8.4.31`, or validate a lockfile-level/package-manager override that actually removes the nested vulnerable copy. Do not apply `npm audit fix --force` blindly; audit currently suggests a breaking/invalid direction for this stack. Add a package-lock contract test or CI audit gate that specifically checks `node_modules/next/node_modules/postcss` once the fix lands.

### C9-SEC-02 - Deprecated esbuild-kit chain carries vulnerable esbuild in dev graph

Severity: Low
Confidence: High
Status: Confirmed dev dependency advisory / risk

Code regions:

- `apps/web/package.json:77` declares `drizzle-kit` as `^0.31.10`.
- `package-lock.json:5874-5884` installs `drizzle-kit` `0.31.10`, which depends on `@esbuild-kit/esm-loader`.
- `package-lock.json:378-386` installs deprecated `@esbuild-kit/core-utils` `3.3.2` and pins `esbuild ~0.18.20`.
- `package-lock.json:764-777` installs nested `esbuild` `0.18.20` in the dev-only graph.

Why this matters:

Full `npm audit --workspace=apps/web --audit-level=moderate` reports GHSA-67mh-4wv8-2f99 for `esbuild <=0.24.2`. The affected chain is marked `dev: true` and disappears from `npm audit --omit=dev`, so this is not a production runtime dependency. The risk is still relevant for developer or CI hosts that expose esbuild's dev server or tooling process to untrusted networks.

Concrete failure scenario:

If a developer runs a vulnerable esbuild-backed dev server on a non-loopback interface, a malicious website visited by the developer can send browser requests to the local dev server and read responses that should not be web-readable. This can leak local source, generated assets, or environment-derived debug output depending on the dev setup.

Suggested fix:

Move off the deprecated `@esbuild-kit/*` path by upgrading the Drizzle/tooling stack once an available release removes it, or add a tested package override that forces a non-vulnerable esbuild for that chain without breaking Drizzle CLI execution. Keep dev servers bound to localhost and document that tunnel/LAN exposure is not supported until the dependency graph is clean.

## Areas Reviewed With No New Finding

Auth and admin API authorization:

- `withAdminAuth` checks token scopes before the cookie path and rate-limits token auth attempts at `apps/web/src/lib/api-auth.ts:72-84`, then enforces same-origin and `isAdmin()` for cookie auth at `apps/web/src/lib/api-auth.ts:114-129`.
- Successful admin responses get `Cache-Control: no-store` and `nosniff` defaults at `apps/web/src/lib/api-auth.ts:130-141`.
- Same-origin fails closed when neither `Origin` nor `Referer` matches the expected origin at `apps/web/src/lib/request-origin.ts:87-106`.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.

Uploads and path handling:

- Original uploads are created under a private directory with owner-only mode at `apps/web/src/lib/upload-paths.ts:49-56`.
- Original filename resolution rejects absolute/path-traversal names, symlinks, and realpath escapes at `apps/web/src/lib/upload-paths.ts:120-170`.
- Legacy public originals fail production startup when present at `apps/web/src/lib/upload-paths.ts:173-193`.
- Public derivative serving validates top-level directory, extension, segment format, symlinks, and realpath containment at `apps/web/src/lib/serve-upload.ts:168-219`.
- GET serving uses fd-stat before streaming to reduce TOCTOU risk at `apps/web/src/lib/serve-upload.ts:304-369`.

DB backup/restore and CLI boundaries:

- CSV export and database dump server actions require same-origin admin checks at `apps/web/src/app/[locale]/admin/db-actions.ts:95-100` and `apps/web/src/app/[locale]/admin/db-actions.ts:173-178`.
- Backups use a private directory and `0600` temp output at `apps/web/src/app/[locale]/admin/db-actions.ts:198-202` and `apps/web/src/app/[locale]/admin/db-actions.ts:240`.
- `mysqldump` receives credentials via environment rather than argv, uses TLS args, and sanitizes stderr at `apps/web/src/app/[locale]/admin/db-actions.ts:204-210`, `apps/web/src/app/[locale]/admin/db-actions.ts:226-238`, and `apps/web/src/app/[locale]/admin/db-actions.ts:265-267`.
- Backup publication is atomic after non-empty/header/trailer checks at `apps/web/src/app/[locale]/admin/db-actions.ts:298-355`.
- Runtime DB TLS now requires `DB_SSL_CA` for non-local DB connections unless `DB_SSL=false` and uses `rejectUnauthorized: true` at `apps/web/src/db/index.ts:12-19`; the CLI helper mirrors this at `apps/web/scripts/mysql-connection-options.js:13-29`. This closes the prior runtime-CA gap.

SSRF and server-side fetch:

- The per-photo OG route pins internal derivative fetches to canonical `BASE_URL`, not attacker-controlled request origin, at `apps/web/src/app/api/og/photo/[id]/route.tsx:176-196`.
- OG fallback redirects validate the configured image URL as same-origin at `apps/web/src/app/api/og/photo/[id]/route.tsx:347-365`.
- The OG fetch helper caps per-fetch bytes and timeout at `apps/web/src/lib/og-photo-fetch.ts:30-94`.

Public route rate limits and body limits:

- Semantic search performs same-origin validation, rejects unsupported/chunked bodies, requires `Content-Length`, caps body bytes before parsing, pre-increments its rate limiter, and caps DB scan size at `apps/web/src/app/api/search/semantic/route.ts:107-184`, `apps/web/src/app/api/search/semantic/route.ts:206-245`, and `apps/web/src/app/api/search/semantic/route.ts:263-284`.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Nginx adds login/admin/public/Next image limiter zones, default request caps, and endpoint-specific body limits at `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:72-79`, and `apps/web/nginx/default.conf:99-120`.
- Nginx correctly documents a topology caveat: if this listener sits behind an LB that does not preserve source IPs, rate-limit keys collapse to the LB IP at `apps/web/nginx/default.conf:59-71`. I treated this as documented operational risk, not a new code finding.

CSP, headers, and analytics boundary:

- Next applies a restrictive production CSP to `/api/*` at `apps/web/next.config.ts:83-88`.
- Global security headers include nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS in production at `apps/web/next.config.ts:90-103`.
- The production page CSP uses nonce-restricted scripts, `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'` at `apps/web/src/lib/content-security-policy.ts:125-155`.
- Google Analytics scripts are only injected by the public layout at `apps/web/src/app/[locale]/(public)/layout.tsx:23-35`; the admin layout does not load analytics scripts at `apps/web/src/app/[locale]/admin/layout.tsx:1-36`. This closes the prior admin-analytics privacy concern.

Secrets and local files:

- I did not read local secret contents. I verified `.env.deploy` is ignored by `.gitignore:18`, `apps/web/.env.local` is ignored by `apps/web/.gitignore:33-35`, and both local files have `0600` permissions.
- `git ls-files` did not show tracked `.env`, `.env.local`, `.env.deploy`, private keys, or DB dump files.

Privacy-sensitive field fences:

- `adminSelectFields` explicitly includes admin/PII/internal fields at `apps/web/src/lib/data.ts:251-327`.
- `publicSelectFields` derives from the admin set while omitting privacy-sensitive fields at `apps/web/src/lib/data.ts:368-407`.
- `publicMapSelectFields` is the only public latitude/longitude projection and is documented as tied to `topics.map_visible` filtering at `apps/web/src/lib/data.ts:409-444`.
- Compile-time guards cover public and map field leakage at `apps/web/src/lib/data.ts:458-488`.
- Search/similar enrichment uses a centralized compile-time-guarded field set at `apps/web/src/lib/search-enrichment-fields.ts:29-47`.
- `privacy-fields.test.ts` enforces the sensitive key contract, public allowlist, symmetric admin-only delta, and search enrichment omissions at `apps/web/src/__tests__/privacy-fields.test.ts:19-57`, `apps/web/src/__tests__/privacy-fields.test.ts:90-140`, and `apps/web/src/__tests__/privacy-fields.test.ts:173-201`.

## Verification Evidence

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- Targeted Vitest security/privacy suite: 24 files, 448 tests passed, including auth, origin guards, route rate-limit scanner, privacy fields, search/map privacy, backup/restore, upload path serving, CSP, sessions, admin tokens, semantic/similar search, and OG route tests.

Failed as expected due to findings:

- `npm audit --workspace=apps/web --audit-level=moderate` failed with 6 moderate advisories: PostCSS through Next and esbuild through deprecated `@esbuild-kit/*`/Drizzle tooling.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` failed with the production PostCSS advisory only.

## Final Sweep

Commonly missed areas checked: CSRF on server actions, token-scope bypass, public mutating/expensive route rate limits, upload path traversal and symlink escapes, original upload privacy, CLI credential leakage in backup, restore/backup atomicity, server-side fetch host pinning, CSP coverage for API routes, admin analytics leakage, local env-file tracking, and symmetric privacy guard drift.

Skipped intentionally: local secret file contents and `node_modules` source contents. Dependency conclusions are based on `package-lock.json` plus `npm audit`; source-level application conclusions are based on the repository files and targeted tests above.

Overall result: no confirmed auth bypass, path traversal, SSRF, secret leak, or privacy-field exposure was found in application code. The remaining confirmed security work is dependency remediation for PostCSS in the production graph and esbuild in the dev graph.
