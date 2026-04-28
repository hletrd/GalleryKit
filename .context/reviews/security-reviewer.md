# Security Reviewer Deep Slice — Prompt 1

**Repo:** `/Users/hletrd/flash-shared/gallery`  
**Date:** 2026-04-28  
**Role:** security-reviewer  
**Mode:** read-only source/config/test/deploy review; only this report file was written. Current uncommitted source/test/config edits were included as review input.

## Scope and inventory

I first inventoried the security-relevant surface with `find`/`git status`, excluding `node_modules`, `.next` output, generated `*.tsbuildinfo`, and binary fixtures/uploads except where path exposure mattered. The matched review inventory was **229 source/config/test/doc files** after exclusions, grouped below.

### Uncommitted files included in this review

- Existing/parallel review artifacts: `.context/reviews/{_aggregate,architect,designer,perf-reviewer,security-reviewer,test-engineer,tracer,verifier}.md`.
- Source/config/test changes reviewed for security impact:
  - `.gitignore` — adds `._*` ignore; no secret exposure regression.
  - `apps/web/playwright.config.ts` — configurable E2E web-server timeout; existing remote-admin guard remains in place.
  - `apps/web/vitest.config.ts` — test timeout only.
  - `apps/web/src/__tests__/touch-target-audit.test.ts` — accessibility test documentation only.
  - `apps/web/src/components/lightbox.tsx` — larger close/fullscreen hit targets; no XSS/auth/file handling change.

### File/pattern inventory examined

