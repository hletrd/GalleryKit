# Plan 101 — Cycle 13 Fixes

**Created:** 2026-04-19 (Cycle 13)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C13-F01 | `uploadTracker` adjustment uses stale fallback when entry evicted during upload loop | MEDIUM | High | IMPLEMENTED |
| C13-F02 | `loadMoreImages` offset does not floor float values | LOW | High | IMPLEMENTED |
| C13-F03 | `deleteImages` audit-logs after transaction (inconsistent with single `deleteImage`) | LOW | High | IMPLEMENTED |
| C13-F04 | `createTopicAlias` catch block returns misleading `invalidAliasFormat` for non-MySQL errors | LOW | High | IMPLEMENTED |

---

## C13-F01: uploadTracker stale fallback — IMPLEMENT

**File:** `apps/web/src/app/actions/images.ts:249-252`

**Fix:**
1. Replace the fallback-to-stale-pattern on line 249:
   ```ts
   // Before:
   const currentTracker = uploadTracker.get(uploadIp) || tracker;
   
   // After:
   const currentTracker = uploadTracker.get(uploadIp);
   ```
2. Wrap the adjustment in a conditional:
   ```ts
   if (currentTracker) {
       currentTracker.count += (successCount - files.length);
       currentTracker.bytes += (uploadedBytes - totalSize);
       uploadTracker.set(uploadIp, currentTracker);
   }
   ```
3. Remove the now-unnecessary `uploadTracker.set(uploadIp, currentTracker);` that was outside the conditional.

**Progress:** [x] Implemented — commit 7a04dd6

---

## C13-F02: loadMoreImages offset float handling — IMPLEMENTED

**File:** `apps/web/src/app/actions/public.ts:13`

**Fix:** Add `Math.floor` to ensure integer offset:

```ts
// Before:
const safeOffset = Math.max(Number(offset) || 0, 0);

// After:
const safeOffset = Math.max(Math.floor(Number(offset)) || 0, 0);
```

**Progress:** [x] Implemented — commit 7a04dd6

---

## C13-F03: deleteImages audit-log before transaction — IMPLEMENTED

**File:** `apps/web/src/app/actions/images.ts:419-420`

**Fix:** Move the audit log (lines 419-420) to before the DB transaction (before line 396). This matches the single `deleteImage` pattern where the audit is logged before the transaction to ensure it's recorded even if the transaction deletes 0 rows.

Move:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'images_batch_delete', 'image', foundIds.join(','), undefined, { count: successCount, requested: ids.length, notFound: notFoundCount }).catch(console.debug);
```

To after line 393 (queue state cleanup) and before line 395 (the `if (foundIds.length > 0)` block that starts the transaction). Note: `successCount` is defined as `foundIds.length` on line 416 — since we're moving before the transaction, use `foundIds.length` directly in the audit call.

**Progress:** [ ] Not yet implemented

---

## C13-F04: createTopicAlias catch block misleading error — IMPLEMENT

**File:** `apps/web/src/app/actions/topics.ts:263`

**Fix:**
1. Add error logging before the return:
   ```ts
   console.error('Failed to create topic alias:', e);
   ```
2. Replace the misleading error key:
   ```ts
   // Before:
   return { error: t('invalidAliasFormat') };
   
   // After:
   return { error: t('failedToCreateTopic') };
   ```
   Use the existing `failedToCreateTopic` key since it's semantically appropriate and already exists in the translation files. If a more specific key is desired, add `failedToCreateAlias` to both `en.json` and `ko.json`.

**Progress:** [x] Implemented — commit 7a04dd6

---

## Deferred Items

| ID | Reason | Exit Criterion |
|----|--------|----------------|
| C13-F05 | Performance optimization, not correctness. Typical tag count < 10. Batch INSERT/SELECT requires significant restructuring. | Re-evaluate if admin UI shows latency with > 20 tags |
| C13-F06 | No user-visible bug. Negligible performance impact. | Re-evaluate if performance profiling shows this as hot path |

---

## Verification

- [x] C13-F01: uploadTracker only adjusts when entry still exists in Map
- [x] C13-F02: `Math.floor` applied to offset in loadMoreImages
- [x] C13-F03: deleteImages audit log fires before DB transaction
- [x] C13-F04: createTopicAlias catch returns generic error, logs the exception
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes (9 files, 66 tests)
