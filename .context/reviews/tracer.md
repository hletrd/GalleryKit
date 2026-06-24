# Cycle 3 Deep Review — Tracer

Date: 2026-06-24
HEAD: 1d5545cb

## Summary

This cycle's tracer review identified **5 new causal flow issues** across the seven traced flows. Two are rated **High** confidence, two **Medium**, and one **Low**. Additionally, 3 previously-open findings from Cycle 1 remain unaddressed and are re-evaluated with current evidence.

---

## New Findings

### TR-C3-01: `uploadImages` Tracker Pre-Increment Race on Concurrent Same-User Uploads

- **Flow:** Upload → Processing Contract → Image Queue
- **File:** `apps/web/src/app/actions/images.ts:190-252`
- **Suspicious Link:** The upload tracker uses a shared mutable object reference (`tracker = { count: 0, bytes: 0, windowStart: now }`) stored in a per-process Map. The pre-increment at line 250-252 (`tracker.bytes += totalSize; tracker.count += files.length`) mutates this object in-place. If two concurrent `uploadImages` calls from the same user+IP interleave between the validation checks (line 196-198) and the pre-increment, both can pass the limit check using the same stale `tracker` reference, then both increment, potentially exceeding the cumulative limit.
- **Failure Scenario:** An admin uploads 50 files (limit 100). Concurrently, another tab from the same admin uploads 60 files. Both read `tracker.count = 0` before either increments. Both pass the check. Both increment. Result: 110 files accepted in one window, exceeding the 100-file cap by 10%.
- **Suggested Fix:** The `set()` at line 193 stores the object reference, but the `get()` at line 190 returns the same reference. The pre-increment should use an atomic compare-and-swap pattern: re-read the tracker from the Map after the await boundary, re-validate, then increment. Or use the advisory lock (`uploadContractLock`) which already serializes contract changes — but this lock is released in the `finally` block at line 551, so it only protects the contract-change phase, not concurrent uploads from the same user.
- **Confidence:** Medium
- **Evidence:** The C8R-RPL-02 comment at line 184-189 acknowledges the TOCTOU for the *first insert* but the pre-increment pattern at line 250 doesn't re-validate after the await boundary. The `tracker` object is mutated in-place, not replaced.

---

### TR-C3-02: `deleteImage`/`deleteImages` File Cleanup Best-Effort After DB Delete — Orphaned Files on Partial Failure

- **Flow:** Data Mutation → File Cleanup → Resource Lifecycle
- **File:** `apps/web/src/app/actions/images.ts:555-649` (deleteImage), `651-807` (deleteImages)
- **Suspicious Link:** The DB transaction deletes the image row FIRST (lines 614-619), then file cleanup runs AFTER (lines 630-637). If file cleanup fails (e.g., `ENOENT` on a derivative that was already cleaned, or `EACCES` on a read-only mount), the DB row is gone but the files remain on disk. The `collectImageCleanupFailures` helper retries once with a 50ms delay, but on persistent failure, the file is orphaned. For `deleteImages`, the batch processes files with concurrency 5, but any single failure in a chunk is logged and continues — the remaining files in that chunk are still attempted, but failures are not re-enqueued.
- **Failure Scenario:** A NAS mount experiences transient I/O errors during a batch delete of 50 images. The DB transaction succeeds for all 50, but 5 derivative files fail cleanup. Those 5 files now have no DB row referencing them, and no background process will ever clean them up. Over months, this accumulates orphaned files in `public/uploads/`. The `data/uploads/original/` directory is also at risk.
- **Suggested Fix:** Consider a two-phase approach: (1) mark images as `pending_deletion` with a timestamp, (2) run cleanup, (3) delete DB row only after cleanup succeeds. Or add a background GC that scans derivative directories for files not referenced by any DB row. The existing `purgeOldViewEvents` pattern (chunked DELETE with bounded iterations) could be adapted for an orphan-file scan.
- **Confidence:** High
- **Evidence:** The `collectImageCleanupFailures` function at lines 49-79 retries once but returns failures without re-enqueueing. The cleanup runs AFTER the DB transaction commits (line 619). No background GC for orphaned files exists in the codebase.

---

