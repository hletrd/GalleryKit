# Cycle 30 Security Reviewer Report

Date: 2026-06-30
Role: security-reviewer
Scope: current HEAD `8db1df97` in `/Users/hletrd/flash-shared/gallery`
Mode: Prompt 1 only: review and report. No implementation or fixes.

## Security-Relevant Inventory

Docs and operating constraints:
- `AGENTS.md` prompt instructions and `CLAUDE.md` security/ops sections were reviewed before code inspection.
- Deploy/runtime references reviewed: `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/.env.local.example`, `.env.deploy.example`.

Auth, authorization, sessions, tokens, and origin checks:
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/proxy.ts`

Admin API routes, public API routes, and server actions:
- Admin APIs: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public APIs: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Mutating/read server actions under `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`

Upload, filesystem, image processing, and path traversal surfaces:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/serve-upload.ts`

Backup, restore, SQL, and child-process surfaces:
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`
- `apps/web/scripts/migrate.js`

Privacy, public data selectors, sharing, analytics, and XSS surfaces:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- Public pages with JSON-LD `dangerouslySetInnerHTML`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/og-photo-fetch.ts`

Security test/lint coverage inspected:
- API auth wrapper lint, action-origin lint, public-route rate-limit lint.
- Privacy-field, SQL-restore-scan, backup-download, CSP, safe JSON-LD, and corresponding lint tests.

