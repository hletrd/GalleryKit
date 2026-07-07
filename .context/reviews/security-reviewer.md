# Security Reviewer Report - review-plan-fix cycle 6 prompt 1

Date: 2026-07-07
Reviewer lane: security-reviewer
HEAD reviewed: `423fa6c1f599a267d80738271152e7f6f7968598`
Scope: read-only source review plus this artifact. No source code edits.
Reference baseline: OWASP Top 10:2021 categories. OWASP has a 2025 release-candidate page, but this review uses the stable 2021 category names required by the security-review workflow.

## Result Summary

- Confirmed issues: 1 Medium
- Likely issues: 1 Low
- Manual-validation risks: 4
- Confirmed Critical/High app vulnerabilities found: 0

The main application security boundaries are cohesive. Admin API routes are centralized through `withAdminAuth`, mutating server actions enforce same-origin provenance, public expensive routes are rate-limited or explicitly exempted with bounded/cacheable behavior, transformed upload serving rejects traversal and symlinks, original uploads are private, public data projections omit admin/private fields, and backup/restore flows have locking, scanner, filename, and filesystem controls. The one confirmed issue is in the dev/build dependency graph, not the production runtime container.

## Inventory Built First

Review-relevant files and docs inventoried before detailed inspection:

- Project/security docs: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/security-reviewer.md`, `.context/reviews/prompts/common_review_scope.md`.
- API routes: `apps/web/src/app/api/**/route.ts`, `apps/web/src/app/api/**/route.tsx`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, feed routes, OG routes.
- Server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Auth/session/rate-limit/request guards: `apps/web/src/lib/session.ts`, `api-auth.ts`, `request-origin.ts`, `action-guards.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `admin-tokens.ts`, `proxy.ts`.
- Upload/path/image handling: `upload-paths.ts`, `upload-filenames.ts`, `serve-upload.ts`, `process-image.ts`, upload routes, delete/cleanup paths in `actions/images.ts`.
- Backup/restore/SQL tooling: `db-actions.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `backup-filename.ts`, `scripts/migrate.js`, `scripts/mysql-connection-options.js`.
- XSS/data exposure: `sanitize.ts`, `validation.ts`, `safe-json-ld.ts`, `content-security-policy.ts`, `data.ts`, `search-enrichment-fields.ts`, OG helpers.
- Deployment/dependency/secrets surfaces: `apps/web/package.json`, `package-lock.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, env examples and secret-placeholder docs.

## Confirmed Issues

### SR6-C01 - Medium - Vulnerable dev/build transitive dependency remains under `drizzle-kit`

Confidence: High

Evidence:

- `apps/web/package.json:70-85` declares `drizzle-kit` as a dev dependency, with `drizzle-kit` at `^0.31.10` on `apps/web/package.json:77`.
- The root override tries to force `esbuild` to `0.28.1` in `package.json:7-10`, but the lockfile still contains nested `node_modules/@esbuild-kit/core-utils/node_modules/esbuild` at `0.18.20` in `package-lock.json:1261-1276`.
- `npm ls esbuild --workspace=apps/web` confirmed the path: `drizzle-kit@0.31.10 -> @esbuild-kit/esm-loader@2.6.5 -> @esbuild-kit/core-utils@3.3.2 -> esbuild@0.18.20`.
- `npm audit --workspace=apps/web --audit-level=moderate` failed with 4 moderate findings for `esbuild <=0.24.2` via that `@esbuild-kit` chain.
- Production exposure is reduced because the Docker runtime dependency stage runs `npm ci --omit=dev --workspace=apps/web` in `apps/web/Dockerfile:67-84`, and the runner copies only the production dependency tree from that stage in `apps/web/Dockerfile:160-169`.

Concrete failure scenario:

A developer, CI runner, or operator runs affected dev tooling in an environment where esbuild's development server is reachable from a browser or network interface. A malicious site visited by that browser can interact with the vulnerable dev server and read responses. This does not appear to ship in the production container, but it is still a real workstation/build-host exposure and keeps the dependency audit red.

Concrete fix:

