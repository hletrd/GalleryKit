# Tracer Report — Cycle 15

**Date:** 2026-06-27
**Agent:** tracer (cycle 15)
**HEAD at trace time:** 2f886351

**One-line:** All four traced flows are fundamentally sound after the cycle-12/13/14 hardening; the only NEW actionable signal is a **test-gate gap** — the cycle-14 R14-01 shutdown-flush fix (`currentFlushPromise` in-flight await) has **zero regression coverage**, so a revert is undetectable (same class as cycle-14 TE-02). The shutdown-flush **residual race** the prompt asks about is real but bounded and within the documented best-effort-analytics contract (LOW / by-design). Flows 2/3/4 are SAFE, with only a narrow, bounded disk-leak residual in flow 2.

---

## Flow 1 — Graceful shutdown → view-count flush (Docker SIGTERM → instrumentation.ts → flushBufferedSharedGroupViewCounts → flushGroupViewCounts)

### Observation
On SIGTERM, `instrumentation.ts:73-80` runs `gracefulShutdown` → `Promise.race([Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()]), 15s timeout])` → `process.exit(0|1)` (`instrumentation.ts:36-65`). The cycle-14 R14-01 fix added a module-level `currentFlushPromise` (`data.ts:70,104,205,222-223`) so the shutdown flush awaits an in-flight timer-driven drain instead of observing the post-swap empty buffer and exiting. `Dockerfile:103` sets `NEXT_MANUAL_SIG_HANDLE=true` (cycle-14 task 1), so Next's competing handler is suppressed and Next never calls `server.close()`.

### Hypotheses
- **H1 — the cycle-14 fix fully closes the truncation window.**
- **H2 — a residual race remains: increments buffered AFTER the flush completes but BEFORE process.exit are lost.**
- **H3 — the fix can hang or double-flush (currentFlushPromise never resolved, or a re-armed timer double-drains).**
- **H4 — the fix is untested, so a regression would be undetectable (test-gate hypothesis).**

### Evidence
- **H1 — CONFIRMED for the targeted window.** `flushGroupViewCounts` swaps `const batch = viewCountBuffer; viewCountBuffer = new Map();` (`data.ts:113-114`) BEFORE the chunked `db.update(sharedGroups)` writes (`data.ts:127-130`). Pre-fix, `flushBufferedSharedGroupViewCounts`'s `size === 0` early-return (`data.ts:226`) saw the empty new buffer and let `process.exit()` truncate the still-draining `batch`. The fix awaits `currentFlushPromise` (`data.ts:222-223`), resolved only in the `finally` (`data.ts:205-206`) after the chunk loop fully settles. So a SIGTERM landing mid-drain now waits for every committed-some-groups chunk to finish. **The serious window (a multi-chunk DB write that had already committed for some groups but not others) is closed.**
- **H3 — REFUTED (no hang, no double-flush).** `resolveDrain` is published at `data.ts:104`; the only code between it and the `try` (`data.ts:111-115`) is non-throwing assignments, so `finally` (and `resolveDrain()` at `:206`) always runs → no hang. The post-await timer-clear (`data.ts:216-219`) cancels any re-armed follow-up timer; that timer's interval is ≥ `BASE_FLUSH_INTERVAL_MS` (5 s, `data.ts:35`) — a macrotask — while the awaiting continuation is a microtask, so the clear always wins → no concurrent double-drain. The final `await flushGroupViewCounts()` (`data.ts:228`) re-enters cleanly because `isFlushing` was reset to `false` in the prior `finally` (`data.ts:148`).
- **H2 — CONFIRMED (residual, bounded).** With `NEXT_MANUAL_SIG_HANDLE=true` (`Dockerfile:103`) Next does **not** `server.close()`, so the HTTP server keeps accepting requests for the **entire** shutdown window (up to the 15 s drain). `bufferGroupViewCount` fires on every fresh public `/g/[key]` render (`data.ts:1309-1310`, inside `getSharedGroup`). The view flush runs **concurrently** with the queue drain (same `Promise.all`, `instrumentation.ts:37-40`) and flushes **once**. Any shared-group page load that buffers an increment AFTER that single flush completes but while the queue is still draining (a window as long as `queue-drain-time − flush-time`, potentially several seconds for an in-flight Sharp encode) is stranded in `viewCountBuffer` and lost at `process.exit`. `bufferGroupViewCount` has no `shuttingDown` guard (`data.ts:48-53` checks only `isRestoreMaintenanceActive()`), so it keeps accepting during shutdown.
- **H4 — CONFIRMED (test-gate gap, NEW).** `grep currentFlushPromise apps/web/src/__tests__` → 0 hits; `grep flushBufferedSharedGroupViewCounts apps/web/src/__tests__` → 0 hits; `grep "instrumentation|gracefulShutdown" apps/web/src/__tests__` → 0 hits. The fixture test `data-view-count-flush.test.ts` locks swap-and-drain, backoff, capacity guards, and the COR-R4C11-01 entry-null — but **nothing** asserts the `currentFlushPromise` publish/await or the shutdown-flush ordering. A revert of the cycle-14 R14-01 fix passes every existing test. **Same class as cycle-14 TE-02** (the broken `bavail` mock that made the cycle-13 fix coverage-free), which the team treated as HIGH-priority / LOW-sev.

