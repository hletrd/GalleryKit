# Debugger — Cycle 14

## Findings

### DBG-14-01: Queue verification failure causes permanent stuck state — image never marked processed, never retried [HIGH]

- **File**: `apps/web/src/lib/image-queue.ts:204-206`
- **Description**: When `processImageFormats` succeeds but post-processing file verification finds one or more output files missing/empty, the job logs an error and `return`s without marking the image as processed and without throwing an exception. Because the function returns normally (no error thrown), the `finally` block at lines 243-253 clears `retryCounts`/`claimRetryCounts` and removes the job from `enqueued`. The image remains `processed = false` in the DB forever, but no retry will ever be enqueued because the code treats this as a successful completion.
- **Concrete failure scenario**: Sharp writes some format files but one format (e.g., AVIF) produces a zero-byte file due to a transient disk write error. The verification check catches this, logs it, and returns. The image stays `processed = false` permanently. On next server restart, `bootstrapImageProcessingQueue` re-enqueues it, but if the same condition occurs it will loop forever on every restart.
- **Suggested fix**: Throw an error instead of silently returning, so the retry logic at lines 230-242 handles it:
  ```typescript
  if (!webpOk || !avifOk || !jpegOk) {
    console.error(`Image processing incomplete for ${job.id}: webp=${webpOk} avif=${avifOk} jpeg=${jpegOk}`);
    throw new Error(`Image processing incomplete for ${job.id}`);
  }
  ```
- **Confidence**: High
- **Severity**: High

---

### DBG-14-02: Queue cleanup on delete-during-processing misses the original file [MEDIUM]

- **File**: `apps/web/src/lib/image-queue.ts:216-222`
- **Description**: When an image is deleted during processing (`affectedRows === 0`), the queue cleans up processed variants (webp/avif/jpeg) but does not delete the original file from `UPLOAD_DIR_ORIGINAL`. The `deleteImage` action in `actions/images.ts` explicitly deletes the original, but the queue path only calls `deleteImageVariants` for the three processed format directories, omitting the original.
- **Concrete failure scenario**: Admin uploads an image, then deletes it while it is still in the processing queue. The queue detects the deletion and cleans up variants, but the original file (potentially 10-200MB) remains on disk permanently as an orphan.
- **Suggested fix**: Add deletion of the original file alongside variant cleanup:
  ```typescript
  await Promise.all([
    fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, job.filenameOriginal)).catch(() => {}),
    deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp),
    deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif),
    deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg),
  ]);
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-03: `processImageFormats` does not ensure output directories exist before writing [HIGH]

- **File**: `apps/web/src/lib/process-image.ts:327-405` (called from `image-queue.ts:184`)
- **Description**: `processImageFormats` writes output files to `UPLOAD_DIR_WEBP`, `UPLOAD_DIR_AVIF`, and `UPLOAD_DIR_JPEG` using Sharp's `.toFile()`, but it never calls `ensureDirs()` to create those directories. The `ensureDirs()` call exists only in `saveOriginalAndGetMetadata()` (line 198). When `processImageFormats` is called from the queue, the directories may not exist yet if the queue processes a bootstrapped job before any upload has triggered `saveOriginalAndGetMetadata`. Sharp's `.toFile()` will fail with `ENOENT` if the parent directory does not exist.
- **Concrete failure scenario**: Server restarts with pending images in the DB. The queue bootstraps and starts processing. If no new upload happens (which would call `saveOriginalAndGetMetadata` -> `ensureDirs`), the queue job calls `processImageFormats` which attempts to write to directories that do not exist on a fresh Docker volume. The job fails with `ENOENT: no such file or directory`, retries 3 times, then gives up permanently.
- **Suggested fix**: Add `ensureDirs()` call at the start of `processImageFormats`, or have the queue job call `ensureDirs()` before invoking `processImageFormats`.
- **Confidence**: High
- **Severity**: High

---

### DBG-14-04: Queue `deleteImageVariants` uses default sizes, not admin-configured sizes [MEDIUM]

- **File**: `apps/web/src/lib/image-queue.ts:217-220`
- **Description**: When cleaning up after a delete-during-processing event, `deleteImageVariants` is called without a `sizes` argument, so it defaults to `DEFAULT_OUTPUT_SIZES = [640, 1536, 2048, 4096]`. However, the admin may have configured different `imageSizes` (e.g., `[800, 1920, 3840]`). The files produced during processing used the admin-configured sizes (line 180-191), but cleanup only removes files matching the default sizes. Custom-sized variants are left as orphans on disk.
- **Concrete failure scenario**: Admin configures `image_sizes = "800,1920,3840"`. An image is processed producing files like `id_800.webp`, `id_1920.webp`, `id_3840.webp`. The admin deletes the image during processing. Cleanup only removes `id_640.webp`, `id_1536.webp`, etc. (which do not exist), and the actual files remain as orphans.
- **Suggested fix**: Pass the same `imageSizes` used for processing to `deleteImageVariants`:
  ```typescript
  const deleteSizes = imageSizes && imageSizes.length > 0 ? imageSizes : undefined;
  await Promise.all([
    deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp, deleteSizes),
    deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif, deleteSizes),
    deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg, deleteSizes),
  ]);
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-05: `updatePassword` rate limit pre-increment consumes slots on form validation failure [HIGH]

