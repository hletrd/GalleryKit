# Perf Reviewer — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

Hot-path latency, memory, allocation, DB round-trips, queue throughput.

## Findings

### C7L-PERF-01 — Duplicate `tagsString.split(',')` allocation in upload action
- File: `apps/web/src/app/actions/images.ts:141-149`
- Severity: LOW
- Confidence: High
- Issue: Two splits allocate two arrays; the second exists purely for length comparison. Negligible per-request, but the upload action runs once per batch (up to 100 files) and the action itself is the slowest user-visible code path.
- Failure scenario: Profile shows two array allocations per upload batch where one suffices.
- Fix: Replace with single split + counts.

### C7L-PERF-02 — `getSharedGroupKeysForImages` runs JOIN even when no shares exist
- File: `apps/web/src/app/actions/images.ts:90-99`
- Severity: INFO
- Confidence: Medium
- Issue: Both `deleteImage` and `deleteImages` call this unconditionally. For batch deletes of 100 images on a gallery with no shared groups, the JOIN is wasted work.
- Fix: Defer; consider EXISTS shortcut.

### C7L-PERF-03 — Sequential per-file upload loop
- File: `apps/web/src/app/actions/images.ts:243-389`
- Severity: INFO
- Confidence: Low
- Issue: Each file: `saveOriginalAndGetMetadata` → DB INSERT → enqueue. With 100 files this is ~100 sequential DB inserts. Could benefit from chunked parallel writes or a single batch INSERT.
- Risk: Race conditions between concurrent saves; UUID generation makes that safe; EXIF concurrency could compete on memory.
- Fix: Defer; out of cycle scope.

### C7L-PERF-04 — `revalidateLocalizedPaths` per-image O(n) calls below 20-id threshold
- File: `apps/web/src/app/actions/images.ts:628-637`
- Severity: INFO
- Confidence: High
- Status: Already mitigated above 20 ids by switching to `revalidateAllAppData`. Below 20, individual paths are rebuilt — the right tradeoff.
- Fix: None.

## Carry-forwards (still deferred)
- D2R-01 exportImagesCsv memory bound — still deferred.
- D2R-02 searchImages 3 sequential queries — still deferred.
- AGG5R-17 `getTopicBySlug` two-SELECT alias lookup — benchmark-gated.
