# Cycle 1 Deep Review — Tracer

Scope: `/Users/hletrd/flash-shared/gallery`  
Role: trace suspicious cross-file flows only. No source edits.

## Inventory / flow map

- **Upload → processing → DB → UI**
  - Client: `apps/web/src/components/upload-dropzone.tsx:199-246` builds one-file `FormData` and calls `uploadImages` sequentially.
  - Action: `apps/web/src/app/actions/images.ts:116-244` authenticates, origin-checks, validates topic/tags/files, acquires upload-processing contract lock, and pre-claims upload quota.
  - Disk/metadata: `apps/web/src/lib/process-image.ts:233-380` streams original to private storage, validates with Sharp, extracts EXIF/blur/ICC metadata.
  - DB enqueue: `apps/web/src/app/actions/images.ts:288-388` inserts an unprocessed `images` row, persists tags, then calls `enqueueImageProcessing`.
  - Queue: `apps/web/src/lib/image-queue.ts:193-345` takes a per-image MySQL advisory lock, renders variants via `processImageFormats`, verifies output files, then flips `processed=true` at `apps/web/src/lib/image-queue.ts:300-303`.
  - Public reads filter to processed rows: `apps/web/src/lib/data.ts:344-346`, `apps/web/src/lib/data.ts:627-640`, `apps/web/src/lib/data.ts:747-750`, `apps/web/src/lib/data.ts:807-811`.
  - Admin dashboard intentionally includes unprocessed rows: `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:15-20`.
- **Auth/session**
  - Middleware only checks protected admin cookie shape: `apps/web/src/proxy.ts:77-95`; actions/API still verify sessions in depth.
  - Login creates a hashed DB session + `admin_session` cookie: `apps/web/src/app/actions/auth.ts:183-222`.
  - Session verifier validates HMAC, token age, DB session, and expiry: `apps/web/src/lib/session.ts:94-144`.
  - Password change rotates all sessions and inserts a fresh one in a transaction: `apps/web/src/app/actions/auth.ts:363-393`.
- **Server actions / mutation guard**
  - Mutating action modules consistently call `isAdmin()`/`getCurrentUser()` plus `requireSameOriginAdmin()`; helper is `apps/web/src/lib/action-guards.ts:37-43` using request-origin policy from `apps/web/src/lib/request-origin.ts:83-107`.
- **Sharing**
  - Single photo share: `apps/web/src/app/actions/sharing.ts:92-188` writes `images.share_key`.
  - Group share: `apps/web/src/app/actions/sharing.ts:190-308` inserts `shared_groups` and `shared_group_images` in a transaction.
  - Public share reads: `apps/web/src/lib/data.ts:736-772` and `apps/web/src/lib/data.ts:778-853`.
- **Admin DB/deployment**
  - Backup/export/restore actions: `apps/web/src/app/[locale]/admin/db-actions.ts:54-521`.
  - Backup download API route: `apps/web/src/app/api/admin/db/download/route.ts:13-108`.
  - Queue bootstrap/shutdown: `apps/web/src/instrumentation.ts:1-35`.
  - Container/deploy topology: `apps/web/Dockerfile:60-90`, `apps/web/docker-compose.yml:22-25`, `apps/web/deploy.sh:27-34`.

## Findings

### T1 — Large backlog bootstrap can strand failed low-id processing jobs

- **Severity:** High
- **Confidence:** Medium-high
- **Flow:** upload → pending DB row → bootstrap cursor → queue retry → UI never sees processed image
- **Evidence:**
  - Bootstrap resumes with `id > bootstrapCursorId`: `apps/web/src/lib/image-queue.ts:407-422`.
  - It advances the cursor to the last scanned pending row and marks bootstrapped once a later pass returns fewer than the batch size: `apps/web/src/lib/image-queue.ts:435-443`.
  - When a job exhausts processing retries, the queue sets `state.bootstrapped = false` and schedules a bootstrap retry, but does **not** reset `bootstrapCursorId`: `apps/web/src/lib/image-queue.ts:328-331`.
  - Future bootstrap calls can also return early if `state.bootstrapped` becomes true: `apps/web/src/lib/image-queue.ts:395-398`.