- **File**: `apps/web/src/app/actions/auth.ts:247-278`
- **Description**: The password change rate limit is pre-incremented at lines 247-258 (both in-memory Map and DB), but cheap form validation checks (empty fields, password mismatch, too short, too long) happen AFTER at lines 260-278. When any of these validations fail, the function returns an error without rolling back the rate limit counter. This is inconsistent with the `login` function, which validates empty fields BEFORE pre-incrementing (auth.ts:76-81 vs 107-117).
- **Concrete failure scenario**: An admin submits 5 password change forms with mismatched `newPassword`/`confirmPassword`. Each submission increments the rate limit counter (both in-memory and DB) without ever reaching the Argon2 verify. After 5 such submissions, the admin is locked out of changing their password for 15 minutes despite never actually attempting authentication.
- **Suggested fix**: Move cheap form validation (empty checks, mismatch, length) to BEFORE the rate limit pre-increment at line 247, matching the `login` pattern. Only the Argon2 verify should consume a rate limit slot.
- **Confidence**: High
- **Severity**: High

---

### DBG-14-06: `createAdminUser` rate limit not rolled back on form validation failure [MEDIUM]

- **File**: `apps/web/src/app/actions/admin-users.ts:70-94`
- **Description**: The in-memory rate limit is pre-incremented at line 70 (`checkUserCreateRateLimit`), and the DB rate limit is pre-incremented at line 78 (`incrementRateLimit`). Form validation (username length/format, password length) happens AFTER at lines 87-94. When validation fails, neither rate limit is rolled back. Rollback exists for successful creation (lines 111-115) and unexpected errors (lines 126-130), but not for validation failures.
- **Concrete failure scenario**: An admin submits 10 user creation forms with usernames shorter than 3 characters. Each attempt increments both in-memory and DB counters. After 10 such submissions, the admin is rate-limited from creating users for 1 hour despite never actually attempting the expensive Argon2 hash.
- **Suggested fix**: Move form validation (lines 87-94) to BEFORE the rate limit pre-increments (lines 70 and 77-85), matching the `login` pattern.
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-07: `updateGallerySettings` storage backend switch failure creates DB/runtime state inconsistency [HIGH]

- **File**: `apps/web/src/app/actions/settings.ts:56-85`
- **Description**: The settings DB transaction commits at lines 58-70, persisting all settings including `storage_backend`. Then `switchStorageBackend` is called at line 79. If the switch fails (e.g., S3 credentials invalid), `switchStorageBackend` rolls back the runtime to the old backend, but the DB already has the new (failed) value. The function returns an error, but the DB is now inconsistent with the runtime.
- **Concrete failure scenario**: (1) Admin changes `storage_backend` from `local` to `s3` but S3 credentials are misconfigured. (2) DB transaction commits `storage_backend = 's3'`. (3) `switchStorageBackend('s3')` fails, runtime rolls back to `local`. (4) Function returns error. (5) Admin UI shows `s3` as current backend (reads from DB), but runtime is `local`. (6) On next server restart, the storage module initializes from DB to `s3`, but credentials are still bad — all storage operations fail. (7) Every subsequent settings save that includes `storage_backend = 's3'` (from the form) will re-attempt the failed switch, potentially blocking all settings saves.
- **Suggested fix**: On `switchStorageBackend` failure, roll back the `storage_backend` DB row to the previous value before returning the error:
  ```typescript
  try {
    await switchStorageBackend(newStorageBackend as 'local' | 'minio' | 's3');
  } catch (switchErr) {
    console.error('[Settings] Failed to switch storage backend:', switchErr);
    // Roll back DB to prevent inconsistency
    const oldBackend = // capture before transaction
    await db.update(adminSettings)
      .set({ value: oldBackend })
      .where(eq(adminSettings.key, 'storage_backend'))
      .catch(() => {});
    return { error: t('failedToSwitchStorageBackend') };
  }
  ```
