# Security Review Report — PROMPT 1 Cycle 1

Date: 2026-06-22

Scope: whole-repository security review for GalleryKit in `/Users/hletrd/flash-shared/gallery`, covering OWASP Top 10, secrets, authentication/authorization, origin checks, public mutating rate limits, upload/file traversal/symlink handling, SQL/command injection, session/cookie handling, backup/restore, and public data leakage.

I preserved the repo rules in `AGENTS.md` and `CLAUDE.md`: no source changes, no commit, no push, no deploy. The only write made by this lane is this review artifact.

## Executive Summary

No critical or high-confidence application-code auth bypass, path traversal, raw SQL injection, command injection, secret exposure, or public PII/GPS leakage was found.

Findings:

1. Medium / High confidence / Confirmed issue: production dependency tree contains vulnerable `postcss` through Next.js.
2. Medium / High confidence / Confirmed issue: dev dependency tree contains known vulnerable `vite`, `@babel/core`, and `js-yaml` packages.
3. Low / Medium confidence / Risk needing manual validation: production CSP still allows inline styles.
4. Low / Medium confidence / Risk needing manual validation: public search LIKE escaping depends on MySQL SQL mode not enabling `NO_BACKSLASH_ESCAPES`.

Security guardrails that passed fresh validation:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`

Dependency audit evidence:

- `npm audit --workspace=apps/web --omit=dev` failed on vulnerable `postcss` nested under `next`.
- `npm audit --workspace=apps/web --include=dev` additionally failed on dev-only `vite`, `@babel/core`, and `js-yaml` advisories.
- Registry spot-check on 2026-06-22: `npm view next version` returned `16.2.9`; `npm view next@latest dependencies.postcss` returned `8.4.31`; `npm view postcss version` returned `8.5.15`.

## Inventory Reviewed

Project/security docs and policy:

- `AGENTS.md`
- `CLAUDE.md`
- `.gitignore`
- `.env.deploy.example`
- `apps/web/.env.local.example`

Build, dependency, and runtime configuration:

- `package.json`
- `package-lock.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/mysql-connection-options.js`

Auth, sessions, origin, rate limits, and admin tokens:

- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/password-hashing.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`

Admin routes/actions and backup/restore:

- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`

Public routes/actions and sharing:

- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/uploads/[...path]/route.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`

Uploads, image processing, storage, and path handling:

- `apps/web/src/app/actions/images.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-quota.ts`
- `apps/web/src/lib/upload-contract.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/gps-exif-strip.ts`
- `apps/web/src/lib/og-photo-fetch.ts`

Data/privacy, XSS/JSON-LD, validation, and config:

- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/site-config.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/map-privacy.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/resolved-stream-source.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`
- `apps/web/src/__tests__/api-auth-response-headers.test.ts`

Local ignored secret files observed but not printed:

- `.env.deploy`
- `apps/web/.env.local`

Both are ignored by `.gitignore`; `git ls-files` showed only `.env.deploy.example` and `apps/web/.env.local.example` are tracked from that env-file set.

## Findings

### SEC-1 — Production dependency tree contains vulnerable PostCSS via Next.js

Severity: Medium

Confidence: High

Classification: Confirmed issue, OWASP A06 Vulnerable and Outdated Components

Code/package regions:

- `apps/web/package.json:56` declares `next` as `^16.2.3`.
- `package-lock.json:5571-5581` resolves `node_modules/next` to `16.2.6` and records its direct `postcss` dependency as `8.4.31`.
- `package-lock.json:5705-5708` resolves `node_modules/next/node_modules/postcss` to `8.4.31`.
- `package.json:7-10` has a root `overrides.postcss` entry, but the lock still contains Next's nested `postcss@8.4.31`.

Why this is a problem:

`npm audit --workspace=apps/web --omit=dev` reports `postcss <8.5.10` as vulnerable to XSS through CSS stringify output that does not escape `</style>`. This is in the production dependency graph because it is nested under `next`, not only a development tool.

Concrete failure scenario:

If a server/build path in this app or in Next's runtime processes attacker-controlled CSS and later embeds that CSS into an HTML `<style>` context, crafted CSS containing a closing style tag can break out and execute script in a victim browser. I did not find an obvious current app path where public users submit CSS, so exploitability appears limited, but the vulnerable package is confirmed in the runtime tree.

Suggested fix:

- Track or apply a Next.js release that moves its bundled PostCSS to `>=8.5.10`.
- Do not use `npm audit fix --force` blindly if it proposes a major downgrade or unrelated Next version.
- If operationally urgent, test an npm override/resolution strategy that forces the nested Next PostCSS to a fixed version, then run the full build, unit suite, and `npm audit --workspace=apps/web --omit=dev`.
- Until fixed, keep untrusted CSS out of any server-side stringify/embed path.

### SEC-2 — Dev dependency tree contains vulnerable Vite, Babel, and js-yaml packages

Severity: Medium

Confidence: High

Classification: Confirmed issue, OWASP A06 Vulnerable and Outdated Components

Code/package regions:

- `apps/web/package.json:77-84` includes test/build tooling such as `vitest`, `@types/*`, `tsx`, and TypeScript-oriented dev dependencies.
- `package-lock.json:137-139` resolves `node_modules/@babel/core` to `7.28.5`.
- `package-lock.json:5132-5134` resolves `node_modules/js-yaml` to `4.1.1`.
- `package-lock.json:7891-7893` resolves `node_modules/vitest/node_modules/vite` to `8.0.8`.

Why this is a problem:

`npm audit --workspace=apps/web --include=dev` reports:

- `vite 8.0.0 - 8.0.15`: high-severity Windows-specific advisories, including NTLMv2 hash disclosure via UNC path handling and filesystem deny bypass variants.
- `@babel/core <=7.29.0`: arbitrary file read via malicious `sourceMappingURL` comment.
- `js-yaml <=4.1.1`: quadratic blowup denial of service with repeated aliases and merge keys.

These appear dev-only and are not installed into the production Docker image when `npm ci --omit=dev` is used, but they still affect developer machines and CI.

Concrete failure scenario:

An attacker who can make a developer or CI job process malicious source, sourcemaps, YAML, or Vite-served paths can trigger local file reads, denial of service, or credential/hash disclosure depending on platform and tool invocation. The Vite advisory is especially relevant if a dev server is exposed beyond localhost on Windows or processes untrusted paths.

Suggested fix:

- Upgrade affected dev dependencies through the normal package manager flow and rerun `npm audit --workspace=apps/web --include=dev`.
- Keep Vite/Vitest dev servers bound to trusted interfaces only.
- Treat CI inputs that run build/test tooling as untrusted and avoid running this toolchain on unreviewed forks with privileged secrets.

### SEC-3 — Production CSP allows inline styles

Severity: Low

Confidence: Medium

Classification: Risk needing manual validation, OWASP A05 Security Misconfiguration / defense in depth

Code regions:

- `apps/web/src/lib/content-security-policy.ts:105-117` builds the production CSP and includes `style-src 'self' 'unsafe-inline'`.
- `apps/web/src/proxy.ts:36-49` applies nonce-bearing request/response CSP headers in production.
- `apps/web/src/__tests__/content-security-policy.test.ts:6-64` locks the current behavior: production scripts avoid `unsafe-inline`, but styles intentionally retain it.

Why this is a problem:

The script policy is nonce-based, but inline style execution is still broadly allowed. This does not create script execution by itself, and I did not find a confirmed current style-injection sink. It does reduce CSP's protection if a future component reflects user/admin-controlled text into `style`, CSS custom properties, or a style block.

Concrete failure scenario:

A future metadata field or admin-configurable value is accidentally used inside an inline style or CSS variable without strict validation. Because `style-src` allows `unsafe-inline`, the browser would not block CSS injection. Depending on browser behavior and surrounding markup, CSS injection can enable UI redress, content spoofing, pixel probing, or assist further XSS chains.

Suggested fix:

- Inventory current inline style requirements.
- Where possible, replace inline styles with classes or validated CSS variables.
- Consider adding `style-src-attr 'none'` or a nonce/hash-based style policy after testing the Next.js and component runtime requirements.
- Keep the existing nonce-based `script-src`; do not regress it to `unsafe-inline`.

### SEC-4 — Public search LIKE escaping relies on MySQL SQL mode

Severity: Low

Confidence: Medium

Classification: Risk needing manual validation, OWASP A03 Injection hardening / resource abuse

Code regions:

- `apps/web/src/lib/data.ts:1412-1420` escapes `%`, `_`, and `\` with backslashes before a public search `LIKE` query and notes the risk if MySQL runs with `NO_BACKSLASH_ESCAPES`.
- `apps/web/src/app/actions/public.ts:236-310` exposes `searchImagesAction`, validates query length, and rate-limits public search before calling the data-layer search.

Why this is a problem:

This is not SQL injection; the query remains parameterized. The residual risk is that MySQL's `NO_BACKSLASH_ESCAPES` mode changes how backslashes behave in string literals and can weaken wildcard escaping unless the query explicitly declares an `ESCAPE` clause. The source comment already recognizes this assumption.

Concrete failure scenario:

If production MySQL enables `NO_BACKSLASH_ESCAPES`, a public user can submit `%` or `_` in a search query and potentially make it behave as a wildcard instead of a literal. That can broaden public search results and increase database work despite the existing query length and rate-limit controls.

Suggested fix:

- Add an explicit `LIKE ... ESCAPE '\\'` clause for this search path if Drizzle/raw SQL usage can express it cleanly.
- Add a startup or migration-time assertion that production SQL mode does not include `NO_BACKSLASH_ESCAPES`.
- Add a regression test that proves literal `%` and `_` search behavior under the configured SQL mode.

## Positive Security Observations

Admin authentication and authorization:

- `apps/web/src/lib/api-auth.ts:49-121` centralizes admin API protection. PAT requests require a valid token and scope; cookie-auth requests require same-origin provenance before `isAdmin()`.
- `apps/web/src/lib/session.ts:16-36` rejects missing/short `SESSION_SECRET` in production.
- `apps/web/src/lib/session.ts:82-150` uses HMAC-signed session tokens, timing-safe comparison, hashed-token DB lookup, expiry checks, and expired-session cleanup.
- `apps/web/src/app/actions/auth.ts:72-257` applies same-origin checks and rate limits to login before issuing an httpOnly, secure-in-production, sameSite-lax cookie.
- `apps/web/src/app/actions/auth.ts:282-444` applies current-user checks, same-origin checks, rate limits, current-password verification, and session rotation for password updates.

Same-origin server actions:

- The action-origin lint gate passed and reported every mutating server action as enforcing `requireSameOriginAdmin()`.
- Representative code: `apps/web/src/lib/action-guards.ts:37-44`, `apps/web/src/app/actions/images.ts:107-195`, `apps/web/src/app/[locale]/admin/db-actions.ts:119-361`, and `apps/web/src/app/actions/lr-tokens.ts:27-116`.

Public mutating rate limits:

- The public-route rate-limit lint gate passed.
- `apps/web/src/app/api/search/semantic/route.ts:99-215` performs same-origin, request size/content validation, and pre-increment rate limiting before expensive semantic work.
- `apps/web/src/app/actions/public.ts:236-310` validates and rate-limits public search actions.
- View-recording actions in `apps/web/src/app/actions/public.ts:353-405` validate identifiers and apply in-memory per-IP limits before writing low-sensitivity analytics.

Upload, traversal, and symlink handling:

- `apps/web/src/lib/serve-upload.ts:127-309` enforces allowlisted top-level upload directories, safe path segments, extension-to-directory matching, root containment, `lstat` symlink rejection, final `realpath` containment, and streams from the validated real path.
- `apps/web/src/lib/process-image.ts:800-844` saves originals under UUID disk names, enforces size and extension checks, writes originals with mode `0600`, and validates metadata with Sharp under `limitInputPixels`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:57-496` combines scoped PAT/admin auth, file validation, upload contract locking, quota tracking, disk-space checks, restore-maintenance checks, GPS stripping, and generic error handling.
- `apps/web/src/app/actions/images.ts:107-195` applies admin auth, same-origin checks, input validation, upload contract locking, quota tracking, and later GPS stripping for admin UI uploads.

Backup/restore:

- `apps/web/src/app/[locale]/admin/db-actions.ts:119-257` runs `mysqldump` via `spawn` with argument arrays rather than a shell, writes backup files with restrictive permissions, and sanitizes stderr.
- `apps/web/src/app/[locale]/admin/db-actions.ts:266-520` gates restore behind admin and same-origin checks, uses a DB restore lock, upload contract lock, maintenance mode, temp files, size limits, header validation, dangerous-SQL scanning, `mysql --one-database`, and cleanup.
- `apps/web/src/lib/sql-restore-scan.ts:12-150` allowlists expected app backup table drops and rejects dangerous SQL constructs such as account management, server/global mutations, filesystem import/export, plugins, routines, events, prepared statements, and dynamic execution.
- `apps/web/src/app/api/admin/db/download/route.ts:22-87` wraps backup downloads in `withAdminAuth`, validates backup filenames, performs path containment and symlink checks, and streams from the validated real path.

Secrets:

- No tracked real env files were found in `git ls-files`.
- `.env.deploy` and `apps/web/.env.local` exist locally but are ignored; I did not print their contents into logs or this review.
- `apps/web/.env.local.example` contains placeholders and rotation guidance, not real secrets.

Public data leakage:

- `apps/web/src/lib/data.ts:316-429` separates public select fields from admin fields and includes compile-time privacy guards for sensitive keys.
- `apps/web/src/__tests__/privacy-fields.test.ts` and `apps/web/src/__tests__/map-privacy.test.ts` lock the privacy model.
- Public semantic/similar search enrichment selects public processed image rows and does not expose original filenames, user filenames, GPS fields, or admin-only processing metadata.

XSS and JSON-LD:

- `apps/web/src/lib/safe-json-ld.ts` escapes `<`, U+2028, and U+2029 before JSON-LD insertion.
- `dangerouslySetInnerHTML` usage found in public pages is for JSON-LD/script payloads routed through the safe JSON-LD helper and CSP nonce flow.
- OG routes sanitize display text before rendering image responses.

SQL/raw command injection:

- I did not find user-controlled `sql.raw`, raw identifier construction, shell-string `exec`, or shell-enabled command execution in reviewed paths.
- Drizzle tagged SQL interpolations and `conn.query` calls use parameters for user-controlled values.
- Command execution in backup/restore uses `spawn(command, args, { shell: false by default })` patterns with array arguments.

## Final Missed-Issues Sweep

Final sweep commands/coverage:

- `rg --files` over the repo to build the initial file inventory.
- Targeted reads of auth/session/origin/rate-limit, admin API routes, all server action groups, upload/storage/image-processing, backup/restore, public search/share/OG routes, data/privacy guards, CSP, validation, scripts, Docker/nginx config, and package manifests.
- Static sweep for `@action-origin-exempt`, `@public-no-rate-limit-required`, `withAdminAuth`, `dangerouslySetInnerHTML`, `unsafe-inline`, `NO_BACKSLASH_ESCAPES`, `process.env`, `spawn`, `exec`, file reads/writes/deletes, `realpath`, `lstat`, `symlink`, `path.join`, and `path.resolve`.
- Secret inventory with `find`, `.gitignore`, `git check-ignore`, and `git ls-files` for env/key/token-looking paths.
- Security lint gates listed above.
- `npm audit --workspace=apps/web --omit=dev` and `npm audit --workspace=apps/web --include=dev`.
- Registry checks for current `next` and `postcss` versions.

Relevant files examined are listed in the Inventory Reviewed section. I also sampled related tests where they lock security-critical behavior. I did not run the full app test suite or production build because this lane was scoped to review and artifact creation; the targeted security lint gates and dependency audits did run.

Residual risks:

- Real production secret values were intentionally not inspected. This review validates tracking/ignore behavior and placeholder examples, not actual secret strength or rotation state.
- Production infrastructure settings such as TLS termination, nginx deployment state, file permissions on live volumes, and MySQL SQL mode require environment validation outside this repo.
- Dependency advisories can change quickly; rerun audit after dependency updates and before deployment.
