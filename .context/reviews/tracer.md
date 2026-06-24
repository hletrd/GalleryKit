# Cycle 4 Deep Review — Tracer

Date: 2026-06-24
HEAD: 1d5545cb

## Summary

This cycle's tracer review re-examines all seven traced flows with fresh evidence, validates prior findings against current code, and identifies **4 new causal flow issues** plus **2 upgraded confidence ratings** on previously open findings. One new finding is rated **High** confidence, two **Medium**, and one **Low**. Additionally, 2 previously-open findings from Cycle 3 are re-evaluated with stronger disconfirming evidence and downgraded, while 3 remain open with upgraded risk assessments.

---

## New Findings

### TR-C4-01: `db/index.ts` Connection Init Promise Hang — Pool Exhaustion on Unresponsive MySQL

- **Flow:** Database Connection → Pool Acquisition → Init Query
- **File:** `apps/web/src/db/index.ts:60-83`
- **Suspicious Link:** The custom `getConnection` wrapper (line 71-83) awaits `initPromise` which is set by the `connection` event handler (line 60-68). The init query `SET group_concat_max_len = 65535` has NO timeout. If MySQL accepts the TCP connection but never responds to this query (e.g., server under extreme load, network partition after handshake), the connection is held indefinitely and never released back to the pool. With `waitForConnections: true` and `queueLimit: 20`, subsequent requests queue behind this hung connection.
- **Failure Scenario:** MySQL enters a state where new TCP connections are accepted but queries hang (e.g., `max_connections` exceeded at the OS level, or a table lock storm). The pool's 10 connections are all stuck awaiting `initPromise`. The 11th request queues. The 31st request (queueLimit + pool size) is rejected with `Queue limit reached`. All live requests that need DB access fail. The app returns 500s until the process is restarted.
- **Suggested Fix:** Add a `Promise.race` with a timeout (e.g., 10s) around the `initPromise` await. On timeout, release the connection and throw so the caller can retry or fail fast. Alternatively, set `connectTimeout` on the individual query, not just the pool-level connection establishment.
- **Confidence:** High
- **Evidence:** Line 80: `await initPromise;` — no timeout, no race, no fallback. The `connection` event fires when TCP is established, but the query itself can hang indefinitely. The pool config at line 17-28 sets `connectTimeout: 5000` but this only applies to the TCP handshake, not query execution. The `queueLimit: 20` means after 20 queued requests, new requests are rejected.

---

### TR-C4-02: `processImageFormats` WI-15 Temp File Not Cleaned on SIGKILL — Disk Accumulation

- **Flow:** Image Processing → Wide-Gamut Downscale → Temp File Lifecycle
- **File:** `apps/web/src/lib/process-image.ts:1023-1042`
- **Suspicious Link:** When a wide-gamut source exceeds `WIDE_GAMUT_MAX_SOURCE_PIXELS`, a temporary TIFF is created in `os.tmpdir()` (line 1023: `path.join(os.tmpdir(), ...)`). The cleanup is in the `finally` block at line 1312-1316. However, if the process receives SIGKILL (OOM killer, container kill, `docker kill`) between temp file creation and `finally`, the temp file is orphaned. The `cleanOrphanedTmpFiles` function in `image-queue.ts` (line 32-73) only scans `UPLOAD_DIR_ORIGINAL` and `UPLOAD_DIR_JPEG` for `.tmp` files — it does NOT scan `os.tmpdir()`.
- **Failure Scenario:** An admin uploads a 100MP ProPhoto image. The WI-15 downscale creates a 200MB temp TIFF in `/tmp`. The container is OOM-killed during the rgb16 pipeline. The temp file remains in `/tmp`. Over months, with repeated large-image uploads and occasional crashes, `/tmp` fills with orphaned `.wi15.tmp` files. On systems where `/tmp` is a tmpfs (RAM-backed), this consumes memory. On systems where `/tmp` is disk-backed, this consumes disk space.
- **Suggested Fix:** Either (a) use the upload directory (which is already scanned by `cleanOrphanedTmpFiles`) for temp files instead of `os.tmpdir()`, or (b) add `os.tmpdir()` to the orphan cleanup scan in `image-queue.ts`, or (c) use a deterministic temp filename pattern and clean it up on bootstrap.
- **Confidence:** Medium
- **Evidence:** `os.tmpdir()` at line 1023. `cleanOrphanedTmpFiles` at `image-queue.ts:32-73` only scans `UPLOAD_DIR_ORIGINAL` and `UPLOAD_DIR_JPEG`. No cleanup for `os.tmpdir()` exists anywhere in the codebase.

