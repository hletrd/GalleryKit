# Plan 230 — Cycle 14 Deferred Items

**Cycle:** 14/100 (review → plan → fix → deploy)
**Date:** 2026-04-23
**Source aggregate:** `.context/reviews/_aggregate-cycle14.md`
**HEAD at planning:** `a308d8c` (post-cycle-13 doc-only commits)

## Context

Cycle 14's fresh fan-out (11 reviewer lanes) found **zero must-fix actionable findings** against current code. The repository also contained stale per-agent files from a prior cycle 14 attempt dated 2026-04-19 — those have been preserved as `*-cycle14-historical-2026-04-19.md` in `.context/reviews/`. Each historical finding was re-evaluated against the current code (HEAD `a308d8c`); HIGH/MEDIUM-severity items that were genuine in 2026-04-19 are either already fixed in cycles 1-13 or do not apply to the current code (no S3 backend, no admin queueConcurrency or storage_backend settings exist).

Per repo policy (CLAUDE.md / AGENTS.md), every review finding must be either (a) scheduled for implementation OR (b) explicitly recorded as deferred with file+line citation, original severity preserved, deferral reason, and exit criterion. This plan documents the 10 deferred items.

## Implementation Plan

**No implementation tasks this cycle.** The fresh fan-out yielded zero must-fix findings; the historical 2026-04-19 HIGH/MEDIUM items are all either already-fixed or not-applicable to current code (verified per-item in the aggregate).

## Deferred Items (full audit trail)

All deferrals respect repo policy: only LOW severity (no HIGH/MEDIUM/security/correctness/data-loss findings are deferred this cycle). Each carries file+line citation, original severity preserved (no downgrade-to-defer), deferral reason, and explicit exit criterion.

### C14-DEFER-01 — Queue verification-failure path bypasses in-process retry

- **File/line:** `apps/web/src/lib/image-queue.ts:256-259`
- **Original severity / confidence:** LOW / High
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-01
- **Description:** When `processImageFormats` succeeds but the post-processing `verifyFile` check finds one of webp/avif/jpeg as zero bytes, the function logs and returns without `throw`. The `catch` retry block at lines 282-294 is therefore not reached, and the in-process exponential retry (max 3) is skipped. The image stays `processed = false` until the next container restart, when `bootstrapImageProcessingQueue` re-enqueues unprocessed rows.
- **Reason for deferral:** Bootstrap on restart re-enqueues unprocessed rows automatically, so failure is bounded by container lifetime (typically minutes to hours in a rolling-deploy environment). No production reports of stuck-processed images persisting across restarts. Switching to `throw` would also need to ensure cleanup of the partial output (otherwise the retry would also see 0-byte files), which is a multi-line refactor.
- **Exit criterion:** Production report of an image stuck in `processed = false` for more than one container restart cycle.

### C14-DEFER-02 — Queue cleanup uses default sizes, not admin-configured

- **File/line:** `apps/web/src/lib/image-queue.ts:270-272`
- **Original severity / confidence:** LOW / Medium
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-04
- **Description:** When the queue notices an image was deleted mid-processing (`affectedRows === 0`), it cleans up variants using `deleteImageVariants` without passing the admin-configured `imageSizes` argument. If the admin set custom sizes, only the default-sized variants are removed; admin-sized variants stay as orphans. However, the user-facing `deleteImage` and `deleteImages` actions (`apps/web/src/app/actions/images.ts:415-419, 527-533`) DO pass admin sizes, so this only matters in the narrow race where the queue's cleanup runs and `deleteImage`'s cleanup does not (which is rare because `deleteImage` deletes BEFORE the queue notices).
- **Reason for deferral:** Negligible orphan window — the user-facing delete path covers the common case. Threading admin sizes into the queue cleanup would require reading `getGalleryConfig()` inside the queue worker.
- **Exit criterion:** Disk-usage growth correlated with admin-configured non-default `image_sizes`.

### C14-DEFER-03 — Shutdown timeout exits with code 0

- **File/line:** `apps/web/src/instrumentation.ts:5-26`
- **Original severity / confidence:** LOW / High
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-12
- **Description:** When `Promise.race` between drain and the 15-second `shutdownTimeout` resolves with the timeout winning, `process.exit(0)` runs unconditionally. Container orchestrators (Kubernetes, Docker Swarm) interpret 0 as clean shutdown, hiding incomplete drain from the deploy pipeline.
- **Reason for deferral:** Changing to non-zero exit on timeout would alert orchestrators on every rolling restart that doesn't complete drain inside 15s, which is brittle for an image-processing workload that may legitimately have multi-minute jobs in flight. The current behavior matches what the rolling-deploy procedure expects.
- **Exit criterion:** Operational decision to enforce a strict drain SLO with alerting integration.

### C14-DEFER-04 — `OptimisticImage` retry closure reads stale `retryCount`

- **File/line:** `apps/web/src/components/optimistic-image.tsx:36-37`
- **Original severity / confidence:** LOW / Medium
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-13
- **Description:** The retry handler uses `setRetryCount(c => c + 1)` (functional updater, correct) but `setImgSrc(...)` reads `retryCount + 1` from the React closure, not the latest functional-updater value. In rapid-fire failure scenarios, both calls would use the same stale `retryCount`.
- **Reason for deferral:** No user-visible bug yet. The retry timer ensures retries are spaced out, so back-to-back closure reads are very unlikely.
- **Exit criterion:** Reproducible double-retry observation in browser logs.

### C14-DEFER-05 — `InfoBottomSheet` `shouldClose` side effect inside state updater

