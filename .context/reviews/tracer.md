# Cycle 38 Tracer Review

Date: 2026-07-08 KST
Role: cycle-38 tracer / causal-flow review
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `5c6a45a5`
Mode: review-only. Required output file only; no source edits, commits, pushes, deploys, or production access.

## Provenance and Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, and the local `code-review` skill instructions. Worktree before this edit already had unrelated modified review files: `.context/reviews/critic.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/verifier.md`; I did not touch them.

Inventory method: built a tracing inventory with `rg --files` plus flow keywords before reviewing. The repo slice under `apps/web/src/app`, `apps/web/src/lib`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/src/__tests__` contains 580 files; 411 matched tracing keywords such as restore, maintenance, upload, delete, backfill, queue, pending, advisory lock, semantic/similar search, public/admin selectors, rate limits, same-origin, and admin mutation barriers. I reviewed the matching flow clusters rather than sampling a small hand-picked subset.

Tracing-relevant clusters reviewed:

- Restore/import and maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, `restore-maintenance*.ts`, `restore-drain-checklist.ts`, `admin-mutation-barrier.ts`, `queue-shutdown.ts`, `background-db-writes.ts`, `maintenance-scheduler.ts`, `pending-file-deletions.ts`, `pending-session-revocations.ts`.
- Upload/delete/processing: `actions/images.ts`, LR upload route, `image-queue.ts`, `process-image.ts`, `upload-paths.ts`, upload tracker and upload-processing contract lock, delete retry ledger.
- Backfills/sidecars: in-app color runner, color sidecar, CLIP embedding sidecar/action, alt-text sidecar, migrations and schema journal.
- Public/admin data-flow invariants: public semantic and similar routes, public search/timeline/map selectors, admin/public select-field privacy guards, same-origin/admin-auth lint surfaces, public route rate-limit tests.

## Findings

### TRC-C38-01 - Independent in-process background budgets can over-subscribe the shared DB pool

- Classification: confirmed issue
- Severity: High
- Confidence: High
- Region: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153` and `761-918`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `330-397`, and `681-827`; `apps/web/src/lib/background-db-writes.ts:8-75`
- Failure scenario: the web process has one MySQL pool capped at 10 connections (`connectionLimit: POOL_CONNECTION_LIMIT`). The image queue reserves roughly half the pool and clamps itself to 2 workers at the default limit, assuming it is the only background owner. The in-app color backfill independently does the same, also allowing 2 workers while holding a whole-run advisory-lock connection. Each queue/backfill worker can hold a per-image lock connection plus transient DB work; analytics writes can add two more background DB operations. When queue processing, in-app backfill, and analytics overlap, their local proofs compose to roughly all pool capacity instead of preserving the intended live headroom, so foreground public/admin reads can queue behind encode-duration work.
- Concrete fix: introduce one process-wide background admission/budget coordinator for image queue, in-app backfill, semantic embedding bootstrap/post-upload work, maintenance sweeps, and analytics writes. The coordinator should account for advisory-lock connections and transient DB work, then either throttle or refuse a background lane once the shared reserve is consumed. Add a regression that starts queue workers + admin backfill + analytics at the default pool size and proves either foreground DB acquisition still has reserved headroom or one background lane is paused.

### TRC-C38-02 - Semantic embedding writers do not share the semantic backfill ownership gate

- Classification: likely issue
- Severity: Medium
- Confidence: High
- Region: `apps/web/scripts/backfill-clip-embeddings.ts:122-130` and `195-238`; `apps/web/src/app/actions/embeddings.ts:113-134` and `173-211`; `apps/web/src/lib/image-queue.ts:501-539`, `542-637`, and `981-1008`; `apps/web/src/lib/clip-model.ts:53-173`; public consumers at `apps/web/src/app/api/search/semantic/route.ts:247-284` and `apps/web/src/app/api/search/similar/[id]/route.ts:137-190`
- Failure scenario: the canonical CLIP sidecar and the unwired admin action both acquire `LOCK_SEMANTIC_EMBEDDING_BACKFILL`. Live queue side effects and `bootstrapMissingActiveEmbeddings()` skip only restore maintenance; they do not check or acquire that semantic lock before scanning missing rows, running image inference, and upserting `image_embeddings`. The primary key/model-version upsert shape prevents duplicate-row corruption, so this is not a confirmed data-integrity bug. The likely failure is competing ownership over scarce inference and DB capacity: a production backfill can run while live queue embedding and missing-embedding bootstrap consume the same process-local CLIP queue used by public text search, increasing visitor 503/timeout risk and extending activation convergence.
- Concrete fix: make live embedding writes observe the same semantic ownership policy as the sidecar: skip/defer while `LOCK_SEMANTIC_EMBEDDING_BACKFILL` is held, or move all embedding writes through one durable embedding job/lease table. If uploads must keep writing during operator backfill, split public query inference from background image inference with explicit reservations and tests proving public semantic/similar requests retain slots under backfill pressure.

### TRC-C38-MV-01 - Sidecar backfills can exceed web-process capacity assumptions at the host/database level

