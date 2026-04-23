# Performance Reviewer -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Performance, concurrency, CPU/memory/UI responsiveness. Mature codebase with 46+ prior cycles.

## Findings

### P6R3-01: `S3StorageBackend.writeStream` materializes entire file in heap [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/storage/s3.ts` lines 95-115
**Description:** `writeStream` collects all chunks from the input stream into a single `Buffer` via `Buffer.concat(chunks)` before uploading via `PutObjectCommand`. For a 200MB upload, this means 200MB of heap memory is consumed for the buffer alone, plus the original stream's internal buffers. For concurrent uploads, this could cause memory pressure or OOM. The local backend uses streaming writes via `pipeline(nodeStream, createWriteStream(...))` which uses constant memory. This is a latent issue since S3 storage is not yet integrated, but will become a real problem when it is.
**Fix:** Use `@aws-sdk/lib-storage` `Upload` class which supports multipart streaming uploads, or use `@aws-sdk/node-http-handler` with streaming support.

### P6R3-02: `exportImagesCsv` holds entire CSV in memory [LOW] [LOW confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 59-88
**Description:** The CSV export builds the entire CSV as a single string (`csvLines.join('\n')`) before returning. For a 50,000-row export (the cap), with average ~200 bytes per row, this is ~10MB — acceptable but not ideal. A streaming response would be more memory-efficient. The existing `results = []` reassignment at line 79 helps release the DB result objects but the CSV string remains.
**Fix:** Consider streaming the CSV response using a ReadableStream instead of building the full string in memory. Low priority since the 50K row cap limits memory usage.

### P6R3-03: `getTopicsWithAliases` fetches all topics and aliases separately — acceptable but could be a single JOIN [LOW] [LOW confidence]
**File:** `apps/web/src/lib/data.ts` lines 168-189
**Description:** `getTopicsWithAliases` uses `Promise.all` to fetch topics and aliases in parallel, then joins them in-memory with a Map. A single SQL JOIN would be more efficient but the current approach is simpler and the data size is typically small (<100 topics). The Map-based join is O(N+M) which is optimal.

## Summary

No critical performance issues. The S3 writeStream concern is latent (not yet integrated). The codebase already has good performance patterns: parallel queries via Promise.all, React cache() for dedup, streaming file writes, and bounded data structures.