- **Confidence**: High
- **Severity**: High

---

### DBG-14-08: `batchAddTags` missing revalidation for individual image pages and topic pages [MEDIUM]

- **File**: `apps/web/src/app/actions/tags.ts:255`
- **Description**: `batchAddTags` only revalidates `/admin/dashboard`, `/`, and `/admin/tags`. It does NOT revalidate individual image pages (`/p/{id}`) or topic pages. Compare with `addTagToImage` (tags.ts:146) which revalidates `/p/${imageId}`, the topic path, plus admin surfaces. Since photo pages use ISR with a 1-week cache, newly added tags will not appear on individual photo pages until the cache expires naturally.
- **Concrete failure scenario**: Admin batch-adds the tag "landscape" to 5 images. The homepage and admin dashboard update immediately, but navigating to any individual photo page still shows the old tag list. The tags remain stale for up to 1 week.
- **Suggested fix**: Follow the `deleteImages` threshold pattern (images.ts:466-476). For small batches, revalidate individual pages; for large batches, use layout-level revalidation:
  ```typescript
  if (existingIds.size <= 20) {
    const topicPaths = await fetchTopicPaths(existingIds);
    revalidateLocalizedPaths(
      '/admin/dashboard', '/', '/admin/tags',
      ...[...existingIds].map(id => `/p/${id}`),
      ...topicPaths
    );
  } else {
    revalidateLocalizedPaths('/', '/admin/dashboard', '/admin/tags');
  }
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-09: Hardcoded `_640` image size in search and image-manager ignores admin config [MEDIUM]

- **File**: `apps/web/src/components/search.tsx:210`, `apps/web/src/components/image-manager.tsx:335`
- **Description**: Both `search.tsx` and `image-manager.tsx` hardcode the `_640` image size suffix when constructing thumbnail URLs. If an admin changes the `image_sizes` setting to remove 640 or use different sizes (e.g., `800,1600,2400`), these components will generate URLs to non-existent files, causing 404s and broken images. Every other component in the codebase uses `findNearestImageSize(imageSizes, target)` to select the nearest configured size.
- **Concrete failure scenario**: Admin changes `image_sizes` from `640,1536,2048,4096` to `800,1600,2400`. The search results and admin image manager thumbnails all 404 because `_640.avif` / `_640.jpg` files no longer exist on disk.
- **Suggested fix**: Both components need to receive `imageSizes` as a prop (or read it from a shared context) and use `findNearestImageSize(imageSizes, 640)` instead of the hardcoded `_640`.
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-10: `image-manager.tsx` missing `imageUrl()` wrapper — CDN `IMAGE_BASE_URL` not prepended [MEDIUM]

- **File**: `apps/web/src/components/image-manager.tsx:335`
- **Description**: `ImageManager` constructs the AVIF thumbnail path directly as `/uploads/avif/${...}` without using the `imageUrl()` helper. When `IMAGE_BASE_URL` is configured (for CDN-fronted deployments), all other components correctly prepend the base URL via `imageUrl()`, but `ImageManager` does not. This means admin image previews will 404 when a CDN is in use.
- **Concrete failure scenario**: Admin configures `IMAGE_BASE_URL=https://cdn.example.com`. All public gallery images load from the CDN. But in the admin image manager, preview thumbnails request `/uploads/avif/...` from the app server directly, which may not serve static files (or may serve stale/missing files if the upload pipeline writes to object storage).
- **Suggested fix**: Import and use `imageUrl()` in `image-manager.tsx`:
  ```tsx
  src={imageUrl(`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, '_640.avif')}`)}
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-11: `queueConcurrency` admin setting is never applied to the running queue [MEDIUM]

- **File**: `apps/web/src/lib/image-queue.ts:61`, `apps/web/src/lib/gallery-config.ts:100`
- **Description**: The `queueConcurrency` setting is read from the DB and exposed via `getGalleryConfig()`, but the actual PQueue concurrency is set once at construction time via `QUEUE_CONCURRENCY` env var (line 61 of image-queue.ts). There is no code path that updates the queue concurrency when the admin changes the setting. The admin UI presents this as a configurable setting, but changing it has zero effect until the server restarts and the `QUEUE_CONCURRENCY` env var is also changed.
- **Concrete failure scenario**: Admin sets queue concurrency to 4 in the settings UI. The queue continues running at concurrency 2 (the env var default). Admin expects faster processing but sees no change.
- **Suggested fix**: Either (a) remove `queueConcurrency` from admin settings since it is not wired up and use only the env var, or (b) add a mechanism to recreate the queue when the setting changes. Option (a) is simplest and avoids misleading the admin.
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-12: Shutdown exits with code 0 on timeout — hides incomplete shutdown from orchestrator [LOW]

- **File**: `apps/web/src/instrumentation.ts:5-26`
- **Description**: The `shutdownTimeout` promise resolves after 15 seconds. After `Promise.race`, `process.exit(0)` is called unconditionally at line 26 regardless of whether the timeout or the actual drain won. When the timeout wins, the log says "forcing exit with queued jobs remaining" but then `process.exit(0)` runs with exit code 0 (success). If this is running in a container orchestrator (Kubernetes, Docker Swarm), exit code 0 tells the orchestrator the shutdown was clean, when in reality in-flight jobs were abandoned mid-processing. This can lead to images stuck in `processed = false` state with partially-written output files.
- **Concrete failure scenario**: During a rolling deployment, the container receives SIGTERM. The queue has 5 images being processed. The 15-second timeout fires before they complete. The process exits with code 0. The orchestrator considers this a clean shutdown. Partially-processed images are left with `processed = false` and some output files already written.
- **Suggested fix**: When the timeout wins the race, exit with a non-zero code to signal incomplete shutdown:
  ```typescript
  const timedOut = await Promise.race([
    Promise.all([...]).then(() => false),
    shutdownTimeout.then(() => true),
  ]);
  if (timedOut) {
    console.warn('[Shutdown] Timed out, exiting with non-zero code');
    process.exit(1);
  } else {
    console.log('[Shutdown] Drained successfully');
    process.exit(0);
  }
  ```
- **Confidence**: High
- **Severity**: Low

---

### DBG-14-13: `OptimisticImage` retry closure captures stale `retryCount` [MEDIUM]

- **File**: `apps/web/src/components/optimistic-image.tsx:36-37`
- **Description**: The `handleError` callback references `retryCount` from the closure, but within a single mount lifecycle, if `handleError` fires multiple times in quick succession, each `setTimeout` callback reads the same stale `retryCount` value. The `setRetryCount(c => c + 1)` correctly uses the functional updater, but the `setImgSrc` on line 37 reads `retryCount + 1` from the closure, not the latest state.
- **Concrete failure scenario**: An image fails to load. The first error schedules a retry with `retry=1`. If the image fails again almost immediately (before the retry timer fires), the second `handleError` call also uses `retryCount=0` from the closure, scheduling another retry with `retry=1` instead of `retry=2`. The retry counter gets out of sync with actual retry attempts, potentially causing the same URL to be requested twice while a valid retry number is skipped.
- **Suggested fix**: Move the retry URL construction inside the `setRetryCount` functional updater:
  ```tsx
  retryTimerRef.current = setTimeout(() => {
    setRetryCount(c => {
      const next = c + 1;
      const separator = typeof src === 'string' && src.includes('?') ? '&' : '?';
      setImgSrc(`${src}${separator}retry=${next}`);
      return next;
    });
  }, delay);
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-14: `InfoBottomSheet` `shouldClose` side effect inside `setSheetState` updater violates purity contract [MEDIUM]

