# Debugger Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository — latent bugs, failure modes, edge cases, regressions.

## Inventory reviewed

All `apps/web/src/` files with focus on: error paths, boundary conditions, race conditions, silent failures, and unhandled edge cases.

---

## Findings

### C1F-DB-01 (High / High). `flushGroupViewCounts` — re-buffered increments after failed flush may exceed buffer cap

- Location: `apps/web/src/lib/data.ts:98-106`
- When a chunk of view count increments fails to flush, they are re-buffered into the new `viewCountBuffer` Map. The re-buffer checks `viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE` (line 101), but the check only applies to *new* entries. If the re-buffered entries are for groups already in the new buffer, they bypass the size check via `!viewCountBuffer.has(groupId)` evaluating to false.
- **Scenario**: Buffer has 999 entries. Flush fails for 50 entries. All 50 are re-buffered. Since they're already in the buffer (counts are incremented), the size stays at 999. But 50 new groups could then be added before the next flush, exceeding the 1000 cap. The `bufferGroupViewCount` function (line 46) checks the cap, so new entries would be dropped.
- **Severity**: Low — the cap is enforced at the buffer entry point, so the overflow is bounded by the failed chunk size (max 20 per chunk). The consequence is dropping new increments, not memory overflow.
- **Fix**: Consider checking total buffer size after re-buffering and dropping the oldest entries if it exceeds the cap.

### C1F-DB-02 (Medium / High). `enqueueImageProcessing` — retry after MAX_RETRIES causes bootstrap re-scan, which re-enqueues the same permanently-failing job

- Location: `apps/web/src/lib/image-queue.ts:328-333`
- When a job fails `MAX_RETRIES` (3) times, the code sets `state.bootstrapped = false` and schedules a bootstrap retry. The next bootstrap will scan for `processed = false` images and re-enqueue the same permanently-failing job. This creates a cycle: fail 3x → bootstrap re-scan → re-enqueue → fail 3x → bootstrap re-scan → ...
- **Severity**: Medium — the BOOTSTRAP_RETRY_DELAY_MS (30s) and the escalating claim retry delays limit the frequency, but a permanently-failing image (e.g., corrupt file) will cause repeated processing attempts indefinitely.
- **Fix**: Add a `failed_count` column or a `last_failed_at` timestamp to the `images` table so the bootstrap query can exclude permanently-failing images (e.g., `WHERE processed = false AND failed_count < 3`). Or track failed IDs in a persistent Set.

### C1F-DB-03 (Medium / Medium). `deleteImage` — file cleanup happens after DB deletion, so orphaned files remain if cleanup fails

- Location: `apps/web/src/app/actions/images.ts:499-516`
- The DB record is deleted in a transaction (line 487-491), then files are cleaned up best-effort (line 502-509). If the process crashes between DB deletion and file cleanup, orphaned files remain on disk. The code logs the cleanup failures but doesn't track them for later cleanup.
- **Severity**: Low — orphaned files don't cause security issues (filenames are UUIDs) but waste disk space. The `cleanOrphanedTmpFiles` function only cleans `.tmp` files, not orphaned image variants.
- **Fix**: Consider adding a periodic orphan-file cleanup job that compares filesystem entries with DB records.

### C1F-DB-04 (Low / Medium). `login` — session invalidation deletes ALL previous sessions, preventing multi-device login

- Location: `apps/web/src/app/actions/auth.ts:208-219`
- On successful login, the code deletes all previous sessions for the user (`sql\`${sessions.id} != ${sessionId}\``). This means logging in on device A, then device B, invalidates the session on device A. The user must re-login on device A.
- **Severity**: Low — this is a deliberate session-fixation prevention measure. For a personal gallery with root-admin accounts, single-session is reasonable.
- **Fix**: No fix needed — documented design choice.

### C1F-DB-05 (Low / Low). `processImageFormats` — atomic rename fallback path may leak `.tmp` files

- Location: `apps/web/src/lib/process-image.ts:506-524`
- The code attempts `link → rename`, then `copyFile → rename`, then `copyFile` as progressively less atomic fallbacks. The `finally` block at line 523 unlinks the `.tmp` file. However, if the process crashes between creating the `.tmp` file and the `finally` block, orphaned `.tmp` files remain. The `cleanOrphanedTmpFiles` function in `image-queue.ts` handles this at bootstrap.
- **Severity**: Low — the cleanup exists.
- **Fix**: No fix needed — bootstrap cleanup covers this.
