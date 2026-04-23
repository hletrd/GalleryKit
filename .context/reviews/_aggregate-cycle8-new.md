# Aggregate Review — Cycle 8 (2026-04-19)

**Source review:** Fresh deep review of full codebase + verification of prior cycle 8 findings

## Summary

Cycle 8 deep review found **5 actionable findings** (1 MEDIUM, 4 LOW). No CRITICAL or HIGH findings. No regressions. Most prior C8 findings (C8-02, C8-03, C8-06, C8-09, C8-11, C8-12) have been fixed in subsequent cycles. The codebase is in strong shape after 37 prior cycles of fixes.

## Findings

| ID | Description | Severity | Confidence | File | Status |
|----|------------|----------|------------|------|--------|
| C8-01 | `createGroupShareLink` insertId BigInt precision loss | MEDIUM | High | `apps/web/src/app/actions/sharing.ts:166` | UNFIXED |
| C8-04 | `searchImages` no query length guard at data layer | LOW | Low | `apps/web/src/lib/data.ts:595-596` | UNFIXED |
| C8-05 | `deleteImage` audit log fires even when image was deleted by race | LOW | Medium | `apps/web/src/app/actions/images.ts:330` | UNFIXED |
| C8-10 | `batchUpdateImageTags` added count may overcount on INSERT IGNORE | LOW | Low | `apps/web/src/app/actions/tags.ts:275-276` | UNFIXED |
| C8-F01 | `deleteTopicAlias` missing revalidation for alias path | MEDIUM | Medium | `apps/web/src/app/actions/topics.ts:295` | NEW |

### C8-01: createGroupShareLink insertId BigInt precision (MEDIUM)

`Number(result.insertId)` at sharing.ts:166 can silently lose precision for BigInt auto-increment IDs > 2^53. Same bug class fixed in `uploadImages` and `createAdminUser`. The validation guard `Number.isFinite(groupId)` exists but does not catch precision loss — `Number()` for values near 2^53 returns a finite but incorrect value.

**Fix:** This is already tracked as deferred C30-04/C36-02. The practical risk is negligible (would require ~9 million groups). Adding explicit `BigInt` handling or at minimum checking `result.insertId` type before conversion would be more robust.

### C8-04: searchImages no query length guard (LOW)

`searchImages` in data.ts does not validate query length. The action caller truncates to 200 chars, but the data layer itself has no guard. Defense in depth.

**Fix:** Add `if (query.length > 200) return [];` at the top of `searchImages`.

### C8-05: deleteImage audit log on race-deleted image (LOW)

The audit log at images.ts:330 fires after the DB delete transaction, but the `image` variable was fetched earlier. If two admins delete the same image concurrently, both will log `image_delete` even though only one actually deleted it. The `affectedRows` from the transaction is not checked before logging.

**Fix:** Check the transaction result or move audit logging inside the successful delete path.

### C8-10: batchUpdateImageTags count overcount (LOW)

The `added++` counter at tags.ts:275-276 increments even when `INSERT IGNORE` was ignored (duplicate key). The returned `added` count may be slightly higher than actual new associations.

**Fix:** Check `affectedRows` from the insert result before incrementing.

### C8-F01: deleteTopicAlias missing alias path revalidation (MEDIUM)

When `deleteTopicAlias` is called, `revalidateLocalizedPaths` is called with `/admin/categories`, `/admin/dashboard`, `/${alias}`, and `/${topicSlug}`. However, the ISR-cached page for the alias path may still serve stale content after deletion. The `revalidateLocalizedPaths` function handles locale prefixes, so the main concern is that the alias URL still resolves from ISR cache until the next revalidation window (1 hour for topic pages).

This is a minor UX issue — the stale cached page will show the old content, but on next server render it will 404. The impact is limited by the 1-hour ISR TTL.

**Fix:** Consider using `revalidateTag` for topic-based cache invalidation, or accept the current behavior since the ISR TTL is short.

## Previously Fixed — Confirmed Resolved

All prior cycle fixes verified as still in place. No regressions.

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion (same as C8-01)
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic

## TOTALS

- **2 MEDIUM** findings (1 deferred from prior cycles, 1 new)
- **3 LOW** findings
- **0 CRITICAL/HIGH** findings
- **5 total** unique findings
