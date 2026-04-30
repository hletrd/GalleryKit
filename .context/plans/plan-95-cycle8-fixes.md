# Plan 95 — Cycle 8 Fixes

**Created:** 2026-04-19 (Cycle 8)
**Status:** DONE

---

## Findings to Address

### 1. C8-04: searchImages no query length guard at data layer [LOW, Low Confidence]

**File:** `apps/web/src/lib/data.ts:595-596`

**Current code:**
```ts
export async function searchImages(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    if (limit <= 0) return [];
```

**Fix:** Add defense-in-depth query length check:
```ts
if (query.length > 200) return [];
```

**Progress:** [x] Implemented — commit 25c5e37

**File:** `apps/web/src/app/actions/images.ts:330`

**Current code:** Audit log fires unconditionally after DB delete, even if the image was already deleted by another admin concurrently.

**Fix:** Move the audit log before the DB delete (since we already have the image data from the earlier select), so it logs the intent to delete regardless of race outcome. Alternatively, add the log after checking the delete was effective. The simplest fix: log before the transaction since we already verified the image exists.

**Progress:** [x] Implemented — commit 19de885

**File:** `apps/web/src/app/actions/tags.ts:275-276`

**Current code:**
```ts
await tx.insert(imageTags).ignore().values({ imageId, tagId: tagRecord.id });
added++;
```

**Fix:** Check `affectedRows` from the insert result:
```ts
const [tagInsertResult] = await tx.insert(imageTags).ignore().values({ imageId, tagId: tagRecord.id });
if (tagInsertResult.affectedRows > 0) added++;
```

Note: MySQL's `INSERT IGNORE` returns `affectedRows: 0` when the row was ignored (duplicate), and `affectedRows: 1` when actually inserted.

**Progress:** [x] Implemented — commit 05780e4

---

### 4. C8-F01: deleteTopicAlias revalidation for alias path [MEDIUM, Medium Confidence]

**File:** `apps/web/src/app/actions/topics.ts:295`

**Current code:** `revalidateLocalizedPaths` is called with alias and topic paths, but the ISR cache may still serve stale content for the deleted alias.

**Analysis:** Looking at the current code at line 295:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```
This already includes `/${alias}` in the revalidation paths. The `revalidateLocalizedPaths` function handles locale prefixes. The real concern is that the ISR `revalidate` time on topic pages is 1 hour, so `revalidatePath` should force-invalidate the cache.

After further review, `revalidatePath` in Next.js does force-invalidate ISR cache for the given path. So the current implementation is actually correct — the ISR cache IS being properly invalidated when the alias is deleted. The concern about stale cache serving is only relevant if `revalidatePath` fails silently, which would be a Next.js bug, not an application bug.

**Verdict:** This finding is less impactful than initially assessed. The current implementation correctly calls `revalidateLocalizedPaths` with the alias path. Downgrading to informational. No code change needed.

**Progress:** [x] Analyzed — no code change needed

---

## Deferred Items

### C8-01: createGroupShareLink insertId BigInt precision [MEDIUM, High Confidence]

**File:** `apps/web/src/app/actions/sharing.ts:166`
**Reason:** Already deferred as C30-04/C36-02. The practical risk is negligible — would require ~9 million shared groups. The `Number.isFinite` guard catches NaN/Infinity. Precision loss for values near 2^53 is theoretically possible but not practically reachable.
**Exit criterion:** If the app ever supports tables approaching 2^53 rows or mysql2 config changes BigInt handling.

---

## Implementation Order

1. C8-04 (searchImages query length guard) — simple one-liner
2. C8-10 (batchUpdateImageTags count accuracy) — simple conditional
3. C8-05 (deleteImage audit log placement) — move log before transaction
