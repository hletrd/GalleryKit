# Debugger Review — Cycle 17

## Latent bug surface and failure mode analysis

### Finding 1: View-count flush `isFlushing` guard is not resilient to uncaught exceptions

- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/data.ts:58-161`
- **Issue**: The `isFlushing` flag is set to `true` at line 64 and reset in the `finally` block at line 112. If an uncaught exception occurs during the `Promise.all` in the `try` block (e.g., an unhandled promise rejection from a Drizzle query), the `finally` block will still execute and reset `isFlushing = false`. However, if the process crashes during the flush, `isFlushing` is never reset, and the next timer will see `isFlushing = true` and skip the flush. This is acceptable because a process crash also kills the timer.
- **Concrete scenario**: DB returns a malformed response that causes Drizzle to throw a TypeError. The `finally` block catches this, resets `isFlushing`, and the buffer entries that failed are re-buffered. This is the correct behavior.
- **Verdict**: No bug. The `try/finally` pattern correctly handles exceptions.

### Finding 2: `lightbox.tsx` cleanup effect may not restore `body.overflow` if component unmounts during fullscreen

- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/components/lightbox.tsx:264-275`
- **Issue**: The lightbox effect saves `document.body.style.overflow` and restores it on cleanup. If the user is in fullscreen mode and the component unmounts (e.g., due to a parent re-render), `document.exitFullscreen()` is not called. The body overflow IS restored (the effect cleanup runs), but the browser remains in fullscreen mode. The user would need to press Escape to exit fullscreen manually.
- **Concrete scenario**: User opens lightbox, presses F for fullscreen, then presses Escape. The keydown handler (line 211-215) checks `!document.fullscreenElement` — since they ARE in fullscreen, it calls `document.exitFullscreen()`, not `onClose()`. On the next Escape, `document.fullscreenElement` is null, so `onClose()` is called. This is the correct behavior.
- **Verdict**: Not a bug. The Escape key correctly exits fullscreen before closing the lightbox.

### Finding 3: `image-queue.ts` claim retry timer is unref'd but still fires during shutdown

- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/image-queue.ts:239-244`
- **Issue**: The claim retry timer (`setTimeout(() => enqueueImageProcessing(job), delay)`) is NOT `.unref()`'d. The `enqueueImageProcessing` call adds a new job to the queue. During shutdown (`state.shuttingDown = true`), `enqueueImageProcessing` returns early (line 201-203), so the re-enqueue is harmless. But the timer itself keeps the event loop alive until it fires.
- **Fix**: Add `.unref()` to the claim retry timer to match the pattern used for `bootstrapRetryTimer` (line 399) and the view-count flush timer (line 54).

### Finding 4: `searchImages` result ordering when main + tag + alias results overlap

- **Confidence**: Low
- **Severity**: Low
- **Location**: `apps/web/src/lib/data.ts:1064-1073`
- **Issue**: The deduplication (line 1064-1070) uses a `seen` Set and preserves insertion order (main results first, then tag, then alias). This means main results always appear before tag/alias results regardless of relevance. For a personal gallery this is fine, but it could cause unexpected ordering if a tag match is more relevant than a title match.
- **Verdict**: Working as designed. Not a bug.

## Findings

### C17-DB-01: Claim retry timer not unref'd — prevents graceful process exit
- **Confidence**: Medium
- **Severity**: Low
- **Location**: `apps/web/src/lib/image-queue.ts:239-243`
- **Issue**: The `setTimeout` for claim retry is not `.unref()`'d, unlike other timers in the module. This keeps the Node.js event loop alive even when there are no other pending operations, preventing graceful shutdown in edge cases.
- **Fix**: Add `retryTimer.unref?.()` after line 242.
