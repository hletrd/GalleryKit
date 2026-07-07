# Security Reviewer Report - Cycle 11

Date: 2026-07-07 KST
Reviewer: security-reviewer
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed commit: `b965e3bf`

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then reviewed the repository from an OWASP Top 10, auth/authz, CSRF/origin, rate-limit, upload/path, SSRF, SQL/shell, secrets, backup/restore, admin API, and data-exposure perspective. This was a report-only review; I did not edit application source or plan files.

Security-relevant inventory reviewed:

- Project policy and operations: `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `apps/web/.gitignore`, deploy env examples, Docker, compose, nginx, migration scripts, backup/restore scripts.
- Auth and authorization: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/password-hashing.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/proxy.ts`, admin layouts/pages, and all `apps/web/src/app/api/admin/**`.
- Server actions and public/admin routes: all `apps/web/src/app/actions/**`, all `apps/web/src/app/api/**`, and locale public routes under `apps/web/src/app/[locale]/(public)/**`.
- Upload and path handling: `upload-paths.ts`, `serve-upload.ts`, `upload-filenames.ts`, `upload-limits.ts`, `image-types.ts`, `process-image.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`, image upload actions, and Lightroom upload API.
- DB backup/restore and shell boundaries: `apps/web/src/app/[locale]/admin/db-actions.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `backup-filename.ts`, `download-filename.ts`, `sanitize.ts`, migration scripts.
- SSRF/server fetch: OG routes, `og-photo-fetch.ts`, SEO/base URL helpers, semantic/similar search, CLIP/model download scripts.
- Headers/rate limits: `rate-limit.ts`, `auth-rate-limit.ts`, route/action linter scripts, `next.config.ts`, `content-security-policy.ts`, `csp-nonce.ts`, `apps/web/nginx/default.conf`.
- Privacy/data exposure: `data.ts`, `data-timeline.ts`, `search-enrichment-fields.ts`, public map/search/share/page data paths, privacy tests.
- Dependency and secrets exposure: root/workspace manifests, `package-lock.json`, env-file ignore coverage, secret-pattern scan results.

## Findings

### C11-SEC-01 - Raw `IMAGE_BASE_URL` can leak credential-bearing CDN config into public HTML

Severity: Medium
Confidence: High
Validation status: Confirmed by source and existing tests; browser render not manually exercised

Code regions:

- `apps/web/src/lib/constants.ts:17` exports raw `process.env.IMAGE_BASE_URL || ''`.
- `apps/web/src/app/[locale]/layout.tsx:117` stamps that raw value into public `<html data-image-base=...>`.
- `apps/web/src/lib/image-url.ts:25-36` reads the raw dataset/env value and concatenates it into image URLs without URL validation or credential/query/hash stripping.
- `apps/web/src/lib/content-security-policy.ts:21-23` rejects credentials, query strings, and hashes for CSP only.
- `apps/web/src/__tests__/csp-malformed-image-base-url.test.ts:48-58` proves CSP omits credential-bearing `IMAGE_BASE_URL`.
- `apps/web/src/__tests__/image-url.test.ts:49-58` explicitly locks the current raw layout stamp.

Failure scenario:

An operator configures a private CDN-style value such as `IMAGE_BASE_URL=https://user:pass@cdn.example.com` or `https://cdn.example.com?token=...`. The CSP builder rejects that value and omits the CDN from `img-src`, but the root layout still emits the raw secret-bearing value into every public HTML document and `imageUrl()` still uses it for SSR/client image URLs. Any visitor, crawler, browser extension, or log collector that captures HTML can read the embedded credentials/token.

Concrete fix:

Centralize image-base validation in a helper shared by CSP, layout, and `image-url.ts`. Accept only absolute `http(s)` URLs, require `https` in production, reject credentials/query/hash, normalize to origin plus pathname if path prefixes are intentionally supported, and return `''` or fail closed when invalid. Update the layout to stamp only the validated/sanitized value, update `imageUrl()` to use the same helper server-side and browser-side, and replace the current `image-url.test.ts` injection lock with tests asserting credential/query/hash values are not emitted or concatenated.

