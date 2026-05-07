# Comprehensive Deep Review — Cycle 17 (2026-04-19)

## Review Scope

Full codebase review covering all server actions (auth, images, topics, tags, sharing, admin-users, public, settings, seo), middleware (proxy.ts), data layer (data.ts), image processing pipeline (process-image.ts, image-queue.ts), auth & session (session.ts, api-auth.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), upload security (serve-upload.ts, upload-limits.ts), DB schema (schema.ts), admin pages, API routes, frontend components, validation, audit, SQL restore scanning, gallery config, and i18n.

## Previously Fixed (Confirmed Resolved This Cycle)

All cycle 1-16 findings remain resolved. Key items re-verified:
- C16-01 (rateLimitBuckets.bucket_start bigint to int): Now uses `int('bucket_start')`. Confirmed fixed.
- C16-03 (flushGroupViewCounts re-buffer O(n) overhead): Now uses single `Map.set` with full count. Confirmed fixed.
- C16-04 (updateImageMetadata control chars): Now uses `stripControlChars()`. Confirmed fixed.
- C16-08 (SQL restore scan overlap): Now uses 1024-byte overlap. Confirmed fixed.
- C39-01 (batchUpdateImageTags remove slug-only lookup): Now uses name-first, slug-fallback lookup. Confirmed fixed.
- C39-02 (info-bottom-sheet GPS dead code annotation): Now has unreachable-GPS comment. Confirmed fixed.
- C39-03 (admin user form label association): Now has `htmlFor`/`id` pairs. Confirmed fixed.
- SEC-39-01 (locale cookie Secure flag): Now conditionally adds `Secure` on HTTPS. Confirmed fixed.
- SEC-39-03 (SET @@global. pattern): Now in dangerous SQL patterns list. Confirmed fixed.
- UX-39-02 (password confirmation field): Now has confirm-password input. Confirmed fixed.

## NEW FINDINGS

### C17-01: `searchImagesAction` pre-increments in-memory counter AND then increments DB separately — double-counting on success path [MEDIUM] [HIGH confidence]
- **File**: `apps/web/src/app/actions/public.ts` lines 55-94
- **Description**: The `searchImagesAction` function pre-increments the in-memory `searchRateLimit` counter (line 55-59), then also calls `incrementRateLimit()` (line 82) which does a separate DB increment. On the success path, both increments are recorded, meaning the in-memory counter is +1 and the DB counter is also +1 for each request. On a subsequent request, the in-memory check (line 48) counts the pre-incremented value, while the DB check (line 63) also counts the DB-incremented value. This is consistent and not a double-count — however, the issue is that on the DB-backed check failure path (line 69-74), the code rolls back the in-memory pre-increment, but the DB increment (line 82) is then executed AFTER the DB check. If the DB check says "limited", the code returns early at line 75, but `incrementRateLimit` at line 82 is never reached in that code path because it's after the early return. Wait — re-reading more carefully: the DB check happens at line 63, then if limited, rolls back in-memory and returns. If NOT limited, `incrementRateLimit` runs at line 82. This means for a successful search, the in-memory counter gets +1 (from pre-increment at line 55-59) AND the DB gets +1 (from line 82). These are tracking the same thing via two different stores. On the next request, the in-memory check (line 48) sees the pre-incremented count, and the DB check (line 63) also sees the incremented count. Both are counting the same request. This is actually correct — the in-memory and DB stores are meant to be parallel. The real concern is a subtle inconsistency: if `incrementRateLimit` fails (DB unavailable, caught at line 83-94), the code rolls back the in-memory counter, which means a successful search is NOT rate-limited tracked in either store. This is actually the OPPOSITE problem — a successful search that hits a DB error during rate limit recording will have its in-memory counter rolled back, meaning the next request won't see this request in the rate limit. This could allow more searches than the limit allows during DB outages.
- **Fix**: When `incrementRateLimit` fails for a DB-backed search that was NOT rate-limited, do NOT roll back the in-memory counter. Keep the in-memory pre-increment so the in-memory rate limit remains effective even when the DB is unavailable. Only roll back when the DB check says "limited" (which is already handled correctly at line 69-74).
- **Revised severity**: LOW — during DB outages, the in-memory map still provides protection. The rollback on `incrementRateLimit` failure is overly cautious and slightly weakens the in-memory fallback.

Actually, on further analysis: the rollback at lines 83-94 is incorrect. The in-memory counter was pre-incremented for this request. The DB increment failed. If we roll back the in-memory counter, this request is "free" — it doesn't count toward either rate limit. The next request will see a lower count than it should. This is a minor rate limit bypass during DB outages, not a critical issue.

### C17-02: `seo.ts` does not strip control characters from settings values before storing [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 55-126
- **Description**: The `updateSeoSettings` function validates length and URL format but does not strip null bytes or control characters from setting values before storing to DB. This is the same class of issue as C16-04 (which was fixed for `updateImageMetadata`). Null bytes in `seo_title` or `seo_description` could cause MySQL truncation or display issues in HTML meta tags.
- **Fix**: Apply `stripControlChars()` or equivalent sanitization to all SEO setting values before the DB upsert.
- **Severity justification**: LOW — SEO settings are admin-only and the values are used in HTML meta tags where browsers typically handle control characters gracefully.