### Rebuttal round
- **Strongest challenge to "H2 is acceptable":** the residual loss window is not "the final microseconds" — because the flush is concurrent with (not after) the queue drain, it can span the whole remaining drain (seconds), during which a busy shared gallery could lose many increments.
- **Why it still stands as LOW/by-design:** CLAUDE.md explicitly classifies shared-group `view_count` as "best-effort approximate analytics... a crash, process kill, or extended DB outage can undercount delivered views. Do not treat it as billing/audit-grade." Deploys also typically drain LB traffic before/while the container stops. A fully-complete fix (close HTTP first, or flush view counts LAST after the queue drain, or loop-until-stably-empty) conflicts with the cycle-14-documented tradeoff of dropping in-flight HTTP. So H2 is a genuine residual but correctly inside the contract.

### Verdict
- **H1: SAFE** (targeted truncation window closed). Confidence HIGH.
- **H2: CONFIRMED residual race**, but **LOW severity / by-design-adjacent** (best-effort analytics). Confidence HIGH. *Optional* hardening if ever escalated: flush view counts as the LAST shutdown step (after `shutdownImageProcessingQueue()` resolves) rather than concurrently, shrinking the loss window to the final drain.
- **H4: CONFIRMED test-gate gap — the actionable finding. LOW severity / MEDIUM priority.** A behavioral test (fake timers + mocked `db.update`) that (a) arms a slow in-flight `flushGroupViewCounts`, (b) calls `flushBufferedSharedGroupViewCounts`, and (c) asserts it awaits all chunks before resolving would lock the fix. Confidence HIGH.

---

## Flow 2 — Image-processing claim/delete race (upload → enqueue → PQueue claim → Sharp fan-out → conditional UPDATE vs concurrent deleteImage)

### Observation
The queue worker acquires the per-image advisory lock (`image-queue.ts:302`), claim-checks `WHERE id AND processed=false` (`:338-343`), Sharp-fans-out (`process-image.ts:1311-1315`), verifies the 3 base files (`image-queue.ts:422-429`), then conditional-UPDATEs `WHERE id AND processed=false` (`:433-435`); on `affectedRows===0` it cleans variants with a `[]` full-scan (`:448-453`). `deleteImage` does **not** take the per-image lock (`images.ts:560-654`) — it deletes the row in a txn (`:620-624`), then unlinks original + all variants via `deleteImageVariants(dir, fn, [])` full-scan (`:635-642`).

