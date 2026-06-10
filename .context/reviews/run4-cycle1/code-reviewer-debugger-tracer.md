# Code review + debugger + tracer — Run-4 Cycle 1

Angle: logic bugs, divergence-class regressions, failure modes, causal traces of the two
failing gates. Method: full read of the run-3 change surface (LR PAT route + its imports),
browser-upload comparison trace, upload-tracker/restore-maintenance/process-image
supporting libs, admin-backfill-runner, serve-upload, image-queue caption/embedding hooks.

## Findings

### COR-R4C1-02 — LR PAT route: no failure handling for insert → enqueue tail
- **Severity/Confidence: MEDIUM / High** (confirmed)
- **Where:** `apps/web/src/app/api/admin/lr/upload/route.ts:344-371`.
- **Trace:** `db.insert(images)` (line 344) can reject (FK on `topic` — the existence check
  at 101-107 is a TOCTOU; FK violations, deadlocks, connectivity); `safeInsertId` (345)
  throws on invalid insertId by contract (`lib/validation.ts:156`). Nothing catches: the
  `try` block's only `finally` releases the advisory lock. Competing hypotheses considered:
  (a) `withAdminAuth` might catch — it does not (it awaits the handler bare,
  `lib/api-auth.ts:102`); (b) Next.js converts the throw into a 500 — yes, but the on-disk
  original from `saveOriginalAndGetMetadata` (218-220) is already persisted and the
  upload-tracker pre-claim (205-207) is already taken; neither is rolled back.
- **Concrete failure:** LR publish racing a topic deletion → FK error → 500 → orphaned
  original file + 1 file/N bytes of phantom quota for the rest of the 1-hour window.
  Repeats across a 500-photo publish queue amplify both.
- **Fix:** mirror `app/actions/images.ts:471-488` — try/catch around the tail:
  `deleteOriginalUploadFile(data.filenameOriginal)`, `settleTrackerToActual(false)`,
  structured `{ error }` 500 JSON. Keep the lock release in `finally`.

### COR-R4C1-03 — LR PAT route: `user_filename` lacks `getSafeUserFilename` parity
- **Severity/Confidence: LOW-MEDIUM / High** (confirmed)
- **Where:** `route.ts:307` (`user_filename: fileEntry.name.slice(0, 255)`) vs browser
  parity `app/actions/images.ts:46-56` (+ rejection at 174-179).
- Missing: `path.basename` (client-controlled path segments stored), `stripControlChars`
  rejection, empty-name rejection, 255-UTF-8-byte budget (C2L2-03), surrogate-safe
  truncation (C22-AGG-02 documents `.slice` is only safe for ASCII). `fileEntry.name` also
  goes raw into audit metadata (`route.ts:386`).
- **Fix:** reuse the same sanitizer (export `getSafeUserFilename` from a shared module or
  duplicate the 10-line guard), reject 400 on null result; pass the sanitized value to
  audit metadata too.

### COR-R4C1-04 — LR PAT route: title/description truncation diverges from canonical code-point validation
- **Severity/Confidence: LOW-MEDIUM / High** (confirmed)
- **Where:** `route.ts:305-306` — `(title ?? '').slice(0, 255)`, `(description ?? '').slice(0, 4096)`.
- The canonical admin surface for these fields (`updateImageMetadata`,
  `app/actions/images.ts` — `countCodePoints(...) > 255` / `> 5000`, comment C7-AGG7R-02)
  validates by code points precisely so emoji/CJK titles fit varchar(255) without
  UTF-16-unit slicing. The LR route slices by UTF-16 units: an emoji boundary at index 255
  bisects a surrogate pair and mysql2's UTF-8 encoder writes a trailing U+FFFD (silent
  mojibake on the photographer's caption). The 4096 cap for description also silently
  truncates content the browser surface would accept (cap 5000) or reject loudly.
- **Fix:** mirror `updateImageMetadata`: reject 400 when `countCodePoints(title) > 255` or
  `countCodePoints(description) > 5000`; store unsliced values otherwise.

### COR-R4C1-05 — LR PAT route: enqueue omits `camera_model` / `capture_date`
- **Severity/Confidence: LOW-MEDIUM / High** (confirmed)
- **Where:** `route.ts:353-371` (enqueue payload) vs browser `images.ts:462-463`.
- **Trace:** `lib/image-queue.ts:385` feeds `job.camera_model` to
  `generateCaption` (`lib/caption-generator.ts:34-39`); without it the stub emits the
  generic `[AUTO] Photo` instead of `[AUTO] Photo taken with <camera>`. The bootstrap
  re-enqueue path re-reads these columns from the DB (`image-queue.ts:588-611`), so only
  fresh LR publishes diverge. With `auto_alt_text_enabled` ON, alt-text quality silently
  degrades on the primary non-browser ingest path — the exact divergence class run-3
  cycles 1-4 were eliminating.
- **Fix:** pass `camera_model: exifDb.camera_model, capture_date: exifDb.capture_date` in
  the enqueue payload.

## Root-cause traces for the two failing gates (handed to test-engineer)

### TRACE-1 — `admin-backfill-runner-detection-failure.test.ts` (gate failure)
Product code is CORRECT: the detection-failure branch issues the version-less UPDATE
(`lib/admin-backfill-runner.ts:267-272`). The test's drain
(`for (let i = 0; i < 10; i++) await setImmediate`) races REAL `sharp(...).metadata()`
libuv threadpool I/O (the test deliberately does not mock sharp — see its comment at
lines 83-89): on a slow/loaded machine the stat hasn't rejected within 10 macrotask
turns, so assertions run before the UPDATE executes. Evidence: failure output interleaves
`detection failed` + `Run complete: processed=1 errors=0` AFTER the assertion counted 0
UPDATE calls. Flaky test, not a regression.

### TRACE-2 — `serve-upload.test.ts` first-test timeout (gate failure)
`lib/serve-upload.ts:7` imports `IMAGE_PIPELINE_VERSION` from `@/lib/process-image`,
whose module load pulls sharp + the full color-pipeline graph. The constant is DEFINED in
the lightweight client-safe `@/lib/gallery-config-shared` (`gallery-config-shared.ts:21`;
`process-image.ts:294` merely re-exports). The test's first dynamic import (after
`vi.resetModules()`) bears the whole cold transform+load (>15 s on this machine; run log:
`import 813.95s` aggregate). Subsequent tests reuse the warm transform cache and pass.
Product-level smell + test-level fragility with one root cause: the serving path should
not load the encoder graph for a constant.

## Verified-clean (no finding)
- Upload-tracker claim/settle math (`lib/upload-tracker.ts`, `upload-tracker-state.ts`)
  including first-insert TOCTOU close and 2x-grace pruning.
- `restore-maintenance.ts` helpers; LR route's entry + late re-check are the same
  process-local flag (single-writer topology per CLAUDE.md).
- `admin-backfill-runner.ts` R29-CRIT-1 single-release-point shape (state/lock/connection
  all released in `finally`).
- SW LRU/meta race (concurrent `recordAndEvict` last-writer-wins) — bounded drift only,
  self-corrects on next write; not worth a finding.
- `JSON.parse` call sites all guarded (wide-gamut-hint, admin-tokens, smart-collections,
  semantic route).
