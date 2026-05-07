# Architectural Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: architect
## Scope: Full repository, focus on storage abstraction integration gap

---

### C6R2-A01: Storage abstraction is architecturally incomplete — dead code layer (HIGH)

**Files:** `apps/web/src/lib/storage/` (all 4 files), `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/actions/images.ts`

The StorageBackend interface was added as a new abstraction layer but none of the actual consumers use it. This is the most significant architectural issue in the current codebase:

1. **Storage layer is unreachable:** `getStorage()` and `getStorageSync()` are exported but never imported anywhere except `actions/settings.ts` (for the switch).

2. **Two parallel storage paths exist:** The `StorageBackend` interface defines `writeBuffer`, `writeStream`, `readBuffer`, `createReadStream`, `delete`, `deleteMany`, `copy`, `stat`, `getUrl`. Meanwhile, `process-image.ts` directly uses `fs.writeFile`, `fs.copyFile`, `fs.link`, `fs.stat`, `fs.unlink`. These are parallel, inconsistent implementations of the same operations.

3. **`switchStorageBackend` is a no-op:** When called, it disposes the old backend and creates a new one, but since nothing reads from the storage singleton, the switch has zero effect on behavior.

4. **Sharp pipeline requires file paths:** The current `processImageFormats` passes a file path to `sharp()` for mmap optimization. The StorageBackend interface provides `readBuffer`/`createReadStream` but not a file path. For S3/MinIO, Sharp would need to read from a buffer or stream, losing the mmap optimization.

**Architectural recommendation:**

The integration must be designed in two tiers:
- **Local backend:** Continue using file paths with Sharp (mmap optimization preserved). The `LocalStorageBackend.getUrl()` returns a relative URL path; `LocalStorageBackend` provides a `getFilePath(key)` method for Sharp.
- **S3/MinIO backend:** Write original to a temp file for Sharp (or use `sharp(buffer)`), then upload all outputs via `writeBuffer()`. Serve files via presigned URLs or CDN.

This is a non-trivial integration that requires careful design to avoid regressing the local-backend performance.

**Confidence:** HIGH

---

### C6R2-A02: `gallery-config.ts` settings are read but not consumed by processing pipeline (MEDIUM)

**File:** `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/process-image.ts`

The gallery config module defines `imageQualityWebp`, `imageQualityAvif`, `imageQualityJpeg`, `imageSizes`, `queueConcurrency`, and `storageBackend` as configurable settings. However, `process-image.ts` hard-codes all quality values (90, 85, 90) and sizes (640, 1536, 2048, 4096). The queue concurrency is read from `process.env.QUEUE_CONCURRENCY` rather than from the settings.

This means the admin settings page lets you change these values, but they have no effect on the actual processing pipeline. The settings are stored in the DB but never read by the code that needs them.

**Fix:** Integrate `getGalleryConfig()` into `processImageFormats` and the queue initialization to actually use the configured values.

**Confidence:** HIGH

---

### C6R2-A03: Circular dependency risk between storage and process-image (LOW)

**Files:** `apps/web/src/lib/storage/local.ts:17-27`, `apps/web/src/lib/process-image.ts:35-45`

Both modules independently derive `UPLOAD_ROOT` with identical logic. If `process-image.ts` ever imports from `storage/`, and `storage/local.ts` imports `UPLOAD_DIR_*` from `process-image.ts`, there would be a circular dependency. Currently they are independent, but the planned integration makes this likely.

**Fix:** Move `UPLOAD_ROOT` and `UPLOAD_DIR_*` to a shared constants module that both can import without circularity.

**Confidence:** MEDIUM

---

### Previously Confirmed Architectural Findings

- All prior architecture findings from cycles 1-5 remain resolved or deferred
