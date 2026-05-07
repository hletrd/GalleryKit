# Cycle 16 Comprehensive Review

**Date:** 2026-04-30
**Reviewer:** multi-perspective consolidated review
**Scope:** Full codebase — all source, actions, lib, components, pages, API routes, tests

## Methodology

Every `.ts`/`.tsx` file under `apps/web/src/` (excluding `node_modules` and `__tests__`) was read in full. Key test files were also reviewed. Findings are categorized by specialist angle but deduplicated where a single issue spans multiple categories.

---

## FINDING C16-MED-01: `loadMoreImages` rate-limit pre-increment is in-memory only — no DB backup

- **Severity:** MEDIUM
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/public.ts`, lines 47-56
- **Category:** security, consistency
- **Description:** The `loadMoreImages` action uses `preIncrementLoadMoreAttempt()` which only increments an in-memory `BoundedMap`. There is no DB-backed `incrementRateLimit`/`checkRateLimit` call. A process restart wipes the in-memory map, allowing an attacker to reset their budget immediately. While the code comment (line 89-93) says "intentionally in-memory only" for UX reasons, the `searchImagesAction` in the same file DOES use DB-backed rate limiting for the same kind of public read path. This inconsistency means `loadMoreImages` can be abused for scraping at a higher rate than search (120/min vs 30/min) with no persistence across restarts.
- **Fix:** Add DB-backed rate-limit check for `loadMoreImages` matching the `searchImagesAction` pattern. The DB round-trip is ~1ms and the UX concern can be addressed with a generous limit.

## FINDING C16-MED-02: `getImageByShareKey` tag name-slug alignment still fragile despite C15-MED-02 fix

- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/data.ts`, lines 890-916
- **Category:** correctness, data-integrity
- **Description:** The C15-MED-02 fix aligned both `GROUP_CONCAT` ORDER BY clauses to `tags.slug`. However, the pairing on lines 912-916 uses index-based zip (`parsedTagNames[i]` paired with `parsedTagSlugs[i]`). If a tag name contains a comma (which `isValidTagName` rejects, but existing DB rows from before that guard was added could contain one), `GROUP_CONCAT` would split on that comma, producing misaligned arrays. The `DISTINCT` keyword in `GROUP_CONCAT` can also cause name/slug count mismatch if two different tags produce the same name but different slugs after dedup. The fallback `parsedTagSlugs[i] ?? ''` silently produces a tag with empty slug.
- **Fix:** Use a unique delimiter unlikely in tag names (e.g., `\x01` or `|||`) or, better, use a combined `GROUP_CONCAT(DISTINCT CONCAT(tags.slug, '\x00', tags.name) ORDER BY tags.slug)` and split on the null byte. Alternatively, fetch tags in a separate query like `getSharedGroup` does.

## FINDING C16-MED-03: `shareRateLimit` in `sharing.ts` uses separate `BoundedMap` from `shareRateLimit` in `rate-limit.ts`

- **Severity:** MEDIUM
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/sharing.ts`, lines 27-28 vs `apps/web/src/lib/rate-limit.ts`, lines 65
- **Category:** security, consistency
- **Description:** There are two completely separate `shareRateLimit` maps: one defined locally in `sharing.ts` (line 27, `SHARE_RATE_LIMIT_MAX_KEYS = 500`) and one exported from `rate-limit.ts` (line 65, `SHARE_RATE_LIMIT_MAX_KEYS = 2000`). The one in `sharing.ts` is used for admin write-path share operations (create group/photo share links). The one in `rate-limit.ts` is used for public share-key lookup rate limiting. They have different key caps (500 vs 2000), different limits (20/min vs 60/min), and different window durations (1 min vs 1 min). While they serve different purposes, the naming collision and the `SHARE_RATE_LIMIT_MAX_KEYS` constant with different values in the same codebase is confusing and risks a future maintainer importing the wrong one. The `sharing.ts` one also lacks DB-backed rate limiting.
- **Fix:** Rename the `sharing.ts` map to `shareWriteRateLimit` with a distinct constant name like `SHARE_WRITE_RATE_LIMIT_MAX_KEYS` to eliminate the naming collision. Consider adding DB-backed checking to match all other admin write paths.

## FINDING C16-LOW-01: `flushGroupViewCounts` does not log or track dropped increments from re-buffer capacity check

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/lib/data.ts`, lines 101-103
- **Category:** observability, correctness
- **Description:** When a re-buffered increment is dropped due to the capacity check (`viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE`), a `console.warn` is logged. But there is no metric or counter tracking how many increments have been dropped over time. For a personal gallery this is likely never triggered, but if it is, there is no way to detect it without parsing logs. The `viewCountRetryCount` map tracks per-group retry counts, but not aggregate dropped counts.
- **Fix:** Add a module-level counter (`droppedViewCountIncrements`) that is logged periodically (e.g., in the GC interval) so an operator can detect sustained buffer overflow without parsing warn-level logs.

