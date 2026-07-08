# Run 10 Cycle 28 Security Review

Reviewer: security-reviewer  
Date: 2026-07-08  
HEAD: `8753b939a780984b2c988fb6b75ed23ebad98ec9`

## Scope

Read first, per instruction:

- `AGENTS.md`
- `CLAUDE.md`

Reviewed current HEAD only. Nearest baseline checked: `.context/reviews/run10-cycle27/security-reviewer.md` and `.context/reviews/run10-cycle27/_aggregate.md`; no already-fixed historical finding is refiled here.

Inventory covered:

- Auth/session, admin API wrappers, admin server actions, and same-origin checks
- Public routes, public actions, rate limits, and edge limiter template
- Upload, original-file storage, derivative file serving, and PAT upload route
- Backup/download/restore, SQL restore scanning, child processes, and maintenance barriers
- CSP/headers, SSRF/open-redirect-sensitive OG surfaces
- Secret handling, tracked-secret hygiene, and token storage
- SQL/raw-command surfaces and smart-collection query compilation
- Privacy-sensitive image fields and public projections

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm audit --workspace=apps/web --audit-level=moderate` passed: `found 0 vulnerabilities`.
- Focused tracked-secret grep over source/config text paths returned no literal secret assignments.

## Confirmed Current Issues

No new confirmed current security issues found in this pass.

## Reviewed Surface Inventory

Auth and admin authorization:

- `apps/web/src/app/actions/auth.ts:79-177` gates login on restore maintenance, same-origin provenance, mutation slot acquisition, per-IP and per-account rate limits, and pre-increments before Argon2 verification.
- `apps/web/src/app/actions/auth.ts:179-260` performs dummy-hash timing equalization, session fixation prevention, secure cookie selection, and generic error handling.
- `apps/web/src/app/actions/auth.ts:331-353` now checks same-origin and restore maintenance before current-user DB work for password changes.
- `apps/web/src/lib/session.ts:16-36` refuses production fallback without `SESSION_SECRET`; `apps/web/src/lib/session.ts:94-150` verifies HMAC signatures with `timingSafeEqual`, validates token shape/age, stores only hashes, and checks DB session expiry.
- `apps/web/src/lib/api-auth.ts:66-151` centralizes `/api/admin/*` auth, same-origin cookie checks, scoped PAT fallback, auth-attempt limiting, and no-store/nosniff response headers.
- `apps/web/src/lib/request-origin.ts:118-145` fails closed unless `Origin` or `Referer` matches the configured/derived origin.

Admin actions:

- `lint:action-origin` passed for all mutating action exports, proving current actions either enforce `requireSameOriginAdmin()` plus the restore mutation barrier or carry explicit read-only exemptions.
- `apps/web/src/app/actions/admin-backfill.ts:34-48` now checks origin and restore maintenance before admin/session and candidate-count work on trigger.
- `apps/web/src/app/actions/admin-backfill.ts:113-124` now returns maintenance before admin/session and candidate-count work on status polling.
- `apps/web/src/app/[locale]/admin/page.tsx:14-32` now renders maintenance before `isAdmin()` on the login entry page.

Public routes and rate limits:

- `lint:public-route-rate-limit` passed for every public App Router route handler requiring a limiter or explicit exemption.
- `apps/web/src/lib/rate-limit.ts:175-190` trusts proxy IP headers only when `TRUST_PROXY=true` and selects the trusted hop from the right side of XFF.
- `apps/web/src/lib/rate-limit.ts:265-273`, `299-307`, `356-364`, `388-397`, and `418-427` cover PAT auth, OG, share, feed, and semantic public buckets.
- `apps/web/src/app/api/search/semantic/route.ts:107-184` applies same-origin, maintenance, content-type, no-chunked, content-length, abort, and pre-increment rate-limit gates before semantic work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-131` applies same-origin, maintenance, id validation, pre-increment rate limiting, and production-mode gating before embedding scans.

Upload and file serving:

- `apps/web/src/lib/serve-upload.ts:162-238` allowlists upload directories/extensions, validates path segments, rejects symlinks, realpath-checks containment, and serves only supported image content types.
- `apps/web/src/lib/upload-paths.ts:68-170` validates original filenames, rejects symlinks, and realpath-checks original-file containment.
- `apps/web/src/lib/upload-filenames.ts:27-34` strips path/control data and enforces the UTF-8 byte budget for stored user filenames.
- `apps/web/src/app/actions/images.ts:87-227` gates browser upload on maintenance/origin/admin barrier, validates topic/tags/filenames, and pre-claims upload quota before async disk/DB work.
- `apps/web/src/app/actions/images.ts:367-379` strips GPS from retained originals or fails closed.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-281` requires admin/PAT auth, checks restore maintenance, rejects chunked or missing-length uploads, caps body/file bytes, validates filenames/topic/title/description, and acquires the upload-processing contract lock.
- `apps/web/src/app/api/admin/lr/upload/route.ts:417-452` mirrors GPS stripping and late restore-maintenance cleanup on the PAT upload path.

Backup, restore, and raw command surfaces:

- `apps/web/src/app/[locale]/admin/db-actions.ts:71-152` protects CSV export with maintenance, same-origin, admin auth, row cap, and CSV escaping.
- `apps/web/src/app/[locale]/admin/db-actions.ts:158-406` protects dumps with maintenance, same-origin/admin checks, restore advisory locking, private backup directory/file modes, minimal child-process env, and sanitized stderr.
- `apps/web/src/app/[locale]/admin/db-actions.ts:421-725` serializes restore with advisory locks, upload/backfill locks, durable maintenance, queue/background/admin drains, session-revocation flushing, and finalizer fail-closed behavior.
- `apps/web/src/app/[locale]/admin/db-actions.ts:752-990` caps restore size, validates SQL headers/trailers, scans chunks for dangerous SQL, uses `mysql --one-database`, sanitizes stderr, and cleans temporary files.
- `apps/web/src/app/api/admin/db/download/route.ts:21-109` wraps backup download with `withAdminAuth`, filename validation, path/realpath containment, regular-file checks, audit logging, and no-store/nosniff headers.
- `apps/web/src/lib/sql-restore-scan.ts:88-156` rejects privilege, cross-database, routine/definer, file import/export, destructive table, prepared-execution, and global/server SQL constructs while allowing the app backup table prelude.

CSP, headers, and SSRF/open-redirect-sensitive paths:

- `apps/web/src/lib/content-security-policy.ts:139-199` builds nonce-based production script CSP, image source allowlists, frame/base/form/object restrictions, and GA-only host additions.
- `apps/web/next.config.ts:55-109` applies upload cache headers, API sandbox CSP, nosniff, frame, referrer, permissions, and HSTS headers.
- `apps/web/src/proxy.ts:36-52` injects per-request production CSP nonces; `apps/web/src/proxy.ts:68-124` applies admin route cookie-format gate and admin-render marker.
- `apps/web/src/lib/og-photo-fetch.ts:64-118` keeps photo OG internal fetches origin-pinned by caller, timeout-bounded, and byte-capped.
- `apps/web/src/lib/seo-og-url.ts:3-43` accepts only relative same-site or same-origin HTTP(S) OG image URLs and rejects backslash normalization bypasses.
- `apps/web/nginx/default.conf:90-96` mirrors core security headers at the edge template.

Secrets and tokens:

- `apps/web/src/lib/admin-tokens.ts:53-63` generates 32-random-byte `gk_` PATs and stores SHA-256 hashes only.
- `apps/web/src/lib/admin-tokens.ts:142-168` verifies PAT format, hash, expiry, and scopes without passing plaintext into SQL.
- `apps/web/src/app/actions/lr-tokens.ts:29-113` protects token minting with maintenance, same-origin, mutation barrier, admin auth, scope normalization, label sanitization, expiry validation, and generic DB errors.
- `apps/web/src/lib/sanitize.ts:117-141` redacts DB credentials and sensitive connection parameters from child-process stderr.
- `apps/web/src/__tests__/tracked-secrets.test.ts:6-57` is backed by a test fixture for committed secret assignments; the focused grep in this review found no current matches.

SQL and raw surfaces:

- `apps/web/src/lib/smart-collections.ts:160-238` compiles only allowlisted AST columns/operators via Drizzle parameter binding and bounded `IN` lists.
- `apps/web/src/lib/smart-collections.ts:250-267` compiles tag predicates through parameterized subqueries, not user-controlled raw SQL.
- `apps/web/src/lib/smart-collections.ts:316-327` bounds and validates JSON query shape before persistence through `apps/web/src/app/actions/collections.ts:16-68` and `71-123`.
- Raw `sql.raw` usage reviewed is fixed separators only, e.g. CSV/tag aggregation separators in `apps/web/src/app/[locale]/admin/db-actions.ts:103` and `apps/web/src/lib/data.ts:1276`; not user-controlled SQL.
- MySQL child-process invocations are fixed binary/argument lists in `apps/web/src/app/[locale]/admin/db-actions.ts:900-906` and `1032-1034`, with credentials in minimal env rather than argv.

Privacy-sensitive data paths:

- `apps/web/src/lib/data.ts:251-327` defines the full admin image field set and marks GPS, original filenames, upload attribution, internal color/HDR/pipeline state, and processing diagnostics as admin-only.
- `apps/web/src/lib/data.ts:368-407` derives `publicSelectFields` by explicitly omitting sensitive/internal fields.
- `apps/web/src/lib/data.ts:409-430` defines the only public GPS projection, documented for map-visible topic filtering only.
- `apps/web/src/lib/search-enrichment-fields.ts:29-46` gives semantic/similar search a compile-guarded public enrichment select.
- `apps/web/src/__tests__/privacy-fields.test.ts:41-79` and `125-162` pin the sensitive-key contract and symmetric admin-only/public separation.

## Risks Needing Manual Validation

1. Edge rate-limit identity depends on deployed nginx/proxy topology.

Severity: Medium  
Confidence: Medium  
Status: Risk needing manual validation, not a confirmed repo-code vulnerability.  
Evidence: `apps/web/nginx/default.conf:20-28` documents that nginx `$binary_remote_addr` zones need real-IP/PROXY-protocol setup behind an LB; `apps/web/nginx/default.conf:59-71` documents that the shipped XFF overwrite is correct only when `$remote_addr` is the real client.  
Scenario: In an LB-fronted production topology without nginx real-IP support and matching `TRUSTED_PROXY_HOPS`, every visitor can share one edge/app rate-limit identity, causing login/admin/public-page 429s for legitimate users or weakening intended per-client abuse attribution.  
Suggested validation/fix: On the deployed host, verify whether nginx sees true client IPs. If an LB/CDN is in front, configure `set_real_ip_from`/`real_ip_header` or PROXY protocol for nginx limit zones, switch XFF to append mode where appropriate, and set `TRUSTED_PROXY_HOPS` to the real hop count.

## Already-Tracked Current Risk Not Refiled

- `AGG-C27-02` remains the known deferred restore-concurrency design issue: `apps/web/src/app/[locale]/admin/db-actions.ts:421-428` authenticates before acquiring the restore advisory lock. A second restore request during an active restore can still touch auth/session tables before returning `restoreInProgress`. This is already recorded in `.context/reviews/run10-cycle27/_aggregate.md` with severity preserved and was not duplicated as a new Cycle 28 finding because the safe fix conflicts with an existing source contract and needs a narrower design.

## Residual Review Limits

This pass used static review plus focused security lint/audit/grep validation. I did not run full `npm test`, full `npm run build`, Playwright, deploy, or live production-host inspection.
