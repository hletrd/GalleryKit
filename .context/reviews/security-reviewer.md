# Security Reviewer Report - Cycle 16/100

Review lane: `security-reviewer`
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `3da74946a7e7a198041bf6067a0192411d61a860`
Scope: current HEAD only, full repository inventory plus OWASP/auth/authz/secrets/input-validation/data-exposure review. Historical review files were included in inventory and secret-pattern sweeps, but findings below are about current HEAD behavior.

## Inventory Summary

Tracked files at HEAD: 2,557.

Review-relevant inventory built from `git ls-tree -r --name-only HEAD`, route/action/lib/config searches, and security pattern sweeps:

| Area | Count / files reviewed |
| --- | --- |
| Application source | 77 app route/page files, 8 API route files, 14 server-action files, 96 library files, 57 components |
| Security/auth core | `src/app/actions/auth.ts`, `src/lib/session.ts`, `src/lib/password-hashing.ts`, `src/lib/api-auth.ts`, `src/lib/action-guards.ts`, `src/lib/admin-tokens.ts`, `src/proxy.ts`, `src/lib/request-origin.ts`, `src/lib/rate-limit.ts`, `src/lib/content-security-policy.ts` |
| Admin mutation surfaces | `src/app/actions/*.ts`, `src/app/[locale]/admin/db-actions.ts`, `src/app/api/admin/db/download/route.ts`, `src/app/api/admin/lr/upload/route.ts` |
| Public mutation / abuse surfaces | `src/app/actions/public.ts`, `src/app/api/search/semantic/route.ts`, `src/app/api/search/similar/[id]/route.ts`, OG routes, share routes |
| File upload and serving | `src/lib/process-image.ts`, `src/lib/upload-paths.ts`, `src/lib/upload-filenames.ts`, `src/lib/upload-limits.ts`, `src/lib/serve-upload.ts`, upload route handlers, nginx upload locations |
| Data exposure guards | `src/lib/data.ts`, `src/lib/search-enrichment-fields.ts`, map/share/feed helpers, privacy-field tests |
| SQL / restore / backups | `src/app/[locale]/admin/db-actions.ts`, `src/lib/sql-restore-scan.ts`, `src/lib/db-restore.ts`, `src/lib/mysql-cli-ssl.ts`, Drizzle migrations |
| Config / deployment | `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, `.env*.example`, deploy scripts |
| Tests and review artifacts | 267 test files, 1,755 `.context` files swept for secrets and prior-risk context |

No sampling was used for the security-relevant inventory: route/action/auth/file-serving/config classes were enumerated and then inspected directly or through focused pattern searches.

## Validation Evidence

Commands run:

- `npm audit --workspaces --json` - 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web` - passed; admin API exports are wrapped by `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web` - passed; mutating server actions return early on `requireSameOriginAdmin()` or carry read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed; public mutating API routes have rate-limit coverage.
- `npx vitest run src/__tests__/tracked-secrets.test.ts --config vitest.config.ts` from `apps/web` - passed.
- `npm run typecheck --workspace=apps/web` - passed; includes app typecheck, script typecheck, and privacy/type guard coverage.
- Secret-pattern sweeps for private keys, common cloud tokens, GitHub tokens, Slack tokens, session-secret assignment markers, DB-password assignment markers, MySQL password variables, and token assignments found no live hardcoded secrets in app/config source. Hits were placeholders, tests, code reading env vars, and historical review prose.

## Confirmed Issues

### C16-SEC-01 - Cookie-authenticated Lightroom uploads are authorized but lose admin attribution

Severity: Low
Confidence: High
Category: OWASP A09 Security Logging and Monitoring Failures / audit integrity

