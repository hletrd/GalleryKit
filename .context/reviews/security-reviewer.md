# Cycle 29 Security Reviewer Report

Date: 2026-06-30
Role: security-reviewer
Scope: Entire repository under `/Users/hletrd/flash-shared/gallery`
Mode: Prompt 1 only: review/report update. No product-code changes, no plan, no implementation.

## Method

Required docs read first:
- `AGENTS.md` instructions from the prompt, including review-only output, project quality gates, destructive-action policy, and repo commit/deploy conventions.
- `CLAUDE.md`, including security architecture, environment guidance, admin/API model, upload/privacy pipeline, restore/backup runbook, and lint-gate contracts.

Inventory and review method:
- Inventoried the tree with `rg --files` and then narrowed by security relevance.
- Used `rg` sweeps for API route exports, server action exports, origin/auth wrappers, rate-limit helpers, upload and filesystem operations, child-process use, raw SQL, fetch/redirect surfaces, dangerous HTML injection, and secret/token/password strings.
- Read relevant code across files rather than relying on comments or tests alone.
- Validated central lint gates and a focused security/privacy/path traversal test set.

## Validation Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web`: passed. Admin API routes found by the scanner are `src/app/api/admin/db/download/route.ts` and `src/app/api/admin/lr/upload/route.ts`; both are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed. All scanned mutating server actions enforce `requireSameOriginAdmin()` or are recognized public/read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed. Public mutating API route coverage is clean; semantic search is rate-limited.
- `npm audit --workspace=apps/web --audit-level=low`: passed with `found 0 vulnerabilities`.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/api-auth.test.ts src/__tests__/action-origin-lint.test.ts src/__tests__/public-route-rate-limit-lint.test.ts src/__tests__/upload-paths.test.ts src/__tests__/serve-upload.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts`: passed, Vitest reported 6 files and 60 tests.

Secret sweep result:
- Tracked source grep found placeholders, env variable names, tests, and historical-plan warnings only. I did not find a current committed private key, live token, DB password, or session secret in HEAD.
- Gitignored runtime secret files such as `.env.local` and `.env.deploy` were intentionally not read.

Worktree note:
- Pre-existing unrelated review artifacts were modified before this report (`.context/reviews/perf-reviewer.md`, `.context/reviews/test-engineer.md`). I did not touch them.

## Confirmed Issues

None found.

## Likely Issues

None found.

## Risks Needing Manual Validation

### SEC-C29-RV-01 - Medium - Proxy/header trust and TLS edge assumptions must match production

Confidence: Medium

Locations:
- `apps/web/src/lib/request-origin.ts:45-68`
- `apps/web/src/lib/request-origin.ts:83-107`
- `apps/web/src/lib/rate-limit.ts:164-195`
- `apps/web/nginx/default.conf:21-30`
- `apps/web/nginx/default.conf:67-71`
- `apps/web/nginx/default.conf:84-88`
- `apps/web/nginx/default.conf:101-105`
- `apps/web/nginx/default.conf:117-121`

What I verified:
- Same-origin checks fail closed unless `Origin` or `Referer` matches the expected origin (`request-origin.ts:83-107`).
- When `TRUST_PROXY=true`, expected origin and client IP trust forwarded headers (`request-origin.ts:45-68`, `rate-limit.ts:164-187`).
- The checked-in nginx config is designed to be an internal HTTP hop behind TLS and warns not to expose it as the public cleartext edge (`nginx/default.conf:21-30`).
- That nginx config overwrites `Host`, `X-Forwarded-Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` before proxying to Next (`nginx/default.conf:67-71`, `84-88`, `101-105`, `117-121`).

Failure scenario:
- If production sets `TRUST_PROXY=true` while requests can reach Next.js directly, or through a proxy that forwards client-supplied `X-Forwarded-*` / `X-Real-IP` values without sanitizing them, an attacker may influence the origin comparison or evade per-IP rate limits.
- If the nginx listener on port 80 is exposed as the public edge instead of sitting behind TLS termination, HSTS headers do not provide transport security by themselves.
- If production is behind a proxy but `TRUST_PROXY` is not set, `getClientIp()` returns `unknown` for everyone and all users share rate-limit buckets (`rate-limit.ts:189-195`), creating a collateral lockout/DoS risk rather than an auth bypass.

Fix / validation:
- Confirm the deployed topology terminates HTTPS at the public edge and redirects public cleartext traffic before the internal nginx/Next hop.
- Confirm all inbound forwarded headers are overwritten or stripped by the trusted proxy layer.
- Use `TRUST_PROXY=true` only behind that trusted proxy. Leave it false for direct-to-Next deployments.
- Validate `TRUSTED_PROXY_HOPS` against the actual proxy chain.

### SEC-C29-RV-02 - Medium - DB restore containment still depends on MySQL account least privilege

Confidence: Medium

Locations:
- `apps/web/src/lib/sql-restore-scan.ts:12-31`
- `apps/web/src/lib/sql-restore-scan.ts:39-59`
- `apps/web/src/lib/sql-restore-scan.ts:210-251`
- `apps/web/src/app/[locale]/admin/db-actions.ts:570-647`
- `apps/web/src/app/[locale]/admin/db-actions.ts:665-678`

What I verified:
- The restore scanner has an explicit app-table allowlist (`sql-restore-scan.ts:12-31`).
- It extracts write targets for relevant DDL/DML statements (`sql-restore-scan.ts:39-59`) and rejects schema-qualified writes or writes outside the app table set (`sql-restore-scan.ts:210-239`).
- Restore writes uploads to a random temp path with `0600` mode, validates plausible dump headers, scans chunks before import, and then invokes `mysql` with an argument array and `--one-database` (`db-actions.ts:570-647`, `665-678`).

Failure scenario:
- A future scanner blind spot or MySQL grammar edge case would have a larger blast radius if the configured DB user has privileges outside the GalleryKit schema. `--one-database` and the scanner are good controls, but DB grants should still be the final containment boundary for uploaded admin restore files.

Fix / validation:
- Manually verify production DB grants: the app user should have only the minimum privileges needed on `DB_NAME.*`, and no global, sibling-schema, FILE, user-management, routine, or event privileges unless explicitly justified.
- Keep `sql-restore-scan` regression tests in the security suite whenever restore grammar support changes.

### SEC-C29-RV-03 - Low - Runtime secret files and historical values require operator validation

Confidence: High

Locations:
- `apps/web/src/lib/session.ts:19-35`
- `README.md:134-143`
- `CLAUDE.md:79-86`
- `plan/plan-353-run6-cycle3-deferred.md:166-170`
- `apps/web/deploy.sh:18`

What I verified:
- Production refuses missing or short `SESSION_SECRET`; it does not fall back to the DB-stored dev secret (`session.ts:19-35`).
- Tracked setup docs use placeholders for DB/admin/session secrets (`README.md:134-143`, `CLAUDE.md:79-86`).
- Prior plan history documents historical example secrets as an operational rotation concern, not a current HEAD code defect (`plan-353-run6-cycle3-deferred.md:166-170`).
- Gitignored runtime env files were not inspected.

Failure scenario:
- If production still uses a value copied from historical checked-in examples, logs, tickets, or local runtime env files, this source review will not detect it. That would compromise session signing, admin bootstrap credentials, DB credentials, or PATs depending on the reused value.

Fix / validation:
- Manually validate production `SESSION_SECRET`, DB credentials, admin bootstrap secrets, deploy credentials, and long-lived PATs in the real secret store.
- Rotate any value that may have come from historical examples or a shared/logged location.

## Confirmed Controls Reviewed

### Auth, Authz, CSRF, And Sessions

- `withAdminAuth` requires same-origin for cookie-authenticated admin API requests before `isAdmin()` (`apps/web/src/lib/api-auth.ts:114-123`) and applies `no-store` / `nosniff` headers on success and failure (`api-auth.ts:8-13`, `130-142`).
- PAT requests are accepted only where the route explicitly passes `allowTokenScope`, are pre-increment rate-limited before DB token verification, require exact scope inclusion, and clear request token context after handler completion (`api-auth.ts:68-111`).
- Admin tokens are generated with 32 random bytes, stored only as SHA-256 hashes, format-checked before DB lookup, compared with `timingSafeEqual`, expiry-checked, and scoped through an allowlist (`apps/web/src/lib/admin-tokens.ts:52-61`, `68-89`, `91-108`, `141-167`, `207-239`).
- Session tokens are HMAC-signed with a production-required secret, verified with length-check plus `timingSafeEqual`, shape-checked after crypto verification, age-limited, and stored as DB hashes (`apps/web/src/lib/session.ts:19-35`, `82-88`, `94-150`).
- Login, logout, password change, admin-user CRUD, token CRUD, sharing CRUD, image mutations, settings, SEO, topics, tags, collections, embeddings, and db-actions all passed the same-origin scanner. Spot checks showed the guard is before sensitive mutations.

### Rate Limiting And Request Size

- Login/password/admin-user/share/search/load-more/view-record/semantic/OG/PAT auth buckets use pre-increment patterns in current code or pass the repo lint checks.
- Semantic search enforces same-origin, strict JSON media type, no chunked transfer, required bounded `Content-Length`, pre-DB-work rate limiting, query length bounds, request abort handling, model-mode gating, and a hard embedding scan cap (`apps/web/src/app/api/search/semantic/route.ts:107-184`, `206-284`).
- Similar-photo search enforces same-origin, restore maintenance, positive integer ID validation, pre-increment semantic limiter, production-mode gating, processed-image joins, and guarded public enrichment fields (`apps/web/src/app/api/search/similar/[id]/route.ts:68-126`, `132-179`, `224-270`).
- nginx adds route-specific body caps and edge request limits for login, admin, restore, dashboard upload, PAT upload, and general admin API paths (`apps/web/nginx/default.conf:1-4`, `58-163`).

### Upload Handling And Path Traversal

- Browser image uploads require same-origin and admin auth before file handling, cap file count and upload size, sanitize user filenames, lock the upload-processing contract, check disk space via `bavail`, reject disabled HDR uploads, strip GPS from retained originals when configured, and re-check restore maintenance before DB commit (`apps/web/src/app/actions/images.ts:114-190`, `221-260`, `291-416`).
- Lightroom upload is behind `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, rejects chunked or missing/invalid `Content-Length`, enforces cumulative and per-file caps, validates filename/topic/text inputs, uses the same upload contract lock, checks disk space, applies HDR/GPS gates, and releases claims/locks in `finally` paths (`apps/web/src/app/api/admin/lr/upload/route.ts:68-137`, `175-259`, `277-402`, `548-555`).
- Original uploads are stored under a private root with `0700` directory creation and strict realpath/lstat containment helpers (`apps/web/src/lib/upload-paths.ts:49-65`, `86-171`).
- Public derivative serving only allows `jpeg`, `webp`, and `avif` top-level dirs, validates segments, rejects symlinks, enforces realpath containment, opens the validated path, streams from the file handle, and emits `nosniff` (`apps/web/src/lib/serve-upload.ts:126-190`, `237-321`).
- Delete paths validate DB filenames before removing originals or derivatives (`apps/web/src/app/actions/images.ts:634-716`, `732-890`).

