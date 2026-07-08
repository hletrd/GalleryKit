# Run 10 Cycle 29 Security Review

Reviewer: security-reviewer  
Date: 2026-07-08 KST  
HEAD: `d985f549afa73b23cdccf5d8fea30f4bfc840847`

## Scope

Fresh current-HEAD review only. I read `AGENTS.md`, `CLAUDE.md`, the Run-10 Cycle 27/28 security and aggregate reviews, and the Run-10 Cycle 27/28 plan/deferred registers before inspecting source. I did not refile already-fixed or already-tracked older findings.

Requested focus areas covered:

- Auth/authz, admin API wrappers, server actions origin/barrier
- Public route and action rate limits
- SSRF/CSP/open-redirect-sensitive surfaces
- Path traversal, upload safety, original-file privacy
- Secrets, PAT handling, child-process envs, stderr redaction
- SQL/raw SQL and restore SQL scanning
- Privacy-sensitive public select fields
- Current `.context` deferred exit criteria

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed. Evidence: both admin API route files reported `OK`.
- `npm run lint:action-origin --workspace=apps/web` passed. Evidence: all mutating server actions reported same-origin coverage, public rate-limited exemptions, or reasoned exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. Evidence: public OG/search/feed routes reported limiter coverage and upload/health routes reported explicit exemptions.
- `npm audit --workspace=apps/web --audit-level=moderate` passed: `found 0 vulnerabilities`.
- Focused secret-pattern grep over tracked source/config text returned no matches for literal secret assignments, private-key blocks, or `gk_` token-shaped plaintexts.
- Raw SQL inventory found no request-path user-controlled `sql.raw`; fixed raw separators are at `apps/web/src/app/[locale]/admin/db-actions.ts:103` and `apps/web/src/lib/data.ts:1276`.

## Confirmed Current Findings

No new confirmed current security findings.

I did not find a reproducible auth/authz bypass, unwrapped admin API route, mutating server action missing same-origin/barrier coverage, public expensive/mutating route missing the required rate-limit gate, SSRF/open redirect path, upload/path traversal issue, plaintext secret, raw SQL injection path, restore/backup privilege break, or public privacy-field leak at current HEAD.

## Reviewed Surface Inventory

Auth, sessions, and admin API wrappers:

- `apps/web/src/lib/session.ts:16-36` requires a production `SESSION_SECRET` and refuses DB-stored fallback in production.
- `apps/web/src/lib/session.ts:94-150` verifies HMAC-SHA256 session tokens, uses `timingSafeEqual`, bounds token age, hashes DB session ids, and checks DB expiry.
- `apps/web/src/lib/request-origin.ts:47-68` anchors production same-origin checks to `BASE_URL` or `siteConfig.url`; `apps/web/src/lib/request-origin.ts:118-145` fails closed without matching `Origin` or `Referer`.
- `apps/web/src/lib/api-auth.ts:66-151` centralizes admin API auth, same-origin cookie checks, scoped PAT alternate auth, admin-token auth-attempt limiting, no-store, and nosniff response headers.
- `apps/web/src/app/api/admin/db/download/route.ts:21-109` is wrapped by `withAdminAuth`, validates backup filenames, realpath-checks containment, streams from the validated descriptor, and sets no-store/nosniff headers.

Server actions and restore mutation barrier:

- `apps/web/scripts/check-action-origin.ts:117-171` now discovers top-level `'use server'` modules under `src/app` and fails if they are outside the approved scanner set.
- `apps/web/scripts/check-action-origin.ts:543-560` classifies DB/query/cache/audit calls as pre-guard side effects, so the lint gate checks more than substring presence.
- `apps/web/src/app/actions/auth.ts:79-180` gates login on restore maintenance, same-origin, mutation slot, per-IP and per-account rate-limit pre-increment, and DB-backed checks before Argon2 verification.
- `apps/web/src/app/actions/auth.ts:331-353` rejects hostile origins and restore maintenance before current-user/password DB work.
- `apps/web/src/app/actions/admin-backfill.ts:34-48` checks same-origin and restore maintenance before admin auth and mutation-slot acquisition; `apps/web/src/app/actions/admin-backfill.ts:113-124` returns maintenance before admin/candidate-count status work.
- `apps/web/src/app/actions/images.ts:87-105` gates browser upload on restore maintenance, same-origin, mutation slot, and current user.

