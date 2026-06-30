# Cycle 53 Security Reviewer Report

Reviewed HEAD: `17db8e38` (`fix(settings): prevent hidden production search state`)
Review date: 2026-07-01
Scope: `/Users/hletrd/flash-shared/gallery`

Mode: security review of current HEAD. Only this review artifact was written.

## Inventory

### Auth, sessions, tokens, and origin

- `apps/web/src/lib/session.ts:16-36` requires a production `SESSION_SECRET` and refuses the DB fallback in production; the dev-only fallback generates 32 random bytes and stores them under `admin_settings`.
- `apps/web/src/lib/session.ts:82-150` signs session tokens with HMAC-SHA256, verifies with `timingSafeEqual`, rejects malformed/future/expired tokens, stores only SHA-256 token hashes, and deletes expired DB sessions.
- `apps/web/src/app/actions/auth.ts:77-244` validates login input, requires same-origin before auth work, pre-increments IP and account login buckets before Argon2 verification, uses a dummy Argon2id hash for missing users, rotates sessions transactionally, and sets `httpOnly`, secure-when-HTTPS-or-production, `sameSite=lax` cookies.
- `apps/web/src/app/actions/auth.ts:290-423` requires same-origin before password changes, validates new password length by code point, rate-limits before Argon2 verification, updates password and rotates all user sessions in one transaction.
- `apps/web/src/lib/password-hashing.ts:10-15` centralizes Argon2id with memoryCost 65536, timeCost 3, parallelism 4.
- `apps/web/src/lib/request-origin.ts:45-76` derives expected origin from trusted proxy headers only when `TRUST_PROXY=true`; `apps/web/src/lib/request-origin.ts:79-107` fails closed unless `Origin` or `Referer` matches.
- `apps/web/src/lib/api-auth.ts:72-111` handles PAT auth first with pre-auth rate limiting, token verification, route-scope checks, request-scoped token context, `last_used_at`, and no-store/nosniff response hardening.
- `apps/web/src/lib/api-auth.ts:114-143` enforces same-origin before cookie-backed admin API auth and stamps no-store/nosniff on successful admin API responses.
- `apps/web/src/lib/admin-tokens.ts:52-89` generates `gk_` tokens from 32 random bytes, stores SHA-256 digests, and rejects malformed presented tokens before DB lookup.
- `apps/web/src/lib/admin-tokens.ts:141-168` verifies token hash with constant-time comparison, joins to an existing admin user, enforces expiry, and returns normalized scopes only.
- `apps/web/src/app/actions/lr-tokens.ts:28-105` and `apps/web/src/app/actions/lr-tokens.ts:108-140` gate token mint/revoke/list behind same-origin admin checks; labels are sanitized, code-point capped, and invalid/past expiries are rejected.
- `apps/web/src/proxy.ts:65-122` performs middleware-level admin cookie presence/format gating and CSP header propagation; API routes are intentionally excluded at `apps/web/src/proxy.ts:124-129` and are guarded independently.

### Admin APIs and server actions

- Admin API inventory remains two routes: `apps/web/src/app/api/admin/db/download/route.ts` and `apps/web/src/app/api/admin/lr/upload/route.ts`; `npm run lint:api-auth --workspace=apps/web` confirmed both export handlers through `withAdminAuth`.
- `apps/web/src/app/api/admin/db/download/route.ts:21-90` validates backup filename shape, resolves paths under `data/backups`, realpaths both root and file, opens/stats/streams the same descriptor, audits the download, and sets attachment/no-store/nosniff headers.
- `apps/web/src/app/api/admin/lr/upload/route.ts:84-99` accepts either scoped PAT or cookie admin, rejects restore-maintenance windows, and attributes uploads to the verified token user or current cookie user.
- `apps/web/src/app/api/admin/lr/upload/route.ts:101-158` rejects chunked/missing/oversized uploads and exhausted upload quotas before acquiring the multipart parse slot.
- `apps/web/src/app/api/admin/lr/upload/route.ts:178-213` parses multipart under a single in-flight slot, settles failed quota claims, and sanitizes the original client filename before storing it as metadata.
- `apps/web/src/app/api/admin/lr/upload/route.ts:215-268` validates topic, title, and description before DB insert.
- `apps/web/src/app/api/admin/lr/upload/route.ts:279-332` holds the upload-processing contract lock, reads strict gallery config, snapshots processing settings, and fails closed when settings or disk-space checks fail.
- `apps/web/src/app/api/admin/lr/upload/route.ts:384-413` enforces HDR-ingest and GPS-strip settings on the PAT upload path.
- `apps/web/src/app/api/admin/lr/upload/route.ts:422-489` re-checks restore maintenance after save/GPS work, inserts the row with admin-only color/HDR/upload-attribution fields, and cleans the original plus quota claim on post-save failures.
- `apps/web/src/app/api/admin/lr/upload/route.ts:506-543` forwards all upload-time processing settings into the image queue job.
- `apps/web/src/lib/action-guards.ts:37-44` centralizes same-origin enforcement for mutating server actions.
- `npm run lint:action-origin --workspace=apps/web` confirmed all mutating server actions and `apps/web/src/app/[locale]/admin/db-actions.ts` return early on `requireSameOriginAdmin()`; read-only/public exemptions were explicitly recognized by the scanner.