### TR-C3-03: `recordPhotoView`/`recordTopicView`/`recordSharedGroupView` Fire-and-Forget Without Await — Silent Analytics Loss on DB Pressure

- **Flow:** Public Route → Analytics Recording → Error Propagation
- **File:** `apps/web/src/app/actions/public.ts:354-368` (recordPhotoView), `371-388` (recordTopicView), `392-404` (recordSharedGroupView)
- **Suspicious Link:** All three view-recording functions use `.catch(console.debug)` on the `db.insert()` promise without `await` (lines 360-367, 381-388, 397-404). The `console.debug` level is often filtered in production logging configurations. If the DB is under pressure (e.g., during a backfill run or high traffic), these INSERTs may fail silently. The per-IP rate limit (`isViewRecordRateLimited`) prevents flooding, but legitimate views are lost without any operational signal.
- **Failure Scenario:** During a color-pipeline backfill that consumes most of the 10-connection pool, a burst of legitimate gallery traffic arrives. The view-recording INSERTs queue behind backfill UPDATEs, time out, and are silently dropped. The admin's analytics dashboard shows artificially low view counts for that period. No error is logged at `warn` or `error` level.
- **Suggested Fix:** Change `console.debug` to `console.warn` so production log aggregation captures these failures. Or add a lightweight in-memory buffer for failed analytics INSERTs (similar to `viewCountBuffer` for shared groups) with periodic flush retry. At minimum, the log level should be `warn` since this indicates operational degradation.
- **Confidence:** Medium
- **Evidence:** Lines 360-367, 381-388, 397-404 all use `.catch((err: unknown) => { console.debug('[analytics] ...', err); })`. The `console.debug` level is typically filtered below `info` in production. The `isViewRecordRateLimited` at line 358 returns early without recording if rate-limited, but the DB failure path is silent.

---

### TR-C3-04: `getClientIp` Falls Back to `"unknown"` String — Shared Rate-Limit Bucket Under Misconfiguration

- **Flow:** Auth Flow → Rate Limiting → Request Origin
- **File:** `apps/web/src/lib/rate-limit.ts:145-176`
- **Suspicious Link:** When `TRUST_PROXY` is not set and `X-Forwarded-For`/`X-Real-Ip` headers are present, `getClientIp` returns the literal string `"unknown"` (line 170). This means ALL requests from ALL clients share a single rate-limit bucket. The `shouldWarnMissingTrustProxy` logs a warning once, but the warning is at `console.warn` which may be missed, and the system continues operating with a broken security posture.
- **Failure Scenario:** A production deployment behind nginx forgets to set `TRUST_PROXY=true`. After 5 failed login attempts from a botnet (each using different IPs but all seen as `"unknown"`), ALL users including the legitimate admin are locked out for 15 minutes. The admin cannot log in to fix the configuration. The `console.warn` at line 173 fires once but may be buried in startup logs.
- **Suggested Fix:** Consider making this a fatal error in production (throw or return a special sentinel that causes rate-limit functions to reject all requests with a clear error message). Or at minimum, elevate the log to `console.error` and add a health-check endpoint that reports this misconfiguration. The current "warn once and continue" pattern is too lenient for a security-critical misconfiguration.
- **Confidence:** High
- **Evidence:** Lines 170-176 return `"unknown"` unconditionally. The warning at line 173 fires once via `warnedMissingTrustProxy` flag. The `login()` function in `auth.ts` uses this IP for both per-IP and per-account rate limiting. The per-IP bucket with key `"unknown"` becomes a global lock.

---

### TR-C3-05: `revalidateLocalizedPaths` Silently Skips Empty Paths but `revalidatePath` May Throw on Invalid Paths