Code region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:67-73` obtains `tokenUserId` only from `getAdminAuthToken(request)`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:434-441` stores `uploaded_by: tokenUserId`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:518-525` writes the audit event with `userId = tokenUserId`.
- `apps/web/src/lib/api-auth.ts:69-126` shows why this route can also succeed through the cookie path: token auth is optional when `allowTokenScope` is set, and absent-token requests fall back to same-origin plus `isAdmin()`.

Failure scenario:

`/api/admin/lr/upload` is intended for PAT-backed Lightroom uploads, but the wrapper also allows same-origin cookie-authenticated admin requests when no `X-GalleryKit-Token` header is present. In that fallback path the request is authorized, yet `tokenUserId` is `null`, so the inserted image gets `uploaded_by = null` and the `lr_token_used` audit row also has `userId = null`. A browser/session based upload through this endpoint becomes harder to attribute during incident response or multi-admin auditing.

Suggested fix:

Either make this route PAT-only when the product contract does not require cookie fallback, or resolve the current admin user in the cookie path and use that ID for both `uploaded_by` and `logAuditEvent`. A minimal fix is:

- If `getAdminAuthToken(request)` returns a token, keep the current token user ID and action name.
- Otherwise call `getCurrentUser()` after `withAdminAuth` has authorized the request, require a user, and record that ID with a distinct audit action such as `lr_cookie_upload` or the existing upload action.

## Likely Issues

No likely code vulnerabilities were identified after the full inventory review and missed-issues sweep.

Notable reviewed surfaces that did not produce findings:

- Admin API auth: `withAdminAuth` enforces PAT scope/rate-limit for token requests and same-origin plus `isAdmin()` for cookie requests, then adds no-store/nosniff defaults (`apps/web/src/lib/api-auth.ts:55-140`).
- Mutating admin actions: the dedicated lint gate passed, and the helper fails closed on missing or mismatched `Origin`/`Referer` (`apps/web/src/lib/action-guards.ts:37-44`, `apps/web/src/lib/request-origin.ts:79-107`).
- Admin page proxy: admin HTML routes require a syntactically plausible `admin_session` cookie before render; API routes are explicitly excluded and covered by per-route wrappers (`apps/web/src/proxy.ts:80-140`).
- Public data selectors: public selectors omit sensitive/admin-only fields and compile-time privacy guards protect semantic-search enrichment (`apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`).
- Upload file serving: derivative serving validates path segments, allowed roots, file type, symlink status, and realpath containment; `/uploads/original/` is blocked at nginx (`apps/web/src/lib/serve-upload.ts`, `apps/web/nginx/default.conf:164-184`).
- DB backup/restore: same-origin/admin auth, advisory locks, restore maintenance, SQL header/size/dangerous-statement checks, TLS args for non-local MySQL, and no shell interpolation were present (`apps/web/src/app/[locale]/admin/db-actions.ts:120-180`, `apps/web/src/app/[locale]/admin/db-actions.ts:288-315`, `apps/web/src/app/[locale]/admin/db-actions.ts:520-565`).

## Manual-Validation Risks

### C16-MVR-01 - Reverse proxy and TLS assumptions must match production topology

Severity: Medium
Confidence: Medium
Category: deployment / OWASP A05 Security Misconfiguration

Code region:

- `apps/web/nginx/default.conf:21-29` listens on port 80 and documents that it must sit behind a TLS-terminating edge, not be exposed as the public cleartext edge.
- `apps/web/nginx/default.conf:66-70` and `apps/web/nginx/default.conf:186-196` forward host, client IP, and scheme headers to Next.
- `apps/web/src/lib/rate-limit.ts:163-193` trusts proxy headers only when `TRUST_PROXY=true`; otherwise all proxied clients collapse to the `unknown` bucket and a production warning is logged.
- `apps/web/src/lib/request-origin.ts:45-68` derives expected same-origin policy from trusted forwarded protocol/host only when proxy trust is enabled.

Failure scenario:

If this nginx listener is accidentally exposed directly over HTTP, or if `TRUST_PROXY` / `TRUSTED_PROXY_HOPS` does not match the real edge chain, security behavior degrades outside the app code. The most obvious failure mode is rate-limit collapse to a shared `unknown` bucket, allowing one attacker to lock out legitimate users. A wrong trust boundary can also make origin reconstruction differ from the actual browser origin, causing either false rejects or, if the edge permits spoofed forwarding headers, incorrect same-origin decisions.

Suggested validation/fix:

Verify production has a TLS edge that redirects cleartext to HTTPS before this listener, sends canonical `X-Forwarded-Host` and `X-Forwarded-Proto`, and strips untrusted incoming forwarding headers. Confirm `TRUST_PROXY=true` and `TRUSTED_PROXY_HOPS` equal the number of trusted proxy hops. If nginx is the public edge, add a 443 server block and explicit HTTP-to-HTTPS redirect before relying on HSTS.

### C16-MVR-02 - All admins are root-equivalent for backup, restore, users, tokens, and destructive media actions

Severity: Medium
Confidence: High
Category: authorization design / least privilege

Code region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:288-295` gates full DB restore only on same-origin plus `isAdmin()`.
- `apps/web/src/app/actions/admin-users.ts:75-83` and `apps/web/src/app/actions/admin-users.ts:182-190` gate admin creation/deletion only on `isAdmin()`.
- `apps/web/src/app/actions/lr-tokens.ts:28-44` and `apps/web/src/app/actions/lr-tokens.ts:108-123` gate PAT creation/revocation only on `isAdmin()`.

