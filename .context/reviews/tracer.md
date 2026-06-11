# Trace Report — GalleryKit End-to-End Flow Analysis
## Run: R5C1 (2026-06-11)

---

## Flow 1: Upload → Original Save → Queue Claim → Sharp Fan-out → DB Update → Derivative Serving → SW Caching → ETag/Invalidation

### Chain

```
uploadImages() [actions/images.ts]
  → acquireUploadProcessingContractLock()         [upload-processing-contract-lock.ts]
  → getGalleryConfig()                            [gallery-config.ts] ← snapshot for upload
  → saveOriginalAndGetMetadata(file)              [process-image.ts]
  → stripGpsFromOriginal() (if stripGpsOnUpload)  [gps-exif-strip.ts]
  → db.insert(images) { processed: false }
  → enqueueImageProcessing(job)                   [image-queue.ts]
     → acquireImageProcessingClaim(jobId)  ← MySQL advisory lock
     → db.select WHERE processed=false    ← claim check
     → processImageFormats()              [process-image.ts]
     → verifyFile (stat size > 0)
     → db.update SET processed=true WHERE processed=false
  → serveUploadFile() [serve-upload.ts]
     → ETag: W/"v{VERSION}-{mtimeMs}-{size}-{settingsHash}"
  → SW stale-while-revalidate [sw.js]
     → HEAD probe with If-None-Match
     → 304 → serve cached; 200 with changed ETag → re-fetch
```

---

### TRC-R5C1-01 — Upload config snapshot not passed to queue for all fields; bootstrap uses LIVE config

**File:** `apps/web/src/lib/image-queue.ts:316-334`

**Observation:** `uploadImages()` in `images.ts:443-453` calls `enqueueImageProcessing(job)` passing a quality/imageSizes snapshot captured at upload time from `uploadConfig`. However, the bootstrap path at `image-queue.ts:609-630` re-enqueues unprocessed images from DB with NO quality/imageSizes fields — those fields are absent in the `ImageProcessingJob` struct bootstrapped from DB. The queue worker (`image-queue.ts:316-334`) then detects `!quality && !imageSizes` and re-reads the LIVE config from DB, not the upload-time snapshot.

**Hypothesis A (confirmed):** Bootstrap jobs always use live config. If image_sizes was changed between upload and restart, reprocessing uses the new sizes, violating the invariant that "images in the same batch were processed consistently."

**Evidence for A:**
- `image-queue.ts:316`: `if (!quality && !imageSizes) { const config = await getGalleryConfig(); ... }`
- Bootstrap call at `image-queue.ts:609`: passes no `quality` or `imageSizes` fields
- The `image_sizes` lock (`settings.ts:82-113`) only prevents changing image_sizes when ANY image exists — but that check runs at settings-save time, not per-image. After the check passes and images exist, a container restart will re-process pending images under the new config.

**Evidence against / gaps:**
- The `image_sizes` lock in settings.ts lines 94-113 blocks the change if ANY image exists, which is a strong guard. The race only opens if the change happens before any image is inserted (window: settings change → first upload arrives).
- In practice, `uploadImages` also enforces the advisory lock synchronizing uploads with contract changes.

**Hypothesis B (weaker):** The `forceSrgbDerivatives` setting IS re-read live even for fresh (non-bootstrap) jobs. Evidence: `image-queue.ts:327` reads `forceSrgbDerivatives` from live config even when job carries quality/imageSizes from upload time. This setting is not snapshotted at upload.

**Severity:** LOW
**Confidence:** High (confirmed by code)
**Classification:** Confirmed

---

### TRC-R5C1-02 — SW stale-while-revalidate serves from `public/` static path, not from `serve-upload.ts`

**File:** `apps/web/public/sw.js:44-50`, CLAUDE.md "Serving precedence (R4C6)"

**Observation:** `isImageDerivative()` in sw.js matches `/uploads/avif/`, `/uploads/webp/`, `/uploads/jpeg/`. However, CLAUDE.md documents that Next.js serves `public/` assets BEFORE route handlers. So `GET /uploads/jpeg/foo_640.jpg` is answered by Next's static server with a `W/"{size-hex}-{mtime-hex}"` ETag — NOT the versioned `W/"v7-{mtimeMs}-{size}-{settingsHash}"` ETag from serve-upload.ts.

**Hypothesis A:** The SW ETag probe (`HEAD` with `If-None-Match: W/"v7-..."`) against the static-served path will always get a DIFFERENT ETag format back from Next's static server, causing the ETag-mismatch branch to trigger a synchronous re-fetch on every cached page load for image derivatives.

**Evidence for A:**
- sw.js line 222: `if (networkEtag && networkEtag !== cachedEtag)` → dispatches full GET
- If the image was ORIGINALLY cached via `serve-upload.ts` (e.g., locale-prefixed URL), its cached ETag is `W/"v7-..."`. But the HEAD probe goes to `/uploads/jpeg/...` which uses Next static ETag (`W/"abc123-def456"`). Mismatch → forced re-fetch every visit.
- If originally cached from the static path, ETag is `W/"abc123-def456"`. The HEAD probe also goes to the same static path → ETag matches → 304 → serve cached. This path is self-consistent.

**Hypothesis B:** The SW only intercepts `pathname.startsWith('/uploads/...')` — if the URL served to the browser is always the static path, both the initial cache-fill AND the HEAD probe use the same ETag format, so no mismatch occurs. This is likely the steady-state case for fresh installs.

