# Perf Reviewer — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: performance, concurrency, CPU/memory/UI responsiveness.

## Findings

### C4R-RPL2-PERF-01 — `data.ts` `flushGroupViewCounts` creates one DB update per group per flush [LOW] [MEDIUM]
**File:** `apps/web/src/lib/data.ts:48-96`

```ts
for (let i = 0; i < entries.length; i += FLUSH_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + FLUSH_CHUNK_SIZE);
    await Promise.all(
        chunk.map(([groupId, count]) =>
            db.update(sharedGroups)
                .set({ view_count: sql`${sharedGroups.view_count} + ${count}` })
                .where(eq(sharedGroups.id, groupId))
                ...
```

When N popular groups are being viewed, this issues N `UPDATE` statements per flush. A single `INSERT ... ON DUPLICATE KEY UPDATE` with a VALUES list could coalesce all chunk updates into a single round-trip. Given the 5-connection pool and the 20-row chunk size, this is limited but still worth measuring under load. Not blocking for normal traffic; track as perf deferred if benchmarks later show it mattering.

### C4R-RPL2-PERF-02 — `searchImages` runs up to 3 sequential queries for a cold search [carry-forward D2-05]

Still unchanged since prior cycles. The short-circuit at line 762 helps when the main query fills the limit. Carry-forward.

### C4R-RPL2-PERF-03 — `bootstrapImageProcessingQueue` does an unpaginated SELECT [carry-forward D2-06]

Still unchanged; SELECT of all pending images on boot. For galleries with thousands of pending uploads (realistic after a restore), this holds the entire row set in memory briefly. Carry-forward.

### C4R-RPL2-PERF-04 — `image-queue.ts` `pruneRetryMaps` O(n) pass per tick [LOW] [LOW]
**File:** `apps/web/src/lib/image-queue.ts:44-55`

```ts
function pruneRetryMaps(state: ProcessingQueueState) {
    for (const map of [state.retryCounts, state.claimRetryCounts] as const) {
        if (map.size <= MAX_RETRY_MAP_SIZE) continue;
        const excess = map.size - MAX_RETRY_MAP_SIZE;
        ...
```

Called from the per-job `finally` and the hourly GC interval. For queues staying under the 10k cap, this is cheap; just flagging that the cap prevents unbounded growth correctly.

### C4R-RPL2-PERF-05 — `dummyHash` is created once per process, which is correct [POSITIVE]
**File:** `apps/web/src/app/actions/auth.ts:62-68`

Confirmed lazy creation via `dummyHashPromise`. Amortizes the ~100ms Argon2 cost across all "user-does-not-exist" logins within the process lifetime. Good.

### C4R-RPL2-PERF-06 — `getImagesLitePage` uses `COUNT(*) OVER()` window function [POSITIVE]

Single query returning page + total count; avoids separate COUNT query. Good design.

## Confidence Summary

- 0 HIGH / 0 MEDIUM.
- 1 new LOW (PERF-01).
- 2 carry-forwards unchanged.
