# Cycle 77 Architect + Debugger + Tracer Review

Reviewed HEAD: `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5` (`fix(backfill): confirm reencode row absence`).

## Inventory

- Required guidance/context read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-76-2026-07-01/_aggregate.md`, `.context/plans/cycle-76-2026-07-01-plan.md`, `.context/plans/cycle-76-2026-07-01-deferred.md`.
- Peer Cycle 77 artifacts observed before this write: `.context/reviews/cycle-77-2026-07-01/verifier-test-engineer.md` and `.context/reviews/cycle-77-2026-07-01/code-reviewer.md`. I kept this lane scoped to architecture, causal tracing, and cross-flow race risk.
- Upload and process inventory:
  - Browser upload holds the upload-processing contract lock before topic validation and save/insert/enqueue (`apps/web/src/app/actions/images.ts:191`), claims quota before awaited checks (`apps/web/src/app/actions/images.ts:252`), re-checks restore maintenance after original save (`apps/web/src/app/actions/images.ts:418`, `apps/web/src/app/actions/images.ts:424`), inserts unprocessed rows (`apps/web/src/app/actions/images.ts:483`), and enqueues a settings snapshot for processing (`apps/web/src/app/actions/images.ts:520`).
  - Lightroom upload mirrors the same restore/contract pattern: entry restore guard (`apps/web/src/app/api/admin/lr/upload/route.ts:94`), post-parse restore guard (`apps/web/src/app/api/admin/lr/upload/route.ts:257`), upload-processing contract lock (`apps/web/src/app/api/admin/lr/upload/route.ts:272`), late post-save restore cleanup (`apps/web/src/app/api/admin/lr/upload/route.ts:434`), row insert (`apps/web/src/app/api/admin/lr/upload/route.ts:500`), and enqueue (`apps/web/src/app/api/admin/lr/upload/route.ts:518`).
  - Queue processing claims the per-image advisory lock, verifies row state under the lock, encodes derivatives, conditionally updates `processed = true`, and cleans up newly materialized variants if the row disappeared before the update. I did not find a new upload/process/delete bug beyond existing deferred test-depth items.
- Delete inventory:
  - Delete actions remove queue state, delete DB rows in a transaction, then unlink originals and derivative variants. They intentionally do not acquire the per-image processing lock, so the invariant depends on queue/backfill cleanup after zero-row updates. Current HEAD's Cycle 76 backfill fix aligns with that invariant.
- Restore maintenance inventory:
  - Restore takes the dedicated restore advisory lock (`apps/web/src/app/[locale]/admin/db-actions.ts:390`), upload-processing contract lock (`apps/web/src/app/[locale]/admin/db-actions.ts:404`), color backfill lock (`apps/web/src/app/[locale]/admin/db-actions.ts:413`), and semantic backfill lock (`apps/web/src/app/[locale]/admin/db-actions.ts:429`).
  - It then writes the durable/process restore marker (`apps/web/src/app/[locale]/admin/db-actions.ts:452`; marker implementation at `apps/web/src/lib/restore-maintenance-durable.ts:96`), flushes buffered group counts, quiesces the image queue, drains tracked background DB writes (`apps/web/src/app/[locale]/admin/db-actions.ts:493`, `apps/web/src/app/[locale]/admin/db-actions.ts:495`, `apps/web/src/app/[locale]/admin/db-actions.ts:497`), runs the restore (`apps/web/src/app/[locale]/admin/db-actions.ts:503`), and clears maintenance/release locks on the verified path (`apps/web/src/app/[locale]/admin/db-actions.ts:508`).
  - Background public view writes are explicitly tracked and drainable (`apps/web/src/lib/background-db-writes.ts:5`, `apps/web/src/lib/background-db-writes.ts:28`).
- Backfill inventory:
  - In-app color backfill takes the global color-pipeline lock (`apps/web/src/lib/admin-backfill-runner.ts:323`) and per-image processing lock (`apps/web/src/lib/admin-backfill-runner.ts:363`), selecting processed rows behind `IMAGE_PIPELINE_VERSION` (`apps/web/src/lib/admin-backfill-runner.ts:390`).
  - Sidecar color backfill refuses durable restore maintenance before DB work (`apps/web/scripts/backfill-color-pipeline.ts:310`), takes the same color-pipeline lock (`apps/web/scripts/backfill-color-pipeline.ts:340`), re-checks the restore marker after acquiring it (`apps/web/scripts/backfill-color-pipeline.ts:357`), and confirms row absence before post-transaction derivative cleanup (`apps/web/scripts/backfill-color-pipeline.ts:485`).
- Sharing inventory:
  - Share creation/revoke actions use entry restore checks and DB transactions or conditional updates. Group share creation validates processed images, rate-limits, then creates group/link rows in a transaction (`apps/web/src/app/actions/sharing.ts:196`, `apps/web/src/app/actions/sharing.ts:223`, `apps/web/src/app/actions/sharing.ts:258`).
  - Public shared group pages are dynamic (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:24`), avoid metadata DB lookups before rate-limit enforcement (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:49`), guard maintenance in the page body (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99`), rate-limit key lookups (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:104`), and use fire-and-forget tracked view recording (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:140`).