### Backup, Restore, Raw SQL, And Child Processes

- DB export/dump/restore actions require same-origin and admin auth before work (`apps/web/src/app/[locale]/admin/db-actions.ts:81-96`, `163-174`, `364-370`).
- `mysqldump`, `mysql`, and post-restore migration are invoked with argument arrays rather than shell interpolation, and stderr is sanitized before logging (`db-actions.ts:214-229`, `256`, `665-715`, `784-801`).
- Non-local MySQL CLI usage requires TLS CA unless explicitly disabled (`apps/web/src/lib/mysql-cli-ssl.ts:1-24`).
- Backup downloads are admin-auth wrapped, validate the backup filename regex, enforce path and realpath containment, stream through an opened file handle, and set `no-store` / `nosniff` (`apps/web/src/app/api/admin/db/download/route.ts:21-109`, `apps/web/src/lib/backup-filename.ts:3-12`).
- Raw SQL sweeps showed known Drizzle templates, migration/reconcile scripts, advisory-lock operations, and restore/admin paths. Runtime user-controlled values reviewed are parameterized through Drizzle or mysql2 query parameters.

### SSRF, Redirects, And External Fetch

- `IMAGE_BASE_URL` parsing accepts only absolute HTTP(S), requires HTTPS in production, and rejects credentials, query, and hash (`apps/web/src/lib/content-security-policy.ts:1-25`).
- Next image remote patterns derive from that validated base URL only (`apps/web/next.config.ts:8-28`, `102-106`).
- Per-photo OG generation pins internal derivative fetches to `BASE_URL` rather than inbound request origin and fails closed if the canonical origin cannot be parsed (`apps/web/src/app/api/og/photo/[id]/route.tsx:97-122`).
- OG photo fallback redirects only to same-origin configured OG image URLs or the site root (`apps/web/src/app/api/og/photo/[id]/route.tsx:249-295`), and the SEO setting validator rejects scheme-relative/backslash open-redirect cases (`apps/web/src/lib/seo-og-url.ts:3-42`).
- OG fetch helper bounds per-fetch time and bytes (`apps/web/src/lib/og-photo-fetch.ts:30-94`, `102-118`).

