# Code Review Report — code-reviewer (Cycle 16)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID, and maintainability.
Verification: All prior cycle fixes confirmed intact (AGG8R-01 through C15-AGG-01).

## Inventory reviewed

All primary source files in `apps/web/src/` (237+ files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on image-queue.ts (recently modified), sanitize.ts, lightbox.tsx, data.ts, topics.ts, db-actions.ts, and cross-file interaction patterns.

## Verified fixes from prior cycles

All prior fixes confirmed intact:

1. C15-AGG-01 (deleteTopic redundant guard removed): CONFIRMED — topics.ts:352-358, guard removed, comment added.
2. C1F-DB-02 (permanently-failed IDs tracked in image-queue): CONFIRMED — `permanentlyFailedIds` Set present, bootstrap query excludes them.
3. C1F-SR-08 (sanitizeStderr redacts DB_HOST, DB_USER, DB_NAME): CONFIRMED — `sensitiveValues` parameter in sanitizeStderr.
4. C1F-DB-01 (viewCountBuffer cap after re-buffering): CONFIRMED — post-flush enforcement at data.ts:119-126.
5. C1F-CR-08/C1F-TE-05 (sanitizeAdminString returns null when rejected): CONFIRMED — sanitize.ts:156-158.

## New Findings

### C16-CR-01 (Medium / Medium). `image-queue.ts`: Comment says "Do NOT reset bootstrapped / scheduleBootstrapRetry" but code does exactly that — contradictory comment masks intent

- Location: `apps/web/src/lib/image-queue.ts:346-352`
- Lines 346-349 say: "Do NOT reset bootstrapped / scheduleBootstrapRetry here — that was the old pattern that caused infinite re-enqueue." But lines 350-352 immediately set `state.bootstrapped = false`, null the cursor, and call `scheduleBootstrapRetry()`.
- The `permanentlyFailedIds` exclusion in the bootstrap query (line 434-435) prevents the specific failed job from being re-enqueued on the next bootstrap, so the infinite loop is broken at the query level. The bootstrap retry is actually correct — it rescans to find OTHER pending (unprocessed) images that aren't in the permanently-failed set. The comment is wrong, not the code.
- The misleading comment could cause a future developer to remove lines 350-352 (believing the comment's directive), which would prevent bootstrap from rescanning for other pending jobs after a permanent failure, leaving those images unprocessed until a server restart.
- Severity is Medium because the comment actively misleads about the code's behavior and could cause a regression if taken at face value.
- Suggested fix: Update the comment to accurately describe why the bootstrap retry is correct despite the permanent failure: "Reschedule bootstrap to discover other pending images. The permanently-failed ID is excluded from the bootstrap query (notInArray), so this does NOT cause infinite re-enqueue of the failed job."

### C16-CR-02 (Low / Low). `instrumentation.ts` uses `console.log` instead of `console.debug` for shutdown messages

- Location: `apps/web/src/instrumentation.ts:9,26`
- Lines 9 and 26 use `console.log()` for shutdown messages. The rest of the codebase consistently uses `console.debug()` for informational/operational messages and `console.error()`/`console.warn()` for actual problems.
- `console.log` bypasses log-level filtering that structured logging setups may use.
- Suggested fix: Change to `console.debug()`.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
