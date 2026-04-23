# Aggregate Review — Cycle 9 (2026-04-19)

**Source review:** Deep multi-angle review of full codebase (code quality, security, performance, architecture, correctness, test coverage, UI/UX)

## Summary

Cycle 9 deep review found **4 findings** (1 MEDIUM, 3 LOW). No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase is in strong shape after 37+ prior cycles of fixes. All previously fixed items verified as still in place.

## Findings

| ID | Description | Severity | Confidence | File |
|----|------------|----------|------------|------|
| C9-F01 | `original_file_size` uses `bigint` with `mode: 'number'` — same BigInt precision class as deferred insertId issue | MEDIUM | Medium | `apps/web/src/db/schema.ts:50` |
| C9-F02 | `batchUpdateImageTags` removed count may overcount when tag not associated with image | LOW | Medium | `apps/web/src/app/actions/tags.ts:287-289` |
| C9-F03 | `searchImagesAction` DB check/increment window allows 1-request overshoot per window across processes | LOW | Low | `apps/web/src/app/actions/public.ts:55-94` |
| C9-F04 | `getImage` prev/next NULL capture_date logic — verified correct after C7-F06 fix (false alarm) | LOW | N/A | `apps/web/src/lib/data.ts:353-406` |

### C9-F01: original_file_size BigInt precision [MEDIUM]

**File:** `apps/web/src/db/schema.ts:50`

The `original_file_size` column uses `bigint('original_file_size', { mode: 'number' })`. For values > 2^53, `Number()` conversion silently loses precision. This is the same bug class as the deferred C30-04/C36-02/C8-01 `insertId` issue, but for file sizes.

Unlike `insertId` (where the practical limit of ~9 million rows makes it truly theoretical), this affects file sizes. However, the current `MAX_FILE_SIZE` is 200MB, so no uploaded file can exceed 2^53. The `original_file_size` is set from `file.size` which is a `number` in the File API. So in practice, this is safe given current upload limits.

**Fix:** Same class as the deferred insertId issue. The practical risk is negligible given the 200MB upload cap. Defer alongside the insertId issue. If upload limits are ever raised significantly, revisit.

### C9-F02: batchUpdateImageTags removed count overcount [LOW]

**File:** `apps/web/src/app/actions/tags.ts:287-289`

In `batchUpdateImageTags`, the `removed` counter increments unconditionally after `tx.delete(imageTags)`:
```ts
await tx.delete(imageTags).where(and(eq(imageTags.imageId, imageId), eq(imageTags.tagId, tagRecord.id)));
removed++;
```
This is the same bug class as the already-fixed C8-10 (added count overcount). If the tag was not associated with the image, the DELETE affects 0 rows but `removed++` still fires. The `removed` count reported to the user would be slightly inflated.

**Fix:** Check `affectedRows` from the delete result before incrementing, matching the C8-10 fix pattern. Note: Need to verify that Drizzle ORM's `delete()` within a transaction returns `affectedRows` in the result for MySQL.

### C9-F03: searchImagesAction rate limit asymmetry [LOW]

**File:** `apps/web/src/app/actions/public.ts:55-94`

The in-memory counter is pre-incremented before DB check (TOCTOU-safe), but `incrementRateLimit` (DB increment) is called AFTER the DB check. There's a window between the DB check and DB increment where a concurrent request could also pass the check, allowing a 1-request overshoot per window across processes.

In-memory pre-increment prevents larger bursts for the same process. Across processes, the DB `ON DUPLICATE KEY UPDATE count = count + 1` is atomic, so the count is accurate — the issue is just the check-then-increment window.

**Fix:** Low priority. The 1-request overshoot is acceptable for a photo gallery search. If stricter enforcement is needed, add a WHERE clause to the ON DUPLICATE KEY UPDATE or use GET_LOCK.

### C9-F04: getImage prev/next NULL logic — verified correct [INFORMATIONAL]

**File:** `apps/web/src/lib/data.ts:353-406`

After careful analysis of the C7-F06 fix, the `IS NULL` usage in the `or()` branches produces valid SQL: `capture_date IS NULL AND created_at > X` which is a valid boolean expression. No code change needed.

## Previously Fixed — Confirmed Resolved

All prior cycle fixes verified as still in place:
- C7-F01 (viewCount backoff) — confirmed in data.ts:12-22
- C7-F02 (search query validation length) — confirmed in public.ts:25
- C7-F05 (useCallback in nav-client) — confirmed in nav-client.tsx:59-62
- C7-F06 (NULL capture_date IS NULL) — confirmed in data.ts:360,366,391,397
- C8-04 (searchImages query length guard) — confirmed in data.ts:597
- C8-05 (deleteImage audit log placement) — confirmed in images.ts:306-309
- C8-10 (batchUpdateImageTags added count) — confirmed in tags.ts:275-276
- Old C9-01 (auth.ts i18n) — confirmed already fixed, getTranslations in use
- Old C9-02 (admin actions i18n) — confirmed already fixed
- Old C9-03 (maxLength attributes) — confirmed already fixed

No regressions detected.

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit (backoff added, but no max-retry)
- C30-04 / C36-02 / C8-01: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (no change needed, informational)

## AGENT FAILURES

None — single reviewer completed all angles.

## TOTALS

- **1 MEDIUM** finding (same class as existing deferred — recommend defer)
- **3 LOW** findings (1 actionable: C9-F02; 2 low-priority/informational)
- **0 CRITICAL/HIGH** findings
- **4 total** unique findings