**Rebuttal of A:** The locale-prefixed `/[locale]/uploads/...` path (which goes through serve-upload.ts) would produce the versioned ETag on first cache fill. But the SW `isImageDerivative` function only matches `/uploads/...` paths, not `/en/uploads/...`. So the SW never intercepts locale-prefixed uploads — only the non-locale path. This means A is only a problem if the non-locale `/uploads/...` path was somehow served by the route handler instead of Next static, which only happens when the file is absent from `public/`.

**Current best explanation:** Mostly self-consistent for the common case. Edge case risk when files are missing from `public/` and served via route handler, then the static file appears later.

**Severity:** LOW
**Confidence:** Medium
**Classification:** Needs-manual-validation

---

### TRC-R5C1-03 — ETag invalidation race: settings hash cache has 5s TTL; a flip can serve stale ETags for up to 5s

**File:** `apps/web/src/lib/serve-upload.ts:46-83`, `apps/web/src/lib/settings-hash.ts:49`

**Observation:** `getServingColorSettingsHash()` uses stale-while-revalidate with a 5s TTL. After an admin flips `force_srgb_derivatives`, the serve-upload path returns the old hash for up to 5s. During this window, browsers receive the stale ETag and may serve stale derivatives.

**Severity:** LOW (documented as acceptable, max 5s skew)
**Confidence:** High
**Classification:** Confirmed — documented acceptable behavior

---

## Flow 2: Login → Session Issue → Middleware Guard → Admin Action → Same-Origin Guard → Rate Limits

### Chain

```
POST /[locale]/admin (login form)
  → login() [actions/auth.ts]
  → hasTrustedSameOrigin() rate-limit check
  → argon2.verify(password, hash)
  → generateSessionToken() [session.ts]
  → db.insert(sessions)
  → Set-Cookie: admin_session=timestamp:random:signature
  →
  middleware [proxy.ts]
  → isProtectedAdminRoute(pathname)
  → token.length >= 100 && tokenParts.length === 3
  → intlMiddleware (no crypto check)
  →
  Server Action
  → requireSameOriginAdmin() [action-guards.ts]
  → isAdmin() / getCurrentUser() [auth.ts]
  → verifySessionToken() [session.ts] ← React cache() per-request
```

---

### TRC-R5C1-04 — Middleware cookie check is format-only; cryptographic session validation happens only inside server actions

**File:** `apps/web/src/proxy.ts:90-115`

**Observation:** The middleware at proxy.ts checks only `token.length >= 100` and `tokenParts.length === 3 && no empty part`. This is a format check, NOT an HMAC verification. Any 100-char string of form `A:B:C` with non-empty parts passes the middleware gate and loads the admin page HTML.

**Hypothesis A (confirmed):** An attacker who crafts a syntactically valid but cryptographically invalid token bypasses the middleware redirect and receives the admin dashboard HTML. The actual API calls (server actions) will fail at `verifySessionToken()`, but the HTML scaffold is served.

**Hypothesis B:** This is acceptable defense-in-depth — the full crypto check at action level prevents any actual data access or mutation. The middleware redirect is a UX optimization, not a security boundary.

**Evidence for A:**
- `proxy.ts:90`: `if (!token || token.length < 100)` → redirect
- `proxy.ts:102`: `tokenParts.length !== 3 || tokenParts.some(p => p.length === 0)` → redirect
- No HMAC check in middleware
- `session.ts:94-145`: full HMAC + DB check only at action invocation

**Evidence for B:**
- CLAUDE.md: "Every mutating admin server action independently verifies auth via `isAdmin()` (defense in depth)"
- The admin page HTML contains no sensitive data itself — it is a React shell that populates via server actions

**Current best explanation:** B is correct — this is intentional design. The middleware is a UX redirect, not a security boundary. Server actions form the real gate. Not a vulnerability.

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — intentional design

---

### TRC-R5C1-05 — Session token uses wall-clock timestamp with 24h window; no token rotation on privilege use

**File:** `apps/web/src/lib/session.ts:82-145`

**Observation:** Session tokens embed a `timestamp` in the plaintext (`timestamp:random:signature`). The 24h validity window is checked client-side (before DB lookup) using `Date.now() - tokenTimestamp`. An attacker with a stolen 23h-old token has 1h to use it. There is no session rotation or token refresh on use.

**Hypothesis:** This is within-spec for a personal gallery (CLAUDE.md: "Adding TOTP/WebAuthn would add complexity without proportional benefit"), but if a cookie is exfiltrated (e.g., via XSS), the attacker has the remaining session lifetime uninterrupted.

**Severity:** LOW
**Confidence:** High
**Classification:** Needs-manual-validation (known design choice per CLAUDE.md)

---

### TRC-R5C1-06 — `verifySessionToken` React cache() can serve stale session data within a single SSR request

**File:** `apps/web/src/lib/session.ts:94`

**Observation:** `verifySessionToken` is wrapped with React `cache()` for per-request deduplication. Within a single SSR render, if `isAdmin()` is called first and returns true, then an attacker triggers session revocation during the same request, `getCurrentUser()` will still return the cached (now invalid) session. This is a fundamental limitation of React cache() deduplication.

**Hypothesis:** In practice, session revocation during a single in-flight SSR request is vanishingly unlikely and not exploitable (the attacker would need to revoke the session they just used). The cache is per-request, not cross-request.

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — acceptable design

