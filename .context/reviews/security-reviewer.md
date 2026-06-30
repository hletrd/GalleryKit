# Cycle 31 Security Reviewer Report

Date: 2026-06-30
Role: security-reviewer
Scope: current HEAD `f1dd39ebb9c2acde2a4dce5974e6cd1fada6f9aa` in `/Users/hletrd/flash-shared/gallery`
Mode: review and report only. No product-code edits.

## Security-Relevant Inventory

Docs and operating constraints:
- `AGENTS.md` prompt instructions and `CLAUDE.md` security/ops sections were reviewed first.
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

Admin APIs, public APIs, and server actions:
- Admin APIs: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`
- Public APIs: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`
- Server actions under `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts`

Upload, file serving, backup/restore, SQL, and child-process surfaces:
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-filenames.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/mysql-cli-ssl.ts`

Privacy, SSRF, XSS/CSV, secrets, and guardrail files:
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/smart-collections.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/content-security-policy.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`

## Validation Evidence

Commands run:
- `npm run lint:api-auth --workspace=apps/web`: passed. Both admin API routes are wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed. All scanned mutating server actions enforce same-origin provenance or carry explicit exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed for current public API routes.
- `npm audit --workspace=apps/web --audit-level=high`: passed with `found 0 vulnerabilities`.
- `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/content-security-policy.test.ts src/__tests__/safe-json-ld.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/map-get-images-behavior.test.ts src/__tests__/seo-actions.test.ts src/__tests__/csv-escape.test.ts src/__tests__/serve-upload.test.ts src/__tests__/upload-paths.test.ts src/__tests__/admin-tokens.test.ts src/__tests__/session.test.ts src/__tests__/auth-rate-limit.test.ts`: passed, 16 files and 254 tests.
- Synthetic scanner check via `npx tsx -e "import { checkPublicRouteSource } ..."`: confirmed a public GET that calls a local DB helper before its limiter is reported as `OK: route.ts (no mutating or expensive GET handlers)`.

Secret sweep:
- Grep over tracked source found placeholders, docs, tests, env variable names, and historical review/plan notes. I did not find a current committed private key, live token, DB password, admin password, or session secret in application source.
- Gitignored runtime secret files such as `.env.local` and `.env.deploy` were not read.

Changed-code focus since cycle 30:
- Product-code delta from `8db1df97..HEAD` is narrow: `apps/web/scripts/check-public-route-rate-limit.ts`, its tests, one restore sequencing line in `apps/web/src/app/[locale]/admin/db-actions.ts`, search UI copy/comments, and i18n copy. No auth/session/upload/serving runtime code changed outside that restore ordering line.

## Confirmed Issues

### SEC-C31-01 - Low - Public expensive-GET rate-limit lint misses expensive work hidden behind local helper calls

Severity: Low
Confidence: High
Category: guardrail / future regression, not an active runtime route bypass

