# Aggregate Review — Cycle 17 (2026-04-19)

**Source reviews:** Comprehensive deep review of all key source files (single-reviewer cycle)

---

## DEDUPLICATION & CROSS-AGENT AGREEMENT

Single-reviewer cycle — no deduplication needed. All findings are from the comprehensive review.

---

## NEW FINDINGS

### C17-01: `searchImagesAction` rolls back in-memory counter on `incrementRateLimit` DB failure, weakening fallback during DB outages [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/public.ts` lines 83-94
- **Description**: When `incrementRateLimit` fails (DB unavailable), the code rolls back the in-memory pre-increment (lines 88-93). This means the request is "free" — it doesn't count toward the in-memory rate limit either. During a DB outage, this allows more searches than `SEARCH_MAX_REQUESTS` because each successful search has its in-memory counter rolled back.
- **Fix**: Remove the rollback in the `incrementRateLimit` catch block (lines 88-93). Keep the in-memory pre-increment even when DB increment fails, so the in-memory rate limit remains effective during DB outages.

### C17-02: `seo.ts` does not strip control characters from settings values [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/seo.ts` lines 99-113
- **Description**: `updateSeoSettings` does not strip null bytes or control characters from setting values before storing. Same class as C16-04 (fixed for `updateImageMetadata`). Null bytes in `seo_title` could cause MySQL truncation or display issues in HTML meta tags.
- **Fix**: Apply `stripControlChars()` to all SEO setting values before the DB upsert, similar to the fix in `updateImageMetadata`.

### C17-03: `settings.ts` does not strip control characters from setting values [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/settings.ts` lines 58-70
- **Description**: Same issue as C17-02 but for gallery settings. `isValidSettingValue` validators are strict (numbers, booleans, specific enums), making actual exploitation unlikely, but consistency with `updateImageMetadata` is desirable.
- **Fix**: Apply `stripControlChars()` to all gallery setting values before the DB upsert.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-16 findings remain resolved. No regressions detected. Key items re-verified:
- C16-01 (rateLimitBuckets.bucket_start bigint to int): Schema now uses `int('bucket_start')`. Confirmed fixed.
- C16-03 (flushGroupViewCounts re-buffer): Now uses single Map.set with full count. Confirmed fixed.
- C16-04 (updateImageMetadata control chars): Now uses `stripControlChars()`. Confirmed fixed.
- C16-08 (SQL restore scan overlap): Now uses 1024-byte overlap. Confirmed fixed.
- C39-01 (batchUpdateImageTags remove path): Now uses name-first, slug-fallback. Confirmed fixed.
- C39-02 (info-bottom-sheet GPS annotation): Now has unreachable-GPS comment. Confirmed fixed.
- C39-03 (admin user form labels): Now has htmlFor/id pairs. Confirmed fixed.
- SEC-39-01 (locale cookie Secure): Conditionally adds Secure on HTTPS. Confirmed fixed.
- SEC-39-03 (SET @@global. pattern): Now in dangerous SQL patterns. Confirmed fixed.
- Prior C17-03 (batchAddTag isAddingTag): `setIsBatchAddingTag(true)` is now at line 176. Confirmed fixed.
- Prior C17-05 (searchImages slice): Now uses `effectiveLimit` at line 652. Confirmed fixed.
- Prior C17-01 (limit caps 500→100): Both `getImages` and `getImagesLite` cap at 100. Confirmed fixed.
- Prior C17-10 (GC interval unref): Line 303 has `state.gcInterval.unref?.()`. Confirmed fixed.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged. See `.omc/plans/plan-deferred-items.md` for the full list.

---

## AGENT FAILURES

None — direct review completed successfully.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **3 LOW** findings (C17-01, C17-02, C17-03)
- **3 total** new findings
