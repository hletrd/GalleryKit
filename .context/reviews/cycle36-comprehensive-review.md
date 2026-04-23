# Cycle 36 Comprehensive Code Review — 2026-04-19

## Reviewer: General-purpose (full codebase sweep)

## Methodology
- Read all server actions, middleware, data layer, image processing pipeline, queue system, auth/session, rate limiting, upload serving, DB schema, admin pages, public pages, API routes
- Cross-referenced with CLAUDE.md documentation
- Checked for regressions from prior cycle fixes (C35-01, C35-04)
- Searched for patterns: notFound(), parseInt, dangerouslySetInnerHTML, TODO/FIXME, empty catches

## Regressions Check
- C35-01 (return before notFound): Verified all 3 locations fixed. All `notFound()` calls now use `return notFound()`.
- C35-04 (photo ID validation in generateMetadata): Verified `/^\d+$/.test(id)` present in `p/[id]/page.tsx:28`.

## Findings

### C36-01: Dashboard page `parseInt` without numeric validation [LOW, Medium Confidence]
**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:10`
**Problem:** `parseInt(pageParam || '1', 10)` is called without first validating `pageParam` is numeric. Unlike the photo page (which now validates with `/^\d+$/`), the dashboard page accepts any string. While `parseInt` returns NaN for non-numeric input and `|| 1` falls back, very large numbers like `999999999999` pass parseInt and could cause excessive offset calculations. The `getImagesLite` function does cap the limit at 100, but offset is unbounded.
**Mitigating factor:** This is an admin-protected page, so the attack surface is limited to authenticated users. The `getImagesLite` limit cap prevents fetching too many rows.
**Concrete scenario:** An admin (or attacker with stolen session) sends `?page=999999999999`, causing `(page - 1) * PAGE_SIZE` = very large offset, which sends a MySQL query with a huge OFFSET. MySQL must scan and discard all preceding rows, consuming CPU and memory.
**Suggested fix:** Add `Math.min(page, 1000)` or similar cap on the page number to prevent extreme offsets. This is defense-in-depth since the page is admin-only.
**Severity:** LOW (admin-only, self-DoS at worst)

### C36-02: `createGroupShareLink` validates `insertId` with `Number.isFinite` but `Number()` can coerce BigInt [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/sharing.ts:166`
**Problem:** `const groupId = Number(result.insertId)` followed by `if (!Number.isFinite(groupId) || groupId <= 0)`. If `insertId` is a BigInt (MySQL auto-increment returns BigInt in some mysql2 configurations), `Number()` silently truncates values > 2^53. For realistic gallery sizes this is not a concern, but the pattern is fragile.
**Mitigating factor:** Real-world gallery databases never approach 2^53 rows. The validation catches NaN/Infinity. This is a theoretical concern only.
**Severity:** LOW (theoretical, extremely unlikely in practice)

### C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit (carry-forward from C30-04) [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:40-46`
**Problem:** When a `db.update` in `flushGroupViewCounts` fails, the count is re-buffered for the next flush. If the DB is persistently down, re-buffered counts accumulate and the buffer never drains. The `MAX_VIEW_COUNT_BUFFER_SIZE` cap prevents unbounded growth, but the re-buffered counts are never discarded even after prolonged DB outage.
**Mitigating factor:** The hard cap of 1000 entries prevents memory explosion. On process restart the buffer is cleared. This is a data-accuracy concern (dropped view counts during extended outages) not a stability concern.
**Severity:** LOW (data accuracy during extended DB outage, not stability)

## No-New-Findings Items
The following areas were thoroughly reviewed and found to be in good shape with no new issues:

- **Authentication & Sessions**: Argon2id hashing, HMAC-SHA256 tokens, timingSafeEqual, session fixation prevention, proper cookie attributes — all solid
- **Rate Limiting**: Pre-increment TOCTOU fix, DB-backed persistence, in-memory fast path, rollback on success/error — all correct
- **Upload Security**: Path traversal prevention, symlink rejection, filename sanitization (UUIDs), decompression bomb mitigation — comprehensive
- **SQL Injection**: All queries via Drizzle ORM (parameterized), LIKE wildcards escaped, SQL restore scanning with dangerous pattern detection
- **Image Processing Queue**: Claim locks, conditional updates, retry limits, orphaned file cleanup, graceful shutdown — robust
- **Data Layer**: React cache() deduplication, Promise.all parallel queries, view count buffering with caps — well-structured
- **Serve Uploads**: Directory whitelist, SAFE_SEGMENT regex, containment check, symlink rejection, no-SVG policy — secure
- **API Routes**: withAdminAuth wrapper on all /api/admin/* routes — correct
- **XSS Prevention**: safeJsonLd escapes `<`, no raw innerHTML with user content
- **i18n**: Proper locale handling, localized path revalidation
- **Audit Logging**: Fire-and-forget with proper try/catch, metadata serialization with size limits

## Deferred Carry-Forward
All previously deferred items remain with no change:
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: passwordChangeRateLimit shares LOGIN_RATE_LIMIT_MAX_KEYS cap
- C30-03: flushGroupViewCounts re-buffers without retry limit (same as C36-03)
- C30-04: createGroupShareLink insertId validation
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