## Validation Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web`: passed. Both admin API routes are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed. All scanned mutating server actions enforce same-origin provenance or carry recognized public/read-only exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed. Public expensive/mutating routes have rate-limit coverage or explicit low-cost exemptions.
- `npm audit --workspace=apps/web --audit-level=high`: passed with `found 0 vulnerabilities`.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/safe-json-ld.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts`: passed, 8 files and 147 tests.

Secret sweep:
- Grep over tracked source found placeholders, env variable names, tests, and historical review/plan notes. I did not find a current committed private key, live token, DB password, admin password, or session secret in application source.
- Gitignored runtime secret files such as `.env.local` and `.env.deploy` were not read.

Worktree note:
- Before this report edit, other review files were already modified in the worktree: `.context/reviews/architect.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/debugger.md`, `.context/reviews/verifier.md`. I did not touch them.

## Confirmed Issues

None found in current HEAD.

## Likely Issues

None found in current HEAD.

## Risks Needing Manual Validation

### SEC-C30-MV-01 - Medium - Public TLS/header-trust topology must match the internal-hop nginx design

Severity: Medium
Confidence: Medium

Locations:
- `apps/web/nginx/default.conf:21-30`
- `apps/web/nginx/default.conf:55`
- `apps/web/nginx/default.conf:67-71`
- `apps/web/src/lib/request-origin.ts:45-69`
- `apps/web/src/lib/request-origin.ts:79-107`
- `apps/web/src/lib/rate-limit.ts:166-197`

What I verified:
- The checked-in nginx server listens on port 80 and explicitly documents that it is intended as an internal HTTP hop behind a TLS-terminating edge (`nginx/default.conf:21-30`).
- HSTS is added (`nginx/default.conf:55`), but HSTS over a cleartext public first hop would not encrypt the first request.
- nginx overwrites forwarded host/IP/proto headers before proxying to Next (`nginx/default.conf:67-71`).
- App same-origin and IP logic trusts forwarded headers only when `TRUST_PROXY=true`; otherwise proxy headers collapse rate limiting to `unknown` rather than trusting spoofed client headers (`request-origin.ts:45-69`, `79-107`; `rate-limit.ts:166-197`).

Concrete failure scenario:
- If this port-80 nginx listener is exposed directly to the internet instead of only behind a TLS edge, admin login/session traffic can traverse the public network in cleartext before any HSTS state exists.
- If `TRUST_PROXY=true` is enabled while requests can bypass the trusted proxy and hit Next directly, an attacker could influence forwarded-origin/IP interpretation. If a real proxy is present but `TRUST_PROXY` is not enabled, all clients share the `unknown` rate-limit bucket, creating collateral lockout/DoS.

Suggested fix / validation:
- Confirm production public cleartext traffic is redirected at the edge before reaching this nginx listener.
- Confirm only the trusted proxy can reach Next/nginx and that it strips or overwrites `X-Forwarded-*` and `X-Real-IP`.
- Keep `TRUST_PROXY=true` only for the trusted-proxy topology; otherwise leave it false.
- Validate `TRUSTED_PROXY_HOPS` against the actual proxy chain.

### SEC-C30-MV-02 - Medium - Admin DB restore intentionally restores security tables, so dump provenance and DB grants are a hard trust boundary

Severity: Medium
Confidence: Medium

Locations:
- `apps/web/src/lib/sql-restore-scan.ts:12-31`
- `apps/web/src/lib/sql-restore-scan.ts:210-251`
- `apps/web/src/app/[locale]/admin/db-actions.ts:365-430`
- `apps/web/src/app/[locale]/admin/db-actions.ts:620-680`

What I verified:
- `restoreDatabase` is admin-only and same-origin guarded before it acquires restore/upload/backfill locks (`db-actions.ts:365-430`).
- The restore path stores a temp file, scans the SQL in chunks, rejects dangerous SQL, requires MySQL TLS settings for non-local hosts, then runs `mysql --one-database` with argv arrays and env credentials (`db-actions.ts:620-680`).
- The SQL scanner blocks writes outside the app-table allowlist and blocks dangerous statement classes (`sql-restore-scan.ts:12-31`, `210-251`).

Concrete failure scenario:
- A crafted dump that stays within the app schema can still alter app security state such as admin users, sessions, or admin tokens if an admin is tricked into restoring it. That is partly the point of full DB restore, but it means "admin can restore SQL" is equivalent to trusting the dump as privileged application state.
- If the production MySQL user has global or sibling-schema privileges, any future scanner blind spot would have a larger blast radius than the GalleryKit database.

Suggested fix / validation:
- Manually verify production MySQL grants: the app user should be limited to the intended `DB_NAME.*` and should not have global, sibling-schema, FILE, user-management, routine, event, or plugin privileges unless explicitly justified.
- Treat restore files as privileged artifacts. Consider requiring password re-authentication or a stronger warning before restore, and consider invalidating sessions/admin tokens after restore unless the operator explicitly wants restored credentials.
- If restores may come from outside the trusted operator backup chain, add signed backup provenance or an allowlisted backup-source workflow.

### SEC-C30-MV-03 - Low - Public map publishes exact GPS for opted-in topics; operator intent must be verified

Severity: Low
Confidence: High

Locations:
- `apps/web/src/lib/data.ts:410-416`
- `apps/web/src/lib/data.ts:1660-1685`
- `apps/web/src/app/actions/topics.ts:600-625`

What I verified:
- `publicMapSelectFields` is explicitly the only public selector retaining latitude/longitude and warns it must be used only with the `map_visible` topic filter (`data.ts:410-416`).
- `getMapImages()` returns GPS only for processed images whose joined topic has `map_visible=true`, and it hard-limits public markers to 10,000 (`data.ts:1660-1685`).
- The map visibility toggle is same-origin/admin guarded and audited (`topics.ts:600-625`).

Concrete failure scenario:
- If an operator enables `map_visible` on a topic without realizing it publishes exact coordinates, visitors can see location metadata for every processed image in that topic that has latitude/longitude.

Suggested fix / validation:
- Manually validate the admin UX and runbook make the exact-GPS implication clear before toggling map visibility.
- For sensitive galleries, consider rounding/clustering coordinates or adding a confirmation copy path for first-time enablement.

### SEC-C30-MV-04 - Low - Some public expensive-route limits are process-local and assume the documented single-app topology

Severity: Low
Confidence: Medium

Locations:
- `apps/web/src/lib/rate-limit.ts:78-99`
- `apps/web/src/lib/rate-limit.ts:320-345`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:33-37`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:98-107`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:38-42`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:104-112`

What I verified:
- Public OG and share-key lookup budgets use bounded in-memory maps (`rate-limit.ts:78-99`, `320-345`).
- Share pages validate key shape, do generic metadata, then rate-limit the body lookup before the DB query (`s/[key]/page.tsx:33-37`, `98-107`; `g/[key]/page.tsx:38-42`, `104-112`).
- Public route rate-limit lint passed for the API route surfaces.

Concrete failure scenario:
- If the app is horizontally scaled across multiple Node processes or hosts, a scripted attacker can multiply effective share-key/OG lookup quota by distributing requests across instances. On the documented single web instance this is not a bypass, but it is a scaling-time security assumption.

Suggested fix / validation:
- If production remains a single app instance behind nginx, document that these budgets are intentionally process-local.
- Before horizontal scaling, move public expensive-route rate limits to a shared store such as the existing DB-backed bucket pattern, Redis, or edge rate limiting.

## Confirmed Controls Reviewed

Auth/authz and sessions:
- `withAdminAuth` requires same-origin for cookie-authenticated admin APIs before `isAdmin()` and applies no-store/nosniff headers (`apps/web/src/lib/api-auth.ts:58-144`).
- Scoped PAT auth is only enabled by routes that pass `allowTokenScope`; token verification is rate-limited, scope checked, marked used, and cleared from request context (`api-auth.ts:72-111`).
- PATs are random 32-byte tokens, stored as SHA-256 hashes, format-checked, expiry-checked, scope-normalized, and compared with timing-safe digest comparison (`apps/web/src/lib/admin-tokens.ts:52-89`, `141-167`, `207-252`).
- Session tokens are HMAC-signed with a production-required secret, DB-hashed, max-age checked, and timing-safe compared (`apps/web/src/lib/session.ts:16-36`, `94-150`).
- Login and password-change paths use same-origin checks, rate limits, Argon2id verification, and session rotation/fixation controls (`apps/web/src/app/actions/auth.ts:95-242`, `287-450`).

CSRF/origin and admin actions:
- `npm run lint:action-origin` passed across db actions, image mutations, admin users, tokens, settings, SEO, sharing, topics, tags, collections, embeddings, and public rate-limited actions.
- Spot checks confirmed sensitive mutations run `requireSameOriginAdmin()` before state changes.

Uploads, processing, and path traversal:
- Browser upload requires same-origin/admin auth, caps files/bytes, sanitizes filenames, holds upload-processing locks, checks disk space, rejects disabled HDR uploads, strips GPS when configured, and re-checks restore maintenance before DB commit (`apps/web/src/app/actions/images.ts:114-632`).
- Lightroom upload is `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, rejects chunked/missing/oversized bodies, validates topic/text/file data, applies the same processing and GPS/HDR controls, and audits token use (`apps/web/src/app/api/admin/lr/upload/route.ts:68-555`).
- Private originals use `0700` root creation and strict lstat/realpath containment helpers (`apps/web/src/lib/upload-paths.ts:49-171`).
- Public derivative serving allows only expected derivative dirs/extensions, rejects symlinks, enforces realpath containment, streams from the opened handle, and emits `nosniff` (`apps/web/src/lib/serve-upload.ts:126-321`).

