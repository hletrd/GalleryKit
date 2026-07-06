# Cycle 1 (2026-07-06) — Debugger Review

Reviewer angle: latent-bug surface — unhandled paths, partial-state on error, boundary
conditions, integer/float coercion, fs edge cases, process lifecycle, locale/timezone
breakage, and completeness of recent fixes on sibling paths.

Repo: `/Users/hletrd/flash-shared/gallery`. HEAD: `657eb0243f49898c0f902fda60669d63b17a512d`
(clean working tree at review start except for uncommitted cycle-85 test/docs edits, which
this lane did not touch). Read-only: no source files modified; the only file written is this
review.

## Prior-context check (performed before hunting for new findings)

Read `CLAUDE.md` in full, `.context/plans/cycle-96-2026-07-01-deferred.md`,
`.context/plans/cycle-98-2026-07-01-deferred.md`, and all four sibling cycle-1 lanes
(`critic.md`, `security-reviewer.md`, `test-engineer.md`, `verifier.md`) plus the concurrently
running `tracer.md`. None of the three findings below duplicate anything in those files:

- The sibling `tracer.md` traced restore Flow 2 hypothesis H2.2 ("a partial/failed `mysql`
  restore … can silently clear the marker and resume traffic against a half-imported DB") and
  refuted it — but that hypothesis is about whether **failure is handled correctly once
  detected** (does `keepMaintenance` stay true). **DBG-03 below is a different, earlier
  question**: whether a truncated-but-syntactically-clean dump can be misclassified as a
  **successful, complete** restore in the first place, because `mysql`'s exit code and the
  existing header-only check cannot distinguish "processed everything the operator intended"
  from "processed a valid prefix and then hit a clean EOF." The tracer's refutation does not
  cover this because it assumes the failure/success signal itself is reliable.
- Verified via `git show baefb427` and `git log -p -S"limitInputPixels: 256" -- admin-backfill-runner.ts`
  that the `MAX_INPUT_PIXELS` pixel-cap fix landed in **both** `scripts/backfill-color-pipeline.ts`
  and `apps/web/src/lib/admin-backfill-runner.ts` in the **same commit** — no sibling-path
  regression there (also independently confirmed by the tracer's H5.1).
- Re-verified the deferred/archived history for the exact "on-this-day server timezone" concern
  (`.context/plans/cycle-22-deferred.md` DBG22-01, `.context/reviews/run7-cycle2/debugger.md`)
  and confirmed it is already a known, explicitly-accepted risk (harmless under the shipped
  UTC-only Docker deployment; re-open criterion is an explicit deploy `TZ` change) — not
  re-reported.
- Verified `cleanMetadataString`/`stripUnicodeFormatting` already scrubs EXIF `camera_model`
  (AGG-R5C3-12 / SEC-R5C3-01) before it ever reaches `caption-generator.ts`'s auto-alt-text
  stub, so a Trojan-Source-style EXIF payload does not reach the public alt-text surface —
  not a bug.
- Confirmed `image-queue.ts`, `rate-limit.ts`, `bounded-map.ts`, `queue-shutdown.ts`,
  `view-retention.ts`, `audit.ts`, `background-db-writes.ts`, the shared-group view-count
  buffer in `data.ts`, `env.ts`, `instrumentation.ts` (SIGTERM/SIGINT graceful shutdown), and
  `clip-model.ts`'s inference-slot semaphore read clean — no new defect found in any of them
  despite being the highest-churn files in cycles 86-99.

## Findings

### DBG-01 — Topic-cover-image temp-file cleanup has no age gate and can delete a concurrently-uploading admin's in-flight file

- Severity: Medium. Confidence: High.
- Classification: Latent bug — race condition / partial-state (an in-progress write raced by
  an unrelated background cleanup).
- Files: `apps/web/src/lib/process-topic-image.ts:135-148` (`cleanOrphanedTopicTempFiles`,
  zero age check), contrast with `apps/web/src/lib/image-queue.ts:35-92`
  (`cleanOrphanedTmpFiles`, the sibling cleanup for image-derivative temp files, which is
  explicitly age-gated by `ORPHANED_DERIVATIVE_TEMP_MIN_AGE_MS` = 60 minutes); call site
  `apps/web/src/lib/image-queue.ts:1019-1020` inside `bootstrapImageProcessingQueue`; upload
  write path `apps/web/src/lib/process-topic-image.ts:82-122` (`processTopicImage`).
- Why: `cleanOrphanedTmpFiles` (for the main photo pipeline) carries an explicit, documented
  age gate: *"Fresh files may belong to a sidecar backfill that overlaps a web restart, so
  cleanup is age-gated instead of deleting every matching filename at startup."* Its sibling,
  `cleanOrphanedTopicTempFiles` (for admin topic-cover-image uploads), does the exact opposite:
  it unconditionally deletes **every** file whose name starts with `tmp-` in both
  `TOPIC_TMP_ROOT` and `RESOURCES_DIR`, regardless of how many milliseconds old it is:
  ```ts
  const tmpFiles = entries.filter(f => f.startsWith('tmp-'));
  ...
  await Promise.all(tmpFiles.map(f => fs.unlink(path.join(dir, f)).catch(() => {})));
  ```
  Both cleanup functions are invoked from the *same* call site
  (`image-queue.ts:1019-1020`, inside `bootstrapImageProcessingQueue`), and that function is
  **not** a startup-only routine — it re-runs on every `scheduleBootstrapContinuation` (a full
  BOOTSTRAP_BATCH_SIZE=500 batch was scanned, more may remain) and every `scheduleBootstrapRetry`
  (fires 30s after **any** single image permanently fails processing, or after 10 failed claim
  attempts) for as long as the gallery is live. So the "fresh file might belong to an in-flight
  operation" hazard that motivated the age gate on the photo-pipeline sibling applies with
  equal force here, but was never applied.
  `processTopicImage()` streams the uploaded file to `tempPath = TOPIC_TMP_ROOT/tmp-{uuid}` via
  `pipeline(nodeStream, createWriteStream(tempPath, ...))`, and only *after* that completes does
  it hand `tempPath` to `sharp(tempPath, ...).toFile(outputPath)`. If
  `bootstrapImageProcessingQueue` (triggered by an unrelated processing failure elsewhere, or a
  large pending backlog) runs `cleanOrphanedTopicTempFiles()` during that window, it deletes
  the admin's `tmp-{uuid}` file while it is still being written to or about to be opened by
  Sharp.
  The existing regression test (`apps/web/src/__tests__/process-topic-image.test.ts:179-192`,
  `'removes stale tmp-* files and leaves non-tmp files intact'`) actually **proves** the gap: it
  writes the temp file and calls `cleanOrphanedTopicTempFiles()` with **zero delay**, and the
  file is deleted — despite the test's own name calling it "stale." There is no fixture that
  exercises an actually-fresh (sub-second) file, because the implementation has no such
  distinction to test.
- Failure scenario: an admin uploads a new topic cover image (topic images share the same
  per-file cap as photo uploads, `MAX_UPLOAD_FILE_BYTES`, so a multi-MB image over a slow
  connection can take several seconds to stream). At the same moment, any in-flight photo
  processing job elsewhere in the gallery permanently fails (a corrupt EXIF blob, an
  unsupported format, a transient Sharp error) and triggers `scheduleBootstrapRetry`, or the
  gallery is mid-way through a large batch-upload continuation scan. `cleanOrphanedTopicTempFiles`
  runs, deletes the admin's mid-stream `tmp-{uuid}` file, and the subsequent `sharp(tempPath,...)`
  call throws ENOENT. `processTopicImage`'s catch block reports `'Invalid image file'` for a
  perfectly valid image, with no indication to the admin that the real cause was an unrelated
  background job.
- Fix: give `cleanOrphanedTopicTempFiles` the same minimum-age gate as `cleanOrphanedTmpFiles`
  (e.g. reuse `ORPHANED_DERIVATIVE_TEMP_MIN_AGE_MS` or a topic-specific constant), checking
  `fs.stat(...).mtimeMs` before unlinking, exactly mirroring the pattern already proven out in
  `image-queue.ts:35-92`.

### DBG-02 — `processing_error` truncation splits UTF-16 surrogate pairs; inconsistent with the code-point-safe truncation pattern used everywhere else in the codebase

- Severity: Low. Confidence: High.
- Classification: Latent bug — string/Unicode boundary edge case (data-integrity nit, not
  security).
- Files: `apps/web/src/lib/image-queue.ts:819-822`:
  ```ts
  const truncatedError = lastErrorMsg.length > 512
      ? lastErrorMsg.slice(0, 512)
      : lastErrorMsg;
  ```
  Contrast with three sibling truncation sites elsewhere in the same codebase that all take
  care to avoid exactly this class of bug: `apps/web/src/app/actions/public.ts:301-304`
  (explicit comment: *"pass sanitizedQuery directly instead of slicing with `.slice(0, 200)`
  which can split a surrogate pair (UTF-16 boundary)"*), `apps/web/src/lib/admin-tokens.ts:214`
  (`Array.from(opts.label.trim()).slice(0, 128).join('')` — code-point array, not raw string
  slice), and `apps/web/src/lib/caption-generator.ts:31-34`
  (`truncateCodePoints`: `[...value].slice(0, maxCodePoints).join('')`).
- Why: `lastErrorMsg` is an arbitrary `Error.message` string (`err instanceof Error ?
  err.message : String(err)`, `image-queue.ts:777`). While most JS error messages are ASCII,
  nothing prevents a thrown error from embedding a non-BMP character (e.g. an emoji or rare
  CJK character copied into a filename-derived error string, or a library that echoes back
  user-supplied Unicode in its error text) landing exactly at UTF-16 offset 512. A plain
  `.slice(0, 512)` operates on UTF-16 code units, not code points, and can bisect a surrogate
  pair, leaving a lone unpaired surrogate in the string that is then written to the
  `processing_error` VARCHAR column and later surfaced in the admin "failed images" panel.
  Node's UTF-8 encoder (used by mysql2 to serialize the bound parameter) silently replaces an
  unpaired surrogate with U+FFFD rather than throwing, so this does not crash anything — it is
  a data-integrity nit, not a stability or security bug, which is why the severity here is Low
  despite the confidence being High that the code has this inconsistency.
- Failure scenario: an admin viewing the failed-images diagnostic panel occasionally sees a
  "�" character mangling an otherwise-readable error message, with no functional impact beyond
  cosmetic log/UI noise.
- Fix: swap the raw `.slice(0, 512)` for the same code-point-safe truncation pattern already
  used three other places in this codebase (e.g. `[...lastErrorMsg].slice(0, 512).join('')`, or
  reuse/export the existing `truncateCodePoints` helper from `caption-generator.ts`).

### DBG-03 — DB backup/restore has no dump-completeness verification; a truncated dump can be written as a "successful" backup or accepted as a "successful" restore that only partially applies

- Severity: High. Confidence: Medium (the code-level gap is confirmed with high confidence;
  real-world trigger frequency — a process crash mid-backup, or a corrupted/truncated restore
  source file — is lower-frequency than everyday request paths, but the operation this affects
  is disaster recovery itself).
- Classification: Latent bug — partial-state on error / missing completeness check (matches
  the "files written but DB row missing, or vice versa" class called out for this review, here
  manifesting as "some tables/rows restored, the rest silently missing").
- Files:
  - Backup write: `apps/web/src/app/[locale]/admin/db-actions.ts:230`
    (`createWriteStream(outputPath, ...)` — writes directly to the **final, canonical** backup
    filename, not a `.tmp` path later renamed atomically on success) and `:288-320` (the only
    completeness checks performed are: non-zero file size, and `hasPlausibleSqlDumpHeader`
    against the **first** 256 bytes only).
  - Header-only validator: `apps/web/src/lib/db-restore.ts:21-25` — the regex
    `/^(?:--|CREATE\s|INSERT\s|DROP\s|SET\s|\/\*!)/i` checks only that the file *starts*
    plausibly; there is no corresponding check of the *end* of the file (mysqldump appends a
    `-- Dump completed on <timestamp>` trailer by default — this backup command does not pass
    `--skip-comments`, `apps/web/src/app/[locale]/admin/db-actions.ts:221-228` — so a complete
    dump always has this sentinel and a truncated one never does).
  - Restore invocation: `apps/web/src/app/[locale]/admin/db-actions.ts:674-680` spawns
    `mysql --one-database ... DB_NAME` with the uploaded file piped to its stdin, no `--force`,
    and no wrapping `START TRANSACTION; ... COMMIT;` around the whole import. The restore is
    judged solely by the child process's exit code (`:718-748`): `code === 0` → success.
- Why this is a real gap, not just theoretical: `mysqldump`'s generated SQL is a long sequence
  of independent, individually-committed statements (default MySQL client autocommit is on;
  `--single-transaction` only affects the **read-side** consistency of the dump generation, not
  how the import is executed). If the on-disk dump file is truncated **exactly at a clean
  statement boundary** — plausible for a mid-write process crash (OOM kill, `docker stop` past
  the grace period, host power loss) that lands between two complete `INSERT`/`CREATE`
  statements, or for a restore-source file that was itself truncated upstream — then feeding it
  to `mysql` via stdin does not produce any error: the client executes every complete statement
  it is given, reaches a clean EOF, and exits **0**, because it has no way to know the dump was
  supposed to contain more. The existing header check cannot catch this (it only inspects the
  first 256 bytes) and there is no trailer/sentinel check that would. The restore path then
  reports `{ success: true }`, clears maintenance mode, and calls `revalidateAllAppData()` —
  the admin is told the restore succeeded, while some suffix of tables (whatever came after the
  truncation point in mysqldump's per-table ordering) was never repopulated. Separately, on the
  backup side, because the write goes straight to the canonical `outputPath` rather than a
  temp-then-atomic-rename path, a Node process kill (not just a `writeStream` error, which
  *is* already handled) between spawning `mysqldump` and the `'close'` handler running leaves a
  truncated file sitting at the real, listed backup filename with none of the existing
  post-hoc checks (`writeStreamHadError`, size>0, header) ever getting a chance to run and
  delete it.
  Note this differs from the tracer's H2.2 (refuted): that hypothesis asked whether a
  *detected* restore failure correctly keeps maintenance mode active (it does — every failure
  branch sets `keepMaintenance: true`). This finding is about whether the exit-code-based
  success/failure signal is *itself* reliable for a specific, plausible class of corrupted
  input (clean-boundary truncation) — it is not, because nothing verifies the dump reached its
  intended end.
- Failure scenario: an operator schedules an automated backup, and the container happens to be
  killed (OOM, host maintenance reboot, `docker stop` timeout) while `mysqldump`'s output is
  mid-flight; the resulting `backup-*.sql` file — indistinguishable by name from a good backup —
  sits in `data/backups/` looking legitimate. Months later, during an actual disaster-recovery
  restore from that specific backup, if the truncation happened to land at a clean statement
  boundary (plausible — the dump is thousands of independent statements), `mysql` exits 0, the
  UI reports "Restore successful," maintenance mode clears, and the gallery resumes serving
  traffic against a DB missing whatever tables/rows came after the truncation point — with no
  error, no audit trail entry indicating anything went wrong, and no signal to the operator that
  the disaster-recovery restore they just performed was itself incomplete.
- Fix: (1) on the backup side, write to a `.tmp` sibling path and atomically `rename()` to the
  final `outputPath` only after all existing post-hoc checks (size, header, `writeStreamHadError`)
  pass, so a mid-write crash never leaves a corrupted file at the canonical, listed filename;
  (2) on the restore side, in addition to the existing header check, verify the file ends with
  mysqldump's standard completion trailer (or, more robustly, count `;`-terminated top-level
  statements / verify the last non-whitespace bytes form a complete, well-terminated statement)
  before accepting the file for import, and/or wrap the import in an explicit
  `START TRANSACTION; ... COMMIT;` (with `SET autocommit=0` prepended to the piped stream) so a
  restore that fails partway through — for any reason — rolls back cleanly instead of leaving a
  half-applied DB, rather than relying solely on the child process's exit code as a completeness
  signal.

## Files/areas examined

- Full reads: `apps/web/src/lib/image-queue.ts` (entire file), `apps/web/src/lib/rate-limit.ts`
  (entire file), `apps/web/src/lib/env.ts`, `apps/web/src/lib/queue-shutdown.ts`,
  `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/bounded-map.ts`,
  `apps/web/src/instrumentation.ts`, `apps/web/scripts/entrypoint.sh`,
  `apps/web/src/lib/data.ts:1-260` (shared-group view-count buffer + flush/drain lifecycle),
  `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/data-timeline.ts`,
  `apps/web/src/lib/on-this-day-date.ts`, `apps/web/src/components/on-this-day-widget.tsx`,
  `apps/web/src/lib/caption-generator.ts`, `apps/web/src/lib/process-topic-image.ts`,
  `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/audit.ts:85-125`,
  `apps/web/src/lib/smart-collections.ts` (validation/compile sections),
  `apps/web/src/app/actions/images.ts:128-900` (upload + batch-delete flows),
  `apps/web/src/app/[locale]/admin/db-actions.ts` (`dumpDatabase`, `restoreDatabase`/`runRestore`,
  `runPostRestoreMigrations`), `apps/web/src/lib/db-restore.ts`, `apps/web/docker-compose.yml`,
  `apps/web/Dockerfile` (entrypoint/CMD wiring).
- Git history: `git log -20 --stat` at HEAD; `git show baefb427` (pixel-cap fix, confirmed
  applied to both backfill entry points in one commit); confirmed `admin-backfill-runner.ts`
  received the identical diff in the same commit via `git log -p -S`.
- Cross-checked prior review artifacts: `.context/plans/cycle-96-2026-07-01-deferred.md`,
  `.context/plans/cycle-98-2026-07-01-deferred.md`, `.context/plans/cycle-22-deferred.md`,
  `.context/plans/cycle-2-2026-06-29-deferred.md`, `.context/plans/cycle-3-2026-06-29-deferred.md`,
  `.context/reviews/run7-cycle2/debugger.md`, `.context/reviews/archive/cycle12-comprehensive-review.md`,
  `.context/reviews/archive/cycle31-comprehensive-review.md`,
  `.context/reviews/archive/_aggregate-cycle31.md`, `.context/plans/archive/plan-77-cycle31-fixes.md`
  (the historical writeStream-flush-timing backup bug — already fixed, distinct from DBG-03),
  and this cycle's sibling `critic.md`, `security-reviewer.md`, `test-engineer.md`, `verifier.md`,
  `tracer.md`.
- Test inventory checked for the finding areas:
  `apps/web/src/__tests__/process-topic-image.test.ts` (confirms DBG-01's absence of an age
  gate — the "stale" test writes and immediately deletes a fresh file), no direct fixture for
  `dumpDatabase`/`runRestore` dump-completeness beyond header-shape assertions (consistent with
  DBG-03).

## Commonly-missed-issues sweep

- Unhandled promise rejections / fire-and-forget without `.catch`: swept `apps/web/src/lib` and
  `apps/web/src/app` for bare `.then(` without a paired `.catch(` — the only hit
  (`tokens-client.tsx:113`, `copyToClipboard(...).then(...)`) is a client-side clipboard UX
  callback with no correctness impact.
- `JSON.parse` call sites repo-wide (`wide-gamut-hint.tsx`, `smart-collections.ts`,
  `admin-tokens.ts`, `image-queue.ts`, `search/semantic/route.ts`) — all wrapped in try/catch
  with safe fallbacks; no unguarded parse found.
- Env-var integer coercion (`parseBoundedPositiveInteger`, `getRateLimitBucketStart`,
  `resolveRetentionMs` in `audit.ts`/`view-retention.ts`, `getTrustedProxyHopCount`) — all use
  `Number()` (not `parseInt`) with explicit `Number.isFinite`/`Number.isInteger` + positivity
  guards; no garbage-string or negative-value coercion bug found.
- DST/leap-day/capture_date timezone handling in `data-timeline.ts` (on-this-day, timeline,
  year-in-review) — deliberately naive-local by design (`capture_date` is stored and read as
  the camera's local wall-clock time, independent of server TZ); re-verified the specific
  known/accepted "On This Day" server-TZ-vs-visitor-TZ gap is already documented and deferred,
  not re-reported.
- Process lifecycle: SIGTERM/SIGINT graceful shutdown (`instrumentation.ts`) correctly guards
  against duplicate signal delivery, clears its own timeout sentinel, and force-exits with a
  distinguishing exit code on timeout; the underlying drained promises
  (`shutdownImageProcessingQueue`, `flushBufferedSharedGroupViewCounts`,
  `drainBackgroundDbWrites`) were each read in full and are internally consistent.
- `CLIP_INFERENCE_CONCURRENCY` slot semaphore (`clip-model.ts`) — traced the hand-off pattern
  between `withInferenceSlot`/`waitForInferenceSlot`/`releaseInferenceSlot` under concurrent
  acquire/timeout/abort interleavings; the counter/waiter-queue bookkeeping is consistent in
  every case traced (no leaked slot, no double-release).
- Did not re-open any of `C77-ARCH-01`, `C80-06`, `C76-04`, `C76-05`, `C75-08`, or the
  orphaned-`cycle-94` findings the critic's lane already surfaced this cycle — no new evidence
  changes their recorded status.

## Caveats

- DBG-03's real-world trigger (a mid-write crash during backup generation, or an externally
  corrupted/truncated restore source file) was not reproduced by executing an actual crash or
  restore — the finding is derived from tracing the code paths, mysqldump's documented default
  trailer behavior, and MySQL client autocommit semantics, not from an observed production
  incident.
- DBG-01 was not reproduced by triggering an actual concurrent bootstrap-vs-topic-upload race
  in a running instance; the race window and its trigger conditions (bootstrap re-running
  during a live topic upload) are traced directly from the source and the existing test file's
  own behavior, not from a live repro.
- I did not run the test suite, lint, typecheck, or build as part of this lane (read-only
  latent-bug hunting); the verifier/test-engineer lanes already covered those gates this cycle.