- **Competing hypotheses checked:**
  - The cursor was likely added to avoid permanently failing low IDs starving later rows. That part works while scanning forward, but once the end is reached and `bootstrapped` flips true, a still-pending low ID below the cursor may no longer be revisited.
  - Small queues with fewer than 500 pending rows are less affected because `bootstrapCursorId` is reset to `null` in the same bootstrap pass.
- **Failure scenario:** Import/restore or bulk upload creates at least `BOOTSTRAP_BATCH_SIZE` pending images. Image `id=1` fails all queue retries due to a transient filesystem/Sharp error. Bootstrap continues past cursor 500 to process later IDs, then reaches the end and marks itself bootstrapped. The failed low-id row remains `processed=false`; public routes filter it out, and the scheduled retry can be skipped by the `state.bootstrapped` early return.
- **Suggested fix:** On max-retry failure, reset `state.bootstrapCursorId = null` before scheduling bootstrap retry, or add a two-phase bootstrap that wraps to the beginning before setting `bootstrapped=true`. Add a regression test with `BOOTSTRAP_BATCH_SIZE + 1` pending rows where the first row fails max retries and is later reselected.

### T2 — Concurrent photo-share loser consumes rate-limit quota while returning an existing key

- **Severity:** Medium
- **Confidence:** High
- **Flow:** admin share action → rate-limit DB/in-memory counters → conditional share-key update
- **Evidence:**
  - `createPhotoShareLink` pre-increments in-memory and DB share limits before the conditional update: `apps/web/src/app/actions/sharing.ts:118-130`.
  - If another request already set the key, the loser re-fetches and returns the existing key without rolling either counter back: `apps/web/src/app/actions/sharing.ts:156-168`.
  - A full rollback helper already exists for non-executed share attempts: `apps/web/src/app/actions/sharing.ts:85-90`.
- **Competing hypotheses checked:**
  - If the image already has a key before rate limiting, the function returns at `apps/web/src/app/actions/sharing.ts:114-116` and does not charge quota. The leak is specifically the race window after pre-increment and before the conditional `UPDATE` sees `affectedRows=0`.
- **Failure scenario:** An admin double-clicks share or two tabs share the same unshared image. One request creates the key; the other returns the key too, but still burns one of the 20/min share attempts. Repeating this across selections can trigger `tooManyShareRequests` even though most attempts were idempotent reads.
- **Suggested fix:** In the `refreshedImage.share_key` branch, call `rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart)` before returning the key, because this request did not create a new share link.

### T3 — Deleting all images from a group share leaves a live empty share URL