- **Flow:** Data Mutation → Cache Invalidation → Error Propagation
- **File:** `apps/web/src/lib/revalidation.ts:30-42`
- **Suspicious Link:** The `revalidateLocalizedPaths` function skips empty/falsy paths (line 35: `if (!path) continue;`), but `revalidatePath` from `next/cache` can throw on paths that don't exist in the app router. If a topic slug contains characters that produce an invalid path after localization, the revalidation may throw, but the caller in `images.ts` doesn't catch these throws (e.g., line 535: `revalidateLocalizedPaths('/', '/admin/dashboard', `/${topic}`);`).
- **Failure Scenario:** An admin creates a topic with a slug that passes `isValidSlug` (alphanumeric, hyphens, underscores) but somehow produces a path that `revalidatePath` rejects. The upload succeeds, the DB is updated, but the revalidation throws an unhandled exception. In Next.js, this may crash the server action or leave the cache stale. The `deleteImage` at line 646 passes `shareRevalidationPaths` which could contain invalid paths if share keys are malformed.
- **Suggested Fix:** Wrap `revalidatePath` in a try-catch within `revalidateLocalizedPaths` so invalid paths are logged but don't crash the action. The function already deduplicates with `seen`, so adding error handling per-variant is straightforward.
- **Confidence:** Low
- **Evidence:** `revalidatePath` is called at line 39 without try-catch. The `images.ts` callers don't wrap it. Next.js documentation notes `revalidatePath` throws for non-existent paths. The `isValidSlug` check at line 231 of `images.ts` validates the topic, but share keys come from DB and could theoretically be malformed.

---

## Re-Evaluated Open Findings (from Cycle 1)

### AGG-06: DB Restore Incomplete Dump Validation — Still Open

- **Status:** Still open. `hasPlausibleSqlDumpHeader` at `apps/web/src/lib/db-restore.ts:21-25` only checks the first line against a regex. A file containing only `--` comments and `DROP` statements would pass. No schema validation or table-name whitelist exists.
- **Risk:** Medium — requires an attacker to already have admin credentials to upload a malicious dump.

### AGG-07: Post-Restore Async Hooks — Still Open

- **Status:** Still open. The `cleanupOriginalIfRestoreMaintenanceBegan` guard at `apps/web/src/lib/restore-maintenance.ts:29-42` checks maintenance state at upload start, but the queue worker's `processImageFormats` fires caption generation and CLIP embedding as fire-and-forget after processing. If a restore begins during processing, these hooks may write to the DB after the restore completes.
- **Risk:** Medium — the restore maintenance flag is checked at upload time, not at processing completion time.

### AGG-09: Permanent Failure State Not Durable — Still Open

- **Status:** Still open. `permanentlyFailedIds` is a `Set<number>` in `globalThis` (line 604 of `images.ts` shows `queueState.permanentlyFailedIds.delete(id)`). A process restart clears this set. Images marked as permanently failed in the DB (`processing_error IS NOT NULL`) are rediscovered by the bootstrap scan, but the in-memory `permanentlyFailedIds` set is the primary guard against re-enqueueing.
- **Risk:** Low — the bootstrap scan re-populates the set on restart, but there's a window where permanently failed images could be re-enqueued.

### AGG-10: Sidecar Backfill Concurrency — No Shared Lock with Live Processing — Still Open

- **Status:** Still open. The sidecar `backfill-color-pipeline.ts` uses `BACKFILL_CONCURRENCY` (uncapped) while the in-app runner uses `ADMIN_BACKFILL_CONCURRENCY` (capped at 2). Both acquire the same `gallerykit_color_pipeline_backfill` advisory lock, but the sidecar runs in a separate container with its own connection pool. The per-image processing lock (`gallerykit:image-processing:{jobId}`) IS acquired by both, so they serialize per-image. However, the sidecar's uncapped concurrency can starve the live instance's pool if both run against the same MySQL server.
- **Risk:** Low — the advisory lock serializes the backfill itself, but the sidecar's high concurrency can pressure the shared MySQL server.

---

## Verified Fixed (from Prior Cycles)

- **C2-HIGH-01 / AGG-08:** `retryFailedImage` now checks restore maintenance before mutation — prevents race with restore. Confirmed at `images.ts:1087-1090`.
- **AGG-12:** Rate limit no longer refunds after expensive work — the OG routes follow Pattern 4 (charged post-validation). Confirmed in `rate-limit.ts` docstring and OG route tests.
- **AGG-20:** Similar-photo route validates id with regex before parseInt — confirmed in route handlers.
- **C8R-RPL-02 / AGG8R-02:** Upload tracker first-insert TOCTOU closed — confirmed at `images.ts:190-194` with explicit `set()` before `await`.
- **C20-MED-01:** `safeInsertId` used at all insert sites — confirmed in `images.ts:383`, `admin-users.ts:147`, and `sharing.ts`.
- **C2R-02:** `requireSameOriginAdmin` wired to all mutating actions — confirmed across `images.ts`, `admin-users.ts`, `auth.ts`, and `db-actions.ts`.
- **COR-R4C10-01:** Admin delete detaches audit_log rows via NULL update — confirmed at `admin-users.ts:256`.
- **COR-R4C11-01:** View count flush timer nulling fix — confirmed at `data.ts:75`.
- **C30-03:** View count retry cap with bounded retry Map — confirmed at `data.ts:21-27`.