- **File**: `apps/web/src/components/info-bottom-sheet.tsx:75-93`
- **Description**: The `handleTouchEnd` callback uses a `shouldClose` flag that is set inside the `setSheetState` updater function. React's state updater functions should be pure — they must not have side effects. The `shouldClose` variable is set as a side effect of the state updater, and then `onClose()` is called outside the updater based on its value. While this works in practice because React currently runs updaters synchronously, it violates the purity contract. If React batches or defers updater execution (which Concurrent Mode may do), `shouldClose` could be read before the updater has run, causing `onClose()` to never be called when the user swipes down from the collapsed state.
- **Concrete failure scenario**: In a future React version that defers state updater execution, swiping down from the collapsed state of the bottom sheet would set `shouldClose = true` too late, and `onClose()` would not be called. The sheet would remain visible in a collapsed state.
- **Suggested fix**: Derive whether to close from the computed next state rather than using a mutable flag inside the updater:
  ```tsx
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartTime.current === null) return;
    setLiveTranslateY(null);
    // ... compute isSwipeUp / isSwipeDown ...
    let nextState: SheetState;
    let shouldClose = false;
    // compute nextState based on prev + swipe direction (purely)
    if (isSwipeUp) {
      nextState = prev === 'collapsed' ? 'peek' : prev === 'peek' ? 'expanded' : prev;
    } else if (isSwipeDown) {
      nextState = prev === 'expanded' ? 'peek' : prev === 'peek' ? 'collapsed' : prev;
      if (prev === 'collapsed') shouldClose = true;
    } else {
      nextState = prev;
    }
    setSheetState(nextState);
    if (shouldClose) onClose();
  }, [onClose]);
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-15: `LoginForm` error toast re-fires on re-render [MEDIUM]

- **File**: `apps/web/src/app/[locale]/admin/login-form.tsx:23-27`
- **Description**: The `useEffect` that shows the error toast depends on `[state]`. After a failed login, `state.error` is set. `useActionState` returns a new object reference after the action completes, so the effect fires on each render cycle where the state reference changes. There is no mechanism to clear the error after it is shown. If the user triggers any re-render (e.g., theme toggle, locale switch), the toast error will reappear.
- **Concrete failure scenario**: User submits wrong password. Error toast appears. User toggles dark/light theme, causing a parent re-render. The error toast fires again with the same message.
- **Suggested fix**: Track the "last shown" error to prevent re-toasting:
  ```tsx
  const lastErrorRef = useRef('');
  useEffect(() => {
    if (state?.error && state.error !== lastErrorRef.current) {
      lastErrorRef.current = state.error;
      toast.error(state.error);
    }
  }, [state]);
  ```
- **Confidence**: High
- **Severity**: Medium

---

### DBG-14-16: S3 `createReadStream` GC vulnerability — response body may be collected while stream is still being consumed [MEDIUM]

- **File**: `apps/web/src/lib/storage/s3.ts:144-155`
- **Description**: The AWS SDK v3 `GetObjectCommand` returns a `response.Body` that is a ReadableStream. The `Readable.fromWeb()` conversion creates a Node Readable that reads from the web stream. However, the `response` object (which holds the underlying HTTP connection) is not referenced after this method returns. If the response object is garbage-collected before the stream is fully consumed by the caller, the underlying HTTP connection may be terminated, causing the stream to emit an error or produce truncated data.
- **Concrete failure scenario**: Under memory pressure, the V8 garbage collector collects the `response` object while the caller is still reading the stream via `createReadStream()`. The stream abruptly ends with an `ECONNRESET` or similar error, producing a corrupted or truncated file.
- **Suggested fix**: Bind the stream's lifecycle to the response by keeping a reference:
  ```typescript
  const nodeStream = Readable.fromWeb(response.Body as unknown as import('stream/web').ReadableStream);
  (nodeStream as any)._s3Response = response;
  return nodeStream;
  ```
- **Confidence**: Medium
- **Severity**: Medium

---

### DBG-14-17: S3 `CopySource` not URL-encoded for keys with special characters [LOW]

- **File**: `apps/web/src/lib/storage/s3.ts:189-193`
- **Description**: The `CopyObjectCommand` uses `CopySource: ${this.bucket}/${srcKey}` without URL-encoding the key. Per the AWS S3 documentation, the `CopySource` parameter must be URL-encoded if the key contains characters that are not valid in a URI (e.g., spaces, `+`, `=`, `%`, or non-ASCII characters). While current gallery keys are typically safe (UUID-based filenames like `webp/abc.webp`), this will fail if the storage backend is ever used with keys containing special characters.
- **Concrete failure scenario**: If the storage backend is used with user-generated keys containing spaces or non-ASCII characters, the `copy()` method will fail with a `NoSuchKey` error from S3 because the unencoded key is parsed incorrectly.
- **Suggested fix**: URL-encode the key in `CopySource`:
  ```typescript
  CopySource: `${this.bucket}/${encodeURIComponent(srcKey)}`,
  ```
- **Confidence**: Medium
- **Severity**: Low

---

### DBG-14-18: `LocalStorageBackend.resolve()` allows access to the UPLOAD_ROOT directory itself [LOW]

- **File**: `apps/web/src/lib/storage/local.ts:26-31`
- **Description**: The path traversal check allows `resolved === path.resolve(UPLOAD_ROOT)` as a special case. This means a key like `"."` or an empty string would resolve to the `UPLOAD_ROOT` directory itself. While `writeStream`/`writeBuffer` would fail trying to write to a directory path, `readBuffer` would attempt to `fs.readFile()` on a directory, which throws a misleading `EISDIR` error rather than a clean "not found". More concerning, `stat(".")` would return `{ exists: true }` for the root directory, which could confuse callers that check existence before operating.
- **Concrete failure scenario**: A bug in key construction produces an empty string or `"."` key. `stat("")` returns `{ exists: true, size: undefined }`, misleading the caller into thinking a file exists. A subsequent `readBuffer("")` throws `EISDIR` rather than `ENOENT`, which may not be caught properly by error handling that only looks for `ENOENT`.
- **Suggested fix**: Add an explicit check for empty/slash-only keys before the path resolution:
  ```typescript
  private resolve(key: string): string {
    if (!key || key === '.' || key === '/') throw new Error(`Invalid storage key: ${key}`);
    const resolved = path.resolve(UPLOAD_ROOT, key);
    if (!resolved.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
      throw new Error(`Path traversal blocked: ${key}`);
    }
    return resolved;
  }
  ```
- **Confidence**: Medium
- **Severity**: Low

---

### DBG-14-19: `seed.ts` unhandled promise rejection [LOW]

- **File**: `apps/web/src/db/seed.ts:13`
- **Description**: The `seed()` function is called at the top level without `.catch()` or `.then()`. If the DB connection fails or the insert fails, an unhandled promise rejection occurs. In Node.js 15+, unhandled rejections terminate the process by default.
- **Concrete failure scenario**: Running `npm run db:seed` when MySQL is unreachable causes an unhandled promise rejection crash instead of a clean error message.
- **Suggested fix**: Add `.catch()` handling:
  ```typescript
  seed().catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
  ```
- **Confidence**: High
- **Severity**: Low

---

## Summary

| # | ID | File | Severity | Confidence | Description |
|---|------|-------|----------|------------|-------------|
| 1 | DBG-14-01 | `image-queue.ts:204-206` | High | High | Queue verification failure causes permanent stuck state |
| 2 | DBG-14-02 | `image-queue.ts:216-222` | Medium | High | Delete-during-processing misses original file |
| 3 | DBG-14-03 | `process-image.ts:327-405` | High | High | processImageFormats does not ensure output directories |
| 4 | DBG-14-04 | `image-queue.ts:217-220` | Medium | High | deleteImageVariants uses default sizes instead of admin-configured |
| 5 | DBG-14-05 | `auth.ts:247-278` | High | High | updatePassword rate limit consumed by form validation failures |
| 6 | DBG-14-06 | `admin-users.ts:70-94` | Medium | High | createAdminUser rate limit consumed by form validation failures |
| 7 | DBG-14-07 | `settings.ts:56-85` | High | High | Storage backend switch failure leaves DB inconsistent with runtime |
| 8 | DBG-14-08 | `tags.ts:255` | Medium | High | batchAddTags missing per-image and per-topic revalidation |
| 9 | DBG-14-09 | `search.tsx:210`, `image-manager.tsx:335` | Medium | High | Hardcoded `_640` size suffix breaks when admin changes `image_sizes` |
| 10 | DBG-14-10 | `image-manager.tsx:335` | Medium | High | Missing `imageUrl()` wrapper — CDN base URL not prepended |
| 11 | DBG-14-11 | `image-queue.ts:61` | Medium | High | queueConcurrency setting never applied to running queue |
| 12 | DBG-14-12 | `instrumentation.ts:5-26` | Low | High | Shutdown exits 0 on timeout, hides incomplete shutdown |
| 13 | DBG-14-13 | `optimistic-image.tsx:36-37` | Medium | High | Retry closure reads stale `retryCount` |
| 14 | DBG-14-14 | `info-bottom-sheet.tsx:75-93` | Medium | High | shouldClose side effect in state updater violates purity |
| 15 | DBG-14-15 | `login-form.tsx:23-27` | Medium | High | Error toast re-fires on re-render |
| 16 | DBG-14-16 | `storage/s3.ts:144-155` | Medium | Medium | S3 createReadStream GC vulnerability |
| 17 | DBG-14-17 | `storage/s3.ts:189-193` | Low | Medium | S3 CopySource not URL-encoded |
| 18 | DBG-14-18 | `storage/local.ts:26-31` | Low | Medium | resolve() allows root directory access |
| 19 | DBG-14-19 | `seed.ts:13` | Low | High | Unhandled promise rejection |

**Critical/High severity**: 4 findings (DBG-14-01, 14-03, 14-05, 14-07)
**Medium severity**: 11 findings
**Low severity**: 4 findings
