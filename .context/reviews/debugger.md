# Debugger Review — Cycle 8 Prompt 1

Scope reviewed: repository-level source, tests, scripts, docs, and data-flow hot paths. I inspected the core server actions, request-origin/rate-limit helpers, image queue and restore flows, storage/cleanup helpers, and the public/admin route surfaces.

## Inventory read

- Docs/config: `README.md`, `apps/web/README.md`, `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`
- Core data flow: `apps/web/src/app/actions/*.ts`, `apps/web/src/lib/*.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Public/admin surfaces: `apps/web/src/app/[locale]/(public)/*`, `apps/web/src/app/[locale]/admin/(protected)/*`
- Schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*`
- Tests: `apps/web/src/__tests__/*.test.ts`, `apps/web/e2e/*.spec.ts`

## Findings

### CONFIRMED

### DBG8-01 — Restore maintenance is sampled only once, so in-flight writes can slip into the restore window
- **Location:** `apps/web/src/lib/restore-maintenance.ts:21-55`, `apps/web/src/app/actions/images.ts:82-245`
- **Severity / confidence:** HIGH / HIGH
- **Status:** Confirmed
- **Failure scenario:** `uploadImages()` checks `getRestoreMaintenanceMessage()` near the top, then spends significant time in file I/O and EXIF extraction before it reaches the DB insert and queue enqueue. If `restoreDatabase()` starts after that first check but before the insert, the upload can still commit during the restore window. That can produce a mixed backup/restore state: the restore may omit the late write, while the upload action reports success and may even enqueue work that runs before the restore quiesces the queue.
- **Suggested fix:** Make restore maintenance a real write lock, not just a preflight flag. The safest minimal fix is to gate all mutating actions on the same shared lock that `restoreDatabase()` holds, or to re-check immediately before the first DB mutation and abort/clean up the saved file if maintenance began. The current process-local flag is not atomic enough for long-running writes.

### DBG8-02 — `image_sizes` / `strip_gps_on_upload` changes can race an upload and violate the “locked once images exist” invariant
- **Location:** `apps/web/src/app/actions/settings.ts:74-147`, `apps/web/src/lib/upload-tracker-state.ts:15-61`
- **Severity / confidence:** HIGH / HIGH
- **Status:** Confirmed
- **Failure scenario:** The settings code checks `images` with a standalone `SELECT` before the update transaction. A concurrent upload can insert the first image after that check but before the settings commit, allowing a supposedly locked `image_sizes` or `strip_gps_on_upload` change to land anyway. That breaks the invariant the UI and public pages rely on: current image derivatives may no longer match the global size list, and pages can start requesting derivatives that were never generated for older images.
- **Suggested fix:** Move the “do any images exist?” check into the same critical section as the `admin_settings` write, and exclude concurrent uploads with the same lock/transaction boundary. `hasActiveUploadClaims()` is only an in-process hint; it cannot make the invariant atomic on its own.

### DBG8-03 — Deleted images can remain publicly accessible if filesystem cleanup fails
- **Location:** `apps/web/src/app/actions/images.ts:423-442` and `apps/web/src/app/actions/images.ts:535-577`; mitigation gap: `apps/web/src/lib/image-queue.ts:433-439`
- **Severity / confidence:** MEDIUM / HIGH
- **Status:** Confirmed
- **Failure scenario:** Both single-image and batch deletion remove the DB row first, then do file removal best-effort. If unlinking the original or derivative files fails because of a transient filesystem error, the action still returns success and the public `/uploads/...` assets remain on disk. There is no orphaned-image reconciliation pass on startup; the only boot-time scrubber removes `.tmp` files, so the leak can persist indefinitely until manual cleanup.
- **Suggested fix:** Treat non-zero cleanup failures as a partial failure, not a clean success. At minimum, surface the failure to the caller and schedule a retry/tombstone for the failed filenames so a later boot or maintenance pass can finish the deletion.

### MANUAL-VALIDATION RISKS

### DBG8-M1 — Restore/upload coordination state is process-local
- **Location:** `apps/web/src/lib/restore-maintenance.ts:7-18`, `apps/web/src/lib/upload-tracker-state.ts:15-20`, `apps/web/src/lib/image-queue.ts:113-131`
- **Why this is a risk:** The repository docs explicitly assume a single web instance / single writer. If the app is ever run with multiple replicas or a Node cluster, each process will have its own restore flag, upload tracker, and image queue, so the protections above stop being global.
- **Validation needed:** Confirm the deployment topology stays single-process, or move the coordination state into shared storage before scaling out.

## Final sweep

I rechecked the remaining hot paths after the findings above: auth/session, rate limiting, public data queries, upload/processing queue, restore/import/export, origin/CSP helpers, and cleanup scripts. I did not find any additional actionable issues beyond the three findings above, but the manual-validation risk remains if the deployment model deviates from the repo’s single-instance assumption.