Locations:
- `apps/web/scripts/check-public-route-rate-limit.ts:57-72`
- `apps/web/scripts/check-public-route-rate-limit.ts:279-382`
- `apps/web/scripts/check-public-route-rate-limit.ts:527-536`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:132-181`

Finding:
- The public-route lint gate marks expensive GET handlers by scanning only the exported handler body's text for marker strings such as `db.`, `ImageResponse`, `getGalleryConfig`, and `sharp` (`check-public-route-rate-limit.ts:57-72`, `378-382`).
- The mutating-handler path already traces local mutating helper functions (`check-public-route-rate-limit.ts:397-437`), but the expensive-GET path does not perform an equivalent local-helper traversal before deciding a handler is cheap (`check-public-route-rate-limit.ts:527-536`).
- I confirmed this with a synthetic route where `async function loadRows(){ return db.select().from(images); }` is called before `preIncrementSemanticAttempt(...)` inside exported `GET`; `checkPublicRouteSource(...)` returned `OK: route.ts (no mutating or expensive GET handlers)`.
- Current checked-in public API routes do not use this bypass shape: the active OG and similar handlers place `preIncrement*` before DB/CPU work (`api/og/route.tsx:80-95`, `api/og/photo/[id]/route.tsx:45-63`, `api/search/similar/[id]/route.ts:98-126`), and semantic POST is already covered by the mutating method rule (`api/search/semantic/route.ts:173-201`).

Failure scenario:
- A future public GET route could add:
  - a local helper that performs DB/image/filesystem/embedding work;
  - an exported `GET` that calls that helper before the limiter; and
  - a limiter later in the handler, or no limiter at all.
- The lint gate can pass because the exported handler body contains only `await loadRows()` rather than an expensive marker string. That would allow an unauthenticated public route to ship with unmetered expensive work.

Suggested fix:
- Extend `check-public-route-rate-limit.ts` so expensive GET detection follows local helper calls similarly to the mutating-function closure at `check-public-route-rate-limit.ts:397-437`.
- Add regression tests for:
  - local helper with `db.select()` called before the limiter: must fail;
  - nested local helper chain: must fail;
  - local helper called only after a dominating limiter gate: may pass;
  - helper imported from another module: fail closed or require a reasoned `@public-no-rate-limit-required` exemption.

## Likely Issues

None found in current HEAD.

## Risks Needing Manual Validation

### SEC-C31-MV-01 - Medium - Public TLS/header-trust topology must match the internal-hop nginx design

Severity: Medium
Confidence: Medium

Locations:
- `apps/web/nginx/default.conf:21-30`
- `apps/web/nginx/default.conf:67-71`
- `apps/web/nginx/default.conf:180-197`
- `apps/web/docker-compose.yml:20-22`
- `apps/web/src/lib/request-origin.ts:45-68`
- `apps/web/src/lib/request-origin.ts:79-107`
- `apps/web/src/lib/rate-limit.ts:166-197`

What I verified:
- The checked-in nginx server listens on port 80 and documents itself as an internal HTTP hop behind TLS termination (`nginx/default.conf:21-30`).
- nginx overwrites forwarded host/IP/proto headers before proxying to Next (`nginx/default.conf:67-71`, `180-197`).
- The compose file sets `TRUST_PROXY=true` for the documented host-network nginx topology (`docker-compose.yml:20-22`).
- App origin/IP logic trusts forwarded headers only when `TRUST_PROXY=true`; otherwise proxy headers collapse rate limiting to `unknown` rather than trusting spoofed client headers (`request-origin.ts:45-68`, `79-107`; `rate-limit.ts:166-197`).

Failure scenario:
- If the port-80 nginx listener is exposed directly to the internet instead of only behind a TLS edge, admin login/session traffic can traverse the public network in cleartext before HSTS can help.
- If `TRUST_PROXY=true` is enabled while requests can bypass the trusted proxy and hit Next directly, an attacker can influence forwarded-origin/IP interpretation. If a real proxy is present but `TRUST_PROXY` is not enabled, all clients share the `unknown` rate-limit bucket, causing collateral lockout/DoS.

Suggested validation:
- Confirm production cleartext traffic is redirected or terminated at the edge before reaching this nginx listener.
- Confirm only the trusted proxy can reach Next/nginx and that it overwrites `X-Forwarded-*` and `X-Real-IP`.
- Validate `TRUSTED_PROXY_HOPS` against the actual proxy chain.

### SEC-C31-MV-02 - Medium - Admin DB restore intentionally restores security tables, so dump provenance and DB grants are hard trust boundaries

Severity: Medium
Confidence: Medium

Locations:
- `apps/web/src/lib/sql-restore-scan.ts:12-31`
- `apps/web/src/lib/sql-restore-scan.ts:61-129`
- `apps/web/src/lib/sql-restore-scan.ts:210-251`
- `apps/web/src/app/[locale]/admin/db-actions.ts:365-371`
- `apps/web/src/app/[locale]/admin/db-actions.ts:620-680`

What I verified:
- Restore is same-origin/admin guarded before acquiring locks and work starts (`db-actions.ts:365-371`).
- App backup tables include `admin_users`, `sessions`, and `admin_tokens` (`sql-restore-scan.ts:12-31`).
- The scanner blocks dangerous statement classes and writes outside the app-table allowlist (`sql-restore-scan.ts:61-129`, `210-251`).
- The restore import uses `mysql --one-database` with argv arrays and env credentials, not shell interpolation (`db-actions.ts:674-680`).

Failure scenario:
- A crafted dump that stays within allowed app tables can still alter admin users, sessions, or PAT hashes if an admin is tricked into restoring it. That is inherent in a full DB restore, but it means dump provenance is equivalent to privileged application state.
- If the production MySQL user has global or sibling-schema privileges, any future scanner blind spot has a larger blast radius than the GalleryKit database.

Suggested validation:
- Verify production MySQL grants are limited to the intended `DB_NAME.*` and do not include global, sibling-schema, FILE, user-management, routine, event, or plugin privileges unless explicitly justified.
- Treat restore files as privileged artifacts. Consider signed backup provenance, operator re-authentication before restore, and optional session/PAT invalidation after restore.

### SEC-C31-MV-03 - Low - Public map publishes exact GPS for opted-in topics; operator intent must be verified

Severity: Low
Confidence: High

Locations:
- `apps/web/src/lib/data.ts:410-416`
- `apps/web/src/lib/data.ts:1660-1696`
- `apps/web/src/app/actions/topics.ts:600-625`

What I verified:
- `publicMapSelectFields` is explicitly the only public selector retaining latitude/longitude and warns it must be used only with the `map_visible` topic filter (`data.ts:410-416`).
- `getMapImages()` returns GPS only for processed images whose joined topic has `map_visible=true`, filters non-null coordinates, limits to 10,000 markers, and asserts every returned row has `topic_map_visible=true` (`data.ts:1660-1696`).
- The map visibility toggle is same-origin/admin guarded and audited (`topics.ts:600-625`).

Failure scenario:
- If an operator enables `map_visible` on a topic without realizing it publishes exact coordinates, visitors can see location metadata for every processed image in that topic that has latitude/longitude.

Suggested validation:
- Validate the admin UX/runbook makes the exact-GPS implication clear before toggling map visibility.
- For sensitive galleries, consider coordinate rounding/clustering or a first-time confirmation path.

### SEC-C31-MV-04 - Low - Some public expensive-route limits are process-local and assume single-instance deployment

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
- Share pages validate key shape, keep metadata generic, then rate-limit the body lookup before the DB query (`s/[key]/page.tsx:33-37`, `98-107`; `g/[key]/page.tsx:38-42`, `104-112`).

Failure scenario:
- If the app is horizontally scaled across multiple Node processes or hosts, scripted requests can multiply effective OG/share-key lookup quota by distributing across instances. On the documented single web instance this is not a bypass, but it is a scaling-time assumption.

Suggested validation:
- Keep production single-instance if relying on these process-local budgets.
- Before horizontal scaling, move these limits to a shared store or edge rate limiter.

## Confirmed Controls Reviewed

Auth/authz and sessions:
- `withAdminAuth` enforces same-origin for cookie-authenticated admin APIs before `isAdmin()` and adds no-store/nosniff headers (`apps/web/src/lib/api-auth.ts:58-144`).
- Scoped PAT auth is only enabled by routes that pass `allowTokenScope`; token requests are rate-limited, scope-checked, marked used, and cleared from request context (`api-auth.ts:72-111`).
- PATs are 32 random bytes, SHA-256 hashed in DB, format-checked, expiry-checked, scope-normalized, and timing-safe compared (`apps/web/src/lib/admin-tokens.ts:52-89`, `141-167`, `207-252`).
- Session tokens are HMAC-signed with production-required `SESSION_SECRET`, DB-hashed, max-age checked, and timing-safe compared (`apps/web/src/lib/session.ts:16-36`, `82-150`).
- Login and password change use same-origin checks, rate limits, Argon2id verification, and session rotation/fixation controls (`apps/web/src/app/actions/auth.ts:74-450`).

CSRF/origin and admin actions:
- `npm run lint:action-origin` passed across DB actions, image mutations, admin users, tokens, settings, SEO, sharing, topics, tags, collections, and embeddings.
- Spot checks confirmed sensitive mutations call `requireSameOriginAdmin()` before state changes, then `isAdmin()`.

Uploads, processing, and path traversal:
- Browser upload requires same-origin/admin auth, caps file count/bytes, sanitizes filenames, holds upload-processing locks, checks disk space, rejects disabled HDR uploads, strips GPS when configured, and re-checks restore maintenance before DB commit (`apps/web/src/app/actions/images.ts:114-460`).
- LR upload is `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, rejects chunked/missing/oversized bodies, validates topic/text/file data, and reuses the same processing/GPS/HDR controls (`apps/web/src/app/api/admin/lr/upload/route.ts:68-554`).
- Private originals use owner-only directory creation plus strict filename, lstat, realpath, and containment helpers (`apps/web/src/lib/upload-paths.ts:49-171`).
- Public derivative serving only allows `jpeg`, `webp`, `avif`, rejects bad segments/extensions/symlinks, enforces realpath containment, streams from the opened handle, and emits `nosniff` on served content (`apps/web/src/lib/serve-upload.ts:126-321`).