### Public routes, rate limits, SSRF, and privacy

- `apps/web/src/app/api/search/semantic/route.ts:107-184` requires same-origin, restore-maintenance clearance, strict JSON content type, non-chunked bounded body headers, and rate-limit pre-increment before DB-backed mode lookup.
- `apps/web/src/app/api/search/semantic/route.ts:186-260` serves only `stub` or operator-enabled `production`, caps query length by code points, and keeps admitted failures charged after protected work begins.
- `apps/web/src/app/api/search/semantic/route.ts:263-368` scans only active-model processed embeddings, caps scan/result sizes, and enriches through the shared privacy-guarded select.
- `apps/web/src/app/api/search/similar/[id]/route.ts:68-126` requires same-origin, restore-maintenance clearance, positive integer id validation, rate-limit pre-increment, and production semantic-search mode before any embedding scan.
- `apps/web/src/app/api/search/similar/[id]/route.ts:132-272` uses only production embeddings for processed images and the same privacy-guarded enrichment select.
- `apps/web/src/app/api/og/route.tsx:61-90` validates topic before rate-limiting the expensive OG route; `apps/web/src/app/api/og/route.tsx:92-132` keeps post-DB 404s charged and emits ETags.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:45-56` rate-limits before the DB/CPU path and only rolls back malformed id rejection.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:97-128` pins internal derivative fetches to `BASE_URL`/canonical origin, fails closed on bad canonical config, and keeps missing-derivative fallbacks charged.
- `apps/web/src/app/api/og/photo/[id]/route.tsx:249-295` validates fallback redirects as same-origin before redirecting to a configured OG image or site root.
- `apps/web/src/lib/og-photo-fetch.ts:64-94` caps each internal photo fetch by timeout and 1 MB response size.
- `apps/web/src/lib/search-enrichment-fields.ts:29-47` exposes only public result-card fields and has a compile-time `PrivacySensitiveKeys` guard.
- `apps/web/src/lib/data.ts:251-327` defines the full admin image select including sensitive fields; `apps/web/src/lib/data.ts:368-488` derives public and map-visible selects by explicit omission and type guards.
- `apps/web/src/lib/data.ts:1680-1714` restricts the only public GPS select to topics where `map_visible=true` and rechecks rows before returning map data.
- `apps/web/src/lib/data-timeline.ts:35-67` hand-mirrors public timeline fields and guards them against `PrivacySensitiveKeys`.
- `npm run lint:public-route-rate-limit --workspace=apps/web` confirmed expensive/mutating public route coverage or explicit documented exemptions.

### File handling, restore, deploy, and docs drift