- **Severity:** Medium
- **Confidence:** High
- **Flow:** sharing → image deletion → FK cascade → public group UI
- **Evidence:**
  - Group links are stored in `shared_groups`; membership rows cascade from images through `shared_group_images.imageId`: `apps/web/src/db/schema.ts:87-104`.
  - Single and batch image deletes remove `images` rows but do not remove now-empty `shared_groups`: `apps/web/src/app/actions/images.ts:486-490`, `apps/web/src/app/actions/images.ts:592-596`.
  - `getSharedGroup` returns a group even when `groupImages` is empty: `apps/web/src/lib/data.ts:801-853`.
  - The public group page renders an empty-state for a live group URL: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:195-199`.
- **Competing hypotheses checked:**
  - Revalidation of affected group keys is present (`apps/web/src/app/actions/images.ts:475-477`, `apps/web/src/app/actions/images.ts:577-580`), so this is not stale cache. It is persisted orphan group state.
- **Failure scenario:** Admin creates a group share with photos A/B, sends the link, then deletes A/B. The share key remains valid and shows an empty shared page rather than revoking/404ing. There is also no active admin listing using `deleteGroupShareLink`, so orphan groups can accumulate.
- **Suggested fix:** After image deletes, delete any affected `shared_groups` with zero remaining `shared_group_images`, or make `getSharedGroup` return `null` when `groupImages.length === 0`. Prefer deleting or expiring empty groups so view-count buffering does not keep touching dead shares.

### T4 — Upload tracker conflates quota usage with active upload claims and can falsely lock settings after cleanup

- **Severity:** Low-medium
- **Confidence:** High
- **Flow:** upload quota → settings mutation lock
- **Evidence:**
  - Upload action pre-claims count/bytes after validation: `apps/web/src/app/actions/images.ts:238-244`.
  - `settleUploadTrackerClaim` leaves successful upload count/bytes in the tracker for quota enforcement: `apps/web/src/lib/upload-tracker.ts:19-32`.
  - `hasActiveUploadClaims` treats any positive count/bytes as an active in-flight upload: `apps/web/src/lib/upload-tracker-state.ts:52-60`.
  - Settings changes that affect the upload-processing contract are blocked when `hasActiveUploadClaims()` is true: `apps/web/src/app/actions/settings.ts:75-79`.
- **Competing hypotheses checked:**
  - Settings also lock `image_sizes` and `strip_gps_on_upload` when any image exists: `apps/web/src/app/actions/settings.ts:110-138`. That permanent image-existence lock masks the tracker bug during normal operation, but not after all images are deleted inside the one-hour upload window.
- **Failure scenario:** Admin uploads one image, then deletes it, leaving the gallery empty. For the remainder of the upload tracker window, changing `image_sizes` or `strip_gps_on_upload` can still return `uploadSettingsLocked` even though no upload is running and no image exists.
- **Suggested fix:** Split tracker state into (a) rolling quota counters and (b) active in-flight claims. Decrement active claims on every settled request, but leave quota counters for rate limiting. Make `hasActiveUploadClaims()` consult only the in-flight counter.

### T5 — Docker image relies on compose-mounted `public/`; standalone image lacks static public assets

- **Severity:** Medium
- **Confidence:** Medium
- **Flow:** deployment → static assets → UI/runtime behavior
- **Evidence:**
  - Dockerfile copies standalone server, `.next/static`, drizzle, and scripts, but not `apps/web/public` assets; it only creates `apps/web/public/uploads`: `apps/web/Dockerfile:60-73`.
  - Compose mounts host `./public` over `/app/apps/web/public`: `apps/web/docker-compose.yml:22-25`.
  - The image start command is otherwise a normal standalone server: `apps/web/Dockerfile:86-90`.
- **Competing hypotheses checked:**
  - The current `apps/web/deploy.sh` path uses compose (`apps/web/deploy.sh:27-34`), so production via that script probably gets the mount. The hidden bug is image portability: `docker run`, Kubernetes, or any deploy path that does not mount the source `public/` tree loses fonts, workers, and other public assets.
- **Failure scenario:** Operator builds/pushes the Docker image and runs it outside this compose file. Next serves pages, but `/fonts/PretendardVariable.woff2`, `/histogram-worker.js`, and other public assets are absent, producing degraded typography/features and 404 noise.
- **Suggested fix:** Copy `apps/web/public` into the runner image, then mount only persistent upload/data subdirectories (`public/uploads` and `/app/data`) at runtime. If compose-only deployment is intentional, document the image as non-standalone and add a health/startup check for required public assets.

## Final sweep / notable non-findings

- Same-origin checks are centralized and broadly applied to mutating admin server actions through `requireSameOriginAdmin()`; read-only admin getters are explicitly annotated as origin-exempt.
- Original uploads are private by default (`UPLOAD_ORIGINAL_ROOT`) and the public upload serving helper only allows `jpeg`, `webp`, and `avif` directories with filename/realpath checks: `apps/web/src/lib/serve-upload.ts:32-102`.
- Lack of queue-side revalidation after `processed=true` looked suspicious, but public gallery/topic/share pages use `revalidate = 0` (`apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:14`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:15`), and admin dashboard is dynamic (`apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:6`). I did not classify it as a current stale-cache bug.
- Backup download route has both auth wrapper and same-origin/source enforcement plus filename and realpath containment checks: `apps/web/src/app/api/admin/db/download/route.ts:13-108`.
