# Cycle 37 Security Review

Date: 2026-06-30
Lane: security-reviewer
Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`
Scope: OWASP-style auth/authz, CSRF/origin/rate-limit guard coverage, public data boundaries, upload/file/path handling, SSRF, token/session handling, dependency/secrets hygiene, and deployment/security documentation drift.

## Result

No new actionable security findings were identified in this cycle.

Confidence: high for tracked source and the focused gate/test surfaces listed below. I did not inspect gitignored runtime secret files or production host state.

Cycle 36 duplicate policy: I read the Cycle 36 security report, aggregate, implementation plan, and deferred register before forming this report. I did not re-raise deferred performance/UX/deployment-tuning items because I found no fresh evidence that changed their severity or made them scheduled now.

## Inventory

Repository guidance and prior-cycle context:

- `AGENTS.md`
- `CLAUDE.md`
- `.context/reviews/cycle-36-2026-06-30/security-reviewer.md`
- `.context/reviews/cycle-36-2026-06-30/_aggregate.md`
- `.context/plans/cycle-36-2026-06-30-plan.md`
- `.context/plans/cycle-36-2026-06-30-deferred.md`
- `.context/plans/README.md`

Changed since Cycle 36 base and reviewed for regression risk:

- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/__tests__/admin-tokens.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`

Auth, session, origin, and token surfaces:

- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/admin-tokens.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`

Admin API routes and server actions:

- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`

Public route handlers and public page lookup gates:

- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`

File handling, restore, privacy, and deployment/security config:

- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/og-photo-fetch.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/search-enrichment-fields.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/tracked-secrets.test.ts`
- `apps/web/src/__tests__/search-route-privacy.test.ts`
- `apps/web/src/__tests__/map-privacy.test.ts`
- `apps/web/nginx/default.conf`
- `apps/web/next.config.ts`

## Findings

None.

## Reviewed Evidence

Authentication and authorization:

- Admin API route coverage remains scanner-backed: `lint:api-auth` reported both admin API handlers wrapped with `withAdminAuth`, covering `src/app/api/admin/db/download/route.ts` and `src/app/api/admin/lr/upload/route.ts`.
- `withAdminAuth` rate-limits PAT attempts before verification, enforces route-declared token scope, stores token context only while the handler runs, and adds no-store/nosniff headers on token and cookie success paths (`apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:76`, `apps/web/src/lib/api-auth.ts:82`, `apps/web/src/lib/api-auth.ts:83`, `apps/web/src/lib/api-auth.ts:85`, `apps/web/src/lib/api-auth.ts:89`, `apps/web/src/lib/api-auth.ts:98`, `apps/web/src/lib/api-auth.ts:102`, `apps/web/src/lib/api-auth.ts:123`, `apps/web/src/lib/api-auth.ts:135`, `apps/web/src/lib/api-auth.ts:139`).
- Cookie-backed admin API access still checks same-origin before `isAdmin()` (`apps/web/src/lib/api-auth.ts:114`, `apps/web/src/lib/api-auth.ts:116`, `apps/web/src/lib/api-auth.ts:123`).
- Origin validation fails closed by default, normalizes expected origin from trusted proxy headers only when `TRUST_PROXY=true`, and requires `Origin` or `Referer` unless callers explicitly opt into the missing-source legacy behavior (`apps/web/src/lib/request-origin.ts:45`, `apps/web/src/lib/request-origin.ts:55`, `apps/web/src/lib/request-origin.ts:58`, `apps/web/src/lib/request-origin.ts:79`, `apps/web/src/lib/request-origin.ts:87`, `apps/web/src/lib/request-origin.ts:96`, `apps/web/src/lib/request-origin.ts:101`, `apps/web/src/lib/request-origin.ts:106`).
- Session signing requires a production `SESSION_SECRET`, uses HMAC-SHA256, verifies with `timingSafeEqual`, validates token shape after HMAC verification, enforces max age, and checks the DB session expiry (`apps/web/src/lib/session.ts:20`, `apps/web/src/lib/session.ts:30`, `apps/web/src/lib/session.ts:82`, `apps/web/src/lib/session.ts:107`, `apps/web/src/lib/session.ts:117`, `apps/web/src/lib/session.ts:124`, `apps/web/src/lib/session.ts:127`, `apps/web/src/lib/session.ts:137`, `apps/web/src/lib/session.ts:145`).
- Login enforces same-origin before consuming rate-limit budget, pre-increments IP and account-scoped buckets before Argon2 work, uses a dummy Argon2 hash for missing users, and creates the new session plus old-session deletion inside one transaction (`apps/web/src/app/actions/auth.ts:98`, `apps/web/src/app/actions/auth.ts:100`, `apps/web/src/app/actions/auth.ts:121`, `apps/web/src/app/actions/auth.ts:132`, `apps/web/src/app/actions/auth.ts:136`, `apps/web/src/app/actions/auth.ts:141`, `apps/web/src/app/actions/auth.ts:180`, `apps/web/src/app/actions/auth.ts:182`, `apps/web/src/app/actions/auth.ts:218`, `apps/web/src/app/actions/auth.ts:225`).
- The Cycle 36 orphan-PAT fix is present: token verification joins `admin_users`, so a legacy orphan `admin_tokens` row fails closed even before FK repair (`apps/web/src/lib/admin-tokens.ts:146`, `apps/web/src/lib/admin-tokens.ts:149`, `apps/web/src/lib/admin-tokens.ts:158`, `apps/web/src/lib/admin-tokens.ts:163`).

