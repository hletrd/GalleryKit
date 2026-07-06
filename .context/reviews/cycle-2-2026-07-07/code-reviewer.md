# Code Quality Review — GalleryKit (apps/web)

Reviewer: r2-code (code-quality specialist)
Scope: logic bugs, SOLID/maintainability, error handling, edge cases, invariant violations,
cross-file interactions. Angle is code quality, not security-specific (a separate pass covers that).
Date: 2026-07-07 · Branch: master

## Headline

This is an exceptionally mature codebase. Nearly every module carries dense provenance
annotations from ~90+ prior review cycles (R4C1..R29, run-1..run-10, cycles 1-100), and the
classes of bug a code-quality pass normally finds — unhandled rejections, TOCTOU on quota/claim,
parseInt scientific-notation truncation, surrogate-pair-bisecting .slice, missing affectedRows
checks, swallowed errors, non-monotonic migration cursors, listener/timer cleanup asymmetry — have
already been found and fixed with tests pinning them. Grep sweeps confirm: no `as any` in product
code, every insertId routed through safeInsertId, every parseInt on numeric input already converted
to Number(), and every component addEventListener has a matching removeEventListener.

I found NO confirmed CRIT/HIGH/MED correctness bugs in the reviewed surface. The findings below are
LOW-severity robustness/scalability/maintainability observations, reported honestly rather than
inflated to fill a table.

## Files examined in depth

lib: image-queue.ts, admin-backfill-runner.ts, process-image.ts (full), data.ts (full),
serve-upload.ts, session.ts, api-auth.ts, smart-collections.ts, gps-exif-strip.ts (byte parser).
actions: images.ts (full), topics.ts (full), auth.ts (full), public.ts (pagination region).
routes: api/admin/lr/upload, api/search/semantic. scripts: migrate.js (full).
components: load-more.tsx (+ sweep of hook/listener cleanup across all components).
Plus grep sweeps: parseInt / as any / insertId / JSON.parse / listener-timer cleanup.

## Findings

### CQ-01 — Processing-error retry has no backoff (immediate synchronous re-enqueue)
- Severity: LOW · Confidence: High
- Location: apps/web/src/lib/image-queue.ts:822-829
- Problem: On a processing failure below MAX_RETRIES the catch does
  `state.enqueued.delete(job.id); enqueueImageProcessing(job);` synchronously — no delay. Asymmetric
  with the claim-retry path (:605-616) which uses an escalating CLAIM_RETRY_DELAY_MS setTimeout. A
  file whose decode fails FAST (transient Sharp/libvips error that recurs immediately) burns all 3
  attempts back-to-back with zero spacing, giving a transient condition no time to clear before the
  job is marked permanently failed.
- Failure scenario: A brief FS/NFS stall that clears in ~2s fails processImageFormats 3 times within
  a few hundred ms; the image lands in permanentlyFailedIds and needs manual admin retry, though a
  short delay would have let it succeed.
- Fix: Schedule the re-enqueue via setTimeout(...).unref() with a small escalating delay, mirroring
  the claim-retry path, instead of calling enqueueImageProcessing(job) inline.

### CQ-02 — Duplicate hourly GC timer possible when the queue global is re-initialized
- Severity: LOW · Confidence: Medium
- Location: image-queue.ts:104 (bootstrapCleanupRun module-scoped) vs :1102-1112 (state.gcInterval
  on the global) vs :337-350 (defensive re-init path in getProcessingQueueState)
- Problem: getProcessingQueueState re-creates the state object if the existing global fails shape
  validation. The hourly gcInterval closure captures the specific state object. On re-init the NEW
  state arms a fresh gcInterval (its `!state.gcInterval` guard is on the new object) while the OLD
  interval keeps firing forever against the orphaned state. Two hourly GC timers then run for the
  process lifetime.
- Failure scenario: Requires the global symbol to be corrupted to a malformed shape (test seam or a
  future bug) — edge case; impact is duplicated hourly purge work + an orphaned object kept alive,
  not wrong results.
- Fix: Store the one-shot bootstrap-cleanup flag on the queue state alongside gcInterval, and/or
  clear the old interval before re-initializing state.

### CQ-03 — bootstrapMissingActiveEmbeddings walks the entire images table uncapped
- Severity: LOW (could be MED at scale with semantic search enabled) · Confidence: Medium
- Location: image-queue.ts:426-482 (invoked at :1034-1044)
- Problem: The missing-embedding retry scan keyset-walks EVERY processed image lacking an
  active-model embedding, in 50-row batches, with no SEMANTIC_SCAN_LIMIT-style cap. Deduplicated by
  embeddingBootstrapInFlight (one in-flight), but re-triggered on every bootstrap: process start,
  each full-batch continuation (:1073), the 30s retry timer, and restore-resume. In stub/production
  mode on a large gallery this is an unbounded background full-table walk that generates embeddings
  for every missing row and contends for the shared CLIP inference queue visitor search waits on.
