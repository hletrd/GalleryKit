# Run-4 Cycle 11 — code-reviewer / debugger / tracer angle

Single-subagent constraint (documented since run2): nested Agent spawning is
unavailable in this orchestrator context, so each angle is a distinct
full-inventory in-context pass. No angle sampled.

## Inventory this cycle
- Independent line-level regression review of BOTH cycle-10 fix commits:
  - `208a8c7e` — `gps-exif-strip.ts` post-EOI trailer rejection (SEC-R4C10-01)
  - `a5455047` — `deleteAdminUser` audit-row detach (COR-R4C10-01)
- Rotation to the LEAST-run-4-covered correctness surface this run: the
  shared-group **view-count buffered-flush state machine** in
  `lib/data.ts:43-179` (timer scheduling + re-buffer + backoff), plus its
  callers (`getSharedGroup` line 1207, `instrumentation.ts` shutdown,
  `db-actions.ts` pre-backup flush).
- Full reads: `api/checkout/[imageId]/route.ts`, `api/download/[imageId]/route.ts`,
  `actions/collections.ts`, `lib/smart-collections.ts` (compiler + validator),
  `lib/analytics.ts`, `lib/analytics-data.ts`, `lib/atom-feed.ts`,
  `lib/og-photo-fetch.ts`, `api/og/photo/[id]/route.tsx`, `lib/rate-limit.ts`.
- Pattern sweeps: unradixed `parseInt` (none in src), floating promises in the
  flush/tracker paths (none), `audit_log` FK columns (target_id has NO FK).

## FINDING — COR-R4C11-01 (LOW / High confidence on code path)

**`flushGroupViewCounts` strands the view-count buffer when a scheduled timer
fires during an in-flight flush.** `lib/data.ts:63-66`.

```js
async function flushGroupViewCounts() {
    if (isFlushing) return;          // (A) early-return — timer NOT nulled
    isFlushing = true;
    viewCountFlushTimer = null;      // (B) only reached when not flushing
    ...
```

Trace of the stranding:
1. Timer `T1` fires → flush starts: `isFlushing=true`, `viewCountFlushTimer=null` (B), begins `await Promise.all(chunk…)` draining the swapped batch.
2. During that await, a shared-group page load calls `bufferGroupViewCount`; since `viewCountFlushTimer===null` it schedules a fresh timer `T2` (`data.ts:53-55`).
3. If the in-flight flush is still awaiting when `T2` fires (a flush that runs longer than `BASE_FLUSH_INTERVAL_MS=5s` — reachable under DB **slowness**: pool saturation, lock contention, slow link), `flushGroupViewCounts()` runs, hits `if (isFlushing) return` at (A), and returns **without nulling `viewCountFlushTimer`**. The variable now holds the fired-and-inert `T2` handle.
4. The first flush reaches its `finally` reschedule guard `if (viewCountBuffer.size > 0 && !viewCountFlushTimer)` (`data.ts:136`). `viewCountFlushTimer` is the stale non-null `T2` → guard is false → it does **not** reschedule.
5. Every later `bufferGroupViewCount` sees `if (!viewCountFlushTimer)` false (`data.ts:53`) → never arms a new timer.
6. The buffer is now stranded: it accumulates until `MAX_VIEW_COUNT_BUFFER_SIZE=1000` (then silently drops) and is only drained by the explicit `flushBufferedSharedGroupViewCounts()` on shutdown / pre-backup.

Secondary facet (same root cause): `flushBufferedSharedGroupViewCounts`
(`data.ts:168-179`, called from `instrumentation.ts` SIGTERM/SIGINT and from
`db-actions.ts:333` before a DB backup) calls `flushGroupViewCounts()`
directly; if `isFlushing` is true at that moment the call no-ops and the
pre-backup / shutdown flush silently drops the buffered increments.

**Why it matters:** shared-group `view_count` is explicitly best-effort
approximate analytics (CLAUDE.md "Runtime topology"), so this is not
billing/audit-grade data loss — hence LOW. But it is a genuine
state-machine defect distinct from the documented buffered-flush undercount:
once stranded, the buffer stops self-draining entirely (not just an
undercount during the outage), and the loss persists after the DB recovers
until the next process exit.

**Failure scenario:** a gallery under load with a momentarily slow DB (a
backup running, a long lock, pool exhaustion) accrues a flush that exceeds
5s; a single page view during that window arms `T2`; `T2` fires before the
flush ends; from that point the gallery silently stops persisting any
shared-group view counts until restart.

**Fix:** null `viewCountFlushTimer` on entry (before the `isFlushing` guard)
so the fired handle is always cleared, and re-arm a timer on the
`isFlushing` early-return when the buffer is non-empty:

```js
async function flushGroupViewCounts() {
    viewCountFlushTimer = null;      // this invocation consumed the timer
    if (isFlushing) {
        if (viewCountBuffer.size > 0 && !viewCountFlushTimer) {
            viewCountFlushTimer = setTimeout(flushGroupViewCounts, getNextFlushInterval());
            viewCountFlushTimer.unref?.();
        }
        return;
    }
    isFlushing = true;
    // (old `viewCountFlushTimer = null;` line removed — hoisted above)
    const batch = viewCountBuffer;
    viewCountBuffer = new Map();
    ...
```

The swap pair (`const batch = …; viewCountBuffer = new Map();`) and the
finally-block reschedule guard are unchanged, so the existing fixture test
`data-view-count-flush.test.ts` still holds; a new assertion locks the
entry-null + isFlushing-rearm.

## Regression review of cycle-10 commits — both SOUND

- **`208a8c7e` (GPS post-EOI trailer):** the new walker records
  `scanRegionStart = markerPos` at the SOS/EOI break and rejects a non-trivial
  trailer via `buf.indexOf(JPEG_EOI_MARKER, scanRegionStart)`. `FF D9` cannot
  occur inside valid entropy-coded scan data (a coded `0xFF` is always
  `0x00`-stuffed; the only markers in the scan are RST `FF D0–D7`), so
  `indexOf` lands on the true primary EOI even for progressive multi-SOS
  JPEGs (only the final segment carries EOI). A normal single-image JPEG has
  `buf.length-(eoiIdx+2) ≤ 2` → not rejected. Conservative false-positive
  (a single-image JPEG with >2 trailing pad bytes re-encodes at q95) is the
  documented, privacy-preserving trade-off, and only when `strip_gps_on_upload`
  is ON. No regression.
- **`a5455047` (admin-delete audit detach):** confirmed `audit_log.targetId`
  is a plain `varchar("target_id",{length:128})` with **no** `.references()`
  (`schema.ts:173`); only `userId` has the `ON DELETE NO ACTION` FK. NULL-ing
  `user_id` before the `admin_users` delete is therefore the COMPLETE
  detach — the delete cannot FK-fail on any other audit column. `sessions`
  are deleted explicitly first (and would cascade anyway). Fix is complete.

## No other confirmed issues
`smart-collections` compiler/validator is parameter-bound and scalar-enforced;
checkout/download/og routes are rate-limited with correct rollback taxonomy;
analytics referrer/geo sanitizers are sound.