CSRF/origin and public rate-limit guard coverage:

- `lint:action-origin` passed and enumerated every mutating server action as either same-origin guarded or an explicitly read-only/rate-limited exemption.
- The Cycle 36 scanner hardening is present: guard branches must exit before side effects, pre-guard mutations and auth reads fail the guard, wrapped async exports are evaluated, default exports and unsupported wrappers fail closed, and local mutating helper detection is computed to a fixed point (`apps/web/scripts/check-action-origin.ts:226`, `apps/web/scripts/check-action-origin.ts:251`, `apps/web/scripts/check-action-origin.ts:528`, `apps/web/scripts/check-action-origin.ts:548`, `apps/web/scripts/check-action-origin.ts:556`, `apps/web/scripts/check-action-origin.ts:700`, `apps/web/scripts/check-action-origin.ts:765`, `apps/web/scripts/check-action-origin.ts:819`, `apps/web/scripts/check-action-origin.ts:826`).
- `lint:public-route-rate-limit` passed and classified all public route handlers, including expensive GET routes and explicit no-rate-limit exemptions for upload derivative serving, feed routes, and health.
- The public-route scanner now treats `serveUploadFile` as expensive GET work, propagates local expensive-helper classification to a fixed point, and fails closed on external GET re-exports (`apps/web/scripts/check-public-route-rate-limit.ts:60`, `apps/web/scripts/check-public-route-rate-limit.ts:432`, `apps/web/scripts/check-public-route-rate-limit.ts:517`, `apps/web/scripts/check-public-route-rate-limit.ts:581`, `apps/web/scripts/check-public-route-rate-limit.ts:603`).
- Semantic search requires same-origin, JSON content type, non-chunked transfer, finite `Content-Length` under the body cap, and pre-increments the semantic limiter before config/database/embedding work (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:109`, `apps/web/src/app/api/search/semantic/route.ts:124`, `apps/web/src/app/api/search/semantic/route.ts:138`, `apps/web/src/app/api/search/semantic/route.ts:148`, `apps/web/src/app/api/search/semantic/route.ts:162`, `apps/web/src/app/api/search/semantic/route.ts:176`, `apps/web/src/app/api/search/semantic/route.ts:178`).
- Similar-image search requires same-origin, validates the route id before work, pre-increments the same semantic limiter, and serves only production semantic mode (`apps/web/src/app/api/search/similar/[id]/route.ts:72`, `apps/web/src/app/api/search/similar/[id]/route.ts:88`, `apps/web/src/app/api/search/similar/[id]/route.ts:100`, `apps/web/src/app/api/search/similar/[id]/route.ts:102`, `apps/web/src/app/api/search/similar/[id]/route.ts:114`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`).
- OG generation endpoints are rate-limited before Satori/Sharp work; the per-photo route keeps post-DB fallback/error paths charged (`apps/web/src/app/api/og/route.tsx:61`, `apps/web/src/app/api/og/route.tsx:80`, `apps/web/src/app/api/og/route.tsx:82`, `apps/web/src/app/api/og/route.tsx:92`, `apps/web/src/app/api/og/photo/[id]/route.tsx:45`, `apps/web/src/app/api/og/photo/[id]/route.tsx:48`, `apps/web/src/app/api/og/photo/[id]/route.tsx:68`, `apps/web/src/app/api/og/photo/[id]/route.tsx:123`, `apps/web/src/app/api/og/photo/[id]/route.tsx:231`).

Upload, file/path, SSRF, and restore handling:

- Browser uploads enforce same-origin/admin before file handling, sanitize user filenames, acquire the upload-processing contract lock, and claim quota synchronously before awaited disk/topic work (`apps/web/src/app/actions/images.ts:128`, `apps/web/src/app/actions/images.ts:135`, `apps/web/src/app/actions/images.ts:137`, `apps/web/src/app/actions/images.ts:180`, `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:205`, `apps/web/src/app/actions/images.ts:218`, `apps/web/src/app/actions/images.ts:252`).
- Lightroom/API uploads run under `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, reject chunked or missing/oversized bodies before multipart parsing, serialize multipart parsing, validate filenames and topics, and share the upload contract lock (`apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:109`, `apps/web/src/app/api/admin/lr/upload/route.ts:117`, `apps/web/src/app/api/admin/lr/upload/route.ts:123`, `apps/web/src/app/api/admin/lr/upload/route.ts:152`, `apps/web/src/app/api/admin/lr/upload/route.ts:180`, `apps/web/src/app/api/admin/lr/upload/route.ts:209`, `apps/web/src/app/api/admin/lr/upload/route.ts:215`, `apps/web/src/app/api/admin/lr/upload/route.ts:279`).
- Public upload serving only allows derivative directories, enforces extension-to-directory consistency, validates safe path segments, rejects symlinks, verifies realpath containment, serves from an opened descriptor, and applies nosniff/cache/ETag headers (`apps/web/src/lib/serve-upload.ts:132`, `apps/web/src/lib/serve-upload.ts:136`, `apps/web/src/lib/serve-upload.ts:143`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:185`, `apps/web/src/lib/serve-upload.ts:189`, `apps/web/src/lib/serve-upload.ts:197`, `apps/web/src/lib/serve-upload.ts:228`, `apps/web/src/lib/serve-upload.ts:257`, `apps/web/src/lib/serve-upload.ts:281`).
- Original upload resolution/deletion is constrained to safe basenames, private roots, symlink rejection, and realpath containment (`apps/web/src/lib/upload-paths.ts:49`, `apps/web/src/lib/upload-paths.ts:68`, `apps/web/src/lib/upload-paths.ts:81`, `apps/web/src/lib/upload-paths.ts:120`, `apps/web/src/lib/upload-paths.ts:139`, `apps/web/src/lib/upload-paths.ts:147`, `apps/web/src/lib/upload-paths.ts:160`, `apps/web/src/lib/upload-paths.ts:165`).
- Per-photo OG internal derivative fetches are pinned to `BASE_URL`/canonical origin rather than inbound Host, and each candidate fetch has timeout and byte caps (`apps/web/src/app/api/og/photo/[id]/route.tsx:97`, `apps/web/src/app/api/og/photo/[id]/route.tsx:109`, `apps/web/src/app/api/og/photo/[id]/route.tsx:111`, `apps/web/src/app/api/og/photo/[id]/route.tsx:116`, `apps/web/src/lib/og-photo-fetch.ts:30`, `apps/web/src/lib/og-photo-fetch.ts:41`, `apps/web/src/lib/og-photo-fetch.ts:54`, `apps/web/src/lib/og-photo-fetch.ts:70`, `apps/web/src/lib/og-photo-fetch.ts:72`, `apps/web/src/lib/og-photo-fetch.ts:81`, `apps/web/src/lib/og-photo-fetch.ts:85`).
- Backup creation/download remains same-origin/admin gated; backup files are written under `data/backups` with private directory/file modes and downloaded through validated filename plus realpath containment (`apps/web/src/app/[locale]/admin/db-actions.ts:164`, `apps/web/src/app/[locale]/admin/db-actions.ts:170`, `apps/web/src/app/[locale]/admin/db-actions.ts:173`, `apps/web/src/app/[locale]/admin/db-actions.ts:185`, `apps/web/src/app/[locale]/admin/db-actions.ts:192`, `apps/web/src/app/[locale]/admin/db-actions.ts:230`, `apps/web/src/app/api/admin/db/download/route.ts:21`, `apps/web/src/app/api/admin/db/download/route.ts:23`, `apps/web/src/app/api/admin/db/download/route.ts:31`, `apps/web/src/app/api/admin/db/download/route.ts:51`, `apps/web/src/app/api/admin/db/download/route.ts:58`, `apps/web/src/app/api/admin/db/download/route.ts:81`).
- Restore is same-origin/admin gated, holds the DB restore/upload/backfill advisory locks, enters durable maintenance, streams the dump to a random temp file with mode `0600`, scans chunks for disallowed SQL, uses `mysql --one-database`, and redacts MySQL stderr (`apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:368`, `apps/web/src/app/[locale]/admin/db-actions.ts:370`, `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:582`, `apps/web/src/app/[locale]/admin/db-actions.ts:591`, `apps/web/src/app/[locale]/admin/db-actions.ts:636`, `apps/web/src/app/[locale]/admin/db-actions.ts:674`, `apps/web/src/app/[locale]/admin/db-actions.ts:715`).
- The SQL restore scanner blocks schema-qualified writes, writes to non-app tables, and dangerous MySQL primitives while masking only known app-backup `DROP TABLE IF EXISTS` statements (`apps/web/src/lib/sql-restore-scan.ts:12`, `apps/web/src/lib/sql-restore-scan.ts:35`, `apps/web/src/lib/sql-restore-scan.ts:39`, `apps/web/src/lib/sql-restore-scan.ts:61`, `apps/web/src/lib/sql-restore-scan.ts:137`, `apps/web/src/lib/sql-restore-scan.ts:210`, `apps/web/src/lib/sql-restore-scan.ts:242`).

