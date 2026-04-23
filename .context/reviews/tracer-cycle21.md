# Tracer Review — Cycle 21

**Reviewer:** tracer
**Date:** 2026-04-19

## Review Scope

Causal tracing of suspicious flows, competing hypotheses.

## Findings

### TRACE-21-01: Orphaned file on upload failure — traced across all code paths [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 135-259
- **Description:** Traced the upload flow step by step:
  1. `saveOriginalAndGetMetadata(file)` — saves original to disk (SUCCESS: file on disk)
  2. `extractExifForDb(data.exifData)` — pure function, no side effects
  3. GPS strip — modifies exifDb in memory, no side effects
  4. `db.insert(images).values(insertValues)` — inserts into DB
     - SUCCESS: image in DB, processing queued. File cleanup handled by delete flow.
     - FAIL (invalid insertId): `continue` at line 188. Original file NOT deleted.
     - FAIL (exception): caught at line 255. Original file NOT deleted.
  5. If we reach Phase 3 (tag processing) and it fails, the image IS in the DB, so it's not truly orphaned — it just has no tags. The queue will process it.
  
  **Competing hypotheses:**
  - H1: Orphaned files are intentional — they'll be cleaned up by an admin tool or cron job. **Rejected:** No such cleanup tool exists in the codebase.
  - H2: Orphaned files are a bug. **Accepted:** The code should clean up on failure.
  - H3: Orphaned files are acceptable because disk space is cheap. **Rejected:** 200MB files accumulating on DB failures is not negligible.
  
- **Fix:** Delete the original file in the catch block and invalid-insertId branch.

### TRACE-21-02: `flushGroupViewCounts` race with concurrent `bufferGroupViewCount` calls [LOW] [LOW confidence]
- **File:** `apps/web/src/lib/data.ts` lines 40-76
- **Description:** Traced the flush flow:
  1. `isFlushing` guard prevents concurrent flushes
  2. `viewCountBuffer.clear()` at line 45 empties the buffer
  3. New increments arriving during flush go to the (now-empty) buffer
  4. Failed increments are re-buffered, potentially merging with new increments
  
  This is actually correct behavior — the buffer is a single-producer (bufferGroupViewCount) / single-consumer (flushGroupViewCounts) pattern with the `isFlushing` guard ensuring mutual exclusion. The only risk is if the re-buffer at line 62 races with a new increment at line 31, but JavaScript's single-threaded event loop prevents this. No actual race condition found.

### TRACE-21-03: `processImageFormats` atomic rename flow traced — correct [INFO]
- **Description:** Traced the link-then-rename flow:
  1. `fs.link(outputPath, tmpPath)` — hard link (fast, same device)
  2. `fs.rename(tmpPath, basePath)` — atomic rename
  3. `finally` block: `fs.unlink(tmpPath).catch(() => {})` — cleanup
  
  If link fails (cross-device), fallback to copyFile+rename. If rename fails, fallback to direct copyFile. All paths eventually either produce the base file or let verification catch the failure. Correct behavior.

## Summary
- 0 CRITICAL findings
- 1 MEDIUM finding (orphaned files — same as DBG-21-01/VER-21-03/CRI-21-01)
- 1 LOW finding (false alarm — no actual race)
- 1 INFO finding