---

## Flow 3: Shared Link/Group Access → View Counting → Analytics Flush

### Chain

```
GET /g/[key] → page.tsx
  → getSharedGroup(key) [data.ts]
  → recordSharedGroupView(groupId) [actions/public.ts] ← fire-and-forget
     → isViewRecordRateLimited(ip)
     → db.insert(sharedGroupViews)
  → view_count in sharedGroups is derived via flushGroupViewCounts [data.ts]
     → buffered in viewCountBuffer Map
     → flushed on timer (getNextFlushInterval) or at restore time
```

---

### TRC-R5C1-07 — Shared group `view_count` is buffered in process memory; never flushed to DB on normal shutdown

**File:** `apps/web/src/lib/data.ts:160-202`, `apps/web/src/instrumentation.ts:18-22`

**Observation:** `incrementSharedGroupViewCount()` in data.ts buffers increments in the in-memory `viewCountBuffer` Map and writes to DB only on a timer (`flushGroupViewCounts`). The `flushBufferedSharedGroupViewCounts()` is called: (1) on DB restore (`db-actions.ts:333`); (2) in `instrumentation.ts` on `'server.shuttingDown'` signal.

**Hypothesis A (confirmed):** A container crash, OOM kill, or `docker stop` with `SIGKILL` (not SIGTERM) will lose all buffered view counts for the current flush interval. The process shutdown signal `server.shuttingDown` only fires on graceful shutdown.

**Evidence for A:**
- `instrumentation.ts:18-22`: flush only on `'server.shuttingDown'` 
- CLAUDE.md: "View counts are only incremented on the initial shared-group page load... View count is best-effort approximate analytics: a crash can undercount"
- This is documented as acceptable behavior

**Evidence against:**
- CLAUDE.md explicitly documents this limitation as known and accepted
- `sharedGroupViews` table records each view event individually — view count in `sharedGroups` is a separate counter, but the analytics query in `analytics-data.ts:154` counts rows from `sharedGroupViews` directly, not the cached `view_count` column

**Hypothesis B:** There are TWO different counts: (1) the `sharedGroups.view_count` column (buffered, lossy); (2) the `sharedGroupViews` table rows (written fire-and-forget per view, independently). The analytics dashboard queries sharedGroupViews rows, not the column. The column is best-effort only.

**Current best explanation:** B is confirmed. Loss is limited to the `view_count` column; the analytics queries use the row table directly. Documented design.

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — documented acceptable behavior

---

### TRC-R5C1-08 — `recordSharedGroupView` fire-and-forget swallows ALL errors including FK violations silently

**File:** `apps/web/src/app/actions/public.ts:396-404`

**Observation:** `recordSharedGroupView(groupId)` performs a fire-and-forget `db.insert(sharedGroupViews)` with `.catch(console.debug)`. There is no validation that `groupId` corresponds to a real group — the FK constraint on `sharedGroupViews.groupId → sharedGroups.id` enforces this at DB level. If the groupId is valid but the group is deleted between the page render and the action call, the insert silently fails with a FK error (logged only at `console.debug`).

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — intentional design (analytics-only, failure is acceptable)

---

## Flow 4: Settings Change → Settings Hash → Cache Invalidation → Backfill

### Chain

```
updateGallerySettings(settings) [actions/settings.ts]
  → acquireUploadProcessingContractLock() (if image_sizes or strip_gps_on_upload)
  → db.transaction → INSERT ... ON DUPLICATE KEY UPDATE
  → revalidateAllAppData()
  → (no explicit cache-bust of serve-upload ETag cache)
  →
  serve-upload.ts on next request
  → getServingColorSettingsHash() ← 5s stale-while-revalidate
  → new ETag with changed settingsHash within 5s
  →
  Backfill: Admin clicks "Re-encode existing photos"
  → adminBackfillRunner() [admin-backfill-runner.ts]
  → acquires gallerykit_color_pipeline_backfill advisory lock
  → iterates images WHERE pipeline_version != IMAGE_PIPELINE_VERSION
  → processImageFormats() with LIVE config
  → db.update pipeline_version, color columns
```

---

### TRC-R5C1-09 — `image_sizes` lock check has a TOCTOU between SELECT and settings upsert

**File:** `apps/web/src/app/actions/settings.ts:94-113`

**Observation:** The `image_sizes` change guard at settings.ts:94-113 first SELECTs whether any image exists (`db.select({ id: images.id }).from(images).limit(1)`), then if no image exists, proceeds to change `image_sizes`. This SELECT and the subsequent `db.transaction` upsert are NOT wrapped in the same transaction or advisory lock that covers uploads.

**Hypothesis A:** An upload could start AFTER the SELECT returns empty but BEFORE the transaction commits the new `image_sizes`. The upload uses `uploadConfig` snapshotted at upload-start time (before the settings change), so the DB gets the old sizes. But the queue worker for that upload also uses the snapshotted sizes. Net result: that upload uses old sizes, subsequent uploads use new sizes. No data corruption, but a brief inconsistency window.

**Evidence for A:**
- settings.ts:94-113: SELECT images → if no image → allow change (no locking between check and write)
- The `acquireUploadProcessingContractLock` IS acquired in settings.ts:74-78 before the upsert, but only when `changesUploadProcessingContract` is true
- `changesUploadProcessingContract` is set when `image_sizes` or `strip_gps_on_upload` is in the settings dict — so the lock IS held for `image_sizes` changes