---

### TR-C4-03: `uploadImages` Tracker Pre-Increment Race — Concurrent Same-IP Uploads Can Exceed Limit

- **Flow:** Upload → Processing Contract → Tracker Validation
- **File:** `apps/web/src/app/actions/images.ts:190-252`
- **Suspicious Link:** The C8R-RPL-02 fix at line 190-194 stores the tracker object in the Map BEFORE any await, so concurrent requests share the same object reference. The limit check at line 196 (`tracker.count + files.length > UPLOAD_MAX_FILES_PER_FILES_PER_WINDOW`) reads the current count, but the pre-increment at line 250-252 happens AFTER all validation. If two concurrent requests interleave between the limit check and the pre-increment, both pass the check with the same stale count, then both increment, exceeding the limit.
- **Failure Scenario:** Limit = 100 files. Request A (60 files) and Request B (60 files) from the same IP arrive concurrently. Both execute line 196 when `tracker.count = 0`. Both pass: 0 + 60 <= 100. Request A increments to 60. Request B increments to 120. The limit is exceeded by 20%.
- **Suggested Fix:** Move the pre-increment to BEFORE the validation checks (mirror the rate-limit pattern where increment happens first, then check). Or use an atomic compare-and-swap: read current count, compute new count, set only if current count hasn't changed. Or acquire a brief lock around the check-and-increment sequence.
- **Confidence:** Medium
- **Evidence:** Lines 196-198: limit check. Lines 250-252: pre-increment. The C8R-RPL-02 comment acknowledges the first-insert TOCTOU but the pre-increment pattern doesn't close the check-then-increment race. The shared mutable object reference makes the race possible.

---

### TR-C4-04: `image-queue.ts` Bootstrap Retry Timer Not Cleared on Graceful Shutdown

- **Flow:** Queue Lifecycle → Shutdown → Timer Cleanup
- **File:** `apps/web/src/lib/image-queue.ts:603-611`
- **Suspicious Link:** `scheduleBootstrapRetry` sets `state.bootstrapRetryTimer` but `shutdownImageProcessingQueue` (line 236-241) only calls `drainProcessingQueueForShutdown`, which clears `gcInterval` and drains the queue but does NOT clear `bootstrapRetryTimer`. If a retry timer was armed before shutdown, it fires after shutdown. The `bootstrapImageProcessingQueue` check at line 631 (`state.shuttingDown`) returns early, so no work is done, but the timer keeps the event loop alive for up to `BOOTSTRAP_RETRY_DELAY_MS` (30 seconds), delaying clean process exit.
- **Failure Scenario:** The queue encounters a connection refused error during bootstrap, arms a 30-second retry timer. An admin triggers a graceful shutdown (e.g., `docker stop` with SIGTERM). The shutdown handler drains the queue but the retry timer remains. The process waits 30 seconds for the timer to fire before exiting. In a Docker container with a 10-second stop grace period, Docker sends SIGKILL after 10 seconds, defeating the graceful shutdown.
- **Suggested Fix:** Add `bootstrapRetryTimer` cleanup to `drainProcessingQueueForShutdown`:
  ```typescript
  if (state.bootstrapRetryTimer) {
      clearTimeout(state.bootstrapRetryTimer);
      state.bootstrapRetryTimer = undefined;
  }
  ```
- **Confidence:** Low
- **Evidence:** `drainProcessingQueueForShutdown` at `queue-shutdown.ts:12-22` clears `gcInterval` and `enqueued` but not `bootstrapRetryTimer`. The `scheduleBootstrapRetry` at line 603-611 sets the timer. `shutdownImageProcessingQueue` at line 236-241 delegates to `drainProcessingQueueForShutdown`.

