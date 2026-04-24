# Tracer Review — Cycle 14 (2026-04-20)

**Reviewer:** tracer (causal flow analysis)
**Scope:** TOCTOU, race conditions, state machine errors, data flow anomalies
**Exclusion:** Findings from cycles 1–13 and their deferred carry-forward are not re-reported.

---

## Source File Inventory

| File | Role |
|------|------|
| `apps/web/src/app/actions/auth.ts` | Login, logout, password change, session management |
| `apps/web/src/app/actions/images.ts` | Upload, delete, metadata update |
| `apps/web/src/app/actions/sharing.ts` | Share link create/revoke, group sharing |
| `apps/web/src/app/actions/topics.ts` | Topic CRUD, alias management |
| `apps/web/src/app/actions/tags.ts` | Tag CRUD, image-tag linking |
| `apps/web/src/app/actions/admin-users.ts` | Admin user creation/deletion |
| `apps/web/src/app/actions/public.ts` | Load-more, search (public) |
| `apps/web/src/app/actions/settings.ts` | Gallery config upsert |
| `apps/web/src/app/actions/seo.ts` | SEO settings upsert |
| `apps/web/src/lib/session.ts` | Session token generation/verification |
| `apps/web/src/lib/image-queue.ts` | Background image processing queue |
| `apps/web/src/lib/process-image.ts` | Sharp pipeline, EXIF extraction, file I/O |
| `apps/web/src/lib/data.ts` | Data access layer, view count buffering |
| `apps/web/src/lib/rate-limit.ts` | MySQL-backed + in-memory rate limiting |
| `apps/web/src/lib/auth-rate-limit.ts` | Login/password change rate limit helpers |
| `apps/web/src/lib/api-auth.ts` | API route admin auth wrapper |
| `apps/web/src/lib/serve-upload.ts` | Static file serving with path traversal defense |
| `apps/web/src/lib/storage/index.ts` | Storage backend singleton + switch |
| `apps/web/src/app/[locale]/admin/db-actions.ts` | DB backup/restore |
| `apps/web/src/app/api/admin/db/download/route.ts` | Authenticated backup download |
| `apps/web/src/proxy.ts` | i18n middleware + admin auth guard |

---

## Previously Fixed — Confirmed Resolved

### C13-01 / C13-02: Rate limit rollback on unexpected errors

**Status: FIXED.** Both `login()` and `updatePassword()` in `auth.ts` now roll back the pre-incremented rate limit counter in their outer `catch` blocks via `clearSuccessfulLoginAttempts(ip)` / `clearSuccessfulPasswordAttempts(ip)`. The pre-increment pattern (increment before expensive Argon2 verify) remains correct, and the rollback on infrastructure failure is now properly handled.

---

## Findings

### C14-01: Image queue claim retry counter reset — finally block clears claim state prematurely

**File:** `apps/web/src/lib/image-queue.ts`, lines 127–254
**Confidence:** HIGH
**Category:** State machine error

**Description:**

The image processing queue uses `claimRetryCounts` to track how many times a job has failed to acquire a MySQL advisory lock (`GET_LOCK`). When `claimRetries >= MAX_CLAIM_RETRIES (10)`, the job should be abandoned. However, the `finally` block at lines 243–253 always executes `state.claimRetryCounts.delete(job.id)` when `retried` is `false` — and for the claim-retry path, `retried` is always `false`.

**Concrete trace:**

```
1. Queue callback starts: retried = false
2. acquireImageProcessingClaim(job.id) → null (lock held by another worker)
3. claimRetries = (get from map || 0) + 1 = N
4. N < 10, so: claimRetryCounts.set(job.id, N)
5. setTimeout(() => enqueueImageProcessing(job), delay)
6. return from try block → enters finally
7. retried is false → claimRetryCounts.delete(job.id) ← CLEARS THE COUNT WE JUST SET
8. enqueued.delete(job.id) ← removes from set (needed for re-enqueue)
9. Later: setTimeout fires → enqueueImageProcessing(job)
10. New callback runs → claimRetryCounts.get(job.id) → undefined → N = 1 again
```

**Consequence:**