**Evidence against A:**
- Actually re-reading: the upload processing contract lock IS acquired (settings.ts:74-78) for `image_sizes` changes. And `uploadImages()` also acquires the same lock (images.ts:170-173). These two calls compete for `LOCK_UPLOAD_PROCESSING_CONTRACT`, which serializes them correctly.

**Revised assessment:** The advisory lock correctly serializes uploads with image_sizes changes. The SELECT-before-check is safe because the lock guarantees no upload can begin while the settings change is in progress.

**Residual gap:** The TOCTOU is between `hasActiveUploadClaims()` check at settings.ts:70 and acquiring the advisory lock at settings.ts:74. If an upload starts AFTER `hasActiveUploadClaims()` returns false but BEFORE `acquireUploadProcessingContractLock()` returns, the upload will block on the advisory lock and proceed after the settings change. This is safe — the upload uses the config it reads after the lock is acquired.

**Severity:** LOW
**Confidence:** High
**Classification:** Confirmed — lock protects the invariant

---

### TRC-R5C1-10 — Settings hash covers `image_sizes` but backfill does NOT re-encode when only `image_sizes` changes

**File:** `apps/web/src/lib/settings-hash.ts:44`, CLAUDE.md backfill section

**Observation:** The settings hash includes `image_sizes` (settings-hash.ts:46). This means changing `image_sizes` invalidates the ETag for ALL derivative requests, forcing re-fetch. However, the backfill triggers on `pipeline_version != IMAGE_PIPELINE_VERSION` (backfill-color-pipeline.ts). A pure `image_sizes` change does NOT bump `IMAGE_PIPELINE_VERSION`, so existing images are NOT re-encoded with the new sizes.

**Hypothesis:** After an `image_sizes` change, all existing derivatives are still served at the old sizes, but the ETag change forces browsers to re-fetch — they receive the same old-size files. The admin must manually trigger "Re-encode existing photos" to get new-size derivatives. This is a UX gap, not a security issue.

**Evidence:**
- CLAUDE.md: "Flipping any of these requires a backfill pass to re-encode existing photos at the new settings"
- `image_sizes` is locked when images exist (prevents the change), so in practice this gap may be unreachable

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — documented design gap

---

## Flow 5: Delete-While-Processing and Restore-While-Uploading Races

### Chain

```
Race A: deleteImage(id) || processImageFormats(id)
  deleteImage:
    → queueState.enqueued.delete(id)          ← in-memory only
    → db.transaction: DELETE imageTags, images
  processImageFormats (concurrent):
    → acquireImageProcessingClaim(id)         ← MySQL advisory lock
    → db.select WHERE processed=false         ← claim check
    → processImageFormats()
    → db.update SET processed=true WHERE processed=false AND id=?
      → affectedRows=0 → detected → cleanup derivatives

Race B: restoreDatabase() || uploadImages()
  restoreDatabase:
    → acquireUploadProcessingContractLock()
    → beginRestoreMaintenance()
    → quiesceImageProcessingQueueForRestore()
  uploadImages:
    → getRestoreMaintenanceMessage() ← checked first
    → acquireUploadProcessingContractLock() ← blocked if restore holds it
```

---

### TRC-R5C1-11 — Delete-while-processing: in-memory `queueState.enqueued.delete(id)` does not cancel an already-running job

**File:** `apps/web/src/app/actions/images.ts:586-591`, `apps/web/src/lib/image-queue.ts:368-380`

**Observation:** `deleteImage(id)` at images.ts:586 calls `queueState.enqueued.delete(id)` and `queueState.permanentlyFailedIds.delete(id)`. This prevents FUTURE enqueue of that id. But if the job is ALREADY running inside `state.queue.add(async () => {...})`, the deletion cannot cancel it.

**Hypothesis A (confirmed):** The running job will complete `processImageFormats()`, write derivative files, then attempt `db.update SET processed=true WHERE processed=false AND id=?`. By that time, `deleteImage` has already committed the DELETE transaction. The conditional UPDATE affects 0 rows (image is gone). The queue job detects this (`affectedRows === 0`) and deletes the freshly-written derivative files. This is the intended behavior.

**Evidence for A:**
- image-queue.ts:370-380: `if (updateResult.affectedRows === 0)` → `deleteImageVariants(...)` × 3 formats
- This is correctly handled

**Hypothesis B (race gap):** Between `queueState.enqueued.delete(id)` and the queue job's `acquireImageProcessingClaim(id)`, if the job has NOT yet started, the `enqueued.delete` prevents re-enqueue but the job is already in the PQueue's internal queue and will still run. The `enqueued.delete` only prevents a new `enqueueImageProcessing(id)` call from finding the id in the set — the existing queued task still executes.

**Evidence for B:**
- PQueue jobs are added as closures; removing from `enqueued` Set does not dequeue the closure
- The job closure captures `job` by reference; `queueState.enqueued.delete(id)` only affects the guard in `enqueueImageProcessing()`

**Current best explanation:** The race is handled correctly by the `affectedRows === 0` check. Derivatives are cleaned up. No file leak.

**Severity:** LOW — handled correctly
**Confidence:** High
**Classification:** Confirmed — design handles this correctly

---