### Hypotheses
- **H1 — success-path delete leaves no orphan** (worker writes files, then UPDATE→0→cleanup).
- **H2 — failure-path delete orphans files** (deleteImage unlinks the original mid-fan-out → Sharp ENOENT → worker retries → retry's claim-check skip returns WITHOUT cleanup).
- **H3 — a deleted image gets wrongly marked processed.**

### Evidence
- **H1 — CONFIRMED safe.** Any interleaving where the worker reaches the conditional UPDATE after a delete sees `affectedRows===0` → `deleteImageVariants(..., [])` full directory scan (`image-queue.ts:448-453`, `process-image.ts:580-608`), which removes every `{name}_*{ext}` variant including non-default sizes. By the time the UPDATE runs, Sharp has fully completed all atomic renames, so the scan catches everything.
- **H3 — REFUTED.** The mark-processed UPDATE is gated on `eq(images.processed, false)` AND `eq(images.id, job.id)` (`:435`); a deleted row matches neither → `affectedRows===0` → no false "processed". The claim-check (`:338-343`) is a second gate. A deleted image cannot be marked processed.
- **H2 — partially mitigated, narrow residual.** If `deleteImage` unlinks the **original** (`deleteOriginalUploadFile`, `images.ts:636`) while the worker's per-format fresh `sharp(processingInputPath)` opens are still pending (WI-14: a fresh decode **per output**, `process-image.ts:1160-1166`), a later open throws ENOENT → `Promise.all` rejects → catch at `process-image.ts:1341-1357` unlinks everything in `writtenSizedPaths` (all 3 formats). **This is the primary mitigation and covers the common case.** Residual: `Promise.all` does **not** cancel sibling promises, so a sibling format whose `toFile()` was already in-flight can complete a write (and add to `writtenSizedPaths`) in the microtask gap AFTER the catch snapshots `Array.from(writtenSizedPaths.*)` — those late files are not unlinked by the catch. On retry, the claim-check finds no row (deleted) → `return` at `:342` **without** cleanup. Two backstops usually reclaim them: (a) `deleteImage`'s own `[]` full-scan (`:635-642`) if it runs after the writes, and (b) on a *non-delete* transient failure, the retry re-encodes the same deterministic filenames and overwrites. Only the precise (delete + original-unlink-lands-between-sibling-opens + deleteImage-scan-already-passed) interleaving on a **non-downscaled** source (downscaled sources read a private temp deleteImage doesn't know about, `process-image.ts:1360-1362`) leaves a couple of size-variant files orphaned. There is **no orphan-derivative GC** — `image-queue.ts:801-810` sweeps sessions/buckets/audit/views/retry-maps but not stray derivatives; `cleanOrphanedTmpFiles` (`:32-73`) handles only `.tmp`. So a leaked fully-renamed derivative persists.

### Rebuttal round
- **Strongest challenge:** the residual orphan is unreclaimable (no GC), so over a gallery's lifetime repeated delete-during-processing races could accumulate dead bytes.
- **Why down-ranked:** the triggering interleaving is extremely narrow (a sub-millisecond sibling-write window inside an already-rare concurrent-delete-of-an-actively-encoding-image), bounded to a handful of files per occurrence, disk-leak only (no correctness/security impact), and two independent backstops cover most instances. It is the **same class** as the documented delete-during-processing handling — just the `Promise.all`-doesn't-cancel-siblings corner that the `writtenSizedPaths` snapshot can't see.

### Verdict
**H1/H3 SAFE** (confidence HIGH). **H2 NEEDS-VALIDATION, LOW/INFO bounded disk-leak** (confidence MEDIUM that the path is reachable; LOW that it's ever materially hit). Not a confirmed material bug. If ever escalated: the catch at `process-image.ts:1341` could await the sibling `generateForFormat` promises to settle before snapshotting `writtenSizedPaths`, or the claim-check skip at `image-queue.ts:342` could do a defensive `[]` full-scan cleanup before returning.

---

## Flow 3 — settings-hash / ETag cache invalidation (admin changes a COLOR_IMPACTING_KEY → ETag on serve-upload path)

### Observation
`COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`) lists 9 keys. `serve-upload.ts:214-215` folds the 8-char hash into `W/"v${IMAGE_PIPELINE_VERSION}-${mtime}-${size}-${settingsHash}"`. The only ETag caller is `getServingColorSettingsHash` (`serve-upload.ts:50-83,214`), which uses the **config-arg** form `getColorSettingsHash(config)` → `buildHashFromConfig` (sorts `image_sizes` ascending, `settings-hash.ts:99`).

### Hypotheses
- **H1 — a byte-impacting admin setting is missing from COLOR_IMPACTING_KEYS** (changes bytes but not the ETag on the serve-upload path).
- **H2 — the no-arg vs config-arg `image_sizes` sort discrepancy causes ETag thrash.**

### Evidence
- **H1 — REFUTED.** `processImageFormats` consumes exactly: quality webp/avif/jpeg, imageSizes, forceSrgbDerivatives, wideGamutJpegChroma, avifEffort, sdrJpegChroma, wideGamutMaxSourcePixels (per-image iccProfileName/colorSignals aside) — every one is in `COLOR_IMPACTING_KEYS`. The two remaining processing-relevant settings are NOT byte-impacting for served derivatives: `strip_gps_on_upload` rewrites only the **original** on disk (derivatives are re-encoded with `withIccProfile` only, no EXIF/GPS), and `allow_hdr_ingest` gates **ingestion** (reject-at-upload), not accepted-image bytes. Both correctly excluded. The compile-time `_ColorKeysAreSettingKeys` guard (`settings-hash.ts:63-66`) enforces validity (not completeness — documented gap, owned by the CLAUDE.md checklist).
- **H2 — REFUTED (inert).** `buildHashFromConfig` sorts `image_sizes` (`:99`); `fetchHashFromDb`→`buildHash` uses the raw DB string unsorted (`:80,110-112`). These would diverge — BUT the no-arg form is only reachable as the cold-start fallback inside `getServingColorSettingsHash` (`serve-upload.ts:69`), where a config-resolution failure also means `getColorSettingsHash()` falls to `FALLBACK_HASH` over empty inputs (`settings-hash.ts:84,116`). No production ETag surface uses the no-arg form against real `image_sizes`, so the sort discrepancy never produces two different live ETags for the same logical settings.

### Verdict
**SAFE.** No byte-impacting setting is missing from `COLOR_IMPACTING_KEYS`; the documented CRT-D1 static-path limitation (a setting flip doesn't rewrite on-disk bytes until a backfill, so only the serve-upload-path ETag invalidates) is by-design, not a defect. Confidence HIGH.

---

## Flow 4 — Backfill re-encode vs delete (admin-backfill-runner.ts affectedRows===0 cleanup)

### Observation
The runner holds the per-image processing lock for the full re-encode→detect→UPDATE window (`admin-backfill-runner.ts:489-616`). `deleteImage` does not take that lock, so it can interleave.

### Hypotheses
- **H1 — a concurrent delete during re-encode orphans the freshly-written derivatives.**
- **H2 — the detection-failed sub-branch (no version bump) misses the delete cleanup.**

### Evidence
- **H1 — REFUTED.** The signals-success branch UPDATEs `WHERE id=row.id` and on `affectedRows===0` calls `cleanupDeletedMidReencodeVariants(row)` (`:560-579`), which unlinks all 3 formats with `[]` full-scan (`:430-440`). Symmetric with the queue worker (`image-queue.ts:448-453`).
- **H2 — REFUTED.** The detection-failed branch (encode OK, detection threw) does its own `was_downscaled/avif_10bit` UPDATE and **also** checks `affectedRows===0` → `cleanupDeletedMidReencodeVariants` → `deleted-mid-reencode` (`:597-611`). So both the version-bump path and the no-version-bump path catch the mid-re-encode delete. The keyset-walk non-snapshot correctness rests on the documented invariants (backfill advisory-lock serialization + fresh uploads land at CURRENT version, `:387-411`), which hold.

### Verdict
**SAFE.** The `affectedRows===0` cleanup is present and correct in BOTH UPDATE branches; pool-exhaustion is treated as a `locked` skip (no version bump, retried next run, `:487-496`). Confidence HIGH.

---

## Critical Unknown
For Flow 1's residual race (H2): the **production magnitude** of view-count loss during a deploy is unknown — it depends on whether the LB stops routing to the draining container before SIGTERM and on shared-group traffic during the drain window. If the deploy drains LB first, H2 loss is near-zero. This is the single fact that would settle whether H2 is purely theoretical or occasionally observable. Given the documented best-effort contract, it does not change the LOW severity.

## Discriminating Probe
Add a behavioral test for the cycle-14 R14-01 fix (Flow 1, H4) — the highest-value, lowest-risk next step: with vitest fake timers and a mocked slow `db.update(sharedGroups)`, (1) buffer increments, (2) trigger a timer flush so `currentFlushPromise` is in-flight mid-chunk, (3) call `flushBufferedSharedGroupViewCounts()` and assert it does NOT resolve until all chunks of the in-flight `batch` have completed (i.e. assert total `db.update` call count equals the buffered group count, and that the await did not short-circuit on the post-swap empty buffer). Reverting the `currentFlushPromise` await must turn this test red. This collapses the test-gate uncertainty and locks the fix against regression in one move.

## Uncertainty Notes
- Flow 2 H2 confidence is MEDIUM: the `Promise.all`-sibling-late-write window is real in the code, but I did not construct a live reproduction (would require precise fault injection of an original-unlink between sibling Sharp opens). The bounded-disk-leak severity holds regardless.
- Flows 3 and 4 are clean SAFE verdicts on direct code reading; no residual uncertainty.
- The cycle-14 bootstrap re-enqueue deferral (`image-queue.ts:687`) was re-confirmed by-design (bounded ≤3 attempts/restart, `notInArray(permanentlyFailedIds)` at `:691-692`); no new angle found — not re-litigated.
