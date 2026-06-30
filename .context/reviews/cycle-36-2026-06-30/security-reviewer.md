# Cycle 36 Security Review

Date: 2026-06-30
Lane: security-reviewer
Scope: authentication/authz, route guards, server actions, public API rate limits, file handling, upload/restore safety, privacy field boundaries, secrets, SSRF/path traversal, and scanner coverage.

## Result

No new actionable security findings were identified in this cycle.

Confidence: high for the reviewed source and tracked-file surfaces. I did not inspect gitignored runtime secret files or production host state; that remains an operator boundary and has already been tracked historically.

## Inventory

Admin API route handlers:
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`

Public API and route handlers:
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`

Server-action modules:
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/collections.ts`
- `apps/web/src/app/actions/embeddings.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`

Security scanner coverage reviewed:
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/tracked-secrets.test.ts`

## Findings

None.

## Reviewed Evidence

Authentication and authorization:
- Admin API exports are expected to wrap handlers through `withAdminAuth`; the scanner recursively discovers admin route files and fails if a route does not export a directly wrapped HTTP handler (`apps/web/scripts/check-api-auth.ts:1`, `apps/web/scripts/check-api-auth.ts:30`, `apps/web/scripts/check-api-auth.ts:107`, `apps/web/scripts/check-api-auth.ts:160`).
- `withAdminAuth` handles scoped PAT uploads before cookie auth, rate-limits token auth attempts, checks token scope, stores token context for the handler, and adds no-store/nosniff response headers (`apps/web/src/lib/api-auth.ts:72`, `apps/web/src/lib/api-auth.ts:76`, `apps/web/src/lib/api-auth.ts:82`, `apps/web/src/lib/api-auth.ts:83`, `apps/web/src/lib/api-auth.ts:98`, `apps/web/src/lib/api-auth.ts:102`).
- Cookie-backed admin API access fails closed on same-origin validation before `isAdmin()` and also adds no-store/nosniff on successful admin responses (`apps/web/src/lib/api-auth.ts:114`, `apps/web/src/lib/api-auth.ts:116`, `apps/web/src/lib/api-auth.ts:123`, `apps/web/src/lib/api-auth.ts:135`, `apps/web/src/lib/api-auth.ts:139`).
- Login checks same-origin before consuming account/IP rate-limit budget and before password verification; both IP and account buckets are incremented before Argon2 work (`apps/web/src/app/actions/auth.ts:98`, `apps/web/src/app/actions/auth.ts:99`, `apps/web/src/app/actions/auth.ts:120`, `apps/web/src/app/actions/auth.ts:131`, `apps/web/src/app/actions/auth.ts:135`, `apps/web/src/app/actions/auth.ts:140`).
- Login avoids timing user enumeration with a dummy Argon2 hash for missing users and creates the new session plus old-session invalidation inside one transaction (`apps/web/src/app/actions/auth.ts:179`, `apps/web/src/app/actions/auth.ts:181`, `apps/web/src/app/actions/auth.ts:217`, `apps/web/src/app/actions/auth.ts:225`).
- Session signing refuses production fallback without a strong `SESSION_SECRET`, verifies HMAC with `timingSafeEqual`, validates token shape after crypto verification, and checks both token age and DB session expiry (`apps/web/src/lib/session.ts:20`, `apps/web/src/lib/session.ts:30`, `apps/web/src/lib/session.ts:82`, `apps/web/src/lib/session.ts:117`, `apps/web/src/lib/session.ts:121`, `apps/web/src/lib/session.ts:127`, `apps/web/src/lib/session.ts:145`).
- Origin checks fail closed by default and only trust right-most forwarded headers when `TRUST_PROXY=true` (`apps/web/src/lib/request-origin.ts:5`, `apps/web/src/lib/request-origin.ts:19`, `apps/web/src/lib/request-origin.ts:46`, `apps/web/src/lib/request-origin.ts:58`, `apps/web/src/lib/request-origin.ts:87`, `apps/web/src/lib/request-origin.ts:106`).

