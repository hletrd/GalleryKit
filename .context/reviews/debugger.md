# Debugger — Deep Review Slice

**Scope:** causal bug tracing across upload actions, settings locks, photo navigation, image queue recovery, and restore/maintenance state.
**Constraint:** review-only; no code changes were made.

## Flow inventory
- Upload path: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/app/actions/settings.ts`.
- Navigation path: `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`.
- Queue/recovery path: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/data.ts`.
- Supporting tests and docs: `apps/web/src/__tests__/images-actions.test.ts`, `apps/web/src/__tests__/queue-shutdown.test.ts`, `apps/web/src/__tests__/restore-maintenance.test.ts`, `README.md:146-148`.

## Findings

### D-01 — Parallel uploads can self-fail on the exclusive upload/settings lock
- **Severity:** High
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/components/upload-dropzone.tsx:193-251`, `apps/web/src/app/actions/images.ts:171-176`, `apps/web/src/lib/upload-processing-contract-lock.ts:10-57`, `apps/web/src/app/actions/settings.ts:75-86`
- **Problem:** the client sends uploads with concurrency 3, but each upload request acquires the same exclusive `GET_LOCK` for up to 5 seconds. That lock is also reused by settings updates, so the contract is blocking both writes and concurrent upload requests.
- **Failure scenario:** a slow save/EXIF path in the first request holds the lock long enough that the second or third concurrent upload times out and returns `uploadSettingsLocked`, even though no settings mutation is happening.
- **Suggested fix:** either replace the single exclusive lock with a shared/read vs exclusive/write coordination model, or serialize client uploads to 1 until the contract is redesigned.

### D-02 — Photo swipe navigation mixes screen and client coordinates
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/components/photo-navigation.tsx:46-99`, compared with `apps/web/src/components/info-bottom-sheet.tsx:56-98`
- **Problem:** touch start stores `screenX` / `screenY`, but the first move check uses `clientX` / `clientY` while the rest of the swipe math uses `screenX` / `screenY`. The coordinate systems are mixed inside a single gesture.
- **Failure scenario:** on devices or browser states where the two coordinate spaces differ, a vertical move can be misclassified as a horizontal swipe or a legitimate swipe can be ignored, causing scroll jank or navigation glitches.
- **Suggested fix:** use either client coordinates or screen coordinates consistently for the entire gesture and add a regression test around the swipe threshold logic.

### D-03 — A missing original file leaves the image row pending without a terminal failure
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/lib/image-queue.ts:236-250`, `apps/web/src/lib/image-queue.ts:327-339`
- **Problem:** when `fs.access(originalPath)` fails, the queue logs and returns early. The `finally` block clears the in-memory state, but the DB row stays `processed=false` and the job is not routed through the retry/bootstrap path.
- **Failure scenario:** if the original file is deleted externally or goes missing after restore, the image can remain permanently pending in that process with no explicit admin-visible failure state.
- **Suggested fix:** treat missing originals as a terminal failure with explicit state, or throw into the bounded retry/bootstrap path and then mark the row failed when retries are exhausted.

### D-04 — Restore maintenance, queue state, and view counts are process-local
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed risk
- **Files/regions:** `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/image-queue.ts:121-139,189-193,469-498`, `apps/web/src/lib/data.ts:11-23,37-50`, `README.md:146-148`
- **Problem:** restore maintenance is just a module-global flag, the processing queue state is module-global, and view-count buffering is module-global. The README documents a single-web-instance/single-writer topology, but the runtime does not enforce it.
- **Failure scenario:** if the app is ever run with multiple workers or replicas, one process can keep accepting uploads or flushing counters while another is in restore maintenance, and recent view-count increments can be lost or split across processes.
- **Suggested fix:** either enforce the single-worker topology at startup, or move maintenance/queue/view-count coordination into shared storage so the behavior is consistent across processes.

## Final sweep notes
- The queue and restore tests document the intended single-process behavior, but they do not protect against a future deployment that accidentally scales out.
- The photo-navigation coordinate mismatch is the clearest current runtime bug in this slice.
- I did not change any code or run destructive actions.

## Summary counts
- Findings: 4 (1 high, 3 medium)
- Report file written: `.context/reviews/debugger.md`