- `MAX_CLAIM_RETRIES = 10` is **never reached** — the counter resets every cycle
- Escalating delay (`CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5)`) never escalates beyond 5s (since count is always 1)
- Jobs that can't acquire a claim retry **indefinitely** at fixed 5-second intervals instead of escalating and eventually giving up
- If the lock-holding worker has crashed without releasing, there is no mechanism to detect and abandon the stuck job after 10 retries

**Suggested fix:**

Set `retried = true` in the claim-retry path and explicitly handle the `enqueued` set before returning:

```typescript
if (!lockConnection) {
    const claimRetries = (state.claimRetryCounts.get(job.id) || 0) + 1;
    const MAX_CLAIM_RETRIES = 10;
    if (claimRetries >= MAX_CLAIM_RETRIES) {
        state.claimRetryCounts.delete(job.id);
        state.enqueued.delete(job.id);
        console.error(`[Queue] Job ${job.id} failed to acquire claim ${claimRetries} times, giving up`);
        return;
    }
    state.claimRetryCounts.set(job.id, claimRetries);
    state.enqueued.delete(job.id); // Remove now so re-enqueue works
    const delay = CLAIM_RETRY_DELAY_MS * Math.min(claimRetries, 5);
    const retryTimer = setTimeout(() => {
        enqueueImageProcessing(job);
    }, delay);
    retryTimer.unref?.();
    retried = true; // Prevent finally from clearing retry maps
    return;
}
```

---

### C14-02: Concurrent admin deletion can bypass last-admin protection

**File:** `apps/web/src/app/actions/admin-users.ts`, lines 135–170
**Confidence:** MEDIUM
**Category:** TOCTOU race condition

**Description:**

`deleteAdminUser()` checks the admin count within a transaction and only proceeds if `count > 1`. However, MySQL's default `REPEATABLE READ` isolation uses a consistent read snapshot: the `count(*)` query reads from the snapshot taken at the start of the transaction, not the current committed state. Two concurrent deletion transactions can both see `count >= 2` and both proceed, potentially leaving 0 admins.

**Concrete trace:**

```
System state: 2 admins — Alice (id=1), Bob (id=2)

1. Alice calls deleteAdminUser(2) — deleting Bob
   - Tx A starts, reads count(*) = 2 from snapshot → proceeds

2. Bob calls deleteAdminUser(1) — deleting Alice
   - Tx B starts, reads count(*) = 2 from snapshot → proceeds

3. Tx A: DELETE sessions WHERE userId = 2 → succeeds (different row, no lock conflict)
   Tx B: DELETE sessions WHERE userId = 1 → succeeds (different row, no lock conflict)

4. Tx A: DELETE adminUsers WHERE id = 2 → succeeds, commits
   Tx B: DELETE adminUsers WHERE id = 1 → succeeds, commits

5. Result: 0 admins remain — last-admin protection defeated
```

The scenario is more plausible with 3+ admins where two admins delete different third admins simultaneously, reducing the count below 2 without either transaction seeing the intermediate state.

**Mitigating factors:**

- Requires two admins to issue deletion requests concurrently (rare in practice)
- Self-deletion is correctly blocked (`currentUser.id === id` check)
- Single-admin setups are immune

**Suggested fix:**

Use `SELECT ... FOR UPDATE` to acquire a shared lock on the `adminUsers` table, forcing serialization:

```typescript
await db.transaction(async (tx) => {
    // FOR UPDATE acquires row-level locks, serializing concurrent deletions
    const [adminCount] = await tx.select({ count: sql<number>`count(*)` })
        .from(adminUsers).for('update');
    if (Number(adminCount.count) <= 1) {
        throw new Error('LAST_ADMIN');
    }
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await tx.delete(adminUsers).where(eq(adminUsers.id, id));
});
```

Alternatively, use a MySQL advisory lock (`GET_LOCK('gallerykit_admin_delete', 0)`) to serialize admin deletions across all connections.

---

### C14-03: Topic update orphaned image file on process crash between commit and cleanup

**File:** `apps/web/src/app/actions/topics.ts`, lines 166–169
**Confidence:** LOW
**Category:** Data flow anomaly (resource leak)

**Description:**

When `updateTopic` replaces a topic image, it first commits the new image filename in the DB transaction (line 144–155), then deletes the old image file outside the transaction (line 167). If the process crashes between the transaction commit and the file deletion, the old image file remains on disk but is no longer referenced by any DB row — an orphaned file.