---

## Re-Evaluated Open Findings (from Cycle 3)

### TR-C3-01: Upload Tracker Pre-Increment Race — CONFIRMED, upgraded to TR-C4-03

- **Status:** Confirmed with stronger evidence. The check-then-increment pattern is a classic TOCTOU race. The C8R-RPL-02 fix only closed the first-insert race, not the check-then-increment race. See TR-C4-03 above for full analysis.
- **Risk:** Medium — same as before, but now with a concrete interleaving scenario.

### TR-C3-02: Delete File Cleanup Best-Effort After DB Delete — PARTIALLY MITIGATED, downgraded

- **Status:** Re-evaluated. The `collectImageCleanupFailures` helper (lines 630-637 of `images.ts`) retries once with 50ms delay. The `deleteImageVariants` function with `[]` sizes triggers a directory scan that removes ALL variants including legacy sizes. The orphan accumulation risk is real but bounded: only files that fail cleanup on both attempts are orphaned. A background GC for orphaned files would still be valuable but is lower priority than other findings.
- **Risk:** Medium → Low. The retry and directory scan mitigate most cases. The remaining risk is transient I/O errors that persist through both attempts.

### TR-C3-03: Analytics Fire-and-Forget Silent Loss — STILL OPEN, unchanged

- **Status:** Still open. The `.catch(console.debug)` pattern at `public.ts:360-367` remains. `console.debug` is typically filtered in production. No operational signal exists for analytics DB pressure.
- **Risk:** Medium — unchanged from Cycle 3.

### TR-C3-04: `getClientIp` "unknown" Fallback — STILL OPEN, upgraded to High

- **Status:** Still open. The `"unknown"` fallback at `rate-limit.ts:170` creates a shared global bucket. The warning at line 173 fires once but may be missed. In production behind a proxy without `TRUST_PROXY=true`, this is a security degradation.
- **Risk:** Upgraded to High. The impact is severe (global lockout after 5 attempts) and the trigger is easy (common misconfiguration).

### TR-C3-05: `revalidatePath` Unhandled Throw — STILL OPEN, unchanged

- **Status:** Still open. `revalidateLocalizedPaths` at `revalidation.ts:39` calls `revalidatePath` without try-catch. Invalid paths could crash server actions.
- **Risk:** Low — requires a malformed path that passes validation but fails `revalidatePath`.

### AGG-06: DB Restore Incomplete Dump Validation — STILL OPEN

- **Status:** Still open. `hasPlausibleSqlDumpHeader` at `db-restore.ts:21-25` only checks the first line.
- **Risk:** Medium — unchanged.

### AGG-07: Post-Restore Async Hooks — STILL OPEN

- **Status:** Still open. The queue worker fires caption generation and CLIP embedding as fire-and-forget after processing. No restore maintenance check exists at hook firing time.
- **Risk:** Medium — unchanged.

### AGG-09: Permanent Failure State Not Durable — STILL OPEN

- **Status:** Still open. `permanentlyFailedIds` is a `Set<number>` in `globalThis`. Process restart clears it. The bootstrap scan re-populates it, but there's a window where permanently failed images could be re-enqueued.
- **Risk:** Low — unchanged.

### AGG-10: Sidecar Backfill Concurrency — STILL OPEN

- **Status:** Still open. The sidecar uses uncapped `BACKFILL_CONCURRENCY` while the in-app runner caps at 2. Both acquire the same advisory lock, but the sidecar can pressure the shared MySQL server.
- **Risk:** Low — unchanged.

---

## Verified Fixed (from Prior Cycles)

