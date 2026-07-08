# Run 10 Cycle 33 Security Review

Reviewer: security-reviewer
Date: 2026-07-08 KST
HEAD reviewed: `959e45afdfcf901f9f88e3eb8e675a12545ced8c`

## Scope

Read-only current-HEAD security pass. I reviewed `AGENTS.md`, `CLAUDE.md` security guidance, auth/rate-limit lint contracts, current source, and recent deferred security context. I did not edit application source.

Requested surfaces covered:

- Auth, admin sessions, admin API wrappers, PAT scope handling, token storage/verification
- Mutating server actions, same-origin guards, restore/admin mutation barriers
- Public routes and public server actions, especially expensive/mutating rate-limit gates
- Upload ingestion, original storage, derivative file serving, symlink/path traversal controls
- Backup, restore, SQL dump/import scanning, child-process command/env handling
- CSP/security headers, SSRF/open redirect surfaces, internal OG image fetches
- Privacy-sensitive public projections, JSON-LD/script sinks, secret-pattern exposure

## Findings

No new confirmed Cycle 33 security findings.

Severity inventory:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

I did not find a reproducible auth/authz bypass, unwrapped admin API route, mutating server action missing same-origin coverage, public expensive/mutating route missing the required rate-limit gate, SSRF/open redirect path, upload/path traversal issue, plaintext secret/token leak, restore/backup privilege break, raw SQL injection path, or public privacy-field leak at the reviewed HEAD.

## Current Security Inventory

Auth, sessions, and same-origin:

- `apps/web/src/lib/session.ts:20-35` requires `SESSION_SECRET` in production and refuses DB fallback for the HMAC signing key.
- `apps/web/src/lib/session.ts:82-150` generates high-entropy session tokens, verifies the HMAC with `timingSafeEqual`, bounds token age, and checks the DB session hash/expiry.
- `apps/web/src/app/actions/auth.ts:100-149` gates login with restore maintenance, same-origin, admin mutation slot acquisition, and per-IP/per-account pre-incremented rate limits before Argon2 verification.
- `apps/web/src/app/actions/auth.ts:240-253` issues `httpOnly`, secure-in-production, `sameSite: 'lax'` session cookies.
- `apps/web/src/lib/request-origin.ts:47-145` anchors production same-origin checks to canonical origin and fails closed without a trusted `Origin` or `Referer`.
- `apps/web/src/lib/action-guards.ts:37-43` centralizes the `requireSameOriginAdmin()` guard used by mutating admin actions.

Admin API and PAT handling:

