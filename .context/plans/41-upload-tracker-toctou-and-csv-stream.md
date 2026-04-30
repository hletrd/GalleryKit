# Plan 41: Upload Tracker TOCTOU Fix and CSV Export Memory Safety

**Priority:** P1 (MEDIUM severity fixes)
**Sources:** C6-03, C6-09
**Status:** DONE

---

## C6-03: Upload tracker TOCTOU on concurrent uploads

**File:** `apps/web/src/app/actions/images.ts` lines 72-108
**Problem:** The cumulative byte check reads the tracker, then processes all files, then updates the tracker. With `UPLOAD_CONCURRENCY = 3` parallel client requests, multiple requests can read the same tracker state and all pass the byte limit check, then each update the tracker after processing — exceeding the limit.

**Fix:** Pre-increment the tracker bytes before processing files, and roll back on failure. This follows the same pattern as the rate-limit TOCTOU fix (pre-increment, then roll back on success).

**Implementation:**
1. After reading the tracker and validating the window (lines 77-82), immediately add `totalSize` to `tracker.bytes` and `files.length` to `tracker.count`
2. Set the tracker in the Map: `uploadTracker.set(uploadIp, tracker)`
3. After processing, if some files fail, adjust the tracker by subtracting failed bytes/counts
4. On complete failure (all files fail), roll back the tracker to its original state

**Code sketch:**
```typescript
// Pre-increment tracker before processing
const originalBytes = tracker.bytes;
const originalCount = tracker.count;
tracker.bytes += totalSize;
tracker.count += files.length;
uploadTracker.set(uploadIp, tracker);

// ... processing loop ...

// On partial failure, adjust tracker
tracker.bytes = originalBytes + uploadedBytes;
tracker.count = originalCount + successCount;
uploadTracker.set(uploadIp, tracker);
```

---

## C6-09: CSV export memory safety

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 30-71
**Problem:** The entire CSV is materialized in memory as a single string, with the DB results also in memory. For 50K rows with large GROUP_CONCAT values, this could consume 40-50MB.

**Fix:** Stream the CSV response as a ReadableStream instead of returning a single string. Convert each row to CSV format as it's processed.

**Implementation:**
1. Change `exportImagesCsv` to return a ReadableStream instead of a string
2. Use a TransformStream or manual ReadableStream construction
3. Write CSV header, then rows one at a time
4. The caller (DB page component) needs to consume the stream

**Alternative (simpler):** Instead of streaming, process the DB rows in chunks and build the CSV incrementally, freeing the original row objects. This is simpler than full streaming but still reduces peak memory.

**Chosen approach:** Simpler incremental approach — process rows and free the DB result as we go, using `Array.join` on batches rather than the entire dataset.

---

## Progress

- [x] C6-03: Pre-increment upload tracker bytes/count — commit 35600b3
- [x] C6-09: Optimize CSV export memory usage — commit 0a24152