- **Auth/session/cookies:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`, admin login/protected layouts, session/admin schema.
- **Authz/CSRF/origin:** all server actions in `apps/web/src/app/actions/*.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{action-guards,request-origin,api-auth,rate-limit,auth-rate-limit}.ts`, and the lint gate scripts.
- **Admin APIs:** `apps/web/src/app/api/admin/db/download/route.ts`; API-auth coverage scripts/tests.
- **Uploads/file serving/storage:** upload routes, `apps/web/src/lib/{serve-upload,upload-paths,upload-limits,upload-tracker*,process-image,process-topic-image,storage/*,image-queue}.ts`, nginx upload locations, upload tests.
- **Public routes/data/privacy:** public gallery/topic/photo/share pages, `apps/web/src/app/api/{health,live,og}/route*`, `apps/web/src/lib/{data,base56,image-url,seo-og-url,safe-json-ld,sanitize,validation,photo-title}.ts`.
- **SQL/db/backup/restore:** `apps/web/src/db/*`, `apps/web/drizzle.config.ts`, `apps/web/src/lib/{db-restore,sql-restore-scan,backup-filename,csv-escape,mysql-cli-ssl,restore-maintenance}.ts`, migration/init/seed scripts.
- **XSS/headers/CSP/Next:** `apps/web/next.config.ts`, `apps/web/src/lib/content-security-policy.ts`, CSP nonce propagation, all `dangerouslySetInnerHTML` sites, OG/image URL helpers.
- **Deployment/config/CI/secrets:** root and app package manifests/lockfile, Dockerfiles/Compose/nginx, deploy scripts, `.dockerignore`, `.gitignore`, `.env*.example`, `.github/*`, docs.
- **Tests/docs reviewed as regression evidence:** security-adjacent unit tests for origin/API guards, sessions/rate limits, backup/restore/download, upload serving/storage, safe JSON-LD, CSV escaping, privacy fields, OG rate limits, and E2E origin/public/admin flows.

## Executive summary

No Critical or High issues were found. The admin mutation surface consistently combines authentication with same-origin provenance checks, session tokens are signed and stored hashed, admin API routes have auth wrappers, upload serving uses segment/extension/symlink/realpath containment, public data selectors omit known privacy fields, backup/restore code has several defense layers, and CSP/JSON-LD/CSV output hardening is present.

Actionable residual risk remains around legacy short share-key compatibility, a public DB-backed health probe, deployment TLS assumptions, one vulnerable nested PostCSS dependency, and overly broad local Image Optimizer patterns.

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 2 |
| Informational / confirmed hardened | 12 |

## Findings

### SEC-01 — Legacy short share keys remain accepted on unauthenticated share routes

- **Severity:** Medium
- **Confidence:** High
- **Label:** Confirmed current issue; historical/deferred compatibility risk.
- **OWASP:** A01 Broken Access Control / token-strength IDOR risk
- **Location:**
  - `apps/web/src/app/actions/sharing.ts:18-19` defines new photo/group keys as length 10.
  - `apps/web/src/app/actions/sharing.ts:139` and `apps/web/src/app/actions/sharing.ts:250` generate those 10-char keys.
  - `apps/web/src/lib/data.ts:637-640` still accepts photo share keys of length `[5, 10]`.
  - `apps/web/src/lib/data.ts:679-685` still accepts group share keys of length `[6, 10]`.
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14` and `:89-100` expose an uncached unauthenticated lookup path.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:15` and `:99-110` expose the matching group lookup path.
- **Why it is a problem:** New links have strong 10-character Base56 entropy, but any database containing historical 5-character photo keys or 6-character group keys continues to accept a much smaller unauthenticated keyspace.
- **Concrete attack/failure scenario:** An attacker enumerates `/s/<5 base56 chars>` or `/g/<6 base56 chars>` and distinguishes hits by 200 vs 404. The share pages themselves do not enforce a route-local per-IP throttle before doing the lookup, so legacy links remain the weak point even though new keys are stronger.
- **Suggested fix:** Migrate/rotate all legacy 5/6-character share keys to 10-character keys, then change validation to length 10 only. If legacy links must survive temporarily, add DB-backed or bounded in-memory rate limiting to the `/s` and `/g` data path and set a sunset date.

### SEC-02 — Public `/api/health` reveals DB readiness and performs unauthenticated DB work

- **Severity:** Medium
- **Confidence:** High
- **Label:** Confirmed current risk.
- **OWASP:** A05 Security Misconfiguration / A09 monitoring signal exposure
- **Location:**
  - `apps/web/src/app/api/health/route.ts:7-33` executes `SELECT 1` and returns `status: ok` or `unavailable` to any requester.
  - `apps/web/src/db/index.ts:13-22` configures a 10-connection pool with queue limit 20.
  - `apps/web/nginx/default.conf:115-129` sends default traffic to Next without a dedicated `/api/health` allowlist or rate limit.
  - `apps/web/src/app/api/live/route.ts:1-9` already provides a DB-free liveness endpoint.
- **Why it is a problem:** Readiness checks are useful internally, but this one is public, leaks maintenance/DB availability state, and creates real DB work for unauthenticated traffic.
- **Concrete attack/failure scenario:** Internet clients fingerprint outage/maintenance windows or spray `/api/health` during an incident. Even cheap `SELECT 1` probes can contend with real requests in the small DB pool/queue.
- **Suggested fix:** Keep `/api/live` public for liveness. Restrict `/api/health` to trusted monitors via nginx `allow/deny`, a private network, or a monitor token header; alternatively return a generic public response and move DB readiness behind internal infrastructure. Add a tight rate limit if it remains externally reachable.

### SEC-03 — Public nginx deployment config depends on an external TLS terminator that is not enforced in-repo

- **Severity:** Medium
- **Confidence:** Medium
- **Label:** Risk needing deployment validation.
- **OWASP:** A02 Cryptographic Failures / A05 Security Misconfiguration
- **Location:**
  - `apps/web/nginx/default.conf:12-20` listens on port 80 and documents that it is intended to sit behind a TLS-terminating edge/load balancer.
  - `apps/web/nginx/default.conf:42` sends HSTS, but HSTS does not secure an initial cleartext public hop if no HTTPS edge is actually present.
  - `apps/web/docker-compose.yml:13-20` uses host networking, binds the app to `127.0.0.1`, and sets `TRUST_PROXY=true`, making the host nginx/edge the security boundary.
  - `apps/web/src/app/actions/auth.ts:207-220` sets `Secure` cookies in production/TLS, which is correct only if the request reaches the browser over HTTPS.
- **Why it is a problem:** The checked-in nginx config is safe only when an external TLS edge exists and forwards HTTPS correctly. The repo does not include a 443 server block, certificate config, or HTTP-to-HTTPS redirect as an enforceable deployment artifact.
- **Concrete attack/failure scenario:** If an operator exposes the shipped nginx listener directly to the internet, admin credentials traverse HTTP during login attempts. Production `Secure` cookies may be ignored by browsers over cleartext, causing failed logins, but the password submission itself has already crossed the network unencrypted.
- **Suggested fix:** Ship either an explicit 443 server block plus 80->443 redirect, or a production deployment contract that is machine-checked during deploy. If TLS is intentionally terminated upstream, restrict the nginx port-80 listener to the load balancer/private interface and document/test required `X-Forwarded-Proto: https` behavior.

### SEC-04 — `npm audit` reports vulnerable nested PostCSS under Next

- **Severity:** Low (moderate advisory; low observed runtime exploitability here)
- **Confidence:** High
- **Label:** Confirmed dependency issue.
- **OWASP:** A06 Vulnerable and Outdated Components
- **Location:**
  - `apps/web/package.json:45` depends on `next@^16.2.3`.
  - `package-lock.json:8116-8118` installs `node_modules/next/node_modules/postcss@8.4.31`.
  - `package-lock.json:8566-8568` installs root `postcss@8.5.10`, so the root override does not eliminate Next's nested copy.
  - `package.json:7-10` attempts a root PostCSS override.
- **Evidence:** `npm audit --workspaces --omit=dev --json` and `npm audit --json` both report 3 moderate findings via `postcss` advisory `GHSA-qx2v-qp2m-jg93` (`PostCSS has XSS via Unescaped </style> in its CSS Stringify Output`) through `next` and `next-intl`.
- **Why it is a problem:** The app does not appear to feed attacker-controlled CSS through PostCSS at runtime, but the vulnerable transitive copy remains installed and keeps audit output red.
- **Concrete attack/failure scenario:** A future build/tooling path that stringifies attacker-influenced CSS through the nested PostCSS version could produce unsafe CSS output. More immediately, CI/security scanners will continue to flag the dependency chain.
- **Suggested fix:** Upgrade to a Next release that vendors or depends on patched PostCSS, or apply a package-manager override/resolution that actually affects `node_modules/next/node_modules/postcss` after verifying Next compatibility. Re-run both audit commands after lockfile update.

### SEC-05 — Next Image Optimizer local allowlist is effectively site-wide

- **Severity:** Low
- **Confidence:** Medium
- **Label:** Likely hardening gap; exploitability should be manually validated against the deployed image optimizer/cache.
- **OWASP:** A05 Security Misconfiguration / A04 resource-consumption design risk
- **Location:**
  - `apps/web/next.config.ts:64-75` allows `images.localPatterns` of `/**` with and without query strings.
  - Official Next.js Image docs describe `localPatterns` as the mechanism to allow specific local paths and block all others, and warn that omitted/wildcard pattern components can let malicious actors optimize unintended URLs: <https://en.nextjs.im/docs/app/api-reference/components/image#localpatterns>.
  - App-generated image sources appear to use controlled upload/resource paths, e.g. `apps/web/src/components/photo-viewer.tsx:216-238`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:183-184`, and `apps/web/src/components/search.tsx:260`.
- **Why it is a problem:** Although normal component usage feeds controlled filenames, the optimizer endpoint is public. A site-wide local pattern widens the direct `/_next/image?url=...` surface beyond the known `/uploads/(jpeg|webp|avif)` and `/resources` image trees and permits arbitrary query-string cardinality.
- **Concrete attack/failure scenario:** A client repeatedly requests optimizer variants for unrelated same-origin image-like routes/static assets or high-cardinality query strings, increasing CPU/cache churn. If a future route returns user-controlled image bytes, the current pattern would already permit optimization without another config change.
- **Suggested fix:** Restrict `localPatterns` to the exact local image trees needed by the app, for example `/uploads/jpeg/**`, `/uploads/webp/**`, `/uploads/avif/**`, and `/resources/**`; omit `search` unless query strings are required, or constrain it to exact expected values. Add a regression test around `nextConfig.images.localPatterns`.

## Confirmed hardened areas / non-findings

- **Admin authz:** Protected admin pages verify real sessions in `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:13-15`, not just middleware cookie shape.
- **Session security:** `apps/web/src/lib/session.ts:19-35` requires a strong env `SESSION_SECRET` in production, `:82-144` signs random timestamped tokens, enforces token age, stores only SHA-256 token hashes, and checks DB expiry. Login/password-change cookies are `httpOnly`, `sameSite: 'lax'`, and secure in production/TLS (`apps/web/src/app/actions/auth.ts:207-220`, `:386-393`).
- **Login brute-force defenses:** `apps/web/src/app/actions/auth.ts:91-147` performs same-origin verification and IP/account-scoped pre-increment rate limiting before Argon2 verification; `:158-166` uses a dummy hash to reduce user-enumeration timing.
- **CSRF/origin:** `apps/web/src/lib/request-origin.ts:45-68` derives expected origins using trusted proxy headers only when `TRUST_PROXY=true`; `:83-107` fails closed when Origin/Referer is missing by default. `apps/web/src/lib/action-guards.ts:37-44` centralizes same-origin admin checks.
- **Admin API auth:** `apps/web/src/lib/api-auth.ts:14-26` wraps admin APIs; `apps/web/src/app/api/admin/db/download/route.ts:13-32` adds same-origin validation before backup download.
- **Origin/API lint gates:** `npm run lint:action-origin --workspace=apps/web` passed and enumerated every mutating server action as guarded or read-only exempt. `npm run lint:api-auth --workspace=apps/web` passed for `src/app/api/admin/db/download/route.ts`.
- **Upload/path traversal/symlink:** `apps/web/src/lib/serve-upload.ts:37-60` validates top-level dirs, extensions, and path segments; `:69-84` applies `lstat`/`realpath` containment; `:95-101` returns immutable image responses with `nosniff`. Upload routes delegate directly to this shared handler.
- **Private originals:** `apps/web/src/lib/upload-paths.ts:24-40` keeps originals under private `data/uploads/original` by default; `:82-103` warns/fails in production when legacy public originals exist; `apps/web/src/instrumentation.ts:1-6` runs that check at startup. Nginx also blocks `/uploads/original/` (`apps/web/nginx/default.conf:92-94`).
- **Upload validation and quotas:** `apps/web/src/app/actions/images.ts:116-128` requires authenticated current user plus same-origin provenance; `:159-227` validates filenames/counts/bytes and cumulative upload windows; `apps/web/src/lib/process-image.ts:42-47`, `:233-287` enforces extension/size/dimension checks, random UUID names, `0600` originals, and Sharp input-pixel limits.
- **File deletion safety:** `apps/web/src/app/actions/images.ts:464-472` and `:562-571` validate DB filenames before deletion; variant deletion is constrained to upload directories.
- **Backup/restore:** `apps/web/src/app/[locale]/admin/db-actions.ts:53-69`, `:127-138`, and `:274-285` require admin plus same-origin provenance. Backups use owner-only dirs/files and avoid CLI password argv exposure (`:151-175`). Restore enforces lock/maintenance, max size, dump-header validation, chunk scanning, temp mode `0600`, `--one-database`, and stderr redaction (`:287-347`, `:350-503`). `apps/web/src/lib/sql-restore-scan.ts:23-113` covers dangerous SQL patterns including MySQL conditional comments.
- **SQL/query safety:** Public search escapes `%`, `_`, and `\` before `LIKE` (`apps/web/src/lib/data.ts:810-842`); raw SQL uses Drizzle templates or parameter arrays in reviewed app paths.
- **Public privacy fields:** `apps/web/src/lib/data.ts:179-225` explicitly omits latitude, longitude, original filename, user filename, original format/size, and processed status from public selectors; share/group queries use those public selectors (`:633-715`).
- **XSS/output hardening:** `apps/web/src/lib/safe-json-ld.ts:14-18` escapes JSON-LD script content; all reviewed `dangerouslySetInnerHTML` usages feed `safeJsonLd`. `apps/web/src/lib/csv-escape.ts:41-63` strips controls/format chars and prefixes formula triggers. Production CSP avoids `unsafe-eval` and nonce-scopes scripts (`apps/web/src/lib/content-security-policy.ts:58-83`, `apps/web/src/proxy.ts:20-45`).
- **Public rate limiting:** Search/load-more and OG image generation have per-IP/bounded rate limits (`apps/web/src/app/actions/public.ts:65-163`; `apps/web/src/app/api/og/route.tsx:39-55`). Proxy header trust is explicit and validates IP chains (`apps/web/src/lib/rate-limit.ts:82-112`).
- **Secrets/config hygiene:** Grep found no committed private keys/API tokens. `.env`/uploads/data are ignored and excluded from Docker contexts (`.gitignore:6-19`, `.dockerignore:6-10`, `apps/web/.dockerignore:5-8`). CI credentials in `.github/workflows/quality.yml:27-37` are test-only fixture values.

## Final sweep checklist

- OWASP A01-A10 reviewed across authz, crypto/session, injection/XSS, insecure design/resource limits, config/deploy, vulnerable components, auth failures, data integrity/restore, logging/audit, and SSRF-like URL handling.
- Secrets scan reviewed committed source/config/scripts/docs and excluded ignored local secret files from disclosure; no production key material found in tracked files.
- Unsafe patterns sweep covered `dangerouslySetInnerHTML`, raw SQL, shell/child process use, filesystem joins/streams/deletes, redirects/URL construction, cookies, and proxy trust.
- Upload/file-serving sweep covered both Next upload routes, nginx static routes, private-original handling, topic images, local storage abstraction, queue cleanup, and deletion paths.
- Deployment sweep covered Dockerfile, Compose, nginx, deploy scripts, env examples, Docker ignore files, CI, package manifests/lockfile.
- Skipped only generated/vendor/output artifacts (`node_modules`, `.next`, tsbuildinfo) and binary image fixtures/uploads beyond path/exposure review.

## Verification performed

- `git status --short --branch` — captured concurrent/uncommitted files and avoided modifying others' edits.
- `find ...` inventory after exclusions — 229 matched security-relevant source/config/test/doc files.
- `git grep` secrets scan — no committed private keys/API tokens; only placeholders, CI fixtures, and env variable references.
- `rg` unsafe-pattern sweep — reviewed `dangerouslySetInnerHTML`, SQL/child-process/fs, cookie, redirect/fetch/URL matches.
- `npm run lint:action-origin --workspace=apps/web` — passed; all mutating server actions enforce same-origin provenance or are explicitly read-only exempt.
- `npm run lint:api-auth --workspace=apps/web` — passed; admin API route is authenticated.
- `npm audit --workspaces --omit=dev --json` — 3 moderate advisories via nested PostCSS under Next.
- `npm audit --json` — same 3 moderate advisories.