Backup/restore and SQL:
- DB export/dump/restore actions require same-origin and admin auth before work (`apps/web/src/app/[locale]/admin/db-actions.ts:81-96`, `164-174`, `365-371`).
- `mysqldump`, `mysql`, and post-restore migration use argument arrays rather than shell interpolation, exclude `HOME`, and sanitize stderr before logging (`db-actions.ts:214-229`, `665-715`, `781-821`).
- Backup downloads validate the filename, enforce realpath containment, stream through an opened file handle, and set no-store/nosniff (`apps/web/src/app/api/admin/db/download/route.ts:21-109`).
- Smart collections use allowlisted columns/operators and parameterized values rather than user-controlled identifiers (`apps/web/src/lib/smart-collections.ts`).

Rate limiting:
- Login/password/admin-user/share-write/search/load-more/view-record/PAT-auth/public API limiters use pre-increment or lint-validated helper patterns.
- Semantic search rejects cross-origin requests, missing/oversized/chunked/non-JSON bodies, overlong queries, non-production model modes, and unbounded embedding scans (`apps/web/src/app/api/search/semantic/route.ts`).
- Similar search requires same-origin, positive image ID, semantic limiter, production model mode, processed target embedding, scan cap, and public-safe enrichment fields (`apps/web/src/app/api/search/similar/[id]/route.ts`).

