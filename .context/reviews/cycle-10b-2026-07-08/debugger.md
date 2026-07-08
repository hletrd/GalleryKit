# Cycle 10b Debugger Review

Role: debugger. Scope (per assignment): latent runtime bugs in the trickiest binary/parsing/
concurrency surfaces — ISOBMFF/NCLX color box walker (`color-detection.ts`), ICC parsers
(`icc-extractor.ts`, `icc-chromaticity.ts`), `gps-exif-strip.ts` byte-level neutralization,
`blur-data-url.ts` validation, `sw-cache.ts` LRU math, `migrate.js` drift logic, upload quota
TOCTOU claim/rollback, `image-queue.ts` claim/dedup, `view-retention.ts` chunked DELETE,
`maintenance-scheduler.ts` timers. Hunting for integer overflow/underflow, off-by-one buffer
offsets, unhandled rejections, unbounded recursion, missing bounds checks, NaN/Infinity
propagation, timezone/date bugs, unclosed DB connections, timer leaks, wrong-path cleanup.

Reviewed COMMITTED HEAD only: `36a79146a7519a267af0c5dbcaf3d9909e727289` (`fix(cycle29): harden
server action scanning`). `git status --short` showed a clean working tree (only the new
untracked `.context/reviews/cycle-10b-2026-07-08/` directory being populated by parallel review
agents this cycle) — every file cited below was read from the working tree, which equals HEAD
exactly for these paths. The peer's previously-dirty files (`check-action-origin.ts`,
`check-action-origin.test.ts`, `cycle-28-source-contracts.test.ts`) were committed in
`36a79146` and touch none of the modules in this review's scope.

## Dedup pass

Before investigating, checked prior debugger passes to avoid re-filing:

