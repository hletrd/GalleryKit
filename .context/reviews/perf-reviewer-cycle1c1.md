# Performance Reviewer -- Cycle 1 (Fresh)

## Files Reviewed
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`

## P1-01: `searchImages` 3 sequential DB queries
**File:** `apps/web/src/lib/data.ts` lines 685-754
**Severity:** LOW | **Confidence:** High
**Problem:** The search function runs main query -> tag query -> alias query sequentially. In the worst case (all 3 needed), latency is additive. With connection pool of 10 and queue limit 20, this is unlikely to cause pool exhaustion but does add unnecessary latency.
**Fix:** Run all 3 queries in parallel using `Promise.allSettled`. Deduplicate results after all resolve. This changes the worst-case latency from ~3x to ~1x the single-query time.

## P1-02: CSV export holds up to 50K rows in memory
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 56-104
**Severity:** LOW | **Confidence:** Medium
**Problem:** `exportImagesCsv` fetches up to 50,000 rows from the DB into memory, then builds a CSV string. At ~500 bytes per row, this is ~25MB of DB results + ~25MB of CSV string = ~50MB peak memory. This is acceptable for a personal gallery but could be problematic with very large datasets.
**Mitigation already applied:** The function releases the results array reference before materializing the CSV string (line 95), and the DB connection pool limits concurrent queries.
**Fix (deferred):** Stream the response instead of building in memory. Requires server action return type change. Defer until gallery size exceeds 30K images.

## P1-03: Bootstrap query fetches ALL unprocessed images without limit
**File:** `apps/web/src/lib/image-queue.ts`
**Severity:** LOW | **Confidence:** Low
**Problem:** The processing queue bootstrap query fetches all unprocessed images. If a batch upload of 10,000 images crashes the server, the next startup will load all 10,000 into memory.
**Fix:** Add a `LIMIT` to the bootstrap query (e.g., 500) and process in batches. This prevents memory spikes on restart after bulk uploads.