Upgrade `drizzle-kit` or its transitive loader chain when upstream removes the vulnerable nested `esbuild`, or test a targeted override that forces the nested `@esbuild-kit/core-utils` `esbuild` to a patched version without breaking migrations/introspection. Do not apply `npm audit fix --force` blindly: npm proposes a breaking downgrade path. After the fix, verify `npm ls esbuild --workspace=apps/web` no longer shows `0.18.20` and `npm audit --workspace=apps/web --audit-level=moderate` passes.

## Likely Issues

### SR6-L01 - Low - Production CSP still allows inline styles

Confidence: Medium

Evidence:

- `apps/web/src/lib/content-security-policy.ts:138-142` documents that production still allows inline styles for framework/component compatibility.
- The actual production directive includes `style-src 'self' 'unsafe-inline'` at `apps/web/src/lib/content-security-policy.ts:143-155`.
- Script execution is substantially tighter because production `script-src` is built from `'self'` plus a nonce in `apps/web/src/lib/content-security-policy.ts:125-131` and `apps/web/src/lib/content-security-policy.ts:143-145`.

Concrete failure scenario:

If a future HTML or style injection bug reaches rendered user-controlled content, the current CSP would allow injected CSS. That is not direct script execution, but it can support UI redress, click deception, or limited data inference depending on browser behavior and page structure.

Concrete fix:

Keep the current allowance only if browser coverage proves Next/font, Tailwind, and component sizing require it. Otherwise move inline styles to static classes or introduce hashes/nonces for required style blocks. If retained, document it as an accepted CSP tradeoff and keep script, object, base-uri, and frame-ancestor restrictions strict.

## Manual-Validation Risks

### SR6-M01 - Conditional High - Public TLS edge must not be the cleartext nginx listener

Confidence: Medium

Evidence:

- The shipped nginx config listens on port 80 in `apps/web/nginx/default.conf:46-55`.
- The same block explicitly says this listener is an internal HTTP hop behind a TLS-terminating edge and that HSTS does not provide TLS by itself in `apps/web/nginx/default.conf:50-55`.
- The compose file uses host networking and expects a host nginx reverse proxy in `apps/web/docker-compose.yml:15-22`.

Risk scenario:

If the nginx listener in this repository is exposed directly as the public edge over HTTP, admin login credentials, restore/backup requests, and session establishment traffic can cross the network in cleartext. Production cookies are marked secure in the app, but the credential POST itself would still be exposed before any cookie protection matters.

Concrete validation/fix:

From outside the deployment network, verify public port 80 redirects to HTTPS and that the public HTTPS endpoint terminates TLS before forwarding internally. If this nginx instance is the public edge, add a 443 server block with certificates and redirect all cleartext 80 traffic before serving the app. Firewall direct access to the Node listener and any internal-only cleartext hop.

### SR6-M02 - Medium - Proxy trust and rate-limit IP attribution depend on exact deployment topology

Confidence: Medium

Evidence:

- App-side client IP attribution trusts forwarded headers only when `TRUST_PROXY=true` and then selects based on `TRUSTED_PROXY_HOPS` in `apps/web/src/lib/rate-limit.ts:175-205`.
- The compose file sets `TRUST_PROXY: "true"` in `apps/web/docker-compose.yml:20-22`.
- Nginx rate-limit zones key on `$binary_remote_addr` in `apps/web/nginx/default.conf:1-29`.
- The nginx comments warn that overwriting `X-Forwarded-For` with `$remote_addr` is correct only when the TCP peer is the real client, and that LB-fronted deployments need different XFF and realip handling in `apps/web/nginx/default.conf:57-69`.

Risk scenario:

If an upstream load balancer connects to nginx from its own IP while nginx overwrites `X-Forwarded-For` with `$remote_addr`, all visitors share the load balancer's bucket. One attacker can lock out legitimate users or distort per-IP limits. If forwarded host/proto/IP headers are appended or trusted with the wrong hop count, same-origin reconstruction and rate-limit attribution can diverge from the real client and real external origin.

Concrete validation/fix:

Test through the live public edge with spoofed `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`, and multi-hop `X-Forwarded-For` values. Confirm the app origin does not change and rate-limit buckets use the intended client. In LB-fronted topologies, configure `ngx_http_realip_module` (`set_real_ip_from`, `real_ip_header`) or PROXY protocol for nginx zones, switch app-facing XFF to the correct append/overwrite contract, and set `TRUSTED_PROXY_HOPS` to the real trusted suffix length.