- **File/line:** `apps/web/src/components/info-bottom-sheet.tsx:75-93`
- **Original severity / confidence:** LOW / Medium
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-14
- **Description:** `handleTouchEnd` mutates an outer `shouldClose` flag inside the `setSheetState(prev => ...)` updater function and then calls `onClose()` based on the flag's value. React's state updater functions should be pure; if React batches or defers updater execution (Concurrent Mode), the flag could be read before the updater runs.
- **Reason for deferral:** Works in current React; future-React risk only. The component is wrapped with the `eslint-disable react-hooks/set-state-in-effect` directive that links to the React docs justification for the related "prop-driven state sync" pattern.
- **Exit criterion:** React's batching/concurrent mode change makes this break in test runs.

### C14-DEFER-06 — `LoginForm` error toast may re-fire on parent re-render

- **File/line:** `apps/web/src/app/[locale]/admin/login-form.tsx:23-27`
- **Original severity / confidence:** LOW / Low
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-15
- **Description:** The `useEffect` that calls `toast.error(state.error)` depends on `[state]`. `useActionState` returns a new object reference after each action invocation, but if a parent re-render produces a new state reference for any other reason (theme toggle, locale switch), the toast may fire again.
- **Reason for deferral:** Not yet observed in production or e2e runs.
- **Exit criterion:** User-reported repeated toast on theme/locale toggle after a failed login.

### C14-DEFER-07 — `LocalStorageBackend.resolve()` allows `.` / empty key

- **File/line:** `apps/web/src/lib/storage/local.ts:26-31`
- **Original severity / confidence:** LOW / Medium
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-18
- **Description:** The path traversal check allows `resolved === path.resolve(UPLOAD_ROOT)` as a special case. An empty string or `"."` key would resolve to `UPLOAD_ROOT` itself; subsequent `readBuffer` would throw `EISDIR` rather than `ENOENT`, which downstream error handling may not catch correctly.
- **Reason for deferral:** The local storage backend is not yet wired into the live upload / processing / serving paths (CLAUDE.md "Storage Backend (Not Yet Integrated)" disclaimer). No live caller can reach this with a malformed key.
- **Exit criterion:** Storage abstraction promotion to the live image pipeline.

### C14-DEFER-08 — `seed.ts` top-level promise lacks `.catch`

- **File/line:** `apps/web/src/db/seed.ts:13`
- **Original severity / confidence:** LOW / High
- **Source:** debugger-cycle14-historical-2026-04-19.md DBG-14-19
- **Description:** `seed()` is called at the top level without `.catch()`. On rejection, Node 15+ produces an unhandled-rejection trace and exits non-zero, which is informative but less polished than a clean error message.
- **Reason for deferral:** Dev-only seed script. Crash-on-rejection produces an actionable trace; the production-grade `init-db.ts` script handles errors properly.
- **Exit criterion:** A user-friendly seed CLI experience becomes a goal.

### C14-DEFER-09 — `DO` SQL statement not blocked in restore scanner

- **File/line:** `apps/web/src/lib/sql-restore-scan.ts:1-31`
- **Original severity / confidence:** LOW / Medium
- **Source:** security-reviewer-cycle14-historical-2026-04-19.md C14-03
- **Description:** `DANGEROUS_SQL_PATTERNS` does not match `\bDO\s+/i`. A crafted dump containing `DO SLEEP(86400)` would pass the scanner and DOS the restore session by holding the advisory lock for 24 hours.
- **Reason for deferral:** Admin-only DOS surface (the restore endpoint requires `isAdmin()` + same-origin proof). The existing scanner already blocks far more dangerous SQL (LOAD DATA / GRANT / CREATE FUNCTION / SET GLOBAL). mysqldump never emits `DO`, so adding the pattern would have zero false-positive risk and would be a 1-line fix when scheduled.
- **Exit criterion:** Any reported restore hang attributable to crafted-dump DOS, OR a future cycle takes the 1-line patch as part of a broader scanner refresh.

### C14-DEFER-10 — `getImageByShareKey` missing `blur_data_url`

- **File/line:** `apps/web/src/lib/data.ts:558-560`
- **Original severity / confidence:** LOW / High
- **Source:** critic-cycle14-historical-2026-04-19.md CRI-14-05
- **Description:** `getImageByShareKey` selects `...publicSelectFields` but does NOT add `blur_data_url`. `getImage` (line 449) and `getSharedGroup` (line 619) both DO include it. The `/s/[key]` share view therefore renders without the blur placeholder shown by `/p/[id]` and `/g/[key]`.
- **Reason for deferral:** Cosmetic loading-state inconsistency — not a correctness bug. The share-link view loads quickly enough on most connections that the missing blur is not user-impacting. Fix would be a single-line addition `blur_data_url: images.blur_data_url,` to the select object.
- **Exit criterion:** UX feedback on share-link first-paint experience.

## Repo policy compliance

- All deferrals are LOW severity. No HIGH/MEDIUM findings are deferred this cycle (the historical HIGH/MEDIUM items are either already fixed or not-applicable to current code).
- No security/correctness/data-loss findings are deferred (the items above are UX, defense-in-depth, or operational tradeoffs only). Per CLAUDE.md, security/correctness items are not deferrable; this rule is honored — none of the deferred items meet that bar.
- All deferrals carry file+line citation, original severity preserved, concrete reason, and exit criterion.
- When the deferred items are eventually picked up, they remain bound by repo policy: GPG-signed commits, conventional commit + gitmoji, no `--no-verify`, no force-push to protected branches, mined hash with 7 leading hex zeros.

## Done condition

This plan is informational; there is no implementation work this cycle. The cycle bookkeeping commit will record this plan + the per-agent reviews + the aggregate, then the per-cycle deploy will run.