- Classification: manual-validation risk, not a confirmed source defect
- Severity: Medium
- Confidence: Medium
- Region: `apps/web/src/db/index.ts:31-42`; `apps/web/scripts/backfill-color-pipeline.ts:349-420`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130` and `195-238`; `apps/web/scripts/backfill-alt-text.ts:55-158`
- Failure scenario: sidecar scripts run in a separate Node process and create their own MySQL pool from the same `src/db` module. Their advisory locks prevent duplicate sidecars and block restore, and per-image locks coordinate color re-encode with queue processing, but the web app's pool-reserve arithmetic does not bound total MySQL connections across processes. A production operator running color backfill, CLIP backfill, or alt-text backfill while the web app is busy can therefore double-count DB capacity at the host level. This depends on MySQL `max_connections`, host CPU/RSS, and operator scheduling, so it needs production/manual validation.
- Concrete fix: add an operator preflight for sidecars that checks live DB capacity (`max_connections`, current connection count, and maybe active web queue/backfill state) before starting, or implement a cross-process DB budget/lease table distinct from the per-task advisory locks. Document sidecar concurrency as host-wide, not only script-local, and default production sidecars to low-traffic windows unless the preflight passes.

## Competing Hypotheses Resolved

- Previous sidecar batch-flush ownership concern rechecked: I do not carry it as a cycle-38 finding. In `backfill-color-pipeline.ts`, JavaScript runs each worker's push into the process-global batch and entry into `flushBatch()` synchronously until the first `await`; `flushBatch()` immediately splices the batch before awaiting DB work. That means another worker cannot later splice an item that the first worker has already handed to its own in-flight transaction, and the per-image claim is released in that worker's `finally` after its awaited flush path. I found no confirmed claim-release-before-persist race there.
- Restore/delete stale-ledger concern rechecked: `deleteImage` and `deleteImages` insert `pending_file_deletions` rows before deleting image rows, then `cleanupPendingFileDeletion()` removes the ledger only after all file deletes succeed (`apps/web/src/app/actions/images.ts:678-728`, `809-917`; `apps/web/src/lib/pending-file-deletions.ts:82-138`). Restore drains pending file deletions after clearing maintenance and the hourly scheduler retries (`db-actions.ts:720-731`; `maintenance-scheduler.ts:35-50`). Failures can leave retry rows temporarily, but that is the intended durable retry state.

## Cross-Flow Invariants Cleared

- Restore/import ordering: `restoreDatabase()` acquires restore, upload-processing contract, color-backfill, semantic-backfill, and alt-text locks before beginning durable maintenance, then drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations before import (`apps/web/src/app/[locale]/admin/db-actions.ts:470-667`). I found no restore-over-live-write path in the inspected source.
- Upload admission: browser and LR uploads both re-check restore state, hold an admin mutation slot for the mutation window, acquire the upload-processing contract lock before topic/save/insert/enqueue, and settle upload quota claims on early failures (`actions/images.ts:87-610`; LR route `85-430` and later post-save block).
- Public/admin privacy: public image selectors explicitly omit sensitive fields and carry compile-time guards (`data.ts:251-488`, `1590-1626`). Semantic/similar search enrichment uses shared compile-guarded fields and strips scores before response (`search-enrichment-fields.ts:29-47`; semantic route `330-368`; similar route `241-285`). No new public leak of GPS/original filenames/admin-only pipeline fields was found.
- Public expensive-route ordering: semantic and similar routes perform same-origin/maintenance checks, then pre-increment the semantic rate limiter before DB-backed mode lookup and embedding scans (`semantic/route.ts:107-184`; `similar/[id]/route.ts:68-131`). No free expensive probe path was found in these routes.

## Validation Evidence

Fresh static commands included:

```bash
git rev-parse --short HEAD && git status --short
rg --files apps/web/src/app apps/web/src/lib apps/web/scripts apps/web/drizzle apps/web/e2e apps/web/src/__tests__
rg -n "requireNoRestoreMaintenance|requireSameOriginAdmin|withAdminAuth|trackAdminMutation|withAdminMutationSlot|assertNoDurableRestoreMaintenanceForScript|beginDurableRestoreMaintenance|drainPendingFileDeletions|GET_LOCK|RELEASE_LOCK|semantic|similar|adminSelectFields|publicSelectFields|PrivacySensitive|pending_file_deletions|queueImageProcessing|bootstrapMissingActiveEmbeddings|storeImageEmbeddingForMode" apps/web/src/app apps/web/src/lib apps/web/scripts apps/web/drizzle apps/web/src/__tests__
find apps/web/src/app/actions apps/web/src/app/api apps/web/src/lib apps/web/scripts apps/web/drizzle apps/web/e2e apps/web/src/__tests__ -type f | wc -l
```

No automated test suite was run because this was a review-only lane with no production-code changes. The validation evidence is static tracing and exact code-region inspection.

## Final Missed-Issue Sweep

Final sweep covered restore locks/drains/finalizers, upload and LR upload restore windows, queue processing and deleted-mid-processing cleanup, pending deletion retry state, in-app and sidecar backfills, semantic activation/model-version paths, CLIP inference queue ownership, public route rate-limit ordering, public/admin selector privacy, admin mutation barriers, advisory-lock release patterns, migration/journal schema surfaces, and relevant regression tests.

Skipped files: no tracing-relevant source file from the keyword inventory was intentionally skipped. Non-relevant or non-source artifacts were skipped: binary/static assets, runtime upload/resource/backups directories, `.next`, `node_modules`, and live production host/database state. No deployment, browser, nginx reload, production DB inspection, or real CLIP-weight smoke was performed.