---

## Causal Chain Analysis by Flow

### 1. Auth Flow (login → session → middleware)

The auth flow is robust. The dual rate-limiting (per-IP + per-account) with pre-increment before Argon2 prevents TOCTOU. The session token uses HMAC-SHA256 with `timingSafeEqual`. The only weakness is TR-C3-04: the `"unknown"` IP fallback creates a shared global bucket under proxy misconfiguration.

### 2. Upload → Processing Contract → Image Queue

The upload flow has strong protections: upload processing contract lock, disk space check, topic validation, HDR ingest gating, GPS stripping, and cumulative tracker. The weakness is TR-C3-01: the tracker pre-increment race on concurrent uploads. The queue's per-image advisory lock and conditional UPDATE prevent double-processing, and the delete-during-processing race is handled.

### 3. Data Mutation → Revalidation → Cache State

The revalidation flow uses `revalidateLocalizedPaths` which expands paths per locale. The weakness is TR-C3-05: unhandled `revalidatePath` throws. The `revalidateAllAppData` fallback for large batches (>20 images) is a good optimization but could be too aggressive (invalidates entire app cache).

### 4. Public Route → Analytics Recording → Error Propagation

The analytics flow uses per-IP rate limiting and fire-and-forget INSERTs. The weakness is TR-C3-03: silent DB failures at `console.debug` level. The shared-group view count uses a buffered flush with retry cap, which is robust.

### 5. Admin API → File Serving → Path Traversal Prevention

The file serving in `serve-upload.ts` uses `SAFE_SEGMENT` regex, `realpath` containment, and symlink rejection. The ETag includes settings hash for cache invalidation. This flow is well-hardened.

### 6. Backfill → Color Pipeline → Derivative Rewrite

The backfill uses advisory locks, pool-budget concurrency caps, and per-image processing claims. The resume contract (no version bump on detection failure) prevents stranding. The sidecar vs in-app concurrency difference remains a concern (AGG-10).

### 7. Session Lifecycle → Secret Rotation → Cookie Invalidation

The session secret falls back to a DB-stored generated secret in dev, but requires `SESSION_SECRET` env var in production. The `verifySessionToken` uses React `cache()` for per-request deduplication. Session expiry is 24 hours. No secret rotation mechanism exists, but this is documented as acceptable for the threat model.

---

## Recommendations

1. **Fix TR-C3-04 (High):** Make missing `TRUST_PROXY` in production a fatal error or at least elevate to `console.error` with a health-check indicator. The current `"unknown"` fallback is a security degradation.

2. **Fix TR-C3-02 (High):** Add a background orphan-file GC or use a two-phase delete (mark pending, clean, then delete DB row). The current best-effort cleanup after DB delete risks disk accumulation.

3. **Fix TR-C3-01 (Medium):** Re-read the upload tracker from the Map after the `await` boundary and re-validate before pre-increment, or use the advisory lock to serialize same-user uploads.

4. **Fix TR-C3-03 (Medium):** Elevate analytics DB failure logging from `console.debug` to `console.warn` so production monitoring can alert on silent analytics loss.

5. **Fix TR-C3-05 (Low):** Wrap `revalidatePath` in try-catch within `revalidateLocalizedPaths` to prevent unhandled exceptions from crashing server actions.

6. **Address AGG-06 (Medium):** Add table-name validation to the restore dump parser, or at minimum require at least one `CREATE TABLE` statement in the header check.

7. **Address AGG-07 (Medium):** Check restore maintenance flag in the queue worker before firing post-processing hooks (caption generation, CLIP embedding).

8. **Address AGG-09 (Low):** Persist `permanentlyFailedIds` to a DB table or Redis so the state survives restarts without relying on the bootstrap scan.