- **C2-HIGH-01 / AGG-08:** `retryFailedImage` checks restore maintenance before mutation. Confirmed at `images.ts:1087-1090`.
- **AGG-12:** Rate limit follows correct patterns. Confirmed in `rate-limit.ts` docstring and route tests.
- **AGG-20:** Similar-photo route validates id with regex. Confirmed in route handlers.
- **C8R-RPL-02 / AGG8R-02:** Upload tracker first-insert TOCTOU closed. Confirmed at `images.ts:190-194`.
- **C20-MED-01:** `safeInsertId` used at all insert sites. Confirmed across codebase.
- **C2R-02:** `requireSameOriginAdmin` wired to all mutating actions. Confirmed.
- **COR-R4C10-01:** Admin delete detaches audit_log rows. Confirmed at `admin-users.ts:256`.
- **COR-R4C11-01:** View count flush timer nulling fix. Confirmed at `data.ts:75`.
- **C30-03:** View count retry cap with bounded retry Map. Confirmed at `data.ts:21-27`.
- **COR-R4C6-05:** Service worker offline cache exemption. Confirmed in `sw.template.js` and `proxy.ts`.
- **AGG-R7-08:** Per-format fresh Sharp instances. Confirmed at `process-image.ts:1019-1097`.
- **WI-14:** Cross-format isolation. Confirmed in `process-image.ts`.

---

## Causal Chain Analysis by Flow

### 1. Auth Flow (login → session → middleware)

The auth flow remains robust. Dual rate-limiting (per-IP + per-account) with pre-increment before Argon2 prevents TOCTOU. The session token uses HMAC-SHA256 with `timingSafeEqual`. The TR-C3-04 weakness ("unknown" IP fallback) is now rated High due to its severe impact under proxy misconfiguration.

### 2. Upload → Processing Contract → Image Queue

The upload flow has strong protections. The new TR-C4-03 finding identifies a check-then-increment race in the upload tracker. The queue's per-image advisory lock and conditional UPDATE prevent double-processing. The delete-during-processing race is handled correctly (worker detects `affectedRows === 0` and cleans up). The TR-C4-02 finding identifies a temp file cleanup gap for wide-gamut images.

### 3. Data Mutation → Revalidation → Cache State

The revalidation flow uses `revalidateLocalizedPaths`. TR-C3-05 remains open (unhandled `revalidatePath` throws). The `revalidateAllAppData` fallback for large batches is a good optimization.

### 4. Public Route → Analytics Recording → Error Propagation

TR-C3-03 remains open (silent analytics loss). The shared-group view count buffer uses Map-swap atomicity with retry cap, which is robust. The view retention GC uses chunked DELETE with bounded iterations.

### 5. Admin API → File Serving → Path Traversal Prevention

The file serving in `serve-upload.ts` uses `SAFE_SEGMENT` regex, `realpath` containment, and symlink rejection. The ETag includes settings hash. This flow is well-hardened.

### 6. Backfill → Color Pipeline → Derivative Rewrite

The backfill uses advisory locks, pool-budget concurrency caps, and per-image processing claims. The resume contract (no version bump on detection failure) prevents stranding. AGG-10 (sidecar vs in-app concurrency) remains open.

### 7. Session Lifecycle → Secret Rotation → Cookie Invalidation

The session secret falls back to DB-stored in dev but requires env var in production. `verifySessionToken` uses React `cache()`. No secret rotation mechanism exists, documented as acceptable.

---

## Database Connection Pool Analysis

The pool configuration at `db/index.ts:17-28`:
- `connectionLimit: 10` — total connections
- `queueLimit: 20` — queued requests beyond pool size
- `connectTimeout: 5000` — TCP handshake timeout
- `keepAliveInitialDelay: 10000` — TCP keepalive

The custom `getConnection` wrapper adds an `await initPromise` (line 80) with no timeout. This is the critical path identified in TR-C4-01. The `query` and `execute` wrappers (lines 86-102) add one connection cycle per query, which is correct but adds overhead.

The backfill runner budgets connections at `admin-backfill-runner.ts:617-808`:
- Cap: `max(1, floor((10 - 5 - 1) / 2)) = 2` workers
- Peak: 1 (lock) + 2*2 (workers) = 5 connections
- This leaves 5 for live traffic, which is correct

However, the sidecar `backfill-color-pipeline.ts` uses `BACKFILL_CONCURRENCY` (default 2, uncapped) with its own pool. If both run concurrently against the same MySQL server, the sidecar can consume additional connections beyond the live instance's budget.

---

## Race Condition Inventory