### Public Privacy Separation

- `publicSelectFields` explicitly omits GPS, original filenames, user filenames, original format/size, processing internals, HDR/color internals, uploader, errors, ICC/color-space details, and pipeline version (`apps/web/src/lib/data.ts:368-408`).
- `PrivacySensitiveKeys` compile guards protect public and map field sets from accidental sensitive-field additions (`apps/web/src/lib/data.ts:459-489`).
- Semantic/similar search enrichment uses a shared compile-guarded select field set (`apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Public share pages validate base56 keys before lookup, rate-limit enumeration-sensitive page body lookups, keep metadata generic, return `notFound()` on invalid/missing/rate-limited keys, and use public selectors (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:38-108`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:43-117`, `apps/web/src/lib/data.ts:1185-1245`, `1251-1291`).
- Public analytics records no full IP address; it derives country/referrer host/bot flags and rate-limits durable writes (`apps/web/src/app/actions/public.ts:397-510`).

### XSS, JSON-LD, Sanitization, And Headers

- All current `dangerouslySetInnerHTML` hits in public pages are JSON-LD script injections fed through `safeJsonLd`.
- `safeJsonLd` JSON-stringifies data and escapes `<`, `>`, U+2028, and U+2029 (`apps/web/src/lib/safe-json-ld.ts:14-19`).
- Admin-controlled persistent strings reject control and Unicode formatting characters through shared sanitizers in the reviewed action paths.
- Production CSP uses nonce-based scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'` (`apps/web/src/lib/content-security-policy.ts:68-123`).
- Global headers include `nosniff`, `SAMEORIGIN`, referrer policy, permissions policy, and production HSTS (`apps/web/next.config.ts:74-88`); nginx mirrors key headers and hides `X-Powered-By` (`apps/web/nginx/default.conf:49-56`).

## Covered File Summary

Primary files examined:
- Docs/policy: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/.env.local.example`, `.env.deploy.example`
- Auth/session/tokens: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/admin-users.ts`
- Origin/rate/security headers: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/proxy.ts`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`
- Upload/path/image: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-filenames.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/mysql-cli-ssl.ts`, `apps/web/scripts/migrate.js`
- Public/search/share/privacy: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public share pages
- Query/compiler: `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/sql-like.ts`
- Health/status: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`
- Tests/gates: API auth lint, action-origin lint, public route rate-limit lint, privacy fields, search route privacy, API auth, upload paths, serve upload, SQL restore scan, backup download route, tracked secrets and related security tests inventoried.

## Missed-Issues Sweep

Final sweep checklist:
- OWASP Top 10: access control, auth/session failures, crypto/secret handling, injection, insecure design, security misconfiguration, vulnerable dependencies, integrity/config assumptions, logging/monitoring, SSRF.
- Auth/authz: admin wrappers, PAT scope gates, server actions, session cookie flow, middleware/proxy interaction.
- CSRF/origin: server actions, admin APIs, semantic search, proxy-trust assumptions.
- Rate limits: login, account bucket, password change, admin token auth, public search/load-more/view, semantic/similar, OG, share lookup, upload quota, nginx edge limits.
- SSRF/open redirect: OG fetches, SEO OG URL, Next remote images, canonical origin handling.
- Path traversal: public derivative serving, private originals, backup download, restore temp files, deletion paths.
- Upload handling: content length, file count/size, Sharp validation, RAW/HDR/GPS behavior, disk cap, restore race checks.
- Backup/restore: SQL scanner, child process invocation, TLS args, temp file permissions, advisory locks.
- API token scopes: token format, hash storage, constant-time compare, scope allowlist, expiry, last-used side effect.
- Privacy leakage: public selectors, search enrichment, share pages, map exception, analytics storage.
- Secrets: tracked source placeholders vs live secrets; gitignored secret files excluded by design.

Result: I found no confirmed or likely new product-code security vulnerabilities in Cycle 29. The remaining security work is operational validation of deployment header/TLS trust, DB least privilege for restore containment, and real secret-store rotation/strength checks.