SSRF, redirects, CSP, and XSS:
- `IMAGE_BASE_URL` parsing requires absolute HTTP(S), production HTTPS, no credentials, and no query/hash (`apps/web/src/lib/content-security-policy.ts:1-25`).
- Next image remote patterns derive from that validated origin (`apps/web/next.config.ts:8-28`, `102-106`).
- OG photo fetches use configured base URL/canonical origin controls and bounded fetches (`apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`).
- Current `dangerouslySetInnerHTML` hits are JSON-LD script payloads fed through `safeJsonLd`; `safeJsonLd` escapes `<`, `>`, U+2028, and U+2029 after JSON serialization (`apps/web/src/lib/safe-json-ld.ts:14-19`).
- Production CSP is nonce-based for scripts with `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'` (`apps/web/src/lib/content-security-policy.ts:68-123`).

Privacy/data exposure:
- `publicSelectFields` omits GPS, original/user filenames, processing internals, original format/size, uploader, error fields, color/ICC internals, and pipeline version (`apps/web/src/lib/data.ts:368-408`).
- Type-level privacy guards protect public, map, and search enrichment selectors from accidental sensitive-field additions (`apps/web/src/lib/data.ts:459-489`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Share pages validate Base56 keys before lookup, rate-limit enumeration-sensitive DB lookups, keep metadata generic, and return `notFound()` for invalid/missing/rate-limited keys (`s/[key]/page.tsx:39-112`, `g/[key]/page.tsx:44-120`).
- Public analytics records derived metadata rather than full IP addresses and rate-limits durable inserts (`apps/web/src/app/actions/public.ts:397-510`).

## Final Sweep

Areas swept:
- Auth/authz: session signing, session storage, admin API wrappers, PAT scope gates, current-user checks, protected middleware behavior.
- CSRF/origin: admin APIs, server actions, semantic/similar APIs, proxy-trust handling.
- Upload and path traversal: originals, variants, backup downloads, temp restore files, delete paths, symlink/realpath checks.
- SQL and command execution: Drizzle SQL templates, smart collection query compiler, restore scanner, mysql/mysqldump child processes.
- Rate limiting: admin login/password, PAT auth, public search/load-more/view recording, share-key lookup, share creation, OG, semantic/similar routes, nginx edge limits.
- SSRF/open redirect: OG fetches, image base URL, Next image patterns, SEO OG URL validation, middleware redirects.
- XSS/CSP: JSON-LD sinks, sanitizers, CSP nonce path, security headers.
- Privacy: public selectors, map exception, semantic/similar enrichment, share pages, analytics.
- Secrets/config: tracked source placeholders and known env reads; runtime secret files excluded.
- Dependencies: `npm audit --workspace=apps/web --audit-level=high`.

Skipped or manually constrained areas:
- No live production host, firewall, TLS edge, DNS, or proxy-chain validation.
- No live restore/upload against a production database or filesystem.
- No gitignored secret files were read.
- No browser/e2e security probing was performed; this was a source, configuration, and targeted-test review.
- Historical git object scanning was not repeated beyond the tracked-source sweep and existing documented historical-secret notes.

Stop condition:
- Required review artifact updated.
- Security inventory completed.
- Current HEAD security gates and targeted tests passed.
- No confirmed or likely current-HEAD product-code vulnerability found; remaining items are deployment/runtime/manual-validation risks.
