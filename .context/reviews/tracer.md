# PROMPT 1 / Cycle 5 — Tracer Deep Repository Review

Scope: causal tracing across request origin → rate limit → auth/session → server actions → DB → file/image processing → revalidation; backup/restore; share links; upload queue; public rendering.

Mode: read-only review except for writing this report. No implementation, no commit.

Verification run while reviewing:

```text
npm run lint:api-auth --workspace=apps/web && npm run lint:action-origin --workspace=apps/web
OK: src/app/api/admin/db/download/route.ts
All mutating server actions enforce same-origin provenance.
```

## Trace-relevant inventory inspected first

### Request origin, auth/session, rate limits
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/proxy.ts`

### Mutating server actions and revalidation
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/audit.ts`

### DB, backup/restore, and migration scripts
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/seed-admin.ts`

### File/image storage and upload queue
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`

### Public/share/admin rendering and upload UI
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/photo-viewer.tsx`

### Config, docs, static checks, tests
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/README.md`
- `scripts/deploy-remote.sh`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- All files under `apps/web/src/__tests__/` listed in the final files-reviewed section.

## Findings

### HIGH — Restore maintenance and queue quiescing are process-local only

- **Status:** confirmed in code; deployment-dependent runtime failure path.
- **Confidence:** high.
- **Evidence:**
  - `apps/web/src/lib/restore-maintenance.ts:1-22` stores restore state in a `globalThis` symbol with a single process-local `active` boolean.
  - `apps/web/src/lib/restore-maintenance.ts:44-55` toggles only that process-local flag.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:263-269` correctly uses a MySQL advisory lock to serialize restore calls, but `apps/web/src/app/[locale]/admin/db-actions.ts:271-299` only calls `beginRestoreMaintenance()`, `flushBufferedSharedGroupViewCounts()`, and `quiesceImageProcessingQueueForRestore()` in the process handling the request.
  - `apps/web/src/app/actions/images.ts:91-94`, `apps/web/src/app/actions/sharing.ts:98-99`, and `apps/web/src/lib/data.ts:28-31` consult the same local flag, so other workers do not see maintenance.
  - `apps/web/src/lib/image-queue.ts:181-185` drops new queue jobs only if that same local queue state says restore is active.
- **Concrete failure path:**
  1. Production runs multiple Node workers/containers or a blue-green deploy overlaps processes.
  2. Worker A starts `restoreDatabase()`, obtains `GET_LOCK('gallerykit_db_restore')`, sets its local maintenance flag, flushes its local view-count buffer, and pauses only its local image queue.
  3. Worker B still has `restoreMaintenance.active === false` and continues to accept uploads, share-link mutations, image deletes, settings changes, and shared-group view-count buffers while MySQL is replaying the dump.
  4. Writes can be lost by the restore, partially interleaved with restored rows, or leave DB rows pointing at files created/deleted outside the restored data snapshot. Worker B can also keep processing images from the old/new DB state during restore.
- **Suggested fix:** make maintenance globally visible and enforced. Options: DB-backed maintenance table/setting with TTL, or a shared check of `IS_USED_LOCK('gallerykit_db_restore')`/`GET_LOCK(..., 0)` around every mutating action and queue bootstrap/worker loop. Ensure all workers poll or check the global state before accepting mutations, queueing jobs, flushing view counts, or processing images. If multi-process is unsupported, fail fast/document a single-process deployment invariant.

### MEDIUM — Background image queue can give up with no durable failed state or admin retry path

- **Status:** confirmed in code.
- **Confidence:** high.
- **Evidence:**
  - `apps/web/src/app/actions/images.ts:217-241` inserts an image row immediately with `processed: false`.
  - `apps/web/src/app/actions/images.ts:297-315` enqueues background processing and counts the upload as successful before derivatives exist.
  - `apps/web/src/lib/image-queue.ts:234-240` returns on missing original file without updating the row or recording an error.
  - `apps/web/src/lib/image-queue.ts:271-289` marks `processed=true` only after all derivatives are verified.
  - `apps/web/src/lib/image-queue.ts:302-315` retries a thrown processing error up to `MAX_RETRIES` and then only logs “giving up”.
  - `apps/web/src/lib/image-queue.ts:319-327` removes the job from in-memory tracking after giving up.
  - `apps/web/src/lib/image-queue.ts:378-427` bootstraps pending rows on startup and then marks `state.bootstrapped = pending.length < BOOTSTRAP_BATCH_SIZE`; once bootstrapped, failed low-volume pending rows are not periodically retried.
  - Share links require processed rows: `apps/web/src/app/actions/sharing.ts:108-112` for single photos and `apps/web/src/app/actions/sharing.ts:217-226` for groups.
- **Concrete failure path:**
  1. Admin uploads an image; the action persists the original and DB row, then returns success after queueing.
  2. Sharp/AVIF/JPEG generation fails repeatedly, disk output verification fails, the original file is missing after a restore, or the job cannot acquire a processing claim enough times.
  3. The queue logs and drops the job from memory, but the database row remains `processed=false` with no `processing_failed`, `processing_error`, retry timestamp, or durable retry record.
  4. Public pages never show the image, share-link creation reports “still processing”, and the admin dashboard can show an indefinitely pending item until a restart/bootstrap happens. Some paths, such as missing original, will also fail again on bootstrap.
- **Suggested fix:** add durable processing state (`queued|processing|processed|failed`), attempt count, last error, and next retry timestamp. Mark rows failed when max retries are exhausted or the original file is missing. Add an admin retry/reconcile action and a periodic bootstrap sweep for failed/retryable rows. Keep queue state in DB if multiple workers are expected.

### MEDIUM — Upload disk-space precheck is bypassed when the upload root is absent or `statfs` fails

- **Status:** confirmed in code.
- **Confidence:** medium-high.
- **Evidence:**
  - `apps/web/src/app/actions/images.ts:148-157` calls `statfs(UPLOAD_DIR_ORIGINAL)` and catches all errors with “proceed anyway”.
  - `apps/web/src/lib/process-image.ts:45-60` creates upload directories later inside `ensureDirs()`.
  - `apps/web/src/lib/process-image.ts:224-247` then streams each accepted file to disk, with per-file allowance up to 200 MiB (`apps/web/src/lib/process-image.ts:43`) and larger total batch limits documented in `apps/web/README.md:39`.
- **Concrete failure path:**
  1. Fresh deployment, moved volume, permissions regression, or missing `data/uploads/original` makes `statfs(UPLOAD_DIR_ORIGINAL)` throw `ENOENT`/`EACCES`.
  2. The upload action silently skips the free-space guard and accepts a large multipart upload.
  3. `saveOriginalAndGetMetadata()` creates directories later and streams the file to disk. On a nearly full or wrong filesystem, writes can fail mid-upload, consume remaining disk, or cause repeated admin-facing “all uploads failed” while leaving disk pressure for the process/host.
- **Suggested fix:** ensure upload directories before the `statfs` precheck, or `statfs` the nearest existing parent/mount. Treat unexpected `statfs` errors as a hard upload failure. Prefer available blocks (`bavail` where exposed) over total free blocks (`bfree`) if the runtime provides it.

### MEDIUM — Database backup/restore does not cover uploaded image assets or reconcile restored rows with files

- **Status:** confirmed product/data-loss risk.
- **Confidence:** high.
- **Evidence:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:136-143` runs `mysqldump ... DB_NAME` only.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:220-221` exposes a `.sql` backup download URL.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:404-409` restores by piping a SQL file into `mysql --one-database DB_NAME`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:456-457` revalidates app data after SQL restore but does not verify asset files.
  - Public reads trust DB metadata: `apps/web/src/lib/data.ts:441-459` returns processed image rows by DB state, and `apps/web/src/lib/data.ts:617-630` returns processed shared-group images by DB state.
  - Missing derivative/original files become HTTP 404s at serving time: `apps/web/src/lib/serve-upload.ts:104-110`.
- **Concrete failure path:**
  1. Operator downloads the built-in backup and later restores it on a fresh server, after disk loss, or after copying only the SQL file.
  2. The restore recreates rows with `processed=true` and filenames, but no `data/uploads/{jpeg,webp,avif,original}` files are restored.
  3. Public gallery pages, photo pages, and share links render DB rows that point to `/uploads/...` URLs; the upload route returns 404 for missing files. Pending rows whose originals are missing also hit the queue’s “file not found” return path and remain unprocessed.
- **Suggested fix:** label the current feature explicitly as “database-only backup” in UI/docs. Prefer adding an asset archive/manifest to backup/restore. At minimum, run a post-restore reconciliation that verifies every `processed=true` row has expected derivative files, marks missing rows failed/unprocessed, and surfaces an admin warning with counts.

### MEDIUM — Proxy misconfiguration collapses rate limits to the shared key `unknown`

- **Status:** confirmed behavior; likely deployment risk.
- **Confidence:** medium-high.
- **Evidence:**
  - `apps/web/src/lib/rate-limit.ts:61-87` trusts `x-forwarded-for`/`x-real-ip` only when `TRUST_PROXY === 'true'`; otherwise it returns the constant `unknown`.
  - `apps/web/src/lib/rate-limit.ts:81-85` only logs a warning once in production when proxy headers are present.
  - `apps/web/README.md:40` documents that `TRUST_PROXY=true` is needed behind the reverse proxy.
  - Login uses the returned IP as the in-memory and DB-backed login bucket: `apps/web/src/app/actions/auth.ts:96-142`.
  - Uploads use it in the per-user upload tracker key: `apps/web/src/app/actions/images.ts:125-128`.
  - Share links use it for share creation buckets: `apps/web/src/app/actions/sharing.ts:101-129` and `apps/web/src/app/actions/sharing.ts:198-240`.
- **Concrete failure path:**
  1. App is deployed behind nginx/load balancer but `TRUST_PROXY` is unset or typoed.
  2. All clients share the rate-limit identity `unknown`.
  3. One client can exhaust the global login budget, causing everyone to hit “too many attempts”; search/share/upload/user-creation quotas can also become shared global throttles. This is an availability issue rather than a bypass.
- **Suggested fix:** fail fast or expose a health/config error in production when forwarded headers are present and `TRUST_PROXY` is not configured. Consider requiring an explicit trusted proxy mode/client-IP header rather than a once-only warning, and include a deploy smoke test for distinct client IP extraction.

### LOW — File-serving and backup download have a local-filesystem TOCTOU gap between validation and stream open

- **Status:** risk; local attacker/prior write access required.
- **Confidence:** medium.
- **Evidence:**
  - Upload serving validates with `lstat()` and `realpath()` at `apps/web/src/lib/serve-upload.ts:75-84`, then later opens `createReadStream(absolutePath)` at `apps/web/src/lib/serve-upload.ts:91-92`.
  - Backup download validates with `lstat()` and `realpath()` at `apps/web/src/app/api/admin/db/download/route.ts:60-74`, then later opens `createReadStream(filePath)` at `apps/web/src/app/api/admin/db/download/route.ts:82-83`.
- **Concrete failure path:**
  1. A local user/process with write access to the upload or backup directory races between the validation and the stream open.
  2. It swaps the validated file path for a symlink or another file after the `lstat`/`realpath` checks.
  3. The route streams whatever `createReadStream()` opens. A remote web attacker cannot exploit this without filesystem write capability, so this is defense-in-depth.
- **Suggested fix:** open a file descriptor with no-follow semantics where available (`O_NOFOLLOW`), `fstat` the descriptor, verify containment/inode properties, and stream from that descriptor. Also keep upload/backup directories owned and writable only by the app user.

## Watchlist / hypotheses examined but not promoted

- **Origin/CSRF guard looked consistent for mutating server actions.** `requireSameOriginAdmin()` centralizes strict Origin/Referer checks at `apps/web/src/lib/action-guards.ts:37-44`; static guard check passed for all mutating server actions.
- **Admin backup download has both auth and same-origin checks.** `withAdminAuth` wraps the route at `apps/web/src/app/api/admin/db/download/route.ts:13`, and strict same-origin enforcement is at `apps/web/src/app/api/admin/db/download/route.ts:27-32`.
- **Public privacy fields appear intentionally trimmed.** `apps/web/src/lib/data.ts:154-181` selects public-safe fields; GPS display in `apps/web/src/components/photo-viewer.tsx` is gated behind admin-only rendering (`apps/web/src/components/photo-viewer.tsx:501-519`, inspected during review).
- **Share links require processed rows before creation.** Single-photo share creation checks `processed` at `apps/web/src/app/actions/sharing.ts:108-112`; group creation checks every image at `apps/web/src/app/actions/sharing.ts:217-226`. This blocks broken unprocessed shares but amplifies the queue-stuck finding above.
- **Public gallery/photo/topic pages opt out of stale ISR for processed-image visibility.** Home page sets `revalidate = 0` at `apps/web/src/app/[locale]/(public)/page.tsx:14-16`; topic page at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`; photo page at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:29-31`.
- **Shared page caching did not surface as a confirmed stale-data bug in this pass.** The locale layout calls `getCspNonce()` at `apps/web/src/app/[locale]/layout.tsx:78`, and `getCspNonce()` calls `headers()` in production at `apps/web/src/lib/csp-nonce.ts:3-8`, which makes the tree request-bound in production. If that layout is refactored away from request headers, revisit share-page cache/revalidation.
- **`/api/og` has a minor robustness/cache smell, not a traced failure:** `apps/web/src/app/api/og/route.tsx:30-34` computes a topic label before validating topic, and `apps/web/src/app/api/og/route.tsx:39` uses a 1-hour public cache. Validate before derivation if this endpoint becomes abuse-prone or SEO settings must invalidate instantly.
- **Shared photo viewer exposes JPEG download links.** `apps/web/src/components/photo-viewer.tsx:101-103` derives a JPEG download URL and `apps/web/src/components/photo-viewer.tsx:548-557` renders it whenever available, including shared views. This looks product-intent-dependent, not a bug unless share links are meant to be view-only.

## Final missed-issues sweep

- Rechecked request provenance from `request-origin.ts` through `action-guards.ts`, `api-auth.ts`, login/password actions, admin DB actions, image actions, share actions, topic/tag/settings/SEO actions, and the static guard scripts. No missing mutating-action origin check found.
- Rechecked rate-limit paths for login, account lockout, share creation, upload tracking, public search/action paths, and admin-user creation. The main causal risk is availability from `unknown` key collapse when proxy trust is misconfigured.
- Rechecked auth/session flow from login through session creation/deletion and admin layouts. No session fixation or public session leak was confirmed in this tracing pass.
- Rechecked DB writes followed by revalidation on uploads, deletes, metadata edits, share-link create/revoke/delete, SEO/settings/topic/tag mutations, restore success, and public rendering. Main issue is not missing revalidation but stale/missing file state outside DB.
- Rechecked backup/restore SQL scanning, admin download auth, backup filename validation, and restore temp-file handling. No remote path traversal finding confirmed; asset incompleteness and process-local maintenance remain the traced risks.
- Rechecked upload queue bootstrap, retry, shutdown, restore quiesce/resume, image derivative verification, and public `processed=true` reads. Durable failed-state absence remains the main queue correctness gap.
- Rechecked public rendering and share-link data access for original filename/GPS leaks. Public selects and admin-only GPS display look intentional; derivative JPEG download in shared viewer is a product-policy watch item.

## Files reviewed

### Source/config/docs
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/README.md`
- `scripts/deploy-remote.sh`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/upload-tracker-state.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`

### Tests inventoried/inspected for coverage signals
- `apps/web/src/__tests__/action-guards.test.ts`
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-rethrow.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/content-security-policy.test.ts`
- `apps/web/src/__tests__/csv-escape.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/exif-datetime.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/histogram.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/__tests__/image-queue.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/images-delete-revalidation.test.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/mysql-cli-ssl.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/storage-local.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/tag-records.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/tags-actions.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/upload-limits.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`
