# Performance Reviewer — Cycle 11

## Method
Deep review of performance, concurrency, CPU/memory/UI responsiveness across all source files. Examined: data.ts, image-queue.ts, photo-viewer.tsx, lightbox.tsx, image-zoom.tsx, home-client.tsx, load-more.tsx, upload flow, process-image.ts, session.ts, rate-limit.ts, bounded-map.ts.

## Findings

### C11-PR-01 (Low / Medium): `bootstrapImageProcessingQueue` calls `cleanOrphanedTmpFiles()` on every bootstrap including continuation passes

- **File+line**: `apps/web/src/lib/image-queue.ts:496-497`
- **Issue**: The orphaned-file cleanup runs on every bootstrap call, including when `bootstrapContinuationScheduled` fires. For a large backlog, the continuation fires repeatedly. Each call runs `fs.readdir()` on 3 directories. The cleanup is idempotent, but subsequent calls still pay the `fs.readdir()` cost.
- **Fix**: Add a flag or timestamp to skip cleanup on continuation passes (only run on the initial bootstrap). Alternatively, move the cleanup to the GC interval.
- **Confidence**: Low
