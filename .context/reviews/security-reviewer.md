# Security Reviewer - cycle 6/100

Role: `security-reviewer`
HEAD reviewed: `e6db9241b3b4f2adbedaeeb46eb5d68275b74879`
Date: 2026-06-29
Scope: current HEAD in `/Users/hletrd/flash-shared/gallery`; report-only pass. No source code fixes implemented.

## Inspection Inventory

Read first, before source review:
- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/security-review/SKILL.md`

Review-relevant HEAD inventory built before findings:
- Docs and operational context: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, current `.context/plans/README.md`, active `.context/reviews/*.md`, and current deployed topology notes in `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, and `apps/web/deploy.sh`.
- Package and build config: root `package.json`, `package-lock.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/next.config.ts`, `apps/web/tsconfig*.json`, `apps/web/eslint.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.env.deploy.example`, and `apps/web/.env.local.example`.
- API route inventory: all 8 route files under `apps/web/src/app/api/**/route.{ts,tsx}`: admin DB download, Lightroom upload, health/live, OG image, OG photo, semantic search, and similar search.
- Server action inventory: all 13 files under `apps/web/src/app/actions/*.ts` plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/authz/origin/session/rate-limit: `api-auth.ts`, `session.ts`, `action-guards.ts`, `request-origin.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `admin-tokens.ts`, `password-hashing.ts`, and admin route middleware in `proxy.ts`.
- Upload, path traversal, and image processing: `upload-paths.ts`, `upload-filenames.ts`, `upload-limits.ts`, `serve-upload.ts`, `process-image.ts`, `process-topic-image.ts`, `gps-exif-strip.ts`, `storage/local.ts`, `storage/types.ts`, and upload cleanup/queue paths.
- Backup/restore: `db-actions.ts`, `api/admin/db/download/route.ts`, `backup-filename.ts`, `download-filename.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `migrate.js`, `mysql-connection-options.js`, and DB migration journal/state under `apps/web/drizzle/`.
- Public/admin data boundaries: `data.ts`, `search-enrichment-fields.ts`, `smart-collections.ts`, public photo/topic/share/map pages, service worker cache logic, OG routes, Atom feed, JSON-LD emitters, and map/search/share actions.
- Input/output safety: `sanitize.ts`, `validation.ts`, `safe-json-ld.ts`, `og-sanitize.ts`, `csv-escape.ts`, `seo-og-url.ts`, `content-security-policy.ts`, `blur-data-url.ts`.
- Scripts and migrations: 27 files in `apps/web/scripts/` were inventoried; security-relevant scripts inspected included migration/bootstrap, CLIP model download/manifest verification, admin seeding, lint guards, service worker build, e2e server, and backfill sidecars. Drizzle migration SQL and journal files were inventoried for schema/security surfaces.
- Tests reviewed as evidence: auth/session/token/origin/rate-limit tests, admin/API guard lint tests, upload/path/restore/search/share/privacy tests, safe JSON-LD tests, service worker cache contract tests, and Docker/deploy contract tests where relevant.

Categories covered: OWASP Top 10, auth/authz, admin/API guards, CSRF/origin, rate limiting, uploads/path traversal, backup/restore, SSRF/open redirect/CSP, XSS/JSON-LD, secrets, dependency/config risks, and cross-file deployment assumptions.

## Confirmed Issues

### SEC-C6-01 - Docker build bypasses the committed lockfile for native packages

Severity: Medium
Confidence: High
OWASP: A06 Vulnerable and Outdated Components; A08 Software and Data Integrity Failures
Status: confirmed issue

File/region:
- `apps/web/Dockerfile:44-51`
- `package-lock.json:1217-1220`, `package-lock.json:1351-1371`, `package-lock.json:1723-1726`, `package-lock.json:2032-2035`, `package-lock.json:3472-3475`, `package-lock.json:7833-7836`

Problem:
The Docker `deps` stage first runs `npm ci --workspace=apps/web --include=optional`, which uses the reviewed `package-lock.json`, but then runs a second `npm install --no-save` for platform-native packages without versions:

```Dockerfile
npm install --workspace=apps/web --include=optional --no-save \
    @img/sharp-libvips-linux-${TARGETARCH:-arm64} \
    @img/sharp-linux-${TARGETARCH:-arm64} \
    @parcel/watcher-linux-${TARGETARCH:-arm64}-glibc \
    @swc/core-linux-${TARGETARCH:-arm64}-gnu \
    @next/swc-linux-${TARGETARCH:-arm64}-gnu \
    lightningcss-linux-${TARGETARCH:-arm64}-gnu
```

Those same native packages are already pinned with integrity hashes in the committed lockfile, for example `@img/sharp-linux-arm64@0.34.5`, `@next/swc-linux-arm64-gnu@16.2.9`, `@swc/core-linux-arm64-gnu@1.15.41`, and `lightningcss-linux-arm64-gnu@1.32.0`. The second install can resolve current registry `latest` versions inside the production build image, outside the reviewed lockfile and outside the `npm audit` result for the committed dependency graph.

Why it matters:
These packages contain native code and build/runtime toolchain components. A normal deployment can silently consume a newer native package than the one reviewed, tested, and integrity-pinned in `package-lock.json`. That weakens the core supply-chain guarantee of `npm ci`: source review and dependency audit no longer prove what the Docker build actually ran.

Concrete failure scenario:
An upstream native package publishes a compromised, yanked, broken, or ABI-incompatible `latest` release after this commit. A later `npm run deploy` rebuilds the image from unchanged source and lockfile, but the unversioned `npm install --no-save` pulls that new package into the build stage. The malicious or broken native package runs during `next build` or is traced into the standalone runtime dependency set, even though the repository diff and lockfile did not change.

Suggested fix:
Keep the Linux optional-dependency workaround, but make it lockfile-enforced. Prefer a single `npm ci` path that materializes Linux optional dependencies from `package-lock.json` using npm's supported `--os/--cpu` or platform install controls. If the explicit install is still needed, install exact versions matching `package-lock.json` and fail if the package-lock version cannot be resolved, for example generated from lockfile entries rather than unversioned package names. Add a Dockerfile contract test that rejects unversioned `npm install --no-save` native package names.

## Likely Issues

No likely application-security issues were identified beyond the confirmed Docker supply-chain issue above. The reviewed auth, origin, upload, restore, public data, and SSRF/CSP paths had concrete guards and matching tests or lint gates.

## Risks Needing Manual Validation

### RISK-C6-01 - TLS and HSTS rely on an external edge, not this nginx file

Severity if misdeployed: High
Confidence: Medium
Status: deployment risk needing manual validation
OWASP: A02 Cryptographic Failures; A05 Security Misconfiguration

File/region:
- `apps/web/nginx/default.conf:21-28`
- `apps/web/nginx/default.conf:47-53`

Why it needs validation:
The checked-in nginx server listens on cleartext port 80 and comments that it is intended to sit behind a TLS-terminating edge/load balancer. It also sends HSTS from this server block. That is safe only if production really terminates HTTPS before this listener and either blocks or redirects direct cleartext public access.

Failure scenario:
If this nginx config is ever used as the public edge without a separate 443 server and HTTP-to-HTTPS redirect, admin login/session traffic can be exposed on cleartext HTTP. Production cookies are marked `Secure`, which may break login over plain HTTP, but that is not a substitute for transport enforcement.

Suggested fix:
Verify the live production path has HTTPS termination and port-80 redirect/blocking in front of this file. Consider shipping the redirect/443 config or an explicit deployment probe/assertion so this assumption fails closed when the topology changes.

### RISK-C6-02 - Client-IP trust depends on exact proxy-chain topology

Severity if misconfigured: Medium
Confidence: Medium
Status: deployment risk needing manual validation
OWASP: A05 Security Misconfiguration

File/region:
- `apps/web/docker-compose.yml:14-21`
- `apps/web/nginx/default.conf:67-69`, `apps/web/nginx/default.conf:84-86`, `apps/web/nginx/default.conf:101-103`, `apps/web/nginx/default.conf:141-143`, `apps/web/nginx/default.conf:192-194`
- `apps/web/src/lib/rate-limit.ts:152-180`

Why it needs validation:
The container sets `TRUST_PROXY=true`, and app rate limits derive the client from `X-Forwarded-For`/`X-Real-IP`. The nginx config forwards `$remote_addr`, not an appended chain. That is correct if this nginx instance directly sees the real client or a trusted upstream has already rewritten `$remote_addr` via nginx `real_ip` configuration outside this file. If an upstream TLS/CDN/load balancer is present and `real_ip` is not configured, all app-level login/search/share rate limits can collapse onto the load balancer address.

Failure scenario:
With a CDN or TLS LB in front of this nginx host, every client appears as the same upstream IP. A few failed login attempts can lock out all users behind that edge bucket, while public route abuse attribution and throttling become inaccurate.

Suggested fix:
Validate the live nginx `real_ip_header`/`set_real_ip_from` configuration or equivalent edge behavior. If a multi-hop chain is intentional, set and test `TRUSTED_PROXY_HOPS` with representative `X-Forwarded-For` headers and add an operational smoke test for distinct client IP extraction.

### RISK-C6-03 - Several security controls are intentionally process-local

Severity if scaled out: Medium
Confidence: High
Status: topology risk, not a current single-instance vulnerability
OWASP: A04 Insecure Design; A05 Security Misconfiguration

File/region:
- `apps/web/docker-compose.yml:11-21`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/restore-maintenance.ts`

Why it needs validation:
The documented deployment is a single web container. Under that topology, process-local restore maintenance flags, upload accounting, and in-memory rate-limit fast paths are coherent. If the service is horizontally scaled, those controls become per-replica unless backed by a shared store.

Failure scenario:
A restore running on replica A would not automatically block upload work routed to replica B. Public request budgets could also be multiplied by distributing traffic across replicas.

Suggested fix:
Keep single-instance deployment as an explicit invariant, or move restore state, upload claims, and limiter buckets to shared DB/Redis leases before adding replicas. Add a deployment guard if replica count can exceed one.

## Positive Security Evidence

- Admin APIs: both admin API routes are wrapped by `withAdminAuth`; the lint guard passed. PAT auth is scope-limited for Lightroom upload, and cookie auth requires same-origin plus `isAdmin()` (`apps/web/src/lib/api-auth.ts:54-133`).
- Server actions: the origin lint guard passed for all mutating server actions; `requireSameOriginAdmin()` or equivalent same-origin checks are present.
- Sessions: production rejects missing/short `SESSION_SECRET`, session tokens are HMAC signed, DB-hashed, max-age checked, timing-safe verified, and expired rows are deleted (`apps/web/src/lib/session.ts:16-150`).
- Login/password change: same-origin checks, pre-incremented IP/account rate limits, Argon2id policy, dummy-hash timing equalization, session rotation, and secure cookie attributes are present (`apps/web/src/app/actions/auth.ts:70-443`; `apps/web/src/lib/password-hashing.ts:10-15`).
- Browser and Lightroom uploads: admin/PAT auth, origin or token-scope gating, content-length/size limits, filename sanitization, upload quota preclaims, disk-space fail-closed checks, topic validation, GPS stripping, HDR rejection, cleanup, and audit paths are present.
- Path traversal: upload serving and backup download validate path segments/filenames, reject symlinks, use `realpath` containment, and stream from resolved paths (`apps/web/src/lib/serve-upload.ts:127-296`; `apps/web/src/app/api/admin/db/download/route.ts:22-87`).
- Backup/restore: dump and restore are admin plus same-origin gated, use random temp files with `0600`, sanitize stderr, avoid shell interpolation, check restore size/header, scan for dangerous SQL, and use advisory/maintenance locks (`apps/web/src/app/[locale]/admin/db-actions.ts:119-599`; `apps/web/src/lib/sql-restore-scan.ts:12-168`).
- SSRF/open redirect: OG photo fetches are pinned to same-origin configured URLs with byte/time caps, and SEO OG URL validation rejects cross-origin absolute URLs and scheme-relative/backslash tricks (`apps/web/src/app/api/og/photo/[id]/route.tsx:100-133`; `apps/web/src/lib/og-photo-fetch.ts:30-94`; `apps/web/src/lib/seo-og-url.ts:3-43`).
- CSP/XSS: production CSP is generated centrally with nonces, `frame-ancestors 'self'`, `object-src 'none'`, and HTTPS-only optional image base URLs. Reviewed `dangerouslySetInnerHTML` usage is JSON-LD only and goes through `safeJsonLd`, with tests for `</script>` and U+2028/U+2029 escaping.
- Public data privacy: public select shapes omit sensitive admin/internal fields and have compile-time privacy guards; semantic/similar search enrichment uses the shared public-safe field set.
- Secrets: tracked env files and docs contain placeholders only; no usable committed credential was found by targeted secret-pattern scans.

## Automated Validation

Passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspaces --omit=dev --json` - 0 vulnerabilities in production dependency audit metadata

Additional static sweeps performed:
- API/action inventory with `find apps/web/src/app/api ...` and `find apps/web/src/app/actions ...`
- Dangerous primitive sweep for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, child-process calls, fetches, filesystem streams, cookies/headers, and path joins/resolves
- Secret-pattern sweep for common cloud/API/token/private-key markers and committed env files
- Lockfile/Dockerfile targeted sweep for native optional dependency versions and install commands

## Final Missed-Issues Sweep

- Auth/authz/admin guards: no unwrapped admin API route found; no mutating server action missing same-origin protection found.
- CSRF/origin: same-origin checks are centralized and used on cookie-auth admin/public mutation paths; PAT upload intentionally bypasses origin only with scoped bearer-token auth.
- Rate limiting: public mutating API lint passed; login/password/share/search/view/upload limiter paths were traced. Remaining concerns are deployment topology risks, not confirmed single-instance bugs.
- Upload/path traversal: browser upload, Lightroom upload, public derivative serving, topic images, local storage, backup download, and cleanup paths were checked for basename normalization, extension allowlists, symlink rejection, and containment.
- Backup/restore: mysqldump/mysql invocation, filename validation, restore SQL scan, temp-file handling, migration post-restore, and download route were checked.
- SSRF/CSP/open redirect: OG fetch/fallback, SEO OG URL validation, CSP image base URL parsing, and service worker cache boundaries were checked.
- Secrets/dependencies/config: committed examples/docs contain placeholders; `npm audit` found no production vulnerabilities; one confirmed Docker build reproducibility/supply-chain issue remains.

Relevant files intentionally not inspected byte-by-byte:
- Binary/static assets and fixtures: images, screenshots, ICC profiles, fonts, icons, and generated visual artifacts under `.context/**`, `apps/web/public/**`, `apps/web/e2e/fixtures/**`, and test fixture directories.
- Historical archived review/plan logs under `.context/reviews/**/archive`, `.context/plans/archive/**`, `plan/**`, and `docs/superpowers/**` were inventoried and spot-checked for security context but not treated as current source of truth.
- Generated/cache/output directories such as `.next`, runtime upload/data directories, gate logs, and pid/log artifacts were not reviewed as HEAD source.
- `package-lock.json` was not read line-by-line; it was audited and targeted for package/version/integrity entries relevant to dependency risk.

Conclusion: current HEAD has one confirmed Medium supply-chain/config issue in the Docker build. The application security controls for auth, origin, uploads, restore, public privacy, SSRF, and CSP are otherwise strong for the documented single-instance deployment, with TLS/proxy/scale assumptions requiring operational validation.