- Topics and aliases inventory:
  - Topic update has an entry restore guard (`apps/web/src/app/actions/topics.ts:184`), optional topic-image processing before the route-segment lock (`apps/web/src/app/actions/topics.ts:240`), a route mutation lock (`apps/web/src/app/actions/topics.ts:250`), and a rename transaction that re-points images, aliases, topic views, and smart-collection query JSON before deleting the old topic (`apps/web/src/app/actions/topics.ts:256`, `apps/web/src/app/actions/topics.ts:292`, `apps/web/src/app/actions/topics.ts:293`, `apps/web/src/app/actions/topics.ts:301`, `apps/web/src/app/actions/topics.ts:310`, `apps/web/src/app/actions/topics.ts:338`).
- Semantic search inventory:
  - Public semantic search has same-origin and restore guards before request parsing/DB mode lookup (`apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:113`) and charges the semantic limiter before the config lookup (`apps/web/src/app/api/search/semantic/route.ts:173`).
  - Admin embedding backfill checks restore at entry, takes the semantic backfill lock, then checks restore again (`apps/web/src/app/actions/embeddings.ts:59`, `apps/web/src/app/actions/embeddings.ts:105`, `apps/web/src/app/actions/embeddings.ts:117`).
  - Sidecar embedding backfill refuses durable restore maintenance and takes the semantic backfill advisory lock (`apps/web/scripts/backfill-clip-embeddings.ts:109`, `apps/web/scripts/backfill-clip-embeddings.ts:119`).
- Admin settings inventory:
  - Settings update has an entry restore guard (`apps/web/src/app/actions/settings.ts:43`), but only takes the upload-processing contract lock when `image_sizes` or `strip_gps_on_upload` actually change (`apps/web/src/app/actions/settings.ts:125`, `apps/web/src/app/actions/settings.ts:130`). All other settings write through the admin-settings transaction without a restore-specific barrier (`apps/web/src/app/actions/settings.ts:163`).
- Public freshness inventory:
  - Share pages traced above are dynamic. Per-photo OG validators now include derivative byte-impacting inputs: sorted image sizes, color settings hash, and pipeline version (`apps/web/src/app/api/og/photo/[id]/route.tsx:63`, `apps/web/src/app/api/og/photo/[id]/route.tsx:76`, `apps/web/src/app/api/og/photo/[id]/route.tsx:77`, `apps/web/src/app/api/og/photo/[id]/route.tsx:139`, `apps/web/src/app/api/og/photo/[id]/route.tsx:147`, `apps/web/src/app/api/og/photo/[id]/route.tsx:149`). I did not find a new public freshness defect.