Rate limits and public route gates:

- `apps/web/src/app/api/search/semantic/route.ts:107-184` enforces same-origin, restore maintenance, content type, no chunked bodies, required/capped content length, abort checks, and semantic rate-limit pre-increment before config/body/embedding work.
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-131` enforces same-origin, restore maintenance, id validation, semantic rate-limit pre-increment, and production semantic mode before embedding scans.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:93-110` handles maintenance, rate-limits OG generation, and only rolls back invalid IDs before DB work; `apps/web/src/app/api/og/photo/[id]/route.tsx:120-133` keeps missing-image probes charged after DB work.

Upload, path traversal, and original-file privacy:

- `apps/web/src/lib/serve-upload.ts:162-238` allowlists `jpeg/webp/avif`, validates segments, enforces directory/extension consistency, rejects symlinks, realpath-checks root containment, requires regular files, and never serves SVG.
- `apps/web/src/lib/upload-paths.ts:120-170` validates original basenames, rejects absolute/path-traversal input, rejects symlinks, and checks realpath containment before original lookup/delete.
- `apps/web/src/lib/upload-filenames.ts:27-34` strips path/control data and enforces a UTF-8 byte budget for stored user filenames.
- `apps/web/src/app/actions/images.ts:145-227` validates filenames, tracks cumulative upload quota by admin/IP, and claims quota synchronously before async disk/DB work.
- `apps/web/src/app/actions/images.ts:367-390` strips GPS from retained originals or deletes/rejects fail-closed; `apps/web/src/app/api/admin/lr/upload/route.ts:417-452` mirrors this behavior for PAT uploads.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-281` requires admin/PAT auth with `lr:upload` scope, rejects chunked/missing/oversized bodies, preclaims quota, validates filename/topic/title/description, rechecks restore maintenance, and acquires the upload-processing contract lock before topic DB work.

Backup, restore, SQL, and child processes:

- `apps/web/src/app/[locale]/admin/db-actions.ts:71-151` protects CSV export with restore maintenance, same-origin, admin auth, a 50k row cap, and CSV escaping.
- `apps/web/src/app/[locale]/admin/db-actions.ts:158-406` protects dumps with restore maintenance, same-origin/admin checks, restore advisory locking, private backup file creation, minimal child env, watchdogs, and sanitized stderr.
- `apps/web/src/app/[locale]/admin/db-actions.ts:421-748` serializes restore with advisory locks, upload/backfill locks, durable maintenance, drain checks, admin-mutation fencing, session-revocation flushing, and fail-closed finalizer behavior.
- `apps/web/src/app/[locale]/admin/db-actions.ts:880-906` invokes `mysql --one-database` with credentials in env rather than argv; `apps/web/src/app/[locale]/admin/db-actions.ts:1009-1049` runs post-restore migrations with a minimal env and stderr sanitization.
- `apps/web/src/lib/sql-restore-scan.ts:88-156` rejects privilege, user, cross-database, destructive table, file import/export, routine/definer, server/global, prepared-execution, and plugin/server SQL constructs.

SSRF, CSP, and URL handling:

- `apps/web/src/app/api/og/photo/[id]/route.tsx:176-196` pins internal derivative fetches to canonical `BASE_URL` origin and fails closed instead of using attacker-controllable request origin.
- `apps/web/src/lib/og-photo-fetch.ts:64-118` uses canonical-origin derivative URLs, per-attempt timeouts, total budget, and pre/post-buffer byte caps.
- `apps/web/src/lib/content-security-policy.ts:15-40` accepts only absolute HTTP(S) `IMAGE_BASE_URL`, requires HTTPS in production, and rejects credentials/query/hash.
- `apps/web/src/lib/content-security-policy.ts:139-199` builds nonce-based production script CSP with image/connect allowlists, `frame-ancestors`, `base-uri`, `form-action`, and `object-src 'none'`.
- `apps/web/next.config.ts:55-109` adds upload cache policy, API sandbox CSP, nosniff, frame, referrer, permissions, and HSTS headers.
- `apps/web/src/proxy.ts:36-52` injects per-request production CSP nonces; `apps/web/src/proxy.ts:68-124` enforces admin cookie shape on protected admin routes and marks admin-rendered HTML for service-worker cache exclusion.

Secrets and PAT handling:

- `apps/web/src/lib/admin-tokens.ts:53-63` generates 32-random-byte `gk_` PATs and stores SHA-256 hashes only.
- `apps/web/src/lib/admin-tokens.ts:142-168` verifies PAT format, DB hash, constant-time hash equality, expiry, and parsed scopes.
- `apps/web/src/app/actions/lr-tokens.ts:29-113` protects token creation with restore maintenance, same-origin, mutation slot, admin auth, scope normalization, label sanitization, expiry validation, generic DB errors, and audit logging.
- `apps/web/src/app/actions/lr-tokens.ts:116-130` starts revocation with the same restore/origin/mutation barrier posture.

Privacy fields:

- `apps/web/src/lib/data.ts:251-327` defines the full admin image field set and documents sensitive fields.
- `apps/web/src/lib/data.ts:368-407` derives `publicSelectFields` while omitting GPS, originals/user filenames, original format/size, processed, admin-only HDR/color/pipeline internals, upload attribution, processing diagnostics, and processing settings.
- `apps/web/src/lib/data.ts:409-445` keeps the only public GPS projection separate and documents the required `map_visible` topic filter.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` keeps semantic/similar result enrichment on a type-guarded public field set.
- `apps/web/src/__tests__/privacy-fields.test.ts:41-79` defines the sensitive-key fixture; `apps/web/src/__tests__/privacy-fields.test.ts:125-162` verifies public omissions and exact admin-only/public separation.