### SR6-M03 - Medium - Historical secrets in git history require operator rotation verification

Confidence: High that the risk exists historically; Low on current production state without operator evidence.

Evidence:

- `CLAUDE.md:73-83` instructs operators to create private env files with real `DB_PASSWORD`, `ADMIN_PASSWORD`, and `SESSION_SECRET` values.
- `CLAUDE.md:85-87` explicitly warns that environments seeded from older checked-in examples must rotate `SESSION_SECRET` and bootstrap/admin credentials because historical git values are compromised.
- Current runtime code refuses a missing or short production `SESSION_SECRET` and avoids DB fallback in `apps/web/src/lib/session.ts:19-35`.
- Static secret-pattern review found placeholders/redacted examples rather than live secrets in tracked HEAD, but source review cannot prove production values were rotated.

Risk scenario:

If production still uses a historical `SESSION_SECRET`, anyone with repo history can forge admin session tokens. If historical bootstrap/admin or database credentials are still live, an attacker with that history can authenticate directly.

Concrete validation/fix:

Verify production `SESSION_SECRET`, admin passwords, PATs, and database credentials differ from any historical checked-in examples. Rotate them if uncertain, invalidate existing sessions after `SESSION_SECRET` rotation, revoke and recreate long-lived admin tokens, and keep env files mode `0600`.

### SR6-M04 - Low/Medium - Plaintext backup artifacts rely on host filesystem controls

Confidence: Medium

Evidence:

- Backup directories are created owner-only in `apps/web/src/app/[locale]/admin/db-actions.ts:196-200`.
- Backup temp files are written with mode `0o600` in `apps/web/src/app/[locale]/admin/db-actions.ts:238`.
- Completed backups are published only after non-empty/header/trailer validation and atomic rename in `apps/web/src/app/[locale]/admin/db-actions.ts:296-353`.
- Backup download is routed through authenticated admin API download links returned at `apps/web/src/app/[locale]/admin/db-actions.ts:369-370`.

Risk scenario:

Database backups contain gallery metadata and administrative state. The application handles local permissions carefully, but compromise of the host account, bind mount, disk snapshot, or off-host copied backup exposes plaintext contents.

Concrete validation/fix:

Verify backup volume permissions, retention, and any off-host copies. Encrypt backups at rest if they leave the trusted host or if the host has multiple administrative users. Treat downloaded backups as sensitive operator artifacts.

## Cross-File Security Observations