- `apps/web/src/lib/api-auth.ts:80-118` rate-limits presented admin tokens, verifies PATs, enforces optional scope, and bypasses same-origin only for valid scoped PAT auth.
- `apps/web/src/lib/api-auth.ts:122-150` requires trusted same-origin plus `isAdmin()` for cookie-backed admin API calls.
- `apps/web/src/lib/admin-tokens.ts:53-78` generates 32-random-byte PATs, stores SHA-256 hashes, and compares digests in constant time.
- `apps/web/src/lib/admin-tokens.ts:142-168` rejects malformed/expired/scopeless tokens before accepting a PAT.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84` and `apps/web/src/app/api/admin/lr/upload/route.ts:633` require `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` wraps backup download with `withAdminAuth`, filename validation, path/realpath containment, descriptor-based streaming, and no-store/nosniff headers.

Server actions and lint contracts:

- `apps/web/src/app/actions/images.ts:87-105` gates browser upload on restore maintenance, same-origin, mutation slot, and current admin identity.
- `apps/web/src/app/actions/lr-tokens.ts:34-54` gates token creation on restore maintenance, same-origin, mutation slot, admin identity, and scope normalization.
- `apps/web/src/app/actions/public.ts:341-414` validates analytics targets and rate-limits before background view writes without storing raw IPs.
- `npm run lint:api-auth --workspace=apps/web` passed and confirmed all admin API exports are wrapped.
- `npm run lint:action-origin --workspace=apps/web` passed and confirmed mutating server actions enforce same-origin provenance or carry accepted exemptions.

Public routes and rate limits:

- `apps/web/src/app/api/search/semantic/route.ts:107-184` enforces same-origin, restore maintenance, content-type/length limits, chunked rejection, and semantic rate-limit pre-increment before config/body/embedding work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:72-131` enforces same-origin, restore maintenance, ID validation, semantic rate-limit pre-increment, and semantic mode gating before embedding scans.
- `apps/web/src/app/api/og/route.tsx:73-120` handles maintenance, validates topic input, and charges the OG limiter before DB-backed image generation.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:93-134` handles maintenance, rate-limits OG generation, and keeps invalid/missing image probes charged.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed and confirmed public mutating/expensive route coverage plus explicit exemptions for cheap upload/health handlers.

Upload, file serving, and path traversal:

- `apps/web/src/app/api/admin/lr/upload/route.ts:101-178` rejects chunked/missing/oversize bodies and preclaims upload quota before multipart parsing.
- `apps/web/src/app/api/admin/lr/upload/route.ts:217-281` validates topic/title/description, rechecks restore maintenance, and acquires the upload-processing lock before topic DB work.
- `apps/web/src/app/api/admin/lr/upload/route.ts:417-452` strips GPS from retained originals or deletes/rejects fail-closed for PAT uploads.
- `apps/web/src/app/actions/images.ts:145-227` sanitizes user filenames and preclaims upload quota for browser uploads.
- `apps/web/src/app/actions/images.ts:367-395` strips GPS from retained originals or deletes/rejects fail-closed for browser uploads.
- `apps/web/src/lib/upload-paths.ts:49-56` creates private original directories with `0700` permissions.
- `apps/web/src/lib/upload-paths.ts:120-170` validates original basenames, rejects path traversal/symlinks, and checks realpath containment.
- `apps/web/src/lib/serve-upload.ts:162-238` allowlists derivative directories/extensions, validates every path segment, rejects symlinks, realpath-checks containment, requires regular files, and sets safe content types.
- `apps/web/src/lib/process-image.ts:864-900` uses random UUID original filenames, writes originals with restrictive mode, and invokes Sharp with input-pixel limits.

Backup, restore, and SQL import safety:

- `apps/web/src/app/[locale]/admin/db-actions.ts:71-151` protects CSV export with restore maintenance, same-origin/admin checks, a 50k row cap, and CSV escaping.
- `apps/web/src/app/[locale]/admin/db-actions.ts:158-359` protects dumps with same-origin/admin checks, private backup file creation, argument-vector child execution, sanitized stderr, and header/trailer assertions.
- `apps/web/src/app/[locale]/admin/db-actions.ts:421-702` protects restore with same-origin/admin checks, advisory locks, upload/backfill locks, durable maintenance, queue drain checks, session revocation, and cleanup/finalizer behavior.
- `apps/web/src/app/[locale]/admin/db-actions.ts:752-906` caps restore file size, checks dump header/trailer, scans SQL chunks, and invokes `mysql --one-database` with credentials in env rather than argv.
- `apps/web/src/lib/sql-restore-scan.ts:88-156` rejects privilege/account operations, routines/definers, file import/export, dynamic SQL, plugin/server/global operations, and destructive schema operations.
- `apps/web/src/lib/sql-restore-scan.ts:262-304` enforces app-table write targets and cross-schema write rejection after stripping comments/literals.

CSP, headers, SSRF, and redirects:

- `apps/web/src/lib/content-security-policy.ts:15-40` accepts only absolute HTTP(S) `IMAGE_BASE_URL`, requires HTTPS in production, and rejects credentials/query/hash.
- `apps/web/src/lib/content-security-policy.ts:139-199` builds nonce-based production CSP with image/connect allowlists and restrictive frame/base/form/object/manifest directives.
- `apps/web/src/proxy.ts:36-52` injects per-request production CSP nonces.
- `apps/web/src/proxy.ts:55-122` enforces admin cookie-shape checks on protected admin HTML routes and marks admin-rendered responses for service-worker cache exclusion.
- `apps/web/next.config.ts:55-109` adds upload cache policy, API sandbox CSP, nosniff, frame, referrer, permissions, and HSTS headers.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:176-208` pins internal derivative fetches to canonical `BASE_URL` and fails closed on invalid origins.
- `apps/web/src/lib/og-photo-fetch.ts:64-118` builds derivative URLs under the canonical origin with per-attempt timeout, total budget, and byte caps.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:329-375` validates fallback redirect origin before redirecting.

Privacy and XSS-relevant sinks:

- `apps/web/src/lib/data.ts:368-407` omits GPS, original filenames/format/size, uploader attribution, processing internals, and admin-only color/HDR/settings fields from public image projections.
- `apps/web/src/lib/data.ts:409-488` isolates public GPS map projection behind `map_visible` topic filtering and compile-time sensitive-key guards.
- `apps/web/src/lib/search-enrichment-fields.ts:29-46` keeps semantic/similar enrichment on a compile-guarded public field set.
- `apps/web/src/lib/safe-json-ld.ts:14-19` escapes JSON-LD script sink characters.
- `apps/web/src/lib/og-sanitize.ts:24-30` strips C0 controls and Unicode formatting characters from OG text.

## Prior Deferred Items Not Refiled

These are still relevant context but are not new Cycle 33 findings because no fresh exploitability evidence or exit criterion fired in this pass.

- `AGG-C27-02`: restore action ordering remains an existing deferred restore-design item. Current code still authenticates before restore lock acquisition at `apps/web/src/app/[locale]/admin/db-actions.ts:421-428`; the deferral and exit criterion are documented at `.context/plans/run10-cycle27/deferred.md:13-16`.
- `AGG-C27-04`: restore finalizer action-level behavior-test strength remains an existing deferred test-strength item, documented at `.context/plans/run10-cycle27/deferred.md:13-16`.
- Prior nginx/proxy real-IP validation, upload/restore memory envelope, authenticated admin browser-flow expansion, and lack of 2FA/WebAuthn remain operator/product/coverage deferrals rather than newly confirmed current-HEAD code defects.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run audit:prod` passed with `found 0 vulnerabilities`.
- `npm run typecheck --workspace=apps/web` passed.
- Focused security/privacy/path tests passed: `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/serve-upload.test.ts src/__tests__/session-verify.test.ts src/__tests__/admin-tokens.test.ts` -> 6 files, 101 tests.
- Secret-pattern scan across tracked source/config text found no credential-like plaintext beyond the expected `GPS` regex token in `apps/web/src/lib/gps-exif-strip.ts:63`.

## Residual Limits

This was a source review plus focused local lint/type/test/audit validation. I did not run full build, full unit suite, Playwright, deploy, live production proxy/nginx validation, or browser-authenticated admin e2e flows. No source files, git state, deployment state, or external services were modified.