- `.context/reviews/cycle-9-2026-07-08/debugger.md` (this run's immediately-prior cycle) —
  full reads of `gain-map-detection.ts`, `gps-exif-strip.ts`, `db-child-watchdog.ts`,
  `single-writer-guard.ts`, `blur-data-url.ts`, `icc-chromaticity.ts`, `migrate.js`,
  `actions/images.ts retryFailedImage`, `image-queue.ts` retry bookkeeping — all disposed
  "no new defect." One defect filed (`DBG9-01`, embeddings backfill scan/attempt-budget
  conflation) — not re-litigated here per instructions to prefer new findings.
- `.context/reviews/run9-cycle8/debugger.md` — explicit CLEAN disposition for
  `color-detection.ts` `parseCicpFromHeif` and `icc-extractor.ts extractIccProfileName`
  (full 424-line / 127-line reads), with the exact bounds-check reasoning already spelled out.
- `.context/reviews/run10-cycle27/debugger.md`, `run10-cycle29/code-reviewer-debugger-tracer.md`
  — restore-drain checklist and `maintenance-scheduler.ts` scope checks, no defects.
- A separate parallel loop's `cycle-4-2026-07-07/debugger.md` already filed `DBG4-03`
  (`image-queue.ts` embedding-scan cursor is process-memory-only, reset by every redeploy, not
  just DB restore) — a different angle on the same state than what I traced below; not
  re-filed.

Given that dedup pass, I re-verified the specifically assigned files myself (fresh eyes, full
reads) rather than trusting prior dispositions blindly, and traced one additional interaction
(`image-queue.ts` embedding-scan cursor vs. the restore-drain timeout) that none of the above
reports mention. Details below.

## Findings

**No new confirmed defects.** Everything investigated either matches the prior "CLEAN"
dispositions above (independently re-verified, not just trusted) or resolves to a
self-healing / unreachable condition on closer trace, documented below for the record so the
next pass doesn't have to re-walk the same paths.

### Checked and confirmed clean (independent re-verification)

- **`apps/web/src/lib/color-detection.ts` `parseCicpFromHeif`** (full read, lines 1-442): the
  ISOBMFF walker's size arithmetic is sound — `size === 1` (64-bit extended size) is bounds-
  checked (`pos + 16 > limit`) before `readBigUInt64BE`, and the `Number(bigint)` conversion
  cannot silently wrap because a 64-bit ISOBMFF box size (max ~1.8e19) is far below
  `Number.MAX_VALUE` (~1.8e308) where BigInt→Number conversion would return `Infinity`; any
  oversized value still fails `pos + size > limit`. `size === 0` correctly resolves to
  `limit - pos`. Depth capped at 5, scan capped at 1 MB. The `colr`/`nclx` payload read
  (`dataStart + 4/6/8/10`) is only reached when `dataSize >= 11`, and `boxEnd <= limit <=
  buffer.length` is already proven, so the read never exceeds the buffer. Recursion is
  restricted to `meta`/`iprp`/`ipco` container types. One acknowledged (non-bug) heuristic
  limitation: the walker returns the *first* `colr`/`nclx` box found depth-first, without
  cross-checking `ipma` item-property associations — on a HEIC with multiple items (e.g. an
  Apple gain-map auxiliary image) carrying different CICP boxes, the wrong item's triplet
  could theoretically win. Not filing this: it requires a source with heterogeneous per-item
  CICP boxes (uncommon — gain-map auxiliary images typically share the primary's color
  properties), and every prior cycle through run9-cycle8 already reviewed this exact walker as
  CLEAN without flagging it, so it's a known, low-likelihood heuristic edge rather than a new
  finding.
- **`apps/web/src/lib/icc-extractor.ts` `extractIccProfileName`** (full read, 137 lines):
  every multi-byte read (`desc` legacy tag, `mluc` v4 records) is preceded by an explicit
  bound check against `iccLen` and the enclosing tag's `dataOffset + dataSize`; tag count and
  record count are both capped at 100; string lengths capped at 1024. The `desc` tag's
  `strLen - 1` (ASCII-invariant length includes the NUL terminator per ICC.1:2010) is
  correctly guarded by `Math.max(0, ...)`. No OOB read, no infinite loop.
- **`apps/web/src/lib/view-retention.ts` `purgeOldViewEvents`**: `resolveRetentionMs` falls
  back to the 395-day default for any non-finite/non-positive input (NaN, negative, zero),
  correctly using `Number()` (not `parseInt`) so `'1e3'` parses to 1000 rather than 1. The
  per-table chunked DELETE loop's termination (`affected < VIEW_PURGE_BATCH`) and the
  `MAX_BATCHES_PER_TABLE` hard cap are consistent — no infinite loop, no unbounded lock.
- **`apps/web/src/lib/maintenance-scheduler.ts`**: `runMaintenanceSweep`'s in-flight guard
  (`if (maintenanceSweepInFlight) return;`) and the subsequent synchronous
  set-before-first-`await` sequencing leaves no window for a duplicate concurrent sweep to
  slip through. `drainMaintenanceSweepsForRestore`'s `Promise.race` against an unref'd timeout
  is correctly cleaned up (`clearTimeout`) on both branches. No leaked interval — `stopMaintenanceScheduler`/`stopMaintenanceSchedulerForTests` clear the interval handle.
- **`apps/web/src/lib/image-queue.ts` `enqueueImageProcessing`** (claim/dedup, full re-trace of
  lines 737-1099): the `state.enqueued` / `state.claimRetryCounts` / `state.retryCounts` /
  `state.lastErrors` bookkeeping is internally consistent across every exit path (successful
  claim, claim contention with retry, claim exhaustion → permanent failure, processing error
  with retry, processing error exhausted → permanent failure) — the `finally` block's
  `claimRetryScheduled`/`retried` flags correctly gate which maps get cleared vs. preserved for
  a scheduled retry, matching the documented C4-A1/C4-A2 fixes.
- **`apps/web/src/lib/image-queue.ts` `bootstrapMissingActiveEmbeddings`** (lines 542-637, not
  explicitly named in prior cycles' dispositions): re-derived the same scan/attempt-budget
  conflation class that `DBG9-01` (cycle-9) found in `embeddings.ts`/
  `backfill-clip-embeddings.ts`, to check whether it recurs here. It does **not**: `scanned`
  is incremented by `rows.length` (rows actually *fetched*, i.e., the same quantity the SQL
  `LIMIT` controls), and the "reached end" check (`rows.length < batchLimit`) compares against
  `batchLimit` — the *actual* (possibly budget-shrunk) `LIMIT` value used in that query — not
  against a stale fixed constant. That is the exact fix `DBG9-01` recommends for the sibling
  code; this function already implements it correctly, so a shrunk final page can never be
  misread as "end of table."
- **Upload quota TOCTOU** (`apps/web/src/app/actions/images.ts` `uploadImages`, full re-trace
  of the claim/settle lifecycle lines 142-610): the synchronous claim-before-first-`await`
  ordering (R16C16 CR-16-01) holds; every awaited step after the claim (disk-space check,
  topic-exists SELECT, per-file processing) is paired with a `settleClaim(...)` call, and the
  one documented residual gap (`deleteOriginalUploadFile` in the per-file `catch` at
  lines 521-536 is the only post-claim `await` not paired with an explicit settle) is provably
  safe because `deleteOriginalUploadFile` (`upload-paths.ts:81-88`) wraps every internal
  `fs.unlink`/candidate-resolution step in `.catch(() => {})`/`.catch(() => null)` and can
  never reject — confirmed by reading the implementation, not just trusting the comment.

### Traced but not filed (self-healing on closer inspection)

- **`sw-cache.ts` `recordAndEvict` has no explicit NaN/Infinity guard on `newSize`.** The
  `if (newSize <= 0) return 0;` early-out is false for `NaN` (any comparison with `NaN` is
  `false`), so a `NaN`-sized entry would be recorded, `total` would become `NaN` forever after,
  and `NaN > maxBytes` is always `false` — permanently disabling eviction for that cache. This
  is a real structural gap in the reference module (`apps/web/src/lib/sw-cache.ts:108`, mirrored
  verbatim in `apps/web/public/sw.template.js:111`), but I checked every current production call
  site and it is **not reachable today**: the only two callers computing a size —
  `responseSize()` (`sw.template.js:228-237`, used for `recordAndEvict`) and the
  `cachedSize = Number(...) || 0` expression (`sw.template.js:392`, used for `touchMeta`) — both
  either validate `Number.isFinite(parsed) && parsed >= 0` before returning it or fall back to
  `Blob.size` (always a valid non-negative integer), or coerce a non-numeric/absent
  `Content-Length` to `0` via `|| 0`. Not filing as a defect since there is no current code path
  that feeds `NaN`/`Infinity` into either function; noting it here as a documented,
  currently-inert gap in case a future caller (e.g. an HTML-cache LRU reusing this module) skips
  that validation.
- **`image-queue.ts` embedding-scan cursor vs. the restore-drain timeout.** Traced a specific
  interaction not covered by the other loop's `DBG4-03` (which is about cross-*process-restart*
  cursor loss): `bootstrapMissingActiveEmbeddings` (line 542) captures `cursorId` as a local
  variable and, on completion, writes `state.embeddingScanCursorId` back
  (lines 585/632) from a `.finally()` that fires whenever that specific invocation ends —
  regardless of what else has happened to `state` in the meantime. `quiesceImageProcessingQueueForRestore` (line 1285) races the queue-idle-and-side-effects
  drain (which includes any in-flight embedding-scan promise, tracked via
  `trackQueueSideEffect`) against a 30 s timeout
  (`RESTORE_QUEUE_DRAIN_TIMEOUT_MS`) and unconditionally resets `state.embeddingScanCursorId = 0`
  / `state.embeddingScanModelVersion = null` after the race settles, win or lose. A real-CLIP
  production embedding scan over a large backlog (default `SEMANTIC_SCAN_LIMIT` 2000 rows,
  `BOOTSTRAP_EMBEDDING_RETRY_CONCURRENCY` 2) can plausibly exceed 30 s, so the scan can still be
  running when the restore drain times out. Traced the consequences: (1) on drain timeout, the
  restore action's drain checklist (`db-actions.ts:595-644`) treats `!drainResult.ok` as a hard
  abort — `runRestore` (the actual import) never executes, so the `images` table is never
  replaced underneath the stale scan; and (2) when the stale scan eventually finishes and writes
  back a stale `embeddingScanCursorId`, the *next* invocation of
  `bootstrapMissingActiveEmbeddings` immediately sees `state.embeddingScanModelVersion === null`
  (left by the quiesce reset) `!== activeModelVersion`, which forces
  `state.embeddingScanCursorId = 0` again before any further scanning. So the stale write is
  transient and self-corrects on the very next scan attempt; there is no lost/skipped-row window
  because the underlying data never changed. Not filing as a defect — flagging the trace here so
  a future reviewer doesn't have to re-derive it if this class of race is revisited.

## Disposition

**0 new defects.** Every module in the assigned scope was independently re-verified (not just
matched against prior dispositions) and remains sound. Two theoretical gaps were traced to
ground — one provably unreachable via any current caller (`sw-cache.ts` NaN), one provably
self-healing via an existing guard (`image-queue.ts` embedding-scan cursor vs. restore-drain
timeout) — and are recorded above so the next cycle doesn't re-spend budget re-deriving them.
