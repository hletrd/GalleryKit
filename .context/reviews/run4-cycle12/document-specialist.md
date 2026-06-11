# Run-4 Cycle 12 — document-specialist angle

Distinct full-inventory in-context pass (single-subagent constraint documented
in `_aggregate.md`). Authoritative sources used: installed `p-queue@9.1.2`
source + doc-comments (`node_modules/p-queue/dist/index.js`), repo CLAUDE.md,
commit messages in `git log`.

## FINDINGS

### DOC-R4C12-01 — CLAUDE.md restore-recovery claim is falsified by the hang mode (MED / High; resolved by the COR-R4C12-01 code fix, no doc edit needed)
CLAUDE.md ("Race Condition Protections"): *"The lock is released
automatically on connection close, so a crashed restore never wedges the next
attempt."* True for crashes — but COR-R4C12-01 is a HANG: the pooled
connection holding `LOCK_DB_RESTORE` is never closed because the server
action never completes, AND `endRestoreMaintenance()` is unreachable, so the
maintenance flag wedges uploads/processing process-wide. The doc's recovery
guarantee silently excludes the one failure mode the code actually had.
Decision: fix the code (scheduled) rather than weaken the doc — after the
quiesce reorder the hang mode is gone and the doc claim holds for both crash
and completion paths. Recorded for provenance; re-open only if a new
unbounded await is ever added inside the restore window.

### DOC-R4C12-02 — commit c6627ec8's message documents inverted p-queue semantics (LOW / High; provenance note)
The 2026-05-06 commit message asserts `onPendingZero()` "only waits for
queued (not active) jobs". The authoritative doc-comment in p-queue 9.1.2
says the opposite: *"`.onPendingZero` only waits for currently running tasks
to finish, ignoring queued tasks"* (`dist/index.js:536-541`), and the
`pendingZero` event is emitted unconditionally when `--pending === 0`
(`dist/index.js:149-151`). Git history cannot be rewritten (repo policy: no
force-push); the correction is recorded here and in the COR-R4C12-01 fix
commit body so future readers searching `onPendingZero` find the right
semantics.

## Doc-vs-code spot checks (clean)
- CLAUDE.md "Image Processing Pipeline" steps 3-7 match `image-queue.ts`
  behavior (claim → conditional UPDATE → orphan cleanup), including the
  advisory-lock-per-job claim note.
- CLAUDE.md analytics caveat (best-effort, buffered, undercount on crash)
  matches post-c11 `data.ts`; the c11 aggregate's DOC-R4C11-01 decision
  (no edit needed) remains correct.
- `upload-tracker.ts` C7L-DOC-01 comment (key shape `${userId}:${ip}`)
  matches the caller at `images.ts:179`.
- CLAUDE.md upload caps (200 MB/file, 2 GiB window, 100 files) match
  `lib/upload-limits.ts` constants and env-override names.
- `serve-upload.ts` ETag format comment matches emission
  (`W/"v{ver}-{mtime}-{size}-{hash8}"`).
No other doc/code mismatch found in the rotation surface.
