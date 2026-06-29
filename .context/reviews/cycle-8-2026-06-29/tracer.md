# Cycle 8 Tracer Review - 2026-06-29

Role: `tracer`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `1e18296971bb`  
Constraint: review-only. No implementation files edited. No commit or push performed per prompt.

## Scope And Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory before findings:

- Repository inventory from `rg --files`: source, tests, scripts, config, docs, migrations, deploy/runtime files, and prior review/plan context.
- Review-relevant application surface under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/nginx`: 557 files inventoried.
- Current-cycle peer reports read for deduplication: `architect.md`, `code-reviewer.md`, `critic.md`, `debugger.md`, `document-specialist.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`, and `verifier.md`.
- Prior review/plan context swept where it touched restore, queue bootstrap, semantic search, analytics, migrations, upload/processing, and deploy/runtime contracts.

Skipped as non-review-relevant: `node_modules`, `.next`, runtime upload/data directories, binary fixtures/assets except where fixture presence mattered, ignored env files, generated caches, and historical archive bodies not needed for duplicate checks.

## Causal Trace Summary

- Upload -> queue -> processing -> DB -> public rendering: traced browser upload through strict gallery config, quota claim, original write, DB insert with `processed=false`, snapshot persistence, enqueue, per-image claim, derivative generation, conditional processed update, public selectors, and public pages.
- Auth/session/origin/rate-limit: traced admin API wrappers, mutating server-action origin guard, login/session HMAC/DB validation, proxy admin prefilter, public route rate-limit scanners, and semantic/OG/share/search limits.
- Analytics writes/reads: traced public fire-and-forget view actions, restore-maintenance skips, in-memory shared-group buffering, referrer/country sanitization, top-view reads, retention, and peer-reported index/referrer gaps.
- Semantic embeddings/search: traced upload snapshot, queue side effects, CLIP model loading/preprocessing, embedding persistence, semantic/similar API scans, enrichment privacy selectors, and peer-reported runtime gate/admission issues.
- Backup/restore: traced dump/download containment, restore same-origin/auth/locks, restore-maintenance flag, shared view-count flush, queue quiesce, SQL validation, mysql import, post-restore migration, maintenance cleanup, and queue resume/bootstrap.
- Migrations/deploy/runtime: traced Drizzle journal/hash assertions, legacy reconcile coverage, Docker/compose/nginx/deploy guarantees, startup bootstrap, live/health routes, and shutdown drain.

## Unique Findings

No additional unique tracer finding survived final deduplication. The restore/queue liveness issue independently traced in this pass was filed first in the current cycle debugger report as `DBG-C8-01`, so it is cross-confirmed below rather than re-filed under a second tracer ID.

## Cross-Confirmed Peer Finding

### DBG-C8-01 - Restore validation failures clear the image queue without restarting bootstrap

Severity: Medium  
Confidence: High  
Status: Confirmed  
Area: restore lifecycle, image queue liveness, upload -> processing -> public rendering

Evidence:

- `restoreDatabase()` enters the restore window, flushes buffered shared-group counts, and quiesces the image-processing queue before it knows whether the uploaded restore file or mysql import will succeed: `apps/web/src/app/[locale]/admin/db-actions.ts:360-372`.
- The `finally` block ends maintenance for failed restores that do not request `keepMaintenance`, but it only calls `resumeImageProcessingQueueAfterRestore()` when `restoreLifecycleVerified` is true: `apps/web/src/app/[locale]/admin/db-actions.ts:373-381`.
- `quiesceImageProcessingQueueForRestore()` pauses the queue, clears queued jobs, drains running/side-effect work, clears the in-memory `enqueued`/retry/error/permanent-failure maps, sets `bootstrapped=false`, clears continuation/cursor state, and clears any bootstrap retry timer: `apps/web/src/lib/image-queue.ts:953-995`.
- The only restore-specific recovery helper starts the paused queue and bootstraps pending rows: `apps/web/src/lib/image-queue.ts:997-1007`.
- Startup is another bootstrap entry point (`apps/web/src/instrumentation.ts:5-6`), and queue retry/continuation timers can bootstrap later only if left armed (`apps/web/src/lib/image-queue.ts:775-792`); quiesce explicitly clears that timer at `apps/web/src/lib/image-queue.ts:991-994`.
- `runRestore()` has multiple ordinary failure exits after quiesce that return `{ success: false }` without `keepMaintenance: true`: missing file/oversize, temp-save failure, invalid SQL header, dangerous SQL, missing DB config, mysql read/stdin/spawn failures, and non-zero mysql exit (`apps/web/src/app/[locale]/admin/db-actions.ts:421-582`). Only post-restore migration failure intentionally returns `keepMaintenance: true` at `apps/web/src/app/[locale]/admin/db-actions.ts:555-559`.

Concrete failure scenario:

1. Admin uploads a batch while several rows are still `processed=false` and queued.
2. Admin starts a DB restore with a malformed dump, a dangerous SQL line, missing DB config, or a mysql import that exits non-zero.
3. The restore path has already called `quiesceImageProcessingQueueForRestore()`, so queued in-memory jobs are dropped, the queue is paused, bootstrap state is reset, and any retry timer is cleared.
4. `runRestore()` returns `{ success: false }` without `keepMaintenance`.
5. The `finally` block ends maintenance but does not resume or bootstrap the queue because `restoreLifecycleVerified` is false.
6. The pre-existing pending image rows remain `processed=false`, public reads continue filtering them out, and there is no automatic rediscovery until a process restart or another code path explicitly calls bootstrap. A later new upload can start the queue for that new job, but it does not re-bootstrap the older pending rows.

Concrete fix:

Track whether quiesce succeeded, then resume/start and bootstrap the image queue after any restore attempt that leaves maintenance (`keepMaintenance !== true`), not only after a fully successful import+migration. Keep the current no-resume behavior for migration failure where `keepMaintenance:true` intentionally prevents the app from serving against an unverified schema.

Add regression coverage around `restoreDatabase()`:

- Invalid header or dangerous SQL after successful quiesce: asserts `endRestoreMaintenance()` and `resumeImageProcessingQueueAfterRestore()` are both called.
- mysql non-zero exit after successful quiesce: asserts the same resume/bootstrap behavior.
- post-restore migration failure: asserts maintenance remains active and the queue is not resumed.

## Peer Findings Not Duplicated

Already-filed current Cycle 8 findings were not re-filed:

- `ARCH-C8-01`: durable semantic-search snapshots bypass runtime production opt-in.
- `ARCH-C8-02`: failed-image retry reopens fail-open processing-config path.
- `DBG-C8-01`: restore validation failures clear the image queue without restarting bootstrap; cross-confirmed above.
- `DOC-C8-01`: action-origin docs still say `public.ts` is excluded, but the scanner audits it.
- `SEC-C8-01`: tracked review log discloses credential material.
- `CODE-C8-01`: concurrency env knobs accept `Infinity`, fractions, and unbounded values.
- `PERF-C8-01`: CLIP preprocessing/admission bypasses the inference governor.
- `PERF-C8-02`: stateful grid fallback hydrates every archive/share image card.
- `C8-CRIT-01`: analytics top-view queries lack matching bot/time/entity indexes.
- `C8-CRIT-02`: referrer sanitizer misses IPv4/IPv6 link-local hosts.
- `TEST-C8-01`: auth/origin lint gates trust helper names without proving imports.
- `TEST-C8-02`: public-route rate-limit exemption does not enforce a reasoned comment.
- `TEST-C8-03`: analytics privacy fixtures omit link-local referrers.
- `C8-V-01`: action-origin docs/comments still claim `public.ts` is excluded.

Carried restore/topology items were also not duplicated: process-local restore-maintenance state, non-transactional mysql restore, prior quiesce deadlock ordering, bootstrap retry observations, and old SQL restore scanner allowlist/bypass items.

## Final Missed-Issue Sweep

Final sweep covered:

- `restore`, `quiesce`, `resumeImageProcessingQueueAfterRestore`, `bootstrapImageProcessingQueue`, `keepMaintenance`, and queue-lifecycle references across source, tests, current reports, and prior plans/reviews.
- Upload and Lightroom ingest through durable processing snapshots, queue bootstrap, retry, side effects, and public processed-image selectors.
- Auth/session/origin/rate-limit scanners and runtime helpers after the test-engineer and document-specialist reports appeared.
- Analytics writes/reads and semantic search after the architect, critic, perf, and test-engineer reports appeared.
- Migration/reconcile/deploy/runtime invariants against the current peer reports and CLAUDE.md operational contracts.

No additional issue survived without duplicating an already-filed Cycle 8 finding or known deferred topology item. No implementation files were changed; this report is the only artifact written by this tracer pass.