## Prior Deferred / Manual-Validation Items

These are current context items but are not refiled as new Cycle 29 findings because the exit criteria have not fired and no new exploitability evidence was found.

1. `AGG-C27-02` - concurrent restore submissions still authenticate before observing an already-active restore window.

Severity: Medium  
Confidence: Medium-High  
Current evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:421-428` still performs `isAdmin()` before acquiring the restore lock; the restore lock/maintenance start path begins later at `apps/web/src/app/[locale]/admin/db-actions.ts:464-548`. Deferral and exit criteria are preserved in `.context/plans/run10-cycle27/deferred.md:13-25`.  
Failure scenario: A second restore request arrives while the first restore is replacing auth/session tables. The second request can touch auth state before returning `restoreInProgress`, producing transient DB noise or misleading unauthorized output.  
Fix direction: Use the deferred design criterion: distinguish true concurrent restores from stale-marker corrective restores, likely with an early restore-lock/owner signal that does not create an unauthenticated lock-hold DoS.

2. `AGG-C28-08` - deployed nginx/proxy rate-limit identity requires operator validation.

Severity: Medium  
Confidence: Medium  
Current evidence: `apps/web/nginx/default.conf:20-28` documents that `$binary_remote_addr` zones need real-IP/PROXY-protocol support behind a load balancer; `apps/web/nginx/default.conf:59-71` documents that XFF overwrite is correct only when nginx receives the real client IP. Deferral and exit criteria are preserved in `.context/plans/run10-cycle28/deferred.md:13-24`.  
Failure scenario: In an LB/CDN-fronted deployment without real-IP configuration, many users share one limiter identity, causing global lockouts/429s or weakening abuse attribution.  
Fix direction: Operator validates nginx real-IP/PROXY-protocol topology, switches XFF to append mode where appropriate, and sets `TRUSTED_PROXY_HOPS` to the actual hop count.

Plan note: `.context/plans/run10-cycle28/plan.md:146-147` still records signed commit/push and deploy/live smoke as pending, while `git rev-parse HEAD` and `origin/master` show `d985f549afa73b23cdccf5d8fea30f4bfc840847` is current. This is a release-ledger/deploy-evidence issue, not a confirmed application security defect in this pass.

## Residual Limits

This review used static inspection plus focused security lint/audit/grep validation. I did not run the full unit suite, full build, Playwright, `npm run deploy`, or live production-host/nginx verification. No production DNS/network/service changes were attempted.