- Auth/session: Session tokens are HMAC-bound and timestamped in `apps/web/src/lib/session.ts:82-89`, hash-stored via `apps/web/src/lib/session.ts:8-10`, and production rejects missing/short session secrets in `apps/web/src/lib/session.ts:19-35`.
- Login/password flows: Login enforces same-origin before credential verification in `apps/web/src/app/actions/auth.ts:77-103`, pre-increments IP and account rate limits before Argon2 work in `apps/web/src/app/actions/auth.ts:129-160`, and password change rotates all sessions in `apps/web/src/app/actions/auth.ts:389-419`.
- Admin APIs/actions: Token-authenticated admin API requests require an explicit allowed scope in `apps/web/src/lib/api-auth.ts:68-111`; cookie-authenticated admin API requests require trusted same-origin before `isAdmin()` in `apps/web/src/lib/api-auth.ts:114-143`; mutating server actions centralize same-origin checks in `apps/web/src/lib/action-guards.ts:37-44`.
- Public rate limits: The per-photo OG route rate-limits before DB/Sharp/Satori work in `apps/web/src/app/api/og/photo/[id]/route.tsx:87-110`, keeps DB misses charged in `apps/web/src/app/api/og/photo/[id]/route.tsx:120-133`, and keeps fetch/render failures charged in `apps/web/src/app/api/og/photo/[id]/route.tsx:202-207` and `apps/web/src/app/api/og/photo/[id]/route.tsx:311-320`.
- SSRF: Per-photo OG derivative fetches use the configured canonical `BASE_URL`, not attacker-controlled request origin, in `apps/web/src/app/api/og/photo/[id]/route.tsx:176-196`; the helper fetches only `/uploads/jpeg/<app filename>` with timeout and byte caps in `apps/web/src/lib/og-photo-fetch.ts:64-87`; fallback redirects require same-origin in `apps/web/src/app/api/og/photo/[id]/route.tsx:329-375`.
- Upload/path safety: Original-upload candidate resolution validates basename-only filenames, rejects symlinks, and verifies realpath containment in `apps/web/src/lib/upload-paths.ts:120-170`; production fails on legacy public originals in `apps/web/src/lib/upload-paths.ts:173-193`; public transformed upload serving allowlists top-level directories/extensions, rejects unsafe path segments, rejects symlinks, and verifies realpath containment in `apps/web/src/lib/serve-upload.ts:168-238`.
- Data exposure: Public image selects explicitly omit private/admin fields in `apps/web/src/lib/data.ts:368-407`; map selects are the only public latitude/longitude exception and are documented as requiring `topics.map_visible` in `apps/web/src/lib/data.ts:409-444`; compile-time guards cover public and map field leaks in `apps/web/src/lib/data.ts:458-488`.
- XSS: JSON-LD serialization escapes `<`, `>`, U+2028, and U+2029 in `apps/web/src/lib/safe-json-ld.ts:14-19`; OG text is sanitized before Satori rendering in `apps/web/src/app/api/og/photo/[id]/route.tsx:136-138`.
- Backup/restore: Backup creation uses same-origin and admin checks in `apps/web/src/app/[locale]/admin/db-actions.ts:165-176`, avoids credentials in child-process argv by passing MySQL credentials via a minimal environment in `apps/web/src/app/[locale]/admin/db-actions.ts:223-236`, and sanitizes stderr in `apps/web/src/app/[locale]/admin/db-actions.ts:263-265`.
- Secrets: HEAD-level secret scan found placeholders/redacted examples, not live credential values. The remaining secret concern is historical rotation verification in SR6-M03.

## OWASP Sweep

| Category | Result | Notes |
| --- | --- | --- |
| A01 Broken Access Control | Pass | Admin API wrapping and server-action origin lint gates passed; PAT route access is explicitly scoped. |
| A02 Cryptographic Failures | Pass with manual secret validation | Production session secret is required and sessions are hash-stored; historical secret rotation still needs operator proof. |
| A03 Injection | Pass | Reviewed user-controlled DB access uses query builders/parameterization; restore is privileged and scanner-gated. |
| A04 Insecure Design | Pass with deployment assumptions | Single-host and trusted-proxy assumptions are documented and must stay aligned with production topology. |
| A05 Security Misconfiguration | Low likely issue plus manual deployment risks | Inline styles remain allowed in CSP; TLS edge and proxy trust need live validation. |
| A06 Vulnerable/Outdated Components | Medium confirmed | Nested dev `esbuild@0.18.20` remains under `drizzle-kit`. |
| A07 Identification/Auth Failures | Pass | Login/password/session flows include same-origin checks, rate limits, Argon2, and session rotation. |
| A08 Software/Data Integrity Failures | Pass with backup/restore caution | Backups/restores are locked and validated; plaintext backup handling remains an operator risk. |
| A09 Logging/Monitoring Failures | Pass | Auth/admin/backup paths log audit events and sanitize sensitive child-process stderr. |
| A10 SSRF | Pass | OG internal fetch is same-origin, app-path constrained, timeout bounded, and byte capped. |

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm audit --workspace=apps/web --audit-level=moderate` - failed on the confirmed moderate dev/build `esbuild` advisory chain through `drizzle-kit`.
- `npm ls esbuild --workspace=apps/web` - confirmed `drizzle-kit@0.31.10 -> @esbuild-kit/core-utils@3.3.2 -> esbuild@0.18.20`.
- Secret-pattern scan across tracked files - found placeholders/redacted examples and historical-review text, not live HEAD secrets.

## Final Sweep

I re-swept admin API wrappers, mutating server-action origin guards, public route rate-limit gates, child-process use, raw SQL use, path traversal/symlink controls, JSON-LD and OG rendering, privacy field projections, Docker/runtime dependency shape, nginx proxy assumptions, env examples, and lockfile dependency state. No source code was edited. The open items are the one confirmed dependency audit failure, one low CSP hardening issue, and four deployment/operator validations listed above.