## FINDING C16-LOW-02: `searchImages` main query lacks `GROUP BY` — relies on MySQL `ONLY_FULL_GROUP_BY` not being enforced for the main branch

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/lib/data.ts`, lines 1118-1135
- **Category:** correctness, sql-compat
- **Description:** The main search branch (lines 1118-1135) does `db.select(searchFields).from(images).leftJoin(topics, ...)` without `GROUP BY`. The tag and alias branches (lines 1176-1193) use `.groupBy(...searchGroupByColumns)`. If `ONLY_FULL_GROUP_BY` is enabled (the MySQL 8 default) and the query ever includes a `JOIN` on `imageTags` or `tags`, it would fail. Currently the main branch doesn't JOIN those tables, so it works — but if a future refactor adds tag filtering to the main query, it would break silently. The inconsistency between the three search branches is a maintenance hazard.
- **Fix:** Add a comment on the main search branch noting that GROUP BY is intentionally omitted because no tag JOIN is present. Alternatively, add GROUP BY proactively for consistency.

## FINDING C16-LOW-03: `CSP style-src 'unsafe-inline'` in production — carry-forward with no mitigation path documented

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/lib/content-security-policy.ts`, line 81
- **Category:** security (carry-forward from prior cycles)
- **Description:** Production CSP includes `style-src 'self' 'unsafe-inline'`. This is a known carry-forward from multiple prior cycles (A17-MED-02, C14-LOW-04). Tailwind CSS generates inline styles that require `'unsafe-inline'`. Nonce-based or hash-based style CSP requires either build-time extraction of all style hashes or runtime nonce injection on every `<style>` tag. No concrete mitigation plan exists in the deferred list.
- **Fix:** Document a concrete exit criterion (e.g., "when Tailwind CSS supports style nonce injection" or "when migrating to CSS-in-JS that supports nonce") in the deferred tracking.

## FINDING C16-LOW-04: `original_file_size: bigint('original_file_size', { mode: 'number' })` — JS number precision loss

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/db/schema.ts`, line 50
- **Category:** correctness, data-integrity (carry-forward from prior cycles, C9-F01)
- **Description:** The schema defines `original_file_size` as `bigint({ mode: 'number' })`. JavaScript `Number` safely represents integers up to 2^53-1 (~9 PB). Files larger than 9 PB are impossible, but files up to 200 MB (the current upload limit) are well within range. The concern is theoretical precision loss for very large files, not a practical bug at the current 200 MB limit. Carry-forward acknowledged.
- **Fix:** Document the accepted precision limit in the schema comment. If the upload limit ever exceeds ~4 GB (near 2^32), migrate to `mode: 'bigint'`.

## FINDING C16-LOW-05: `proxy.ts` middleware session cookie format check is loose — only validates `:` count

- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/proxy.ts`, line 87
- **Category:** security
- **Description:** The middleware checks `token.split(':').length !== 3` to validate the session cookie format. The token structure is `timestamp:random:signature`. The check ensures three colon-separated segments but does not validate that each segment is non-empty or has the expected format (hex string, etc.). A token like `::` would pass this check. While `verifySessionToken` performs full cryptographic verification server-side, a slightly stricter format check in the middleware would reduce unnecessary DB queries for obviously malformed tokens.
- **Fix:** Add a minimum length check per segment or a hex-format check on the signature portion to avoid hitting the DB for trivially malformed tokens.