Server actions and public rate limits:
- The server-action scanner recursively discovers `app/actions/**`, includes the out-of-tree admin DB actions file, and requires an approved `requireSameOriginAdmin` guard shape unless an explicit exemption is present (`apps/web/scripts/check-action-origin.ts:13`, `apps/web/scripts/check-action-origin.ts:56`, `apps/web/scripts/check-action-origin.ts:84`, `apps/web/scripts/check-action-origin.ts:101`, `apps/web/scripts/check-action-origin.ts:113`).
- The public route scanner covers route files outside admin paths, treats mutating handlers and expensive GET handlers as requiring approved rate-limit helpers, and rejects local/noop helper lookalikes by checking import provenance (`apps/web/scripts/check-public-route-rate-limit.ts:1`, `apps/web/scripts/check-public-route-rate-limit.ts:37`, `apps/web/scripts/check-public-route-rate-limit.ts:43`, `apps/web/scripts/check-public-route-rate-limit.ts:77`, `apps/web/scripts/check-public-route-rate-limit.ts:91`, `apps/web/scripts/check-public-route-rate-limit.ts:124`).
- Public load-more/search server actions validate inputs before DB work and apply rate limiting with rollback only on pre-expensive-work error paths (`apps/web/src/app/actions/public.ts:121`, `apps/web/src/app/actions/public.ts:135`, `apps/web/src/app/actions/public.ts:146`, `apps/web/src/app/actions/public.ts:159`, `apps/web/src/app/actions/public.ts:236`, `apps/web/src/app/actions/public.ts:253`, `apps/web/src/app/actions/public.ts:268`, `apps/web/src/app/actions/public.ts:292`, `apps/web/src/app/actions/public.ts:308`).
- Public share pages do not perform share-key lookups from `generateMetadata`; the page body validates Base56 keys, rate-limits enumeration-sensitive lookups, and returns generic/noindex metadata (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:21`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:44`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:49`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:90`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:98`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:106`).
- Shared group pages follow the same no-lookup metadata and rate-limited body lookup pattern, with positive integer parsing for optional `photoId` (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:49`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:54`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:96`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:104`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:109`).
- Semantic search requires same-origin, JSON content type, non-chunked bodies, finite `Content-Length` under 8192 bytes, and pre-increments the semantic limiter before config/database/embedding work (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:124`, `apps/web/src/app/api/search/semantic/route.ts:136`, `apps/web/src/app/api/search/semantic/route.ts:147`, `apps/web/src/app/api/search/semantic/route.ts:162`, `apps/web/src/app/api/search/semantic/route.ts:173`, `apps/web/src/app/api/search/semantic/route.ts:178`).
- Similar-image search is same-origin, validates the image id before work, pre-increments the semantic limiter, and serves only production semantic mode (`apps/web/src/app/api/search/similar/[id]/route.ts:72`, `apps/web/src/app/api/search/similar/[id]/route.ts:86`, `apps/web/src/app/api/search/similar/[id]/route.ts:98`, `apps/web/src/app/api/search/similar/[id]/route.ts:102`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`).
- OG routes rate-limit CPU/image work before DB/Satori/Sharp work and charge post-DB not-found/fallback paths (`apps/web/src/app/api/og/route.tsx:67`, `apps/web/src/app/api/og/route.tsx:80`, `apps/web/src/app/api/og/route.tsx:82`, `apps/web/src/app/api/og/route.tsx:92`, `apps/web/src/app/api/og/photo/[id]/route.tsx:45`, `apps/web/src/app/api/og/photo/[id]/route.tsx:48`, `apps/web/src/app/api/og/photo/[id]/route.tsx:68`).

File handling, path traversal, upload, and SSRF:
- Public upload serving validates allowed top-level directories, extension-to-directory consistency, safe path segments, realpath containment, symlink rejection, file type, ETag/cache handling, and stream cleanup from an already-open file descriptor (`apps/web/src/lib/serve-upload.ts:132`, `apps/web/src/lib/serve-upload.ts:136`, `apps/web/src/lib/serve-upload.ts:141`, `apps/web/src/lib/serve-upload.ts:153`, `apps/web/src/lib/serve-upload.ts:175`, `apps/web/src/lib/serve-upload.ts:181`, `apps/web/src/lib/serve-upload.ts:185`, `apps/web/src/lib/serve-upload.ts:189`, `apps/web/src/lib/serve-upload.ts:197`).
- Original uploads are stored under an owner-only private directory; original file resolution requires a valid basename, rejects absolute paths, rejects symlinks, and verifies realpath containment (`apps/web/src/lib/upload-paths.ts:49`, `apps/web/src/lib/upload-paths.ts:59`, `apps/web/src/lib/upload-paths.ts:120`, `apps/web/src/lib/upload-paths.ts:139`, `apps/web/src/lib/upload-paths.ts:147`, `apps/web/src/lib/upload-paths.ts:160`, `apps/web/src/lib/upload-paths.ts:165`, `apps/web/src/lib/upload-paths.ts:173`).
- Browser uploads require same-origin/admin, validate user filenames before storage, acquire the upload-processing contract lock, and claim upload quota before the first awaited disk/topic work after synchronous quota checks (`apps/web/src/app/actions/images.ts:128`, `apps/web/src/app/actions/images.ts:135`, `apps/web/src/app/actions/images.ts:137`, `apps/web/src/app/actions/images.ts:180`, `apps/web/src/app/actions/images.ts:191`, `apps/web/src/app/actions/images.ts:212`, `apps/web/src/app/actions/images.ts:225`, `apps/web/src/app/actions/images.ts:232`).
- Lightroom API uploads run inside `withAdminAuth(..., { allowTokenScope: 'lr:upload' })`, reject chunked/missing `Content-Length`, enforce declared and actual size caps, serialize multipart parsing, validate user filenames, and validate topic slugs before DB writes (`apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:101`, `apps/web/src/app/api/admin/lr/upload/route.ts:109`, `apps/web/src/app/api/admin/lr/upload/route.ts:117`, `apps/web/src/app/api/admin/lr/upload/route.ts:152`, `apps/web/src/app/api/admin/lr/upload/route.ts:178`, `apps/web/src/app/api/admin/lr/upload/route.ts:209`, `apps/web/src/app/api/admin/lr/upload/route.ts:215`).
- Per-photo OG internal fetches are pinned to the canonical `BASE_URL` origin rather than inbound request origin, fail closed if canonical origin is invalid, and enforce per-fetch and total timeout/byte budgets (`apps/web/src/app/api/og/photo/[id]/route.tsx:97`, `apps/web/src/app/api/og/photo/[id]/route.tsx:109`, `apps/web/src/app/api/og/photo/[id]/route.tsx:111`, `apps/web/src/app/api/og/photo/[id]/route.tsx:113`, `apps/web/src/lib/og-photo-fetch.ts:30`, `apps/web/src/lib/og-photo-fetch.ts:41`, `apps/web/src/lib/og-photo-fetch.ts:54`, `apps/web/src/lib/og-photo-fetch.ts:70`, `apps/web/src/lib/og-photo-fetch.ts:81`, `apps/web/src/lib/og-photo-fetch.ts:85`).

Backup and restore:
- Backup export requires same-origin/admin, requires DB env configuration, creates `data/backups` with mode `0700`, obtains the restore advisory lock, and avoids putting MySQL credentials on CLI argv (`apps/web/src/app/[locale]/admin/db-actions.ts:164`, `apps/web/src/app/[locale]/admin/db-actions.ts:170`, `apps/web/src/app/[locale]/admin/db-actions.ts:173`, `apps/web/src/app/[locale]/admin/db-actions.ts:177`, `apps/web/src/app/[locale]/admin/db-actions.ts:192`, `apps/web/src/app/[locale]/admin/db-actions.ts:202`, `apps/web/src/app/[locale]/admin/db-actions.ts:215`).
- Backup download is admin-authenticated, validates backup filenames, performs path and realpath containment checks, streams from the validated descriptor, and sets attachment/no-store/nosniff headers (`apps/web/src/app/api/admin/db/download/route.ts:21`, `apps/web/src/app/api/admin/db/download/route.ts:23`, `apps/web/src/app/api/admin/db/download/route.ts:31`, `apps/web/src/app/api/admin/db/download/route.ts:35`, `apps/web/src/app/api/admin/db/download/route.ts:45`, `apps/web/src/app/api/admin/db/download/route.ts:51`, `apps/web/src/app/api/admin/db/download/route.ts:75`, `apps/web/src/app/api/admin/db/download/route.ts:81`).
- Restore requires same-origin/admin, uses a dedicated connection for advisory locks, holds the DB restore, upload-processing, color backfill, and semantic backfill locks, enters durable restore maintenance, flushes/quiesces/drains background work, and resumes/clears state in `finally` paths (`apps/web/src/app/[locale]/admin/db-actions.ts:365`, `apps/web/src/app/[locale]/admin/db-actions.ts:367`, `apps/web/src/app/[locale]/admin/db-actions.ts:370`, `apps/web/src/app/[locale]/admin/db-actions.ts:374`, `apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:494`, `apps/web/src/app/[locale]/admin/db-actions.ts:503`, `apps/web/src/app/[locale]/admin/db-actions.ts:508`).
- Restore upload streaming writes to a random temp path with mode `0600`, checks plausible dump headers, scans chunks with a 1 MiB carry tail, invokes `mysql --one-database`, uses environment variables instead of CLI password flags, redacts stderr, and deletes temp files on failure/success paths (`apps/web/src/app/[locale]/admin/db-actions.ts:577`, `apps/web/src/app/[locale]/admin/db-actions.ts:582`, `apps/web/src/app/[locale]/admin/db-actions.ts:591`, `apps/web/src/app/[locale]/admin/db-actions.ts:613`, `apps/web/src/app/[locale]/admin/db-actions.ts:636`, `apps/web/src/app/[locale]/admin/db-actions.ts:646`, `apps/web/src/app/[locale]/admin/db-actions.ts:674`, `apps/web/src/app/[locale]/admin/db-actions.ts:679`, `apps/web/src/app/[locale]/admin/db-actions.ts:715`, `apps/web/src/app/[locale]/admin/db-actions.ts:722`).
- The SQL restore scanner allows only known app backup table drops, blocks schema-qualified writes and writes to non-app tables, extracts executable MySQL conditional comments before scanning, and blocks high-risk SQL primitives such as grants, user changes, database/table drops, data exfiltration, routines/triggers/events/views, `SQL SECURITY DEFINER`, prepared execution, and global mutation (`apps/web/src/lib/sql-restore-scan.ts:12`, `apps/web/src/lib/sql-restore-scan.ts:35`, `apps/web/src/lib/sql-restore-scan.ts:39`, `apps/web/src/lib/sql-restore-scan.ts:44`, `apps/web/src/lib/sql-restore-scan.ts:61`, `apps/web/src/lib/sql-restore-scan.ts:101`, `apps/web/src/lib/sql-restore-scan.ts:107`, `apps/web/src/lib/sql-restore-scan.ts:117`, `apps/web/src/lib/sql-restore-scan.ts:121`, `apps/web/src/lib/sql-restore-scan.ts:137`, `apps/web/src/lib/sql-restore-scan.ts:210`, `apps/web/src/lib/sql-restore-scan.ts:242`).

Privacy boundaries and secrets:
- Public image selects are derived by explicitly omitting sensitive/admin-only columns, while public map selects are the only anonymous select shape allowed to include latitude/longitude and carry their own compile-time guard (`apps/web/src/lib/data.ts:368`, `apps/web/src/lib/data.ts:375`, `apps/web/src/lib/data.ts:406`, `apps/web/src/lib/data.ts:410`, `apps/web/src/lib/data.ts:443`, `apps/web/src/lib/data.ts:459`, `apps/web/src/lib/data.ts:473`, `apps/web/src/lib/data.ts:486`).
- The public map page passes only marker fields after `getMapImages()`, which is the documented map-visible data-access path (`apps/web/src/app/[locale]/(public)/map/page.tsx:41`, `apps/web/src/app/[locale]/(public)/map/page.tsx:48`, `apps/web/src/app/[locale]/(public)/map/page.tsx:53`).
- Semantic and similar search enrichment share one compile-time guarded public select shape, preventing privacy-sensitive image columns from being added without a type error (`apps/web/src/lib/search-enrichment-fields.ts:29`, `apps/web/src/lib/search-enrichment-fields.ts:43`, `apps/web/src/app/api/search/semantic/route.ts:324`, `apps/web/src/app/api/search/similar/[id]/route.ts:228`).
- Privacy tests assert sensitive keys exist in the admin/schema contract, are absent from public selects, form the exact admin-only difference, and are absent from timeline/search enrichment shapes (`apps/web/src/__tests__/privacy-fields.test.ts:7`, `apps/web/src/__tests__/privacy-fields.test.ts:47`, `apps/web/src/__tests__/privacy-fields.test.ts:60`, `apps/web/src/__tests__/privacy-fields.test.ts:86`, `apps/web/src/__tests__/privacy-fields.test.ts:104`, `apps/web/src/__tests__/privacy-fields.test.ts:126`).
- Tracked secret hygiene test scans tracked text files for literal credential assignments and allows only placeholder/redacted/template values (`apps/web/src/__tests__/tracked-secrets.test.ts:7`, `apps/web/src/__tests__/tracked-secrets.test.ts:8`, `apps/web/src/__tests__/tracked-secrets.test.ts:33`, `apps/web/src/__tests__/tracked-secrets.test.ts:48`, `apps/web/src/__tests__/tracked-secrets.test.ts:57`).

## Validation

Passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --omit=dev --workspace=apps/web --json` - 0 production vulnerabilities reported.
- `npm test --workspace=apps/web -- tracked-secrets.test.ts privacy-fields.test.ts` - 2 files, 10 tests passed.
- `npm test --workspace=apps/web -- check-api-auth.test.ts check-action-origin.test.ts check-public-route-rate-limit.test.ts search-route-privacy.test.ts map-privacy.test.ts` - 5 files, 133 tests passed.

Tracked secret scan:
- A narrowed tracked-source scan outside `.context/**` and `plan/**` found only deterministic CI/test placeholders in `.github/workflows/quality.yml`.
- A second narrowed scan for private keys, AWS keys, OpenAI keys, Google API keys, and GalleryKit token literals found no matches.

## Historical Items Not Re-raised

- Process-local public/token-spray limits were already deferred as D32-08 under the documented single-instance/single-writer topology (`.context/plans/cycle-32-2026-06-30-deferred.md:60`). I saw no new evidence that the deployed topology changed.
- Restore accepting auth/session/token table state was already deferred as AGG-C33-18 (`.context/plans/cycle-33-2026-06-30-deferred.md:75`). I did not find a new bypass beyond that accepted backup/restore product boundary.
- Gitignored runtime secret files were already called out as not inspected in D28-18 (`.context/plans/cycle-28-2026-06-30-deferred.md:137`). This review covered tracked source and scanner/test coverage, not runtime host files.

## Stop Condition

The requested security surfaces were inventoried, relevant implementation files were reviewed line-by-line, targeted security scanners/tests/audit passed, and no fresh actionable issue remained to file.