### C11-SEC-02 - Production dependency graph still contains vulnerable PostCSS through Next

Severity: Medium
Confidence: High
Validation status: Confirmed by `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`

Code regions:

- `apps/web/package.json:59` declares `next` `^16.2.10`.
- `apps/web/package.json:82` declares top-level `postcss` `^8.5.16`.
- `package.json:7-9` attempts a root `postcss` override to `8.5.16`.
- `package-lock.json:9194-9205` installs `next` `16.2.10` with nested `postcss` `8.4.31`.
- `package-lock.json:9334-9337` locks `node_modules/next/node_modules/postcss` to `8.4.31`.

Failure scenario:

The production audit reports GHSA-qx2v-qp2m-jg93 for `postcss <8.5.10`: unescaped `</style>` in CSS stringify output. I did not find a current route that accepts arbitrary public CSS and stringifies it into HTML, so the current exploitability is conditional. The risk becomes real if a future theme/custom-CSS/style-generation feature accepts untrusted CSS and renders PostCSS stringified output into an HTML `<style>` context through Next's nested PostCSS copy.

Concrete fix:

Remove the nested vulnerable copy from the lockfile. As of this review, `npm view next version` returns `16.2.10` and `npm view next@latest dependencies.postcss version` still returns `8.4.31`, so simply upgrading to latest Next does not currently clear the audit. Test a lockfile-effective nested override for Next's PostCSS or track the next stable Next release that updates this dependency. Do not apply `npm audit fix --force` blindly; npm currently suggests an invalid/breaking downgrade path. Add CI audit coverage for `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`.

### C11-SEC-03 - Dev dependency graph carries vulnerable esbuild through deprecated Drizzle tooling chain

Severity: Low
Confidence: High
Validation status: Confirmed by full `npm audit --workspace=apps/web --audit-level=moderate`; dev-only

Code regions:

- `apps/web/package.json:79` declares `drizzle-kit` `^0.31.10`.
- `package-lock.json:5874-5884` installs `drizzle-kit` `0.31.10`, including `@esbuild-kit/esm-loader`.
- `package-lock.json:378-386` installs deprecated `@esbuild-kit/core-utils` `3.3.2` and pins `esbuild ~0.18.20`.
- `package-lock.json:764-800` installs nested dev-only `esbuild` `0.18.20`.
- `package-lock.json:802-810` shows `@esbuild-kit/esm-loader` depends on `@esbuild-kit/core-utils`.

Failure scenario:

The full audit reports GHSA-67mh-4wv8-2f99 for `esbuild <=0.24.2`. This chain is marked `dev: true` and is absent from the production-only audit except for the PostCSS issue. The practical risk is on developer or CI machines: if an affected esbuild-powered dev server/tooling process is bound to a non-loopback interface, a malicious website visited by that developer can issue requests to the local server and read responses.

Concrete fix:

Upgrade the Drizzle/tooling chain when a release removes the deprecated `@esbuild-kit/*` dependency, or add and validate an override that removes `@esbuild-kit/core-utils/node_modules/esbuild@0.18.20` without breaking Drizzle CLI execution. Until then, keep dev/tooling servers bound to localhost and avoid exposing them through tunnels or LAN interfaces.

## Areas Reviewed With No New Finding

Auth and admin API authorization:

- `withAdminAuth` verifies PAT scope before the cookie path and rate-limits token auth attempts at `apps/web/src/lib/api-auth.ts:72-84`; the cookie path enforces same-origin and admin session checks at `apps/web/src/lib/api-auth.ts:114-129`.
- Admin API responses default to `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` at `apps/web/src/lib/api-auth.ts:130-141`.
- Same-origin validation fails closed when neither `Origin` nor `Referer` matches the expected origin at `apps/web/src/lib/request-origin.ts:87-106`.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.

Uploads and file/path handling:

- Original uploads are stored under a private directory with owner-only mode at `apps/web/src/lib/upload-paths.ts:49-56`.
- Original-file lookup rejects absolute/path-traversal names, symlinks, and realpath escapes at `apps/web/src/lib/upload-paths.ts:120-170`.
- Public derivative serving validates directory, extension, segment format, symlinks, and realpath containment at `apps/web/src/lib/serve-upload.ts:168-219`.
- GET serving stats the opened fd before streaming to reduce TOCTOU risk at `apps/web/src/lib/serve-upload.ts:304-369`.
- Lightroom upload uses `withAdminAuth(... allowTokenScope: 'lr:upload')`, rejects chunked/oversized bodies, sanitizes filenames/topics/strings, holds upload quota before awaits, and rechecks restore maintenance.

DB backup/restore, SQL, and shell:

- CSV export, dump, and restore server actions require same-origin admin checks before work in `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Backups use a private backup directory, `0600` temp files, header/trailer checks, and atomic rename.
- `mysqldump`, `mysql`, and post-restore migration subprocesses use bounded argv, minimal env, `MYSQL_PWD` instead of password argv, TLS args, watchdogs, and `sanitizeStderr`.
- Restore upload uses random private temp files, SQL header/trailer checks, app-table allowlisting, dangerous SQL scanning, and restore/mutation/upload/backfill barriers.
- SQL reviewed was Drizzle-parameterized except deliberate bounded `sql.raw` for constant CSV separator syntax.

SSRF and public fetch:

- Per-photo OG fetches are pinned to canonical `BASE_URL`, not attacker request origin.
- OG fallback redirects validate fallback image URLs as same-origin.
- `og-photo-fetch.ts` enforces timeout and byte caps.
- Public semantic/similar search routes validate origin, body shape/size, mode, rate limits, and scan caps.

Data exposure and XSS:

- Public select fields derive from admin fields with sensitive omissions, and map/search enrichment fields have compile-time privacy guards.
- `privacy-fields.test.ts` passed and covers the symmetric privacy contract.
- `dangerouslySetInnerHTML` hits are JSON-LD-only and route through `safeJsonLd`, which escapes `<`, `>`, U+2028, and U+2029.
- Public map latitude/longitude exposure remains tied to `topics.map_visible`.

Secrets and local files:

- I did not read local secret contents.
- `.env.deploy` is ignored by `.gitignore:18`; `apps/web/.env.local` is ignored by `apps/web/.gitignore:35`.
- Secret-pattern scans found examples/review text and tests, not active tracked application secrets.

## Verification Evidence

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm test --workspace=apps/web -- src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/csp-malformed-image-base-url.test.ts src/__tests__/image-url.test.ts`
  - 6 files passed, 55 tests passed.

Failed due to findings:

- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate`
  - Fails with 2 moderate production vulnerabilities: Next's nested `postcss <8.5.10`.
- `npm audit --workspace=apps/web --audit-level=moderate`
  - Fails with 6 moderate vulnerabilities: production PostCSS plus dev-only esbuild through `@esbuild-kit/*`/Drizzle tooling.

Current registry checks:

- `npm view next version` -> `16.2.10`.
- `npm view next@latest dependencies.postcss version` -> `8.4.31`.
- `npm view postcss version` -> `8.5.16`.
- `npm view drizzle-kit version dependencies.@esbuild-kit/esm-loader` -> `0.31.10`, `^2.5.5`.

## Final Missed-Issue Sweep

I performed final `rg` sweeps for `dangerouslySetInnerHTML`, eval/new Function, child process use, raw SQL, auth tokens, password/secret envs, fetch/URL/path operations, auth guard exemptions, rate-limit exemptions, admin wrappers, and same-origin guards. The relevant hits mapped back to the reviewed surfaces above.

Skipped intentionally: reading local secret-file values and auditing `node_modules` source code manually. Dependency conclusions are based on manifests, lockfile state, `npm ls`, `npm explain`, registry metadata, and `npm audit`.

Overall result: I did not find a confirmed auth bypass, CSRF bypass, path traversal, SSRF primitive, raw SQL injection, admin API exposure, backup/restore arbitrary SQL bypass, or public privacy-field leak in application code. The actionable security work is the raw `IMAGE_BASE_URL` validation gap plus current dependency-audit failures.