Privacy, secrets, and deployment/security docs:

- Public semantic/similar result enrichment uses one compile-time guarded select shape that omits privacy-sensitive image columns (`apps/web/src/lib/search-enrichment-fields.ts:29`, `apps/web/src/lib/search-enrichment-fields.ts:43`, `apps/web/src/app/api/search/semantic/route.ts:324`, `apps/web/src/app/api/search/similar/[id]/route.ts:228`).
- Privacy tests still enforce the sensitive-key contract, public-select omission, exact admin-only difference, timeline public-shape omission, and search-enrichment omission (`apps/web/src/__tests__/privacy-fields.test.ts:7`, `apps/web/src/__tests__/privacy-fields.test.ts:60`, `apps/web/src/__tests__/privacy-fields.test.ts:86`, `apps/web/src/__tests__/privacy-fields.test.ts:104`, `apps/web/src/__tests__/privacy-fields.test.ts:126`).
- Deployment headers/body limits align with the documented posture: nginx sets nosniff/frame/referrer/permissions/HSTS headers, keeps default body size at 2 MiB, grants larger budgets only to admin DB, dashboard upload, and LR upload paths, blocks `/uploads/original/`, and forwards controlled proxy headers (`apps/web/nginx/default.conf:31`, `apps/web/nginx/default.conf:49`, `apps/web/nginx/default.conf:55`, `apps/web/nginx/default.conf:76`, `apps/web/nginx/default.conf:93`, `apps/web/nginx/default.conf:133`, `apps/web/nginx/default.conf:150`, `apps/web/nginx/default.conf:165`, `apps/web/nginx/default.conf:174`).
- Next headers add nosniff/frame/referrer/permissions/HSTS outside development, and the build image remote pattern is derived from the validated `IMAGE_BASE_URL` parser (`apps/web/next.config.ts:4`, `apps/web/next.config.ts:8`, `apps/web/next.config.ts:51`, `apps/web/next.config.ts:75`, `apps/web/next.config.ts:77`, `apps/web/next.config.ts:86`, `apps/web/next.config.ts:102`, `apps/web/next.config.ts:105`).
- A narrowed tracked-source secret regex pass outside `.context/**` found only documented placeholders and historical plan text; no private keys, PAT literals, cloud API keys, or non-placeholder credential assignments were found in active source.

## Validation

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --omit=dev --workspace=apps/web --json` - 0 production vulnerabilities reported.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts` - 2 files, 10 tests passed.
- `npm test --workspace=apps/web -- --run src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/map-privacy.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/admin-tokens.test.ts` - 7 files, 199 tests passed.

Non-test checks:

- `git rev-parse HEAD` returned `d6c3a8f69911c84a63985a59827d4597def922d4`.
- `find . -maxdepth 3 \( -name AGENTS.md -o -name CLAUDE.md -o -name CONTRIBUTING.md -o -name .cursorrules \) -print` found only `./AGENTS.md` and `./CLAUDE.md`.

## Historical Items Not Re-raised

- Cycle 36 deferred items were performance, accessibility/UX, and i18n polish. I found no evidence changing those into security issues for Cycle 37.
- The authenticated LR upload multipart buffering concern remains covered by older deferral context and was not re-raised: current code still has PAT/session auth, edge/app body caps, a per-process parse slot, declared and actual file-size checks, and upload quota tracking.
- Gitignored runtime secrets and production host state remain outside this read-only source review. Existing tracked docs already state that old checked-in example secrets must be treated as compromised and rotated.

## Final Sweep Note

Commonly missed areas checked this cycle: scanner fail-open regressions after Cycle 36, scoped PAT owner validation, same-origin dominance before auth reads/mutations, public expensive GET rate limiting, semantic-search result privacy, OG SSRF host pinning, backup/download path traversal, SQL restore primitives, upload original/derivative containment, tracked secret patterns, production dependency vulnerabilities, and nginx/Next security-header/body-limit drift.

Stop condition: current HEAD matched the requested commit, relevant tracked security surfaces were inventoried and reviewed, focused security gates/tests/audit passed, and no fresh actionable issue remained to file.