### C17-03: `settings.ts` does not strip control characters from setting values before storing [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/settings.ts` lines 35-96
- **Description**: Same issue as C17-02 but for gallery settings. The `updateGallerySettings` function validates via `isValidSettingValue` but does not strip null bytes or control characters. Gallery settings like `image_sizes` could theoretically contain control characters that bypass the numeric validator.
- **Fix**: Apply control character stripping to all setting values before the DB upsert.
- **Severity justification**: LOW — `isValidSettingValue` already validates the format tightly (numbers, booleans, or specific enums), making control character injection unlikely in practice.

### C17-04: `searchImagesAction` double-increments DB rate limit when in-memory check passes but DB check also passes [MEDIUM] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/public.ts` lines 52-94
- **Description**: Wait, I need to re-analyze this more carefully. The flow is:
  1. Pre-increment in-memory counter (lines 55-59)
  2. DB check (line 63) — if limited, roll back in-memory and return
  3. If NOT limited, call `incrementRateLimit` (line 82) to increment DB
  This means: each request increments the in-memory counter by 1 AND the DB counter by 1. These are two separate stores tracking the same thing. On the NEXT request, the in-memory check (line 48) sees +1, and the DB check (line 63) also sees +1. But wait — the DB check uses `checkRateLimit` which reads the CURRENT DB count, and then `incrementRateLimit` ADDS 1. So the sequence is: read DB count -> check if over limit -> if not, add 1 to DB. The in-memory counter is also incremented by 1. After N requests, in-memory count = N and DB count = N. These are consistent. This is actually correct behavior — the in-memory map is a fast-path cache of the DB-backed rate limit. Each request is counted once in each store. NOT a double-counting issue.

I retract C17-04. The dual-store rate limiting is correct by design.

### C17-05: `topicRouteSegmentExists` TOCTOU in `createTopic` and `createTopicAlias` [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/topics.ts` lines 58-59, 240-241
- **Description**: Both `createTopic` and `createTopicAlias` call `topicRouteSegmentExists` before inserting, creating a TOCTOU race. However, the code correctly catches `ER_DUP_ENTRY` (lines 90, 257) as the authoritative check, making the `topicRouteSegmentExists` check merely advisory (better error messages). The race is already handled.
- **Fix**: No fix needed — already handled via ER_DUP_ENTRY catch. Informational only.

### C17-06: `updateSeoSettings` does not sanitize `seo_og_image_url` for JavaScript URLs [LOW] [LOW confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 88-97
- **Description**: The URL validation checks for `http:` or `https:` protocol, which correctly rejects `javascript:` URLs. No issue found. Retracted.

### C17-07: `db-actions.ts` env passthrough includes `LANG` and `LC_ALL` — already tracked as deferred CR-38-05 [LOW]
- **File**: `apps/web/src/app/[locale]/admin/db-actions.ts` lines 121, 314
- **Description**: Already deferred. No new action needed.

## Consolidated New Findings (Non-Retracted)

### C17-01: `searchImagesAction` rolls back in-memory counter on `incrementRateLimit` DB failure, weakening in-memory fallback during DB outages [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/public.ts` lines 83-94
- **Description**: When `incrementRateLimit` fails (DB unavailable), the code rolls back the in-memory pre-increment (lines 88-93). This means the request is "free" — it doesn't count toward the in-memory rate limit either. During a DB outage, this allows more searches than `SEARCH_MAX_REQUESTS` because each successful search has its in-memory counter rolled back.
- **Fix**: Remove the rollback in the `incrementRateLimit` catch block (lines 88-93). Keep the in-memory pre-increment even when DB increment fails, so the in-memory rate limit remains effective during DB outages. The DB check already handles its own failure (line 77: "DB unavailable — rely on in-memory Map"), so the in-memory counter should be the fallback authority.

### C17-02: `seo.ts` does not strip control characters from settings values [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 99-113
- **Description**: `updateSeoSettings` does not strip null bytes or control characters from setting values before storing. Same class as C16-04 (fixed for `updateImageMetadata`).
- **Fix**: Apply `stripControlChars()` to all SEO setting values before the DB upsert, similar to the fix in `updateImageMetadata`.

### C17-03: `settings.ts` does not strip control characters from setting values [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/settings.ts` lines 58-70
- **Description**: Same issue as C17-02 but for gallery settings. The `isValidSettingValue` validators are strict (numbers, booleans, specific enums), making actual exploitation unlikely, but consistency with `updateImageMetadata` is desirable.
- **Fix**: Apply `stripControlChars()` to all gallery setting values before the DB upsert.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status. See `.omc/plans/plan-deferred-items.md` for the full list.

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings (C17-01 downgraded to LOW after analysis; C17-04 retracted)
- **3 LOW** findings (C17-01, C17-02, C17-03)
- **3 total** new findings
