# Cycle 14 Debugger Review

Reviewed HEAD: `d821a9ab` (`master`)

Scope: latent-bug review of current HEAD only. I read `AGENTS.md` and `CLAUDE.md` first, then built a bug-relevant inventory from `git ls-files` (2551 tracked files): app/runtime routes and actions, image processing/queue/restore code, data access, schema/migrations, deployment/config, scripts, and tests that encode behavior. I excluded historical `.context/reviews/*` and plan archives from line-by-line runtime review because they are not executable production surface, but I kept their project constraints in view through `AGENTS.md`/`CLAUDE.md` and static repository sweeps.

## Confirmed Issues

### 1. Similar-photo lookup trusts embedding rows before checking image visibility

- Severity: Medium
- Confidence: Medium
- Files/regions:
  - `apps/web/src/app/api/search/similar/[id]/route.ts:118-125`
  - `apps/web/src/app/api/search/similar/[id]/route.ts:145-150`
  - `apps/web/src/app/api/search/similar/[id]/route.ts:198-205`
  - `apps/web/src/db/schema.ts:280-295`
  - `apps/web/drizzle/0012_image_embeddings.sql:5-12`

The route loads the target vector directly from `image_embeddings` by `image_id` and `model_version`, then scans all production embeddings. It only checks `images.processed = true` later during enrichment of result rows. That means the target image itself is never required to be public/processed, and stale or inconsistent embedding rows can win `topK` before being dropped by the later enrichment query.

Concrete failure scenario: after a restore, manual repair, partial backfill, or future processing retry leaves `image_embeddings` populated for an image whose `images.processed` is false, `/api/search/similar/<id>` can return a 200 for a non-public target. Separately, if many stale/unprocessed vectors rank above valid images, the route computes `topK` from stale rows and then drops them in enrichment, producing empty or underfilled results even though valid processed images exist outside the top-K cut.

Concrete fix: join `image_embeddings` to `images` in the target lookup and scan, and filter `eq(images.processed, true)` before decoding/scoring. The target lookup should return 404 unless the image exists and is processed. Add a route test that asserts the target lookup `.where(...)` includes the processed predicate, not just `PRODUCTION_MODEL_VERSION`.

### 2. Database backup creation claims header validation but only checks non-empty output

- Severity: Low
- Confidence: High
- Files/regions:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:220-236`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:456-477`
  - `apps/web/src/lib/db-restore.ts:21-25`

`dumpDatabase()` comments say it verifies the backup is non-empty and contains the expected mysqldump header, but the implementation only calls `fs.stat()` and checks `stats.size === 0`. The restore path has a real `hasPlausibleSqlDumpHeader()` check, so the two sides disagree.

Concrete failure scenario: if `mysqldump` exits 0 while stdout contains non-SQL diagnostic text, a wrapper output, or otherwise corrupt non-empty content, the admin UI reports a successful backup and stores it. The failure is only discovered during a later restore attempt, which is the worst time to learn that the last backup artifact was invalid.

Concrete fix: after the flush completes, read the first 256 bytes of `outputPath` and call `hasPlausibleSqlDumpHeader()` just like restore does. If it fails, delete the file and return `failedToWriteBackup`. Add a unit/source-contract test for backup-side header validation so this does not regress.

## Likely Issues

### 3. Embedding bootstrap retry can outlive restore quiescence

- Severity: Medium
- Confidence: Medium
- Files/regions:
  - `apps/web/src/lib/image-queue.ts:327-367`
  - `apps/web/src/lib/image-queue.ts:371-425`
  - `apps/web/src/lib/image-queue.ts:951-956`
  - `apps/web/src/lib/image-queue.ts:1035-1063`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:367-385`
  - `apps/web/src/lib/restore-maintenance.ts:21-55`

Normal caption/embedding side effects are tracked with `trackQueueSideEffect()` and drained during restore quiescence. The bootstrap retry root promise is launched fire-and-forget at `image-queue.ts:954`, and only the per-row tasks are tracked after the bootstrap has already read config and selected rows. `quiesceImageProcessingQueueForRestore()` drains `state.sideEffects`, but it cannot see an in-flight bootstrap root that has not registered its row tasks yet.

Concrete failure scenario: process startup schedules `bootstrapMissingActiveEmbeddings()`. Before it registers row tasks, an admin starts restore. Restore maintenance begins and the queue drains zero side effects, then starts importing SQL. The bootstrap loop can resume and attempt embedding writes during the restore window. `storeImageEmbeddingForMode()` checks `isRestoreMaintenanceActive()` before insert, but there is still a check-then-insert race between `image-queue.ts:350` and `image-queue.ts:356`.

Concrete fix: track the bootstrap root promise itself in `state.sideEffects` before any config/query work starts, or add a dedicated `state.bootstrapEmbeddingRetryPromise` that quiesce awaits. Also re-check maintenance as close to the insert as possible, ideally under the same restore/upload contract lock used for processing writers. Add a restore-quiesce test where the bootstrap root is in progress but has not yet registered per-row tasks.

## Risks Needing Manual Validation

### 4. Timeline/year grouping tests mirror timezone-dependent parsing instead of asserting calendar semantics

- Severity: Low
- Confidence: Low
- Files/regions:
  - `apps/web/src/lib/data-timeline.ts:235-255`
  - `apps/web/src/app/[locale]/(public)/timeline/page.tsx:89-99`
  - `apps/web/src/components/on-this-day-widget.tsx:14-23`
  - `apps/web/src/__tests__/data-timeline.test.ts:117-170`

The code groups MySQL `DATETIME` strings using `new Date('YYYY-MM-DD HH:mm:ss').getMonth()`, and the tests duplicate that same parsing logic inline. On the current Node/V8 runtime this likely works as local-time parsing, but `YYYY-MM-DD HH:mm:ss` is not the same as an ISO timestamp with an explicit timezone, and the tests would pass even if the intended calendar-month semantics diverge from SQL `MONTH(capture_date)`.

Concrete failure scenario to validate: run the timeline/year-review tests under a different `TZ` and with boundary values such as `2026-03-01 00:30:00` and `2026-12-31 23:30:00`. If the rendered grouping ever differs from MySQL `MONTH(capture_date)`, photos can appear in the wrong month section or the on-this-day widget can show the wrong year around timezone boundaries.

Concrete fix if reproduced: parse calendar fields from the stored string (`slice(0, 4)`, `slice(5, 7)`, `slice(8, 10)`) or group in SQL with `MONTH()`/`YEAR()` and keep JS out of timezone interpretation. Replace inline test clones with tests against the exported functions/helpers and include boundary cases.

## Final Missed-Issues Sweep

Final sweeps covered route exports/auth/rate-limit annotations, raw SQL and file I/O, spawn/backup/restore paths, upload serving, semantic search, queue/restore interactions, migrations/schema, env parsing, JSON parsing, timers, dangerous HTML injection sites, and tests that source-lock behavior. I did not find additional confirmed runtime issues in those sweeps.

Skipped relevant files: none intentionally. Non-runtime historical review/plan files under `.context/` were not line-read as production bug surface; the executable/runtime inventory was covered by direct inspection plus repository-wide static sweeps.
