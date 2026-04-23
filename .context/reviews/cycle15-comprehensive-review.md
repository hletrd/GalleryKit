# Comprehensive Code Review — Cycle 15 (2026-04-19)

**Reviewer:** Multi-angle deep review (code quality, security, performance, i18n, architecture, data integrity)
**Scope:** Full repository — all server actions, data layer, middleware, UI components, security modules, i18n, image processing pipeline, API routes

---

## Methodology

Every source file under `apps/web/src/` was examined, including:
- All 7 server action modules (`actions/*.ts`)
- Data layer (`lib/data.ts`), schema (`db/schema.ts`)
- Security modules (`session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `validation.ts`, `sql-restore-scan.ts`, `serve-upload.ts`, `api-auth.ts`)
- Image processing pipeline (`process-image.ts`, `image-queue.ts`, `process-topic-image.ts`)
- All React components and page routes
- All unit test files
- i18n message files (`en.json`, `ko.json`)
- Middleware (`proxy.ts`), admin DB actions, instrumentation
- All public pages (home, topic, shared group, shared photo, photo viewer)
- All `generateMetadata` functions for i18n coverage
- API routes (OG image, health, DB download)
- Utility modules (base56, revalidation, audit, upload-limits, queue-shutdown, image-url, safe-json-ld, locale-path)

Previous cycle findings (C1 through C14) were checked for regressions — none found. All deferred items were reviewed for relevance. Prior C15 findings (C15-01, C15-02, C15-03 about hardcoded English metadata strings) were verified as already fixed.

---

## Findings

No new findings this cycle.

---

## Previously Fixed — Confirmed Resolved in This Cycle

All cycle 1-14 findings verified as resolved. Key items specifically re-verified:

- C14-01 (tags={[]} on photo page): Confirmed — `p/[id]/page.tsx:210` now passes `tags={image.tags ?? []}`
- C15-01/C15-02/C15-03 (hardcoded English metadata strings): Confirmed fixed — all `generateMetadata` functions now use `getTranslations` with proper namespace keys. Verified by grep: no matches for `'Photo Not Found'`, `'Untitled'`, `'Not Found'`, `'Shared Photo'`, `'does not exist'`, `'Browse.*photos'`, `'Latest Photo'`, or `'Home'` in page metadata.
- Download route (`api/admin/db/download/route.ts`): Confirmed secure — `SAFE_FILENAME` regex validation + containment check + symlink rejection + admin auth wrapper
- All earlier fixes (C1 through C13) remain intact with no regressions

---

## Areas Reviewed With No New Issues Found

- **Session management** (`session.ts`): HMAC-SHA256 signing, timing-safe comparison, 24-hour expiry, production-only SESSION_SECRET enforcement
- **Path traversal prevention** (`serve-upload.ts`, `validation.ts`, download route): SAFE_SEGMENT regex, ALLOWED_UPLOAD_DIRS whitelist, containment checks, symlink rejection
- **SQL injection prevention** (`sql-restore-scan.ts`): Dangerous SQL pattern scanning with conditional comment handling
- **Rate limiting**: Login/password change have pre-increment + rollback; search has rollback on DB failure; share uses synchronous safe pattern
- **Image processing pipeline**: Sharp limitInputPixels, ICC bounds checking, queue claim mechanism, orphaned file cleanup, output format verification
- **Safe JSON-LD**: `<` escaped to `\u003c` preventing XSS
- **Data privacy**: GPS coordinates excluded from public API, filename_original excluded, compile-time privacy guard on selectFields
- **CSV injection prevention**: Formula character prefix, CR/LF stripping
- **Argon2 timing-safe user enumeration**: Dummy hash for non-existent users
- **Upload tracker**: Pre-increment + post-adjust pattern, hard cap on keys, re-read from Map before adjustment
- **View count buffering**: Hard cap, re-buffer on failure, graceful shutdown flush, exponential backoff
- **Admin auth guard**: Cookie format check before redirect, every server action independently verifies auth
- **DB backup security**: Advisory lock on dedicated connection, SQL scanning, writeStream error detection
- **Schema design**: Composite indexes well-aligned with query patterns
- **Tag operations**: Slug collision detection, batch operations with proper validation, `INSERT IGNORE` + re-fetch for concurrency
- **Admin user management**: Last-admin deletion prevention, self-deletion prevention, session cleanup
- **Shared pages**: Both `/s/[key]` and `/g/[key]` correctly pass tags, use localized metadata
- **Middleware**: Protected admin route guard with cookie format validation
- **Base56**: Proper rejection sampling to avoid modulo bias
- **Process topic image**: Temp file with mode 0o600, separate pixel limit, extension validation
- **OG image route**: Input length validation, tag list capping
- **Health endpoint**: Minimal DB connectivity disclosure (deferred, no change)
- **DB connection pool**: TLS enforcement for non-localhost, connection limit, keepalive
- **API auth wrapper**: `withAdminAuth` used on all `/api/admin/*` routes
- **Upload limits**: Configurable via env var, proper body size limit
- **Queue shutdown**: Graceful drain with pause/clear/onPendingZero

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-14 remain deferred with no change in status:

1. C32-03: Insertion-order eviction in Maps [LOW]
2. C32-04 / C30-08: Health endpoint DB disclosure [LOW]
3. C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap [LOW]
4. C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit [LOW]
5. C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion [LOW]
6. C30-06: Tag slug regex inconsistency [LOW]
7. Font subsetting (Python brotli dependency)
8. Docker node_modules removal (native module bundling)
9. C5-05 original_file_size from client value [LOW]
10. C5-07 prunePasswordChangeRateLimit infrequent pruning [LOW]
11. C5-08 dumpDatabase partial file cleanup race [LOW]
12. C6-10 queue bootstrap unbounded fetch [LOW]
13. C7-07 NULL capture_date prev/next navigation [LOW]
14. C7-08 rate limit inconsistency in safe direction [LOW]
15. C8-04 searchImages query length guard [LOW]
16. C8-05 audit log on race-deleted image [LOW]
17. C8-10 batchUpdateImageTags added count accuracy [LOW]
18. C13-03 CSV export column headers hardcoded in English [LOW]
19. C14-02 share rate limit pattern inconsistent [LOW]

---

## TOTALS

- **0 MEDIUM** findings
- **0 CRITICAL/HIGH** findings
- **0 total** actionable findings

Clean cycle — the codebase is in strong shape after 14+ prior cycles of fixes. No regressions detected, all previously identified issues remain resolved.