- `apps/web/src/lib/upload-paths.ts:49-57` creates private originals with mode `0700`; `apps/web/src/lib/upload-paths.ts:120-170` rejects unsafe filenames, absolute paths, traversal, symlinks, and realpath escapes.
- `apps/web/src/lib/serve-upload.ts:132-160` serves only `jpeg`, `webp`, and `avif` directories with safe path segments and matching extensions.
- `apps/web/src/lib/serve-upload.ts:175-201` realpath-checks upload root containment, rejects symlinks and non-files, and resolves content type only from approved extensions.
- `apps/web/src/lib/serve-upload.ts:228-313` emits settings-aware ETags, handles conditional/HEAD requests without body streams, and wires abort cleanup for GET streams.
- `apps/web/src/app/[locale]/admin/db-actions.ts:164-355` gates DB backup behind same-origin admin checks, creates owner-only backup files, uses `mysqldump` with arg arrays and env credentials, validates output, and releases advisory locks.
- `apps/web/src/app/[locale]/admin/db-actions.ts:365-566` gates restore behind same-origin admin checks, holds restore/upload/backfill locks, enters durable maintenance, quiesces queues, and releases locks in setup/finally paths.
- `apps/web/src/app/[locale]/admin/db-actions.ts:570-761` writes restore uploads to a random temp file, validates size/header, scans chunks for dangerous SQL, uses `mysql --one-database` with arg arrays/env credentials, and runs post-restore migrations.
- `apps/web/src/lib/sql-restore-scan.ts:61-129` blocks grants/users, destructive table/database statements, routines/triggers/events/views, file IO, plugins, globals, prepared statements, and encoded user-variable payloads.
- `apps/web/src/lib/sql-restore-scan.ts:210-252` rejects schema-qualified writes and writes outside the current app backup table allowlist.
- `apps/web/deploy.sh:30-83` deploys via the configured env file, waits for health before Docker cleanup, and prunes only stopped/unused Docker artifacts after the live container/image are up.
- `scripts/deploy-remote.sh:55-86` refuses missing or group/world-readable deploy env files and derives SSH command inputs from private config rather than hardcoding host/key paths.
- Cycle 52 finding `C52-02` is fixed at `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:27-35` and `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:297-310`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:802-839`: the server passes the resolved semantic-search mode using the operator env gate, and the client renders a disabled production-active state instead of implying Disabled.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed; both admin API routes wrap handlers with `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web`: passed; all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public expensive/mutating route coverage or documented exemptions are intact.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/tracked-secrets.test.ts src/__tests__/safe-json-ld.test.ts src/__tests__/sanitize-for-og-global.test.ts src/__tests__/og-sanitize.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/lr-upload-hdr-gate.test.ts src/__tests__/backup-download.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/cycle-52-source-contracts.test.ts`: 12 files passed, 314 tests passed.
- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- Static dangerous-pattern sweep over `apps/web/src`, `apps/web/scripts`, `.github`, package files, README, and `CLAUDE.md`: no live hardcoded secrets, no `shell: true`, no `eval`/`Function`; `dangerouslySetInnerHTML` sites are JSON-LD routed through `safeJsonLd`.

## Findings

No new Critical, High, Medium, or Low security findings were confirmed in Cycle 53.

- Severity: n/a
- Confidence: High
- Failure scenario: n/a
- Fix: n/a

## Non-Findings Checked

- **Cycle 52 semantic-search visibility:** fixed. Failure scenario previously was an operator with `semantic_search_mode='production'` plus `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` seeing the Settings select imply Disabled while public semantic search was active. Current code threads the resolved mode and displays production-active or production-healed warning states.
- **PAT cross-origin upload:** intended. Token-authenticated `lr:upload` requests bypass same-origin by design, but the token must be well-formed, valid, unexpired, scoped, rate-limited before DB verification, and route-specific processing still enforces restore maintenance, upload quotas, filename/input validation, GPS/HDR policy, and queue settings.
- **Public OG internal fetch:** no SSRF. The only server-side HTTP fetch uses the configured canonical origin plus DB-stored derivative filename and bounded configured sizes; inbound Host/Origin is not used.
- **Public GPS map data:** intentional and constrained. Latitude/longitude are omitted from the normal public select and exposed only by `getMapImages()` for `topics.map_visible=true`, with a runtime leak guard before return.
- **Deploy pruning:** no data-delete finding. The script prunes after a healthy `up -d`; persistence is bind-mounted host paths, and the automatic volume prune omits `-a`.

## Final Sweep

Security posture at reviewed HEAD: no promoted defects.

Reviewed surfaces include auth/authz, admin API gates, server action provenance, public route rate limits, semantic-search production gating, input validation, SQL/command/XSS/path traversal boundaries, SSRF, privacy-sensitive fields, upload/GPS/HDR handling, DB backup/restore, deploy scripts, dependency audit, and docs drift against `CLAUDE.md`.

I did not run full `npm run lint`, full `npm run typecheck`, full `npm test`, `npm run build`, or Playwright E2E because this was a focused security-review lane and the targeted security gates/tests above were the smallest validation set for the claims made here.
