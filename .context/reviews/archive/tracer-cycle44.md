# Tracer — Cycle 44 (2026-04-20)

## Review Scope
Causal tracing of suspicious flows, competing hypotheses for latent failures, and data-flow analysis across module boundaries.

## Traced Flows

### T44-01: Upload flow — topic slug data path
**Trace:** `uploadImages` (images.ts:58) → `formData.get('topic')` → `isValidSlug(topic)` check (line 119) → DB insert (line 164, `topic` field)
**Hypothesis:** If `topic` contains control characters not rejected by `isValidSlug` (currently none, but future validator changes), they reach the DB.
**Likelihood:** LOW — `isValidSlug` currently blocks all control characters.
**Recommendation:** Apply `stripControlChars(topic)` as defense in depth. Matches CR44-01/CC44-01.

### T44-02: Login flow — username data path
**Trace:** `login` (auth.ts:70) → `formData.get('username')` → DB SELECT WHERE username=... (line 125) → `argon2.verify` (line 131)
**Hypothesis:** If an attacker sends `admin\x00`, the DB query `WHERE username = 'admin\x00'` returns no rows (since stored usernames are sanitized). The dummy hash ensures no timing leak. The unsanitized username is also passed to `logAuditEvent` (line 135), which serializes it to JSON and stores in the audit log — control characters in the audit log could cause display issues in admin UI.
**Likelihood:** LOW — no auth bypass, but audit log contamination possible.
**Recommendation:** Apply `stripControlChars(username)` in `login()`. Matches S44-01.

### T44-03: Image queue claim retry — unbounded timer accumulation
**Trace:** `enqueueImageProcessing` (image-queue.ts:134) → `acquireImageProcessingClaim` fails → `setTimeout(enqueueImageProcessing, delay)` → recursive call adds to queue again
**Hypothesis:** If the MySQL advisory lock is held for an extended period, claim retries accumulate timers. Each retry creates a new queue entry, but the old entry's `enqueued` state is NOT deleted before the retry (line 169: the `return` after `enqueueImageProcessing` skips the `finally` block's `state.enqueued.delete`). Wait — actually, the `return` at line 169 DOES execute the `finally` block (finally always runs). So `state.enqueued.delete(job.id)` runs at line 269, then the retried job re-adds it. This is correct.
**Conclusion:** No bug. The retry mechanism is sound.

### T44-04: View count buffer — double-counting under concurrent access
**Trace:** `bufferGroupViewCount` (data.ts:26) → `viewCountBuffer.set(groupId, ... + 1)` → `flushGroupViewCounts` → `viewCountBuffer.clear()` → failed increments re-buffered
**Hypothesis:** Between `new Map(viewCountBuffer)` (line 45) and `viewCountBuffer.clear()` (line 46), `bufferGroupViewCount` could add new entries that are lost because the snapshot was taken before clear.
**Analysis:** `bufferGroupViewCount` runs on the Node.js event loop, same as `flushGroupViewCounts`. Since `new Map(viewCountBuffer)` and `viewCountBuffer.clear()` are synchronous operations within the same microtask, no interleaving is possible. The `isFlushing` flag (line 43) also prevents concurrent flush. New increments between the snapshot and clear are added to `viewCountBuffer` which was just cleared — they are NOT in the batch but WILL be flushed in the next cycle. This is correct.
**Conclusion:** No bug. Single-threaded event loop ensures atomicity.

## New Findings

### T44-05: `login` audit log stores unsanitized username [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/auth.ts` line 135
**Description:** The `username` parameter from `formData.get('username')` is passed directly to `logAuditEvent` without `stripControlChars`. If the username contains control characters, they end up in the `audit_log.metadata` JSON field. While the `logAuditEvent` function serializes with `JSON.stringify` (which escapes control characters as `\uXXXX`), the `targetId` parameter (also `username`) is stored directly in the `target_id` VARCHAR column without sanitization.
**Fix:** Apply `stripControlChars(username)` before using it in `login()`. Matches S44-01.

## Previously Deferred Items (No Change)

- CR-39-02: `processImageFormats` unlink-before-link race window
- D43-01: Backup file integrity verification after write