## Traced Flows

1. Upload -> queue processing -> delete during processing
   - Browser and Lightroom upload both hold the upload-processing contract through insert/enqueue and perform late restore checks after slow file work. Queue/backfill writers own cleanup when they materialize derivatives after a row disappears. Current HEAD's row-absence confirmation prevents same-value zero-row updates from being mistaken for deletion. No new defect confirmed in this flow.

2. Color backfill -> delete mid-reencode
   - In-app backfill and sidecar backfill both serialize with the global color-pipeline lock and per-image processing locks. Sidecar flush now probes `rowExists` only when `affectedRows === 0` before collecting deleted-mid-reencode files (`apps/web/scripts/backfill-color-pipeline.ts:485`). This addresses the Cycle 76 live-row cleanup bug; I am not re-raising it.

3. Restore maintenance -> ordinary admin mutations
   - Restore fences uploads, color backfills, semantic backfills, image queue work, and tracked background public view writes. It does not fence ordinary foreground admin mutations that passed an entry maintenance check before the marker was written. That is the one new architecture finding below.

4. Sharing/public view accounting
   - Admin share actions use entry restore checks and DB transactions. Public shared group reads are dynamic and rate-limited, and view writes are tracked through the background writer drain path. No new sharing-specific defect confirmed apart from the broader restore foreground-mutation race.

5. Topic rename and alias fan-out
   - Topic rename updates the known FK children and smart-collection query JSON inside the rename transaction before deleting the old slug. No new topic/alias fan-out defect confirmed apart from the broader restore foreground-mutation race.

6. Semantic search and embeddings
   - Request paths and sidecars respect restore maintenance and the semantic backfill advisory lock. The production catch-up/cap concern remains the historical deferred `PA-42-02`; no new evidence changed its severity in this pass.

7. Public freshness and OG validators
   - Public shared pages are dynamic, and the per-photo OG route now folds derivative-affecting settings and pipeline version into the ETag before the `304` branch. Peer verifier findings cover missing regression pins for those inputs; I did not duplicate them as architectural defects.

## Findings

### C77-ARCH-01 - Restore maintenance does not fence in-flight non-upload admin mutations