Backup/restore and SQL:
- CSV export, dump, and restore actions require same-origin/admin auth (`apps/web/src/app/[locale]/admin/db-actions.ts:81-96`, `164-174`, `365-371`).
- `mysqldump`, `mysql`, and post-restore migration use argument arrays and sanitized stderr (`db-actions.ts:215-229`, `674-715`, `781-821`).
- Backup downloads validate filename, enforce realpath containment, stream through an opened file handle, and set no-store/nosniff (`apps/web/src/app/api/admin/db/download/route.ts:21-109`).
- Smart collections use allowlisted columns/operators and parameterized values.

Rate limiting:
- Login/password/admin-user/share-write/search/load-more/view-record/PAT-auth/public API limiters use pre-increment or lint-validated helper patterns.
- Semantic search rejects cross-origin requests, missing/oversized/chunked/non-JSON bodies, overlong queries, non-production model states, and unbounded embedding scans (`apps/web/src/app/api/search/semantic/route.ts:107-360`).
- Similar search requires same-origin, positive image ID, semantic limiter, production model mode, processed target embedding, scan cap, and public-safe enrichment fields (`apps/web/src/app/api/search/similar/[id]/route.ts:68-271`).

SSRF, redirects, CSP, and XSS:
- `IMAGE_BASE_URL` parsing requires absolute HTTP(S), production HTTPS, and no credentials/query/hash (`apps/web/src/lib/content-security-policy.ts:1-25`; `apps/web/next.config.ts:8-28`).
- OG photo fetches pin internal fetches to the trusted canonical origin and bound each fetch by timeout and byte cap (`apps/web/src/app/api/og/photo/[id]/route.tsx:97-128`; `apps/web/src/lib/og-photo-fetch.ts:30-118`).
- Current `dangerouslySetInnerHTML` sinks are JSON-LD scripts fed through `safeJsonLd`, which escapes `<`, `>`, U+2028, and U+2029 after JSON serialization (`apps/web/src/lib/safe-json-ld.ts:14-19`).
- Production CSP is nonce-based for scripts and includes `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'self'` (`apps/web/src/lib/content-security-policy.ts:68-123`; `apps/web/src/proxy.ts:21-49`).

