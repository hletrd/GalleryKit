# Tracer Review — Cycle 17

## Causal tracing of suspicious flows

### Trace 1: Login rate-limit under DB failure

**Flow**: User submits login -> `auth.ts:126-137` pre-increments in-memory + DB counters -> `auth.ts:142-154` DB-backed check -> `auth.ts:155-162` catch block on DB failure.

**Hypothesis 1**: If DB is unavailable, the in-memory Maps are the only guard. Two concurrent requests from the same IP could both pass the in-memory check before either increments, because `loginRateLimit.set()` (line 128) is not atomic with the increment (line 126). However, JavaScript is single-threaded in the event loop, so the `limitData.count += 1` and `loginRateLimit.set()` execute atomically between await points. The real risk is if the DB increment (line 129) fails and the in-memory count diverges.

**Verdict**: The in-memory path is safe within a single process. The DB-unavailable catch (line 155-162) rolls back on `count > LOGIN_MAX_ATTEMPTS`, which is the correct behavior — it prevents the in-memory count from exceeding the limit. The competing hypothesis (DB failure gives extra attempts) is mitigated by the in-memory guard.

### Trace 2: View-count buffer during concurrent flush

**Flow**: `bufferGroupViewCount()` -> `flushGroupViewCounts()` -> swap Map reference -> drain chunk-by-chunk.

**Hypothesis**: If `flushGroupViewCounts` is called while already flushing (e.g., timer fires during a long flush), the `isFlushing` guard (line 63) prevents re-entry. But the swap (line 72) happens AFTER the guard check. If the timer fires between lines 63 and 72, the new timer callback would see `isFlushing = true` and return immediately. The swap happens once per flush cycle.

**Verdict**: Safe. The `isFlushing` boolean prevents concurrent flushes. The Map swap is atomic (single assignment). New increments during a flush go to the fresh Map (line 72).

### Trace 3: Image queue bootstrap cursor under permanent failures

**Flow**: `bootstrapImageProcessingQueue()` -> query with `notInArray(permanentlyFailedIds)` -> `scheduleBootstrapContinuation()` on large result sets.

**Hypothesis**: If there are 600 unprocessed images and 200 permanently-failed ones, the first bootstrap batch (500) skips the 200 permanently-failed IDs but still gets 500 unprocessed images. The cursor (`bootstrapCursorId`) advances to the last ID in the batch. The next continuation scan starts from `id > cursor`, which might skip some unprocessed images that have IDs lower than some permanently-failed IDs.

**Concrete scenario**: IDs 1-200 are permanently failed, IDs 201-800 are unprocessed. Bootstrap query: `WHERE processed = false AND id NOT IN (1..200) AND id > NULL LIMIT 500`. This returns IDs 201-700 (500 rows). Cursor = 700. Continuation: `WHERE processed = false AND id NOT IN (1..200) AND id > 700 LIMIT 500`. Returns IDs 701-800. This is correct — no unprocessed images are missed.

**Verdict**: The cursor + notInArray combination correctly handles interleaved permanently-failed and unprocessed IDs. No images are skipped.

### Trace 4: Lightbox focus trap and Escape key interaction

**Flow**: User presses Escape in lightbox -> `lightbox.tsx:211-215` checks `!document.fullscreenElement` -> calls `onClose()`. FocusTrap component (from lazy-focus-trap) also handles Escape.

**Hypothesis**: The FocusTrap and the manual keydown handler both try to handle Escape. If FocusTrap catches it first and stops propagation, the manual handler never fires. If the manual handler catches it first (it's on `window`), it calls `onClose()` which unmounts the lightbox, and FocusTrap cleanup runs in the effect's return.

**Verdict**: The `window.addEventListener('keydown')` fires before FocusTrap's internal handler because window listeners fire during the capture/target phase before React's synthetic events. The `e.stopPropagation()` on line 203 stops further propagation of handled keys. Escape is in the list, so it's stopped. This is correct — the manual handler takes precedence.

## Findings

### C17-TR-01: View-count flush re-buffer after partial failure can create unbounded retry count
- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/lib/data.ts:92-106`
- **Issue**: When a flush partially fails (some chunks succeed, some fail), the retry counter for failed groups is incremented (line 106). If the same group fails in multiple flush cycles, the retry count accumulates. The `VIEW_COUNT_MAX_RETRIES = 3` cap (line 93) prevents infinite re-buffering, but the counter is only cleared on success (line 86). This is working as designed.
- **Fix**: No fix needed. The retry cap prevents unbounded accumulation.