- Severity: High
- Confidence: High
- Files: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`

Restore maintenance now locks the restore itself, uploads, color backfill, and semantic backfill, then writes the durable marker and drains queue/background writers (`apps/web/src/app/[locale]/admin/db-actions.ts:390`, `apps/web/src/app/[locale]/admin/db-actions.ts:404`, `apps/web/src/app/[locale]/admin/db-actions.ts:413`, `apps/web/src/app/[locale]/admin/db-actions.ts:429`, `apps/web/src/app/[locale]/admin/db-actions.ts:452`, `apps/web/src/app/[locale]/admin/db-actions.ts:493`, `apps/web/src/app/[locale]/admin/db-actions.ts:497`). That covers the historically risky upload/backfill/background paths.

The gap is that foreground admin mutations outside those locks only check restore maintenance at function entry. Examples:

- `updateImageMetadata` checks maintenance at entry (`apps/web/src/app/actions/images.ts:908`) but later performs a select and update without a second restore check or restore-compatible mutation barrier (`apps/web/src/app/actions/images.ts:947`, `apps/web/src/app/actions/images.ts:956`).
- `createGroupShareLink` checks maintenance at entry (`apps/web/src/app/actions/sharing.ts:196`) but later validates images and creates shared-group/link rows in a transaction (`apps/web/src/app/actions/sharing.ts:223`, `apps/web/src/app/actions/sharing.ts:258`).
- `updateTopic` checks maintenance at entry (`apps/web/src/app/actions/topics.ts:184`) but can then process a topic image, acquire the topic route lock, and run a multi-table rename transaction (`apps/web/src/app/actions/topics.ts:240`, `apps/web/src/app/actions/topics.ts:250`, `apps/web/src/app/actions/topics.ts:256`).
- `updateGallerySettings` checks maintenance at entry (`apps/web/src/app/actions/settings.ts:43`) but settings that do not change the upload-processing contract write directly through the admin-settings transaction (`apps/web/src/app/actions/settings.ts:125`, `apps/web/src/app/actions/settings.ts:163`).

Failure scenario:

1. Admin action A starts before a restore and passes its entry maintenance check.
2. Restore action B starts, obtains all currently modeled locks, writes the durable marker, quiesces queue/background writes, and starts importing SQL.
3. Action A reaches its DB write while the restore import/post-migration window is active.
4. Depending on timing, A's write is overwritten by the import, lands against a partially restored schema/data set, or persists after the restored snapshot. All three outcomes violate the operator expectation that a restore produces the uploaded snapshot plus documented post-restore migrations, with no unrelated foreground admin writes interleaved.

This is a design-level race, not a single action's validation bug. The existing lock set shows the intended restore contract, but it models only selected writer classes. Entry-only maintenance guards are insufficient for long foreground actions because restore begins after those guards have already passed.

Suggested fix:

- Add a restore-compatible foreground admin mutation barrier and use it around all mutating server actions/API handlers that write application tables.
- For the current single web process, a small in-process gate can close new mutations, wait for active mutations to drain, and reject once maintenance begins. Restore should close that gate before writing the durable marker and before `runRestore`.
- If the deployment might add more web processes later, back the gate with a database lock/protocol rather than process memory alone. MySQL named locks are exclusive only, so this likely needs either a short DB-backed lease/counter table or a carefully scoped advisory-lock convention instead of trying to make `GET_LOCK` act like a shared lock.
- Keep the existing narrow locks for upload/backfill semantics. They are still useful because upload/backfill have file-system and per-image derivative invariants beyond generic DB mutation exclusion.
- Add regression coverage with a controllable action that passes an initial restore check, blocks before write, starts restore maintenance, then proves the action is rejected/drained before the DB mutation executes.

## Historical Items Not Re-raised

- `C76-01` and `C76-02`: Current HEAD includes row-absence confirmation for re-encode cleanup and derivative-affecting OG validator inputs. I traced those paths and did not re-open them.
- `C76-03`: Cycle 76 ledger follow-up is not an architecture/runtime defect in this lane.
- `C76-04`: Bottom-sheet dropdown portal DOM coverage remains deferred. No Cycle 77 evidence changed its severity or made it scheduled now.
- `C76-05`: `getImageProcessingState` predicate-depth coverage remains deferred. I did not re-raise it because no new route behavior evidence changes its risk.
- `C65-02`: Settings-only re-encode obligation disappearing after reload remains deferred. It is adjacent to settings/backfill, but this pass found no new evidence changing its priority.
- `PA-42-02`: Production CLIP web-process catch-up advisory locking/cap concerns remain deferred. Semantic sidecar and admin backfill locking were traced, but no new production activation evidence changes severity.
- `C61-06` and `C61-07`: Shared-group view-count flush behavioral coverage and Lightroom upload source-contract coverage remain historical/deferred. The current code paths were inventoried only for architecture interactions.
- `C75-08`, `C73-05`, `C73-06`, `C72-06`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`: Not re-raised because this HEAD did not add evidence that changes their deferred status.
- Peer Cycle 77 verifier findings (`C77-01` through `C77-03`) are test-depth findings in the current cycle. I did not duplicate them here because this lane focused on causal architecture/runtime risks.

## Final Sweep

- Source files were not modified by this lane.
- This lane wrote only `.context/reviews/cycle-77-2026-07-01/architect-debugger-tracer.md`.
- Worktree already contained untracked peer Cycle 77 review artifacts before this report was added.
- No tests were run by this lane; validation was static source tracing plus peer artifact review. The finding above should be verified with a focused concurrency regression once a foreground mutation barrier design is chosen.