Failure scenario:

This is consistent with the documented current trust model, but it is a manual risk if the deployment has multiple admins with different trust levels. Any authenticated admin can create another admin, mint Lightroom upload credentials, download or restore the database, and perform destructive gallery actions. A compromised low-trust admin account is therefore equivalent to full application compromise.

Suggested validation/fix:

Confirm that every admin account is intended to be a fully trusted operator. If not, introduce roles or capabilities for high-impact actions (`db:backup`, `db:restore`, `admin:user-manage`, `token:manage`, `media:delete`) and require recent password reauthentication or step-up verification for restore, backup download, and admin/token management.

### C16-MVR-03 - DB backup artifacts and MySQL child-process credentials rely on host-level trust

Severity: Low
Confidence: High
Category: secrets / data-at-rest operational risk

Code region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:140-172` creates `data/backups`, writes backup files with owner-only modes, and spawns `mysqldump` with DB credentials in the child environment.
- `apps/web/src/app/[locale]/admin/db-actions.ts:540-550` spawns `mysql` restore with credentials in the child environment.
- `apps/web/src/app/api/admin/db/download/route.ts:22-87` streams a validated backup file to an authenticated admin with no-store/nosniff headers.

Failure scenario:

The code does the right application-level checks, avoids credentials in process arguments, uses owner-only file modes, and excludes `HOME` from the child environment. The remaining risk is operational: backups are plaintext SQL files at rest and `MYSQL_PWD` exists briefly in the child process environment. On a compromised or multi-user host, local privileged users can read backup contents or process environments.

Suggested validation/fix:

Validate that the host is single-tenant or otherwise protected by disk encryption and OS-level process isolation. For a stronger posture, encrypt backups at creation time, store them outside the app working directory with explicit retention, and consider a MySQL option file or socket-based auth mechanism with equivalent or better process-environment exposure characteristics.

## Cross-File Interaction Notes

- The admin API route matcher in `proxy.ts` intentionally excludes `/api/*`, so `scripts/check-api-auth.ts` and `withAdminAuth` are the primary API protection surface. The lint gate passed, and the two admin API routes are wrapped.
- `withAdminAuth` token-first behavior is necessary for Lightroom clients that cannot satisfy same-origin, but that same route-level optionality created C16-SEC-01 because handler attribution only reads token context.
- Public semantic and similar search routes are not admin routes, but they use same-origin checks, content-length/body caps, rate limits, production-mode gates, and public-only enrichment fields. I found no sensitive fields returned from those routes.
- Public map exposure is intentionally special-cased: latitude/longitude are only selected for `map_visible` topics and guarded by runtime assertions plus `_PrivacySensitiveKeys` exclusions elsewhere.
- File upload insertion, processing queueing, original storage, derivative serving, and delete paths share UUID/safe-path helpers and realpath/symlink checks. I found no path traversal from user filenames into storage paths.

## Final Missed-Issues Sweep

Final sweeps covered:

- Admin/auth keywords: `withAdminAuth`, `requireSameOriginAdmin`, `isAdmin`, cookie/header usage, redirects, response helpers.
- Injection sinks: raw SQL/query usage, `dangerouslySetInnerHTML`, shell/process spawning, JSON-LD rendering, CSV export, uploaded filename handling.
- Secrets: private-key markers, common token prefixes, explicit secret assignments, DB password/session secret examples.
- Data exposure: public selectors, semantic enrichment fields, map coordinates, share pages, OG routes, Atom/feed helpers.
- Configuration: CSP, HSTS/security headers, nginx upload/original-file routing, image remote patterns, TLS/proxy-derived origin reconstruction.

The sweep did not identify additional confirmed or likely issues beyond C16-SEC-01. Remaining items are manual deployment/trust validations listed above.