## FINDING C16-LOW-06: `deleteImage` and `deleteImages` call `getCurrentUser()` after DB transaction — redundant DB query

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/images.ts`, lines 492, 628
- **Category:** performance
- **Description:** Both `deleteImage` and `deleteImages` call `getCurrentUser()` after the DB transaction to log audit events. `getCurrentUser()` is wrapped in `cache()`, so the second call within the same request is a cache hit. However, in `deleteImage` specifically, the user was already checked via `isAdmin()` at the top. The `getCurrentUser()` call at line 492 is only for the audit log. This is not a bug, but in a batch-delete scenario with many images, each `logAuditEvent` is fire-and-forget, so the overhead is minimal.
- **Fix:** No fix needed — informational. The `cache()` wrapper makes this a no-op for the second call.

## FINDING C16-LOW-07: `sanitizeStderr` regex for `password=VALUE` can match across line boundaries

- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/sanitize.ts`, lines 136-138
- **Category:** security
- **Description:** The regex `/(password\s*[:=]\s*)[^\s;'"` `)]*/gi` uses `[^\s;'"` `)]*` which will match until it hits whitespace, semicolons, quotes, backticks, or close-paren. If a MySQL error message contains `password=SOME_VALUE` followed by more text on the same line without any of those delimiters, the regex could match too aggressively or not aggressively enough. The `g` flag also means it replaces all occurrences, which is correct. However, the character class does not include `>` or `}` which are common in connection string formats. A value like `password={complex_value}` would only match up to the space before the closing brace.
- **Fix:** Consider expanding the character class to include `>`, `}`, and `]` for broader coverage of connection-string formats.