- Failure scenario: A 50k-image gallery flips to production; each queue bootstrap continuation kicks
  off a full-gallery embedding walk, sustaining DB + inference load.
- Fix: Cap the scan per invocation and rely on repeated bootstraps for forward progress, matching the
  sidecar backfill's bounded-per-run model. Semantic search is off by default, so exposure is low
  today.

### CQ-04 — Admin backfill has no permanent-failure tracking; a corrupt row is re-attempted every run
- Severity: LOW · Confidence: Medium
- Location: apps/web/src/lib/admin-backfill-runner.ts:487-576 (encode-failed path); candidate
  selection at :407-431 (pipeline_version < CURRENT)
- Problem: Unlike the upload queue (permanentlyFailedIds), the backfill runner has no permanent-
  failure set. An encode-failed row keeps its stale pipeline_version by design (correct for transient
  failures) — but a permanently-corrupt original is re-selected and re-attempted on EVERY subsequent
  run, and keeps every run reporting encodeFailures>0 / flipping the WITH-FAILURES banner
  indefinitely.
- Failure scenario: One unreadable original in a large gallery means the operator never sees a clean
  backfill completion, and each run wastes an encode attempt on the doomed row.
- Fix: Track repeatedly-failing ids within a run (or persist a distinct failure marker) so a
  known-bad row is skipped after N attempts and surfaced separately. Backfill is operator-triggered,
  so exposure is bounded.

### CQ-05 — reconcileLegacySchema must be a complete hand-maintained mirror of the final schema
- Severity: LOW (maintainability / recurring-defect class) · Confidence: High
- Location: apps/web/scripts/migrate.js:317-718 (reconcile) and :764-801 (fresh-install path routes
  through reconcile + baseline, making drizzle.migrate() a no-op)
- Problem: Fresh installs AND legacy re-baselines derive their schema entirely from
  reconcileLegacySchema (journaled .sql files are baselined, not executed), making this the single
  source of truth for a from-scratch DB. Any column/index/FK a new migration adds that is NOT
  mirrored here ships a fresh install whose first INSERT fails with ER_BAD_FIELD_ERROR — the class
  that already bit production (R4C1 COR-R4C1-13, color/HDR columns). CLAUDE.md documents the
  "update reconcile for every new migration" rule, but there is no compile-time or test guard that
  reconcile stays in sync with db/schema.ts.
- Failure scenario: A future migration adds images.new_col; the author forgets the matching
  ensureColumn here; CI (running against an already-migrated DB) passes; the next fresh install /
  cold e2e DB dies on first upload.
- Fix: Add a test diffing reconcile's produced columns/indexes against db/schema.ts (or a fresh
  drizzle-generated schema) so a missing mirror fails CI — turning a silent runtime break into a
  test-time signal.

## Cross-file interactions verified correct (no action needed)

- Upload -> queue -> backfill share the same processing-settings snapshot and the same
  deleteImageVariants(dir, fn, []) full-scan cleanup on the delete-during-(re)encode race
  (image-queue.ts:727-744, admin-backfill-runner.ts:450-485, images.ts delete paths). All three
  check affectedRows and clean orphaned derivatives symmetrically.
- Upload quota TOCTOU: the synchronous check->claim->settle contract in uploadImages
  (images.ts:239-320) and the LR route (lr/upload:130-176) is airtight; every post-claim awaited
  early-return settles the claim, and the one exception (deleteOriginalUploadFile) is safe only
  because that helper never throws — a constraint the code documents at images.ts:566-575.
- Cursor/keyset pagination is order-compatible across getImagesLite / getImagesLitePage /
  getImagesForSmartCollection; the single-vs-double +1 lookahead is correct per caller
  (public.ts:163-168 applies its own +1; getImagesForSmartCollection applies its own internally and
  loadMoreSmartCollectionImages passes the base limit — the R4C5 fix).
- Session/auth: HMAC-then-shape-check ordering avoids a timing oracle (session.ts:110-125); login
  timing-equalizes with a module-init dummy Argon2 hash; rate-limit pre-increment precedes the
  expensive verify with correct rollback; session-fixation and password rotation each use a single
  transaction (auth.ts).
- Topic slug-rename transaction re-points all FK children (images, topicAliases, topic_views) plus
  eq/in smart-collection topic predicates before deleting the old row (topics.ts:268-353).
- GPS byte scrubbers (gps-exif-strip.ts) are meticulously bounds-checked and fail-closed to null
  (-> caller re-encode) on any structural anomaly, including walkAborted-after-finding-items and
  post-EOI-trailer cases.

## Not reproduced / out of scope

- Dockerfile builder-stage missing workspace-nested node_modules (drizzle-kit TS2307): excluded per
  the task brief (already being fixed by the orchestrator).
- Security-specific findings (authz, injection, SSRF): deferred to the security pass; where they
  intersect code quality the implementations reviewed here are sound.