The reverse is correctly handled: if the transaction fails, the new image is deleted in the catch block (line 177–179). Only the post-commit cleanup is vulnerable.

**Concrete trace:**

```
1. updateTopic("old-slug", formData) — new image uploaded
2. Transaction: UPDATE topics SET image_filename = "new-uuid.webp" WHERE slug = "old-slug"
3. Transaction commits successfully
4. Process crashes before line 167 executes
5. Result: "old-uuid.webp" orphaned on disk, no DB row references it
```

**Mitigating factors:**

- Orphaned files are only a disk space concern, not a data integrity issue
- Requires a process crash in a very narrow window
- Admin can manually clean up or the files are cleaned during Docker volume recreation

**Suggested fix:**

Track orphaned files in a cleanup queue (e.g., write the old filename to a `pending_cleanup` table within the same transaction, then delete the file and remove the cleanup entry afterward). Alternatively, accept the risk as negligible and document as a known limitation.

---

## Flows Traced — No Issues Found

| Flow | Files | Verdict |
|------|-------|---------|
| **Upload → queue → process** | `actions/images.ts` → `image-queue.ts` → `process-image.ts` | Pre-increment upload tracker is correct; additive adjustment preserves concurrent writes. Claim check + conditional UPDATE correctly handle delete-during-processing. |
| **Login → session creation** | `actions/auth.ts` → `lib/session.ts` | Pre-increment rate limit + rollback on success/error is correct. HMAC-SHA256 with timingSafeEqual. Transaction wraps insert + invalidate. |
| **Share link creation** | `actions/sharing.ts` | Atomic `UPDATE ... WHERE share_key IS NULL` prevents duplicate keys. Retry loop handles ER_DUP_ENTRY. |
| **Topic slug rename** | `actions/topics.ts` | Transaction updates references before PK rename. ER_DUP_ENTRY catch guards TOCTOU in `topicRouteSegmentExists`. |
| **Tag upsert + image link** | `actions/tags.ts` | `INSERT IGNORE` prevents duplicate tags. Name-first-then-slug lookup prevents slug collision misattribution. `batchUpdateImageTags` uses transaction. |
| **DB backup/restore** | `admin/db-actions.ts` | Advisory lock prevents concurrent restores. `MYSQL_PWD` env var avoids `-p` flag leak. WriteStream flush handled correctly. |
| **Upload file serving** | `lib/serve-upload.ts` | SAFE_SEGMENT regex + ALLOWED_UPLOAD_DIRS whitelist + resolvedPath.startsWith() + lstat symlink rejection. Multi-layer path traversal defense is sound. |
| **Storage backend switch** | `lib/storage/index.ts` | Rollback pattern: saves old state, tries new, rolls back on failure. Single-threaded model prevents mid-switch reads of uninitialized backend. |
| **View count buffering** | `lib/data.ts` | Copy-and-clear is safe under Node.js single-threaded model. Re-buffering on flush failure preserves counts. Hard cap prevents unbounded growth. |
| **Search rate limiting** | `actions/public.ts` | Pre-increment + DB-backed check. Rollback on DB check failure keeps in-memory and DB consistent. |
| **Session secret init** | `lib/session.ts` | `INSERT IGNORE` + re-fetch pattern handles concurrent process startup. `sessionSecretPromise` deduplicates within process. Production requires env var. |
| **Admin deletion (single)** | `actions/admin-users.ts` | Transaction wraps count-check + delete. See C14-02 for concurrent deletion gap. |

---

## Summary

| ID | Severity | File | Lines | Description |
|----|----------|------|-------|-------------|
| C14-01 | HIGH | `lib/image-queue.ts` | 127–254 | Claim retry counter reset in finally block makes MAX_CLAIM_RETRIES ineffective; jobs retry indefinitely at fixed 5s intervals |
| C14-02 | MEDIUM | `app/actions/admin-users.ts` | 135–170 | Concurrent admin deletion bypasses last-admin protection under MySQL REPEATABLE READ snapshot |
| C14-03 | LOW | `app/actions/topics.ts` | 166–169 | Post-commit image file cleanup can be lost on process crash, orphaning old image on disk |

**Totals:** 1 HIGH + 1 MEDIUM + 1 LOW = 3 actionable findings
