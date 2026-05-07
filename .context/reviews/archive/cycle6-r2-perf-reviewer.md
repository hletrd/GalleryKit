# Performance Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: perf-reviewer
## Scope: Full repository, focus on storage, settings, and processing pipeline

---

### C6R2-P01: S3 `writeStream` materializes entire file in memory (HIGH)

**File:** `apps/web/src/lib/storage/s3.ts:95-115`

The `writeStream` method collects all chunks from the stream into a single `Buffer` in memory before uploading. For image uploads, this means a 200MB file is fully buffered in Node.js heap memory. The local backend properly streams to disk via `pipeline()`, but the S3 backend defeats the purpose of streaming.

AWS SDK v3 supports `Upload` from `@aws-sdk/lib-storage` which provides multipart upload with streaming. This avoids buffering the entire file.

**Failure scenario:** Concurrent upload of 5 large images (200MB each) with S3 backend would require ~1GB of heap memory just for the upload buffers, potentially causing OOM.

**Fix:** Use `@aws-sdk/lib-storage` `Upload` class for streaming multipart uploads, or at minimum set a size threshold below which single PutObject is used and above which multipart streaming kicks in.

**Confidence:** HIGH

---

### C6R2-P02: `deleteMany` in S3 backend uses sequential individual deletes instead of batch (MEDIUM)

**File:** `apps/web/src/lib/storage/s3.ts:182-186`

The comment says "individual deletes in parallel are simpler and sufficient" but S3 supports `DeleteObjectsCommand` for batch deletion (up to 1000 keys per request). For a single image with 13 files (1 original + 4 sizes x 3 formats), this makes 13 HTTP requests instead of 1. For batch deletion of 100 images, this is 1300 HTTP requests instead of 2.

**Fix:** Use `DeleteObjectsCommand` for batch deletion. Fall back to individual deletes only for error recovery.

**Confidence:** MEDIUM

---

### C6R2-P03: `updateGallerySettings` sequential DB upserts (LOW)

**File:** `apps/web/src/app/actions/settings.ts:57-66`

12 settings are upserted one at a time in a `for...of` loop. Each awaits the previous one. This is ~12 sequential DB round-trips. Same pattern in `updateSeoSettings` (6 round-trips).

**Fix:** Use `Promise.all` for the upserts since they are independent, or use a single INSERT...ON DUPLICATE KEY UPDATE with multiple value tuples.

**Confidence:** MEDIUM

---

### C6R2-P04: `process-image.ts` creates Sharp instance per format instead of using clone() (INFO)

**File:** `apps/web/src/lib/process-image.ts:346-390`

This was previously flagged as C4-F06 (informational). The code does use `image.clone()` within `generateForFormat` (line 366), which is correct. The three `generateForFormat` calls run in parallel via `Promise.all` (line 394), each using `image.clone().resize()`. This is the optimal pattern — the base `sharp()` instance decodes once, then each clone shares the decoded pixel data. No action needed.

**Confidence:** HIGH (confirmed resolved)

---

### Previously Confirmed Performance Findings

- All prior performance findings remain resolved or properly deferred
- C32-03: Insertion-order eviction in Maps — deferred, no change
- C30-03/C36-03: `flushGroupViewCounts` re-buffering without retry limit — deferred, no change
