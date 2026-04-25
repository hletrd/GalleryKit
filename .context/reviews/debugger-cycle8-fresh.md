# Debugger — Cycle 8 (Fresh, broad sweep)

**Scope:** "What goes wrong if X breaks?" trace-style debugging on the cycle's surfaces.

## Investigations

### D8F-01 — What if `/api/og` route handler throws AFTER `getTopicBySlug` but before `ImageResponse` rendering?
**Trace:** `apps/web/src/app/api/og/route.tsx:18-154`. The outer `try/catch` catches the error and returns 500 with `Cache-Control: 'no-store, no-cache, must-revalidate'`. Stack details are logged at console.error; client gets only "Failed to generate the image".
**Fault tolerance:** OK — error path does not expose internals.
**Concern:** The 500-response cache headers are correct (no-store).

### D8F-02 — What if `bufferGroupViewCount` runs during a DB outage?
**Trace:** `apps/web/src/lib/data.ts:28-42, 48-96`. `flushGroupViewCounts` catches per-row failures and re-buffers (with capacity check). Backoff increments `consecutiveFlushFailures` and exponentially extends the next interval up to 5 minutes.
**Fault tolerance:** Strong. Bounded buffer, exponential backoff, drops new increments at capacity.
**Concern:** During the backoff window, increments accumulate but are not lost (re-buffer works). After 5 minutes the flush retries. **Confirmed correct.**

### D8F-03 — What if `restoreDatabase` is called twice in quick succession?
**Trace:** `apps/web/src/app/[locale]/admin/db-actions.ts:249-323`. First call acquires the MySQL advisory lock `gallerykit_db_restore` with timeout 0 (non-blocking). Second call gets `acquired !== 1` and returns `restoreInProgress` immediately without releasing the lock. **CORRECT: the second call did not acquire the lock so it has nothing to release; the lock stays with the first call's connection.**
**Fault tolerance:** Strong. The lock is released in the first-call's outer `finally`. If the first call's process crashes, the connection drops, and MySQL automatically releases the advisory lock (session-scoped).
**Concern:** None.

### D8F-04 — What happens if `enqueueImageProcessing` is called after `state.shuttingDown` is set?
**Trace:** `apps/web/src/lib/image-queue.ts:182-186`. The early-return logs at debug and silently drops. **The job remains in the DB as `processed = false`.** Bootstrap on next process start picks it up.
**Fault tolerance:** Strong — durable backlog via DB processed flag.
**Concern:** None. Confirmed correct.

### D8F-05 — What if a Sharp `metadata()` call returns successfully but with `width = 0`?
**Trace:** `apps/web/src/lib/process-image.ts:275-276`.
```ts
const width = (metadata.width && metadata.width > 0) ? metadata.width : 2048;
const height = (metadata.height && metadata.height > 0) ? metadata.height : width;
```
The fallback to 2048 / 2048 prevents downstream divide-by-zero. **OK.**

### D8F-06 — What if `images.title` contains a U+202E RLO that was inserted via a pre-cycle-5 path?
**Trace:** `apps/web/src/app/actions/images.ts:679-684` rejects new writes; existing rows from before C5L-SEC-01 retain their content. Render path (photo-viewer, lightbox, OG image, search results) does not re-validate.
**Fault tolerance:** **Open question.** The fix protected the write path, not the read path. A row with U+202E from before April 21, 2026 (commit `f0b62d7`) could still serve to public users.
**Recommendation:** Either (a) one-shot migration that strips Unicode-formatting from existing `images.title/description`, `topics.label`, `topic_aliases.alias`, `tags.name`, `admin_settings` rows; or (b) explicit acceptance that pre-fix data may carry the legacy chars and the public render is on the admin's reading.
**Severity:** LOW for a single-admin personal gallery — the admin likely never had hostile input. But operationally relevant.

### D8F-07 — What if Sharp processing succeeds but `verifyFile` returns `false` for one of the formats?
**Trace:** `apps/web/src/lib/image-queue.ts:273-285`. Throws a synthesized error `Image processing incomplete for ${id}: webp=... avif=... jpeg=...`. The catch block at line 304 retries (max 3) and eventually calls `scheduleBootstrapRetry`.
**Fault tolerance:** Strong. Image stays unprocessed in DB. Subsequent bootstrap pass picks it up.
**Concern:** None.

### D8F-08 — What if MySQL pool exhaustion (queueLimit=20) happens during a request burst?
**Trace:** `apps/web/src/db/index.ts:13-26`. Pool size 10, queue 20, connectTimeout 5s. If 31 concurrent DB requests arrive, the 31st waits up to 5s and then errors with `ER_CON_COUNT_ERROR` or pool-queue-exceeded.
**Fault tolerance:** Server actions catch and return localized errors. Public actions like `loadMoreImages` re-throw → Next.js error page.
**Concern:** Loud failures during legitimate bursts. Mitigation could be a graceful 503 from server actions, but personal-gallery scope rarely hits this.

## Net summary

- The codebase has very strong fault-tolerance posture for the paths examined.
- One genuinely open issue surfaces on the read side: legacy Unicode-formatting characters in pre-fix rows (D8F-06). LOW severity, but a one-shot migration would close it.
- Other investigations confirmed correctness of restore lock handling, queue shutdown, view-count buffering, and Sharp fallback paths.