### TRC-R5C1-12 — Restore while uploading: `beginRestoreMaintenance()` check in `uploadImages()` is done AFTER original file is saved to disk

**File:** `apps/web/src/app/actions/images.ts:311-325`

**Observation:** In `uploadImages()`, the sequence is:
1. `getRestoreMaintenanceMessage()` — early exit if maintenance active (line 109)
2. `acquireUploadProcessingContractLock()` — blocks if restore holds this lock (line 170)
3. `saveOriginalAndGetMetadata(file)` — writes original to disk (line 279)
4. `cleanupOriginalIfRestoreMaintenanceBegan()` — second maintenance check (line 313)
5. `getRestoreMaintenanceMessage()` — third check (line 319)

**Hypothesis A:** If `beginRestoreMaintenance()` fires AFTER step 2 (lock acquired by upload) but BEFORE step 4, the upload holds the `uploadContractLock` while restore waits for it. The restore will block until the upload's `finally` releases it. The file IS cleaned up by `cleanupOriginalIfRestoreMaintenanceBegan`. This is the intended interlocking behavior.

**Evidence for A:**
- `restoreDatabase()` calls `acquireUploadProcessingContractLock(0)` (zero timeout) — if upload holds it, restore returns `uploadSettingsLocked`
- The two-phase check in uploadImages (pre-acquire at line 109, post-save at line 313) is defense-in-depth

**Hypothesis B (gap):** `beginRestoreMaintenance()` is called in `restoreDatabase()` AFTER acquiring both advisory locks (line 310). By the time `beginRestoreMaintenance()` is active, the upload contract lock is already held by the restore — no new upload can start. The only race is an in-flight upload that grabbed the contract lock BEFORE the restore did. For that case, the restore fails fast with `uploadSettingsLocked` (line 302-307), which is correct.

**Current best explanation:** The interlocking is correct. No hazard.

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — correct design

---

### TRC-R5C1-13 — `quiesceImageProcessingQueueForRestore` uses `queue.clear()` before `queue.onIdle()` — but clears in-memory queue only; DB `processed=false` rows will be re-discovered on next bootstrap

**File:** `apps/web/src/lib/image-queue.ts:673-714`

**Observation:** On restore, `quiesceImageProcessingQueueForRestore()` calls `queue.pause(); queue.clear(); await queue.onIdle()`. This drops queued-but-not-started jobs from the PQueue. After restore, `resumeImageProcessingQueueAfterRestore()` calls `bootstrapImageProcessingQueue()` which re-queries `processed=false` rows. The restored DB may have different `processed=false` rows (from the backup). This is correct behavior.

**Gap:** If the restore FAILS partway through and the DB is in an inconsistent state, `endRestoreMaintenance()` still fires in the `finally` block, and `bootstrapImageProcessingQueue()` runs against a potentially broken DB schema. If the schema migration partially applied, the `SELECT` in bootstrap may fail and trigger `scheduleBootstrapRetry`. This is recoverable.

**Severity:** LOW
**Confidence:** Medium
**Classification:** Needs-manual-validation

---

## Flow 6: Download Token / Entitlement Issuance → Paid Download Streaming → GPS Strip Interaction

### Chain

```
Stripe Checkout:
  POST /api/checkout/[imageId]    ← rate-limited, creates Stripe session
  → Stripe webhook: POST /api/stripe/webhook
     → INSERT entitlements { downloadTokenHash, expiresAt=NOW()+24h }
     → LOG_PLAINTEXT_DOWNLOAD_TOKENS → stdout (manual distribution)

Download:
  GET /api/download/[imageId]?token=<dl_...>   ← interstitial HTML
  POST /api/download/[imageId]?token=<dl_...>  ← claim + stream
     → validateDownloadRequest()
     → lstat(originalPath) + realpath checks
     → open(resolvedFilePath, 'r')         ← file open BEFORE claim
     → db.update SET downloadedAt=NOW(), downloadTokenHash=null WHERE downloadedAt IS NULL
     → affectedRows=0 → 410 Gone
     → stream fileHandle.createReadStream()
```

---

### TRC-R5C1-14 — Download route streams the RAW original file; GPS strip on upload protects the on-disk original, but only if `strip_gps_on_upload` was enabled at upload time

**File:** `apps/web/src/app/api/download/[imageId]/route.ts:282`, `apps/web/src/app/actions/images.ts:305-311`

**Observation:** The paid download route streams `UPLOAD_DIR_ORIGINAL/filename_original` — the exact file saved at upload time. GPS strip is performed at upload time (`images.ts:305-311`) when `uploadConfig.stripGpsOnUpload` is true. If an image was uploaded when `strip_gps_on_upload=false` and the admin later changes it to `true`, the existing on-disk original is NOT retroactively stripped.

**Hypothesis A (confirmed):** Images uploaded before `strip_gps_on_upload` was enabled will have GPS data in their on-disk original, and that GPS data will be included in paid downloads even after the setting is enabled.

**Evidence for A:**
- `images.ts:305-311`: GPS strip only happens at upload time, conditioned on `uploadConfig.stripGpsOnUpload`
- Download route: `route.ts:282` streams `UPLOAD_DIR_ORIGINAL` path directly
- No GPS re-strip at download time
- `strip_gps_on_upload` change is LOCKED when images exist (`settings.ts:115-134`), so this race requires: (1) admin enables GPS strip, (2) admin disables it, (3) admin enables it again (lock only checks the transition, not historical images)