Privacy/data exposure:
- `publicSelectFields` omits GPS, original/user filenames, processing internals, source format/size, uploader, error fields, and admin-only color internals (`apps/web/src/lib/data.ts:368-408`).
- Type-level guards protect public, map, and search enrichment selectors from sensitive-field additions (`apps/web/src/lib/data.ts:459-489`; `apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Share pages validate Base56 keys before lookup, rate-limit enumeration-sensitive DB lookups, keep metadata generic, and return `notFound()` for invalid/missing/rate-limited keys (`s/[key]/page.tsx:39-112`; `g/[key]/page.tsx:44-120`).
- CSV export escapes formula-leading fields and strips control/bidi/zero-width characters (`apps/web/src/lib/csv-escape.ts:41-64`).

## Final Missed-Issue Sweep

Areas swept:
- Auth/authz: session signing/storage, admin API wrappers, PAT scope gates, current-user checks, protected middleware behavior.
- CSRF/origin: admin APIs, server actions, semantic/similar APIs, proxy-trust handling.
- Upload and path traversal: originals, derivatives, backup downloads, temp restore files, delete paths, symlink/realpath checks.
- SQL and command execution: Drizzle SQL templates, smart collection query compiler, restore scanner, mysql/mysqldump child processes.
- Rate limiting: login/password, PAT auth, public search/load-more/view recording, share-key lookup, share creation, OG, semantic/similar routes, nginx edge limits.
- SSRF/open redirect: OG fetches, image base URL, Next image patterns, SEO OG URL validation, middleware redirects.
- XSS/CSP/CSV: JSON-LD sinks, sanitizers, CSP nonce path, security headers, CSV formula injection.
- Privacy: public selectors, map exception, semantic/similar enrichment, share pages, analytics.
- Secrets/config: tracked source placeholders and env reads; runtime secret files excluded.
- Dependencies: `npm audit --workspace=apps/web --audit-level=high`.

Skipped or manually constrained:
- No live production host, DNS, firewall, TLS edge, or proxy-chain validation.
- No live restore/upload against a production database or filesystem.
- No gitignored secret files were read.
- No browser/e2e security probing was performed; this was source/configuration review plus targeted tests.
- Historical git-object secret scanning was not repeated beyond current tracked-source grep and existing documented historical-secret notes.

Stop condition:
- Required review artifact updated.
- Security inventory completed.
- Current HEAD security gates and focused tests passed.
- One confirmed guardrail issue recorded with reproduction evidence; no active runtime exploit found in current checked-in public API routes.
