# Code Reviewer — Cycle 9

## C9-CR-01 (Medium/High): `viewCountRetryCount` iteration-during-deletion on raw Map

**File+line**: `apps/web/src/lib/data.ts:155-159`

The `viewCountRetryCount` Map uses a for-of loop with `.delete()` inside iteration for FIFO eviction. Cycle 7 fixed `BoundedMap.prune()` and cycle 8 fixed `upload-tracker-state.ts` to use collect-then-delete, but this raw Map site was missed.

```js
for (const key of viewCountRetryCount.keys()) {
    if (evicted >= excess) break;
    viewCountRetryCount.delete(key);
    evicted++;
}
```

While ES6 guarantees this is safe on Maps, the pattern is inconsistent with the project's own convention (collect-then-delete) established in C7-MED-01 and C8-MED-01.

**Confidence**: Medium (correctness is fine per ES6 spec, but consistency/defensive-coding principle applies)
**Fix**: Apply collect-then-delete pattern matching BoundedMap.prune().

## C9-CR-02 (Medium): `pruneRetryMaps` in image-queue.ts uses iteration-during-deletion

**File+line**: `apps/web/src/lib/image-queue.ts:84-95`

Same pattern as C9-CR-01 — `pruneRetryMaps` iterates over Map keys and deletes during iteration. The collect-then-delete convention should be applied here too for consistency.

```js
for (const key of map.keys()) {
    if (evicted >= excess) break;
    map.delete(key);
    evicted++;
}
```

**Confidence**: Medium (ES6 guarantees safety, but consistency matters)
**Fix**: Apply collect-then-delete pattern.