**Evidence against A:**
- The `strip_gps_on_upload` toggle IS locked when images exist (`settings.ts:125-133`): if ANY image exists, the toggle cannot be changed. This means once the first image is uploaded with `strip_gps_on_upload=false`, the setting is permanently locked at false until all images are deleted.

**Revised assessment:** The lock at `settings.ts:125-133` prevents the gap from being reached in normal operation: you cannot change `strip_gps_on_upload` once any image exists. The gap only exists if the lock check has a bypass (e.g., direct DB manipulation or a bug in the lock logic).

**Severity:** MEDIUM — in theory reachable via the lock bypass or if images were imported before the lock was added; the GPS data exposure in paid downloads is a privacy issue

**Confidence:** Medium
**Classification:** Confirmed — the streaming of raw original without GPS re-check is a real gap; the lock mitigates it in normal operation

---

### TRC-R5C1-15 — Download token expiry is 24h from webhook receipt; no extension mechanism; Stripe webhook retry could generate a fresh token after expiry

**File:** `apps/web/src/app/api/stripe/webhook/route.ts:346-382`

**Observation:** `expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)`. The token is single-use and expires after 24h. The idempotency guard (SELECT by sessionId first, then `onDuplicateKeyUpdate`) prevents regenerating a fresh token on Stripe retry. After expiry, the customer cannot download and there is no self-service re-issue path (marked as TODO: US-P54-phase2).

**Hypothesis:** If the operator does not check `LOG_PLAINTEXT_DOWNLOAD_TOKENS` logs within 24h of a sale, the customer never receives their token. The webhook log line is the only distribution channel. This is a known UX gap (TODO comment in code).