| Race | Location | Mitigation | Status |
|------|----------|------------|--------|
| Delete-while-processing | `image-queue.ts:390-410` | Conditional UPDATE + affectedRows check | Fixed |
| Concurrent tag creation | `images.ts:383-389` | INSERT IGNORE | Fixed |
| Topic slug rename | `images.ts:...` | Transaction | Fixed |
| Batch delete | `images.ts:...` | DB transaction | Fixed |
| Single delete | `images.ts:614-619` | DB transaction | Fixed |
| createTopic TOCTOU | `topics.ts:...` | ER_DUP_ENTRY catch | Fixed |
| ensureDirs | `process-image.ts:...` | Promise singleton | Fixed |
| Session secret init | `session.ts:...` | INSERT IGNORE | Fixed |
| Concurrent DB restore | `db-actions.ts:...` | Advisory lock | Fixed |
| Upload contract change | `upload-processing-contract-lock.ts` | Advisory lock | Fixed |
| Per-image processing | `image-queue.ts:207-234` | Advisory lock + conditional UPDATE | Fixed |
| Concurrent backfill | `admin-backfill-runner.ts:...` | Advisory lock | Fixed |
| Upload tracker first-insert | `images.ts:190-194` | Early set() | Fixed |
| Upload tracker check-then-increment | `images.ts:196-252` | None — TR-C4-03 | Open |
| View count flush timer | `data.ts:63-189` | isFlushing guard + null-on-entry | Fixed |
| Connection init hang | `db/index.ts:80` | None — TR-C4-01 | Open |

---

## Recommendations (Prioritized)

1. **Fix TR-C4-01 (High):** Add timeout to `db/index.ts` connection init promise. This is a latent pool exhaustion risk that could cause cascading failures under MySQL degradation.

2. **Fix TR-C3-04 (High):** Make missing `TRUST_PROXY` in production a fatal error or elevate to `console.error` with health-check exposure. The current `"unknown"` fallback is a security degradation that can cause global lockout.

3. **Fix TR-C4-03 (Medium):** Close the upload tracker check-then-increment race by moving pre-increment before validation, or using atomic compare-and-swap.

4. **Fix TR-C4-02 (Medium):** Add WI-15 temp file cleanup to `cleanOrphanedTmpFiles` or use the upload directory for temp files.

5. **Fix TR-C3-03 (Medium):** Elevate analytics DB failure logging from `console.debug` to `console.warn`.

6. **Fix TR-C4-04 (Low):** Clear `bootstrapRetryTimer` in `drainProcessingQueueForShutdown`.

7. **Address AGG-06 (Medium):** Add table-name validation to restore dump parser.

8. **Address AGG-07 (Medium):** Check restore maintenance flag before firing post-processing hooks.

9. **Address AGG-09 (Low):** Persist `permanentlyFailedIds` to DB for durability across restarts.

10. **Address AGG-10 (Low):** Document sidecar backfill concurrency risks or add a shared pool budget.

---

## Methodology Notes

This review used the following evidence sources:
- Direct code reading of 20+ critical files across all execution paths
- Cross-referencing of findings against existing test files and comments
- Causal chain reconstruction from entry points to exit points
- Hypothesis generation with competing explanations and disconfirming evidence
- Evidence strength ranking (controlled reproduction > primary artifact > inference > speculation)

All findings were validated against the current HEAD (`1d5545cb`) and existing Cycle 3 findings were re-evaluated with fresh evidence rather than assumed still valid.

---

*Review completed by tracer agent on 2026-06-24.*
*Evidence gathered from: image-queue.ts, admin-backfill-runner.ts, data.ts, db/index.ts, auth.ts, rate-limit.ts, session.ts, queue-shutdown.ts, auth-rate-limit.ts, bounded-map.ts, upload-tracker-state.ts, restore-maintenance.ts, images.ts, process-image.ts, advisory-locks.ts, proxy.ts, clip-model.ts, semantic/route.ts, upload-processing-contract-lock.ts, view-retention.ts, audit.ts, caption-generator.ts, public.ts, revalidation.ts, db-restore.ts.*