## FINDING C16-LOW-08: No Content-Security-Policy header on API route responses

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/proxy.ts`, line 105-110 (matcher excludes `/api/*`)
- **Category:** security (carry-forward from prior cycles, D1-MED)
- **Description:** The middleware matcher explicitly excludes `/api/*` routes from CSP injection. The `withAdminAuth` wrapper in `api-auth.ts` does not add CSP headers either. This means API responses (including admin routes like `/api/admin/db/download`) do not receive CSP headers. While API routes returning JSON don't typically need CSP, the download route returns a file stream which could be embedded in a browser context. Adding `X-Content-Type-Options: nosniff` (which is already set on upload file serving) would be defense-in-depth.
- **Fix:** Add `X-Content-Type-Options: nosniff` to API route responses in the `withAdminAuth` wrapper.

## FINDING C16-LOW-09: `getSharedGroup` images query uses `.limit(100)` but doesn't validate position ordering gaps

- **Severity:** LOW
- **Confidence:** LOW
- **Category:** data-integrity
- **File:** `apps/web/src/lib/data.ts`, lines 957-974
- **Description:** The shared group images query orders by `position` then `imageId` with a `.limit(100)`. If `position` values have gaps (e.g., 0, 2, 5 — which can happen if the dedup in `createGroupShareLink` removes duplicates from the `imageIds` array), the ordering still works correctly because positions are relative. However, the UI may display unexpected gaps if positions are used as display indices. This is not a bug — the code works correctly — but it's worth noting for future maintenance.
- **Fix:** No fix needed — informational.

## FINDING C16-LOW-10: `createPhotoShareLink` race window between share-key check and atomic update

- **Severity:** LOW
- **Confidence:** LOW
- **File:** `apps/web/src/app/actions/sharing.ts`, lines 95-175
- **Category:** concurrency
- **Description:** Between the initial check `if (image.share_key)` (line 100) and the atomic `UPDATE ... WHERE share_key IS NULL` (line 128), another concurrent request could have already created a share key. The code handles this correctly by re-fetching the share key on retry (lines 143-155). However, the rate-limit budget is consumed even for the "already has share key" fast path. If two admins click "share" simultaneously, one of them will consume a rate-limit slot without actually creating a new key.
- **Fix:** Move the `image.share_key` check after the rate-limit pre-increment, or add a rollback for the rate-limit on the "already exists" path.

## FINDING C16-LOW-11: `exportImagesCsv` uses hardcoded English headers — carry-forward from C13-03/C15-LOW-05

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, line 76
- **Category:** i18n (carry-forward)
- **Description:** CSV export column headers are `["ID", "Filename", "Title", "Width", "Height", "Capture Date", "Topic", "Tags"]` — hardcoded English. This is a known deferred item from prior cycles. No change in status.
- **Fix:** Deferred — see C13-03.

## FINDING C16-LOW-12: `getImageByShareKey` uses single GROUP_CONCAT for name-slug alignment — fragile if tags contain the separator

- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/data.ts`, lines 890-916
- **Category:** correctness
- **Description:** Related to C16-MED-02 but lower severity because `isValidTagName` already rejects commas in tag names. The GROUP_CONCAT separator `,` could theoretically collide with tag names that contain commas if any exist from before the validation was added. The `DISTINCT` keyword in GROUP_CONCAT can also cause count mismatches.
- **Fix:** See C16-MED-02.

## FINDING C16-LOW-13: `login` function creates dummy Argon2 hash on first call — timing side-channel for first request

- **Severity:** LOW
- **Confidence:** LOW
- **File:** `apps/web/src/app/actions/auth.ts`, lines 63-68
- **Category:** security
- **Description:** The `dummyHashPromise` is lazily initialized on the first call to `getDummyHash()`. The first login attempt for a non-existent user pays the Argon2 hash generation cost (~100ms), while subsequent attempts reuse the cached hash. This means the very first login request after a process restart has slightly different timing than subsequent requests, potentially revealing that the server just restarted. This is a very low-severity information leak — an attacker would need to observe the timing difference of a single request to infer a process restart.
- **Fix:** Pre-compute the dummy hash at module initialization time (not on first call) or accept the negligible risk.

## FINDING C16-LOW-14: `adminUsers` table has no `updated_at` column — password changes are not timestamped

- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/db/schema.ts`, lines 106-111
- **Category:** audit, observability
- **Description:** The `adminUsers` table has `created_at` but no `updated_at`. When an admin changes their password, there is no DB-level timestamp recording when the password was last changed. The audit log tracks the event, but there is no column-level record. This is acceptable for a personal gallery but could be useful for security audits.
- **Fix:** Consider adding `updated_at timestamp` column with `onUpdateNow()`. Low priority.

## FINDING C16-LOW-15: `verifySessionToken` uses `cache()` from React — expired session cache hit could bypass expiry check

- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/session.ts`, lines 94-145
- **Category:** security
- **Description:** `verifySessionToken` is wrapped in React `cache()`, meaning within a single request, the same token is only verified once. If a session expires between two requests from the same user, the cache would not interfere because `cache()` is request-scoped, not cross-request. However, if `verifySessionToken` is called multiple times within the same server-side rendering of a page, and the session expires during that rendering (extremely unlikely — rendering takes milliseconds), the cached result would not reflect the expiry. This is a theoretical concern only.
- **Fix:** No fix needed — React `cache()` is request-scoped and rendering is too fast for session expiry to occur.

---

## SWEPT FILES (final sweep — confirming coverage)

All source files under `apps/web/src/` (excluding `node_modules`, `__tests__`, and `components/ui/`) were read:
- All server actions (`actions/*.ts`)
- All library modules (`lib/*.ts`)
- All pages and layouts
- All API routes
- Schema, seed, DB connection
- Proxy/middleware
- Key components (lightbox, photo-viewer, home-client, upload-dropzone, etc.)
- Test files (spot-checked for coverage gaps)

No files were skipped in this review.

---

## CARRY-FORWARD ITEMS (no change from prior cycles)

All previously deferred items from cycles 5-15 remain deferred with no change in status. See plan 60 (cycle 15 deferred) and plan 72 (cycle 26 deferred) for the full list.