**Severity:** MEDIUM — customer-visible impact (can't download after 24h without manual intervention)
**Confidence:** High
**Classification:** Confirmed — known gap (TODO in code)

---

### TRC-R5C1-16 — Stripe idempotency key `checkout-{imageId}-{ip}-{minute}` shares namespace across all images/IPs at same minute when TRUST_PROXY not set

**File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:178`

**Observation:** When `TRUST_PROXY` is not set, `getClientIp()` returns `'unknown'`. The idempotency key becomes `checkout-{imageId}-unknown-{minute}`. Two different users buying the same image in the same minute get the same idempotency key — Stripe deduplicates, returning the FIRST user's session URL to the SECOND user.

**Hypothesis A (confirmed):** Second buyer in the same minute gets the first buyer's Stripe Checkout URL (redirected to the first buyer's session). They can pay for that session, but the entitlement will be recorded with the first buyer's session metadata.

**Evidence for A:**
- `route.ts:178`: `const idempotencyKey = 'checkout-${image.id}-${ip}-${Math.floor(Date.now() / 60_000)}'`
- `route.ts:173-177`: comment confirms "When TRUST_PROXY is not set, IP becomes 'unknown'"
- This is explicitly documented as a deployment-config issue

**Severity:** HIGH — when TRUST_PROXY is not set (which is the DEFAULT for non-proxy deployments), two concurrent buyers of the same image within the same minute share a Stripe session; one buyer's payment benefits the other's entitlement
**Confidence:** High
**Classification:** Confirmed — acknowledged in code comment but severity underestimated; docker-compose.yml default TRUST_PROXY setting needs verification

---

### TRC-R5C1-17 — Download route: `affectedRows ?? 1` fallback allows double-download if Drizzle result shape changes

**File:** `apps/web/src/app/api/download/[imageId]/route.ts:394-400`

**Observation:** The single-use enforcement check:
```ts
const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
const affected = header?.affectedRows ?? 1;
if (affected === 0) { ... 410 ... }
```

The `?? 1` fallback: if the Drizzle/mysql2 result shape changes (e.g., returns `undefined` for `affectedRows` on a successful update), the fallback allows the download to proceed even when the row was already claimed.

**Hypothesis A:** If `header?.affectedRows` is undefined due to a Drizzle driver change, `affected` defaults to 1, and the download proceeds even if 0 rows were actually updated — allowing a second download on an already-claimed token.

**Hypothesis B:** The comment states "fall back to 1 (allow download) on shape mismatch to avoid a false-410." This is an explicit trade-off: prefer false-positive over false-negative for customer experience, accepting that a driver shape change could allow double-download.

**Evidence for A:**
- The fallback is `?? 1` (permissive), not `?? 0` (restrictive)
- If `affectedRows` is undefined and the token was already used, a second download is allowed

**Evidence against A:**
- MySQL2 / Drizzle has consistently returned `affectedRows` on UPDATE results for years
- The comment explains the intentional choice

**Severity:** MEDIUM — the `?? 1` fallback creates a single-use bypass on driver shape change
**Confidence:** Medium
**Classification:** Confirmed — intentional but risky trade-off

---

## Additional Suspicious Flows

### TRC-R5C1-18 — `retryFailedImage` action lacks `isAdmin()` check; only `requireSameOriginAdmin()` guards it

**File:** `apps/web/src/app/actions/images.ts:1042-1111`

**Observation:** `retryFailedImage(id)` at line 1042:
```ts
export async function retryFailedImage(id: number) {
    const originError = await requireSameOriginAdmin();
    if (originError) return originError;
    ...
```

It calls `requireSameOriginAdmin()` but does NOT call `isAdmin()` to verify the session is valid and unexpired. `requireSameOriginAdmin()` checks Origin/Referer headers for same-origin provenance, but it does NOT verify the admin session cookie.

**Hypothesis A (HIGH):** A request with a forged/expired session cookie but a same-origin Origin header will pass `requireSameOriginAdmin()` and reach the DB update and re-enqueue logic. The function clears `processing_error` and `failed_at` on an arbitrary image ID, and re-enqueues reprocessing for it.

**Evidence for A:**
- `action-guards.ts:37-44`: `requireSameOriginAdmin()` only calls `hasTrustedSameOrigin()` — checks Origin/Referer vs Host. Does NOT check session validity.
- `retryFailedImage` does not call `isAdmin()` or `getCurrentUser()` anywhere
- All other mutating actions call BOTH `requireSameOriginAdmin()` AND `isAdmin()`
- Pattern in `deleteImage`: line 543 calls `isAdmin()` explicitly
- Pattern in `updateImageMetadata`: line 797 calls `isAdmin()` explicitly

**Evidence against A:**
- Next.js server actions require the `Origin` header to match the app's own origin (CSRF protection). An external attacker cannot forge Origin to match the app's own domain.
- `hasTrustedSameOrigin()` checks Origin against Host — same defense as Next.js CSRF
- The Next.js CSRF mechanism provides the same protection as `isAdmin()` for cross-origin forgery
- But: an XSS attacker operating from the SAME origin CAN make same-origin requests without a valid admin session

**Rebuttal of B:** Even granting that Next.js CSRF covers cross-origin forgery, the missing `isAdmin()` check means any same-origin request (including from XSS payload) can trigger retryFailedImage with an ARBITRARY image ID. The function re-enqueues processing for ANY image that has `processed=false` and `processing_error IS NOT NULL`. An XSS attacker can cause arbitrary image re-processing.

**Severity:** HIGH — `retryFailedImage` is the ONLY mutating action in images.ts that omits `isAdmin()`; any same-origin unauthenticated request (XSS context) can trigger it
**Confidence:** High
**Classification:** Confirmed

---

### TRC-R5C1-19 — `bulkUpdateImages` calls `requireSameOriginAdmin()` BEFORE `isAdmin()`; but other actions call `isAdmin()` first

**File:** `apps/web/src/app/actions/images.ts:869-875`

**Observation:**
```ts
export async function bulkUpdateImages(input: BulkUpdateImagesInput) {
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
```

vs the pattern in `deleteImage` (line 543):
```ts
if (!(await isAdmin())) { return { error: t('unauthorized') }; }
const originError = await requireSameOriginAdmin();
```

**Observation:** `bulkUpdateImages` inverts the order: origin check first, then session check. The difference is only observable when Origin is valid but session is expired: `requireSameOriginAdmin()` passes, then `isAdmin()` fails. Both checks are performed; order matters only for performance (which DB lookup runs first) and error message leakage (same error string from both branches). Not a security gap.

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — not a vulnerability, minor inconsistency

---

### TRC-R5C1-20 — `x-gk-admin-render` header is set based on cookie PRESENCE, not validity

**File:** `apps/web/src/proxy.ts:128-130`

**Observation:**
```ts
if (request.cookies.get('admin_session')) {
    response.headers.set('x-gk-admin-render', '1');
}
```

The presence of ANY `admin_session` cookie (even expired, malformed, or forged) sets `x-gk-admin-render: 1`, which tells the SW to NOT cache the HTML offline fallback.

**Hypothesis A:** An attacker who sets a cookie named `admin_session` with any value will cause the server to mark ALL their page responses as admin-rendered, preventing SW offline caching for that user. This is a minor DoS against the offline fallback feature.

**Hypothesis B:** This is intentional — the header is a hint to the SW, not a security decision. The cookie presence check is cheap and conservative: it's safer to under-cache than to cache a personalized admin page in the offline store.

**Current best explanation:** B is correct. The impact is a degraded offline experience for a user who has an old/invalid admin_session cookie, not a security gap. Not a vulnerability.

**Severity:** LOW — offline PWA DoS for users with stale admin cookies
**Confidence:** High
**Classification:** Confirmed — intentional conservative design

---

### TRC-R5C1-21 — SW `isSensitiveResponse` returns true for ANY `no-store` response, preventing caching of error pages

**File:** `apps/web/public/sw.js:56-61`

**Observation:**
```js
function isSensitiveResponse(response) {
    if (!response) return true;
    if (response.status === 401 || response.status === 403) return true;
    const cc = response.headers.get('Cache-Control') ?? '';
    return cc.includes('no-store');
}
```

All public gallery pages use `revalidate = 0` which produces `Cache-Control: no-store` (dynamic rendering). However, the `networkFirstHtml` function (line 252) bypasses `isSensitiveResponse` for HTML routes and uses a dedicated `x-gk-admin-render` check instead. The image stale-while-revalidate path (line 179) DOES use `isSensitiveResponse`, and since image derivatives use `Cache-Control: public, max-age=3600, must-revalidate` (NOT `no-store`), they are never filtered as sensitive. This is correct.

**Severity:** INFO
**Confidence:** High
**Classification:** Confirmed — correct design

---

## Summary Table

| ID | Severity | Flow | Description |
|---|---|---|---|
| TRC-R5C1-01 | LOW | Upload→Queue | Bootstrap jobs use LIVE config, not upload-time snapshot |
| TRC-R5C1-02 | LOW | Serving→SW | SW ETag probe vs Next static ETag format mismatch in edge case |
| TRC-R5C1-03 | LOW | ETag | Settings hash 5s stale window |
| TRC-R5C1-04 | INFO | Auth | Middleware is format-only; crypto at action level (intentional) |
| TRC-R5C1-05 | LOW | Auth | No session rotation on privilege use |
| TRC-R5C1-06 | INFO | Auth | React cache() stale session within single SSR request |
| TRC-R5C1-07 | INFO | Analytics | view_count buffer lost on SIGKILL (documented) |
| TRC-R5C1-08 | INFO | Analytics | View recording swallows FK errors silently |
| TRC-R5C1-09 | LOW | Settings | image_sizes TOCTOU between check and commit (mitigated by advisory lock) |
| TRC-R5C1-10 | INFO | Settings→Backfill | image_sizes change doesn't trigger backfill (documented) |
| TRC-R5C1-11 | LOW | Delete race | enqueued.delete does not cancel running job (handled by affectedRows check) |
| TRC-R5C1-12 | INFO | Restore race | Upload/restore interlock is correct |
| TRC-R5C1-13 | LOW | Restore | Failed restore may leave DB inconsistent before bootstrap |
| TRC-R5C1-14 | MEDIUM | Download+GPS | On-disk originals uploaded before strip_gps_on_upload enabled retain GPS in paid downloads |
| TRC-R5C1-15 | MEDIUM | Download | 24h token expiry with no re-issue path; manual ops required |
| TRC-R5C1-16 | HIGH | Checkout | Stripe idempotency key collision when TRUST_PROXY not set → two buyers share a session |
| TRC-R5C1-17 | MEDIUM | Download | `affectedRows ?? 1` fallback permits double-download on driver shape change |
| TRC-R5C1-18 | HIGH | Auth | `retryFailedImage` missing `isAdmin()` check; same-origin request suffices |
| TRC-R5C1-19 | INFO | Auth | `bulkUpdateImages` inverts origin/session check order |
| TRC-R5C1-20 | LOW | SW/Auth | `x-gk-admin-render` based on cookie presence not validity |
| TRC-R5C1-21 | INFO | SW | isSensitiveResponse correctly scoped for HTML vs images |

---

## CRIT/HIGH Findings — Detailed

### TRC-R5C1-18 (HIGH): `retryFailedImage` missing `isAdmin()` check

**File:** `apps/web/src/app/actions/images.ts:1042-1046`

**Impact:** Any same-origin unauthenticated request (including XSS payload, CSRF with matching Origin, or a request from an authenticated-but-expired session) can:
1. Clear `processing_error` and `failed_at` on ANY image with a failed state
2. Re-enqueue arbitrary image processing

**Fix:** Add `if (!(await isAdmin())) return { error: 'Unauthorized' };` immediately after the `requireSameOriginAdmin()` check, consistent with all other mutating actions in the file.

---

### TRC-R5C1-16 (HIGH): Stripe idempotency key collision when TRUST_PROXY not set

**File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:178`

**Impact:** When deployed without a reverse proxy that sets the real client IP (or without `TRUST_PROXY=true`), all checkout attempts by ANY user for the same image in the same 60-second window use the same Stripe idempotency key (`checkout-{imageId}-unknown-{minute}`). Stripe returns the FIRST buyer's session URL to subsequent buyers. Depending on who completes payment, entitlements are created for the wrong buyer's session.

**Fix:** If `ip === 'unknown'`, do not use an idempotency key (pass `{}` options instead), OR add a random component that is consistent per-session but not per-IP. Document that this is unsafe without TRUST_PROXY in deployment docs.

---

## Critical Unknowns and Discriminating Probes

1. **TRC-R5C1-18** — Verify `retryFailedImage` is exploitable without a valid session:
   - Probe: Send `POST /[locale]/admin/dashboard` (server action invocation) for `retryFailedImage` with a request that has a valid `Origin: [app-domain]` header but no `admin_session` cookie. Confirm `requireSameOriginAdmin()` passes but the action proceeds to the DB update without `isAdmin()` rejection.

2. **TRC-R5C1-16** — Verify TRUST_PROXY default in production docker-compose:
   - Probe: Check `apps/web/docker-compose.yml` for `TRUST_PROXY` environment variable. If absent or false, the HIGH finding is confirmed for the default deployment.

3. **TRC-R5C1-14** — GPS in paid downloads:
   - Probe: Upload an image with GPS data when `strip_gps_on_upload=false` (which is the default, and the lock prevents changing it). Download via the paid route. Verify with `exiftool` that GPS IFD is present in the streamed original.

---

## Uncertainty Notes

- TRC-R5C1-16: The Stripe idempotency key collision requires `TRUST_PROXY` to be unset AND two users buying the same image within the same 60-second window. Severity depends on actual deployment configuration.
- TRC-R5C1-17: The `?? 1` fallback for affectedRows has been intentionally chosen and documented; a driver change making affectedRows undefined on a successful UPDATE is extremely unlikely with mysql2/Drizzle.
- TRC-R5C1-14: The `strip_gps_on_upload` lock (`settings.ts:125-133`) makes the gap unreachable in normal operation; GPS exposure in paid downloads only matters when the operator intended GPS stripping but the lock prevented retroactive application.
