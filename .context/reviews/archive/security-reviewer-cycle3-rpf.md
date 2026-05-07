# Security review — cycle 3 / Prompt 1

Date: 2026-04-29
Role: security-reviewer
Scope: `/Users/hletrd/flash-shared/gallery` tracked repository contents, excluding generated/untracked build artifacts (`node_modules`, `.next`) from findings unless they indicated a committed source/config issue. No implementation files were edited.

## Inventory and coverage

Repository inventory from `git ls-files`: **947 tracked files**.

I reviewed the security-relevant tracked files without sampling across these surfaces:

- **Project docs / threat-model notes:** `README.md`, `CLAUDE.md`, `AGENTS.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, prior `.context`/`plan` review notes that describe security-sensitive behavior.
- **Deployment and platform config:** `.github/workflows/quality.yml`, `.github/dependabot.yml`, `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, Playwright/e2e config.
- **App routing and auth boundaries:** `apps/web/src/proxy.ts`; all API route files under `apps/web/src/app/api/**/route.*` and `apps/web/src/app/**/uploads/[...path]/route.ts`; admin/public pages that render JSON-LD or protected UI.
- **Server actions:** `apps/web/src/app/actions/{auth,admin-users,images,public,seo,settings,sharing,tags,topics}.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`.
- **Security libraries and data access:** `apps/web/src/lib/action-guards.ts`, `api-auth.ts`, `request-origin.ts`, `session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `validation.ts`, `sanitize.ts`, `content-security-policy.ts`, `safe-json-ld.ts`, `backup-filename.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `data.ts`, `gallery-config*.ts`, `seo-og-url.ts`, `base56.ts`, `audit.ts`.
- **Upload / file / image processing:** `apps/web/src/lib/upload-limits.ts`, `upload-paths.ts`, `serve-upload.ts`, `storage/local.ts`, `process-image.ts`, `process-topic-image.ts`, `image-queue.ts`, `image-url.ts`, `blur-data-url.ts`, upload tracker/lock helpers.
- **Database and migrations:** `apps/web/src/db/**`, Drizzle SQL migrations and snapshots, migration/seed scripts under `apps/web/scripts/**`.
- **Regression tests and security gates:** auth/origin/rate-limit/backup/upload/restore/XSS/path traversal tests under `apps/web/src/__tests__/**`, e2e specs under `apps/web/e2e/**`, and the static guard scripts `apps/web/scripts/check-api-auth.ts` and `check-action-origin.ts`.

Automated sweeps run as supporting evidence:

- `npm audit --workspaces --omit=dev --json` → 0 vulnerabilities.
- `npm audit --workspaces --json` → 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web` → passed; admin API auth coverage OK.
- `npm run lint:action-origin --workspace=apps/web` → passed; mutating server actions enforce same-origin checks; read-only getters are explicitly exempt.
- Regex sweeps for `dangerouslySetInnerHTML`, `eval`, raw SQL, shell/process execution, filesystem operations, deserialization/`JSON.parse`, URL/network use, cookies/headers, API routes, admin auth wrappers, and credential/secret markers.
- High-signal tracked secret scan for common cloud/API/private-key/token patterns → no committed production secrets found. The only env-like tracked files are examples; `.github/workflows/quality.yml` uses isolated CI test credentials.

## Findings summary

| ID | Status | Severity | Confidence | Area |
| --- | --- | --- | --- | --- |
| SR-C3-01 | Confirmed | Medium | High | Trusted proxy / rate-limit identity spoofing |

No Critical or High severity findings were confirmed in this pass.

## Findings

### SR-C3-01 — Shipped nginx appends attacker-supplied `X-Forwarded-For`, weakening app-side per-IP rate limits and audit attribution

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **OWASP:** A05 Security Misconfiguration, A07 Identification and Authentication Failures, A09 Security Logging and Monitoring Failures; DoS/rate-limit bypass risk.
- **Citations:**
  - `apps/web/docker-compose.yml:18-20` sets `TRUST_PROXY: "true"` for the documented host-network nginx deployment.
  - `apps/web/nginx/default.conf:53-57`, `70-74`, `85-89`, and `120-124` forward `X-Real-IP $remote_addr` but also set `X-Forwarded-For $proxy_add_x_forwarded_for`, which preserves any inbound client-supplied `X-Forwarded-For` and appends nginx's `$remote_addr`.
  - `apps/web/src/lib/rate-limit.ts:82-104` trusts forwarded headers when `TRUST_PROXY=true`, parses `X-Forwarded-For`, and returns the address immediately before the configured trusted-proxy suffix (`TRUSTED_PROXY_HOPS`, default 1), falling back to `X-Real-IP` only when no client slot is present.
  - `README.md:146-148` correctly warns that trusted proxy headers must be overwritten by the trusted edge, but the shipped nginx config appends instead of overwriting `X-Forwarded-For`.
- **Failure scenario:**
  1. The site is deployed with the shipped compose/nginx pattern, so the app runs with `TRUST_PROXY=true` behind nginx.
  2. An attacker sends `X-Forwarded-For: 198.51.100.10` to nginx.
  3. nginx forwards `X-Forwarded-For: 198.51.100.10, <attacker-remote-addr>` to Next.js because `$proxy_add_x_forwarded_for` preserves the untrusted inbound value.
  4. With the default single trusted hop, `getClientIp()` selects `198.51.100.10` as the client IP. By changing the spoofed value, the attacker can rotate app-side per-IP buckets and pollute audit IP attribution.

  Account-scoped login rate limiting still limits repeated attacks against the same username, so this is not a complete login brute-force bypass. It does weaken IP-based controls for login spraying, public search/load-more/OG endpoint throttles, share/admin mutation quotas, upload quota attribution, and incident logs.
- **Fix:**
  - In the shipped nginx config, overwrite rather than append untrusted forwarded chains before traffic reaches the app, for every proxying location. For the documented single-hop nginx deployment, use `proxy_set_header X-Forwarded-For $remote_addr;` instead of `$proxy_add_x_forwarded_for`.
  - If a CDN/load balancer sits in front of nginx, have the trusted outer edge strip/overwrite inbound forwarding headers and configure nginx/app hop counts only for the exact trusted chain.
  - Consider changing `getClientIp()` for single-hop deployments to prefer the trusted nginx-set `X-Real-IP`, or reject/scrub `X-Forwarded-For` chains longer than the expected trusted path unless an explicitly trusted outer proxy has overwritten them.
  - Add a regression test for the shipped nginx/app contract: a client-supplied `X-Forwarded-For` must not become the app's rate-limit key when `TRUST_PROXY=true`.

## Reviewed areas with no confirmed findings

- **Secrets:** No active production secrets, private keys, cloud keys, GitHub/OpenAI-style tokens, or real `.env` files were found in tracked source/config. Example files use placeholders. CI credentials are scoped test values. Docs already warn that historical checked-in values must be treated as compromised and rotated.
- **Authentication/session:** Admin passwords use Argon2id; sessions are random HMAC-signed cookies hashed before DB storage; production requires a sufficiently long `SESSION_SECRET`; session comparison uses constant-time verification; cookies are `httpOnly`, `sameSite=lax`, and `secure` when the trusted request protocol is HTTPS/production. Logout and password change enforce same-origin checks and session rotation/deletion.
- **Authorization:** Admin layouts/actions validate `isAdmin()`. Static guard `lint:api-auth` passed for admin API routes. The project intentionally treats all admin users as root-equivalent; this is a documented design choice rather than an unintentional authz bypass.
- **CSRF/origin:** Mutating admin server actions call `requireSameOriginAdmin()`/`hasTrustedSameOrigin`; admin DB download has explicit same-origin enforcement; the origin checker fails closed when both `Origin` and `Referer` are absent. The confirmed proxy issue above affects IP attribution, not the Host/X-Forwarded-Host/Proto overwrite paths used by same-origin checks in the shipped config.
- **SQL injection:** User-controlled values are validated and bound through Drizzle query builders or parameterized `sql` templates. Search escapes LIKE wildcards. Migration scripts use static SQL or explicit parameter binding for env/bootstrap values.
- **Unsafe deserialization / restore SQL:** JSON parsing is limited to controlled config/migration metadata. DB restore scans uploads with size caps, header checks, comment/literal masking, and dangerous SQL pattern blocking before piping to `mysql --one-database`; restore/download require admin auth and same-origin checks.
- **File/path traversal:** Public upload serving restricts top-level derivative directories, validates path segments/extensions, rejects symlinks/non-files, uses `realpath` containment, and does not serve original uploads. Backup downloads use strict backup filename validation plus backup-directory containment and symlink rejection. Local storage key normalization rejects absolute paths, empty segments, and `..`.
- **Upload/image processing:** Uploads require admin auth and same-origin, enforce per-file and total byte caps, validate filenames/extensions, store originals outside public derivatives, run Sharp with pixel limits, and generate random derivative names. Topic image uploads use temp random names and bounded dimensions.
- **SSRF/external fetch:** No user-controlled server-side fetch target was found. `IMAGE_BASE_URL` and SEO/OG URL handling validate absolute URLs and reject credentials/query/hash for CSP/image config where applicable.
- **XSS/public leakage:** `dangerouslySetInnerHTML` is limited to JSON-LD output passed through `safeJsonLd()`, which escapes `<`, U+2028, and U+2029, with CSP nonces applied. Public data selectors intentionally omit private original filenames, user filenames, GPS latitude/longitude, original format/size, and unprocessed images.
- **DB backup/restore leakage:** Dumps and restore temp files are written with `0600` modes, backup download is admin-only/same-origin, stderr sanitizes DB password patterns, and private backup paths are under app data rather than public uploads.
- **Dependencies:** Both production-only and all-workspace npm audits reported zero known vulnerabilities at review time.

## Final missed-issues sweep

The final sweep re-ran targeted searches for:

- API route exports without auth wrappers.
- Mutating server actions without same-origin guards.
- Raw SQL and shell invocations.
- Filesystem reads/writes, symlink-sensitive serving, and backup/restore paths.
- `dangerouslySetInnerHTML`, `eval`, `new Function`, and DOM injection patterns.
- `JSON.parse`/deserialization and URL/fetch/HTTP calls.
- Credential/secret markers and high-signal token/private-key patterns.

The sweep did not reveal additional confirmed vulnerabilities beyond SR-C3-01.

## Remaining risks / assumptions

- This was a static source/config review plus existing test/static-gate execution; I did not run a live exploit against a deployed nginx instance.
- The single web-instance/single-writer topology is an explicit project constraint. Scaling horizontally without moving process-local restore maintenance, upload quota, and queue state into shared coordination storage remains an operational risk documented in the repo.
- The all-admins-are-root model is explicit in the docs. If future deployments need least-privilege roles, that should be treated as a product/security requirement change rather than a small patch.
