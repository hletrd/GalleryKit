# Cycle 22 Causal Trace Review — tracer

Date: 2026-07-08 KST
Review HEAD: `856bbc86fded2f9deb99c3a17fb2175f3be31560`
Role: `tracer`
Scope: suspicious flow tracing across upload, restore, delete, retry, background jobs, and cross-request state. No fixes implemented.

## Inventory First

- Restore causal chain: `src/app/[locale]/admin/db-actions.ts`, restore maintenance durable/process flags, admin mutation barrier, upload-processing contract lock, image queue quiesce, background DB write drain, maintenance scheduler drain, SQL restore scanner.
- Upload chains: dashboard upload action, LR PAT upload route, original save/metadata, GPS strip, derivative queue enqueue, upload quota tracker, per-upload processing lock, restore maintenance cleanup.
- Delete chains: single and batch delete actions, queue-state cleanup, pending file deletion ledger, strict original/variant deletion, public derivative serving.
- Retry/background chains: image queue permanent failures, retry failed image action, semantic/caption backfills, maintenance scheduler, background analytics DB writes, pending session revocations.
- Cross-request state: process-local rate-limit maps, upload quota tracker, queue state, restore barriers, singleton guard, config cache/semantic mode.

## Findings

### TRC-22-01 — Durable deletion ledger is not connected to any future retry driver

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Causal path:
  - `apps/web/src/app/actions/images.ts:677-700`: `deleteImage()` creates `pending_file_deletions`, then deletes `images`.
  - `apps/web/src/app/actions/images.ts:714-727`: it invokes `cleanupPendingFileDeletion()` once after the DB delete and returns success with a cleanup failure count.
  - `apps/web/src/app/actions/images.ts:808-879`: `deleteImages()` does the same for each image in bounded chunks.
  - `apps/web/src/lib/pending-file-deletions.ts:70-90`: failed cleanup only updates the row's attempts/error; it does not schedule work.
  - `apps/web/src/lib/maintenance-scheduler.ts:34-45`: the periodic sweep omits `pending_file_deletions`.
  - Repo-wide call-site search found no retry path outside the delete action bodies.
- Competing hypotheses considered:
  - Hypothesis A: the ledger is a real durable retry queue. Rejected by call-site search and maintenance scheduler inspection.
  - Hypothesis B: the ledger only records operator-visible failure state. Supported by current code, but the comments at `images.ts:678-680` and `images.ts:809-811` say the row is "retry state"/"retryable", so behavior and causal contract diverge.
  - Hypothesis C: cleanup failure is harmless because DB rows are deleted. Rejected for privacy/destructive semantics: files can remain addressable by direct derivative URL if the caller knows the UUID filename, and originals can remain on disk.
- Concrete scenario: batch deletion succeeds in MySQL, but one filesystem unlink fails twice because the upload directory is briefly unavailable. The pending row records `attempts = attempts + 1`, but no background job later reads it. The admin UI can report deletion success, while the old derivative/original persists until a manual DB/file operation.
- Suggested fix: wire `pending_file_deletions` into a bounded maintenance/backfill worker, guarded by restore maintenance. Trace tests should prove a failed cleanup row is retried on startup/hourly sweep, success deletes the row, repeated failures back off, and restore maintenance suppresses the sweep.

### TRC-22-02 — Restore drain checklist is strong but remains a manual registry for future writers

- Severity: Low
- Confidence: Medium
- Status: Risk
- Causal path:
  - `apps/web/src/lib/restore-drain-checklist.ts:10-17` documents that every process-local DB writer must be added to the restore drain stages.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:580-635` drains shared-group view counts, image queue, background DB writes, maintenance sweeps, and admin mutations before import.
  - `apps/web/src/lib/background-db-writes.ts:77-112` tracks and bounds background/analytics DB write drains.
  - `apps/web/src/lib/maintenance-scheduler.ts:34-45` defines the tasks that are covered by the maintenance sweep drain.
- Failure scenario: a future feature adds a buffered DB writer or a filesystem-backed cleanup worker and forgets to register its drain. Restore can then import while that writer later commits stale state into the restored DB or mutates files outside the snapshot boundary.
- Suggested fix: keep the drain-checklist test close to every new queue/background writer. Consider an explicit registry API so new background writers cannot start without declaring a restore drain/restore-suppression policy.

### TRC-22-03 — Single-writer warnings do not prevent causal splits across process-local state

- Severity: Medium
- Confidence: Medium
- Status: Risk / accepted topology constraint
- Causal path:
  - `CLAUDE.md:245-247` declares single web instance/single writer and lists process-local coordination state.
  - `apps/web/src/lib/single-writer-guard.ts:6-16` says the boot guard detects but cannot enforce the topology.
  - `apps/web/src/lib/single-writer-guard.ts:218-235` logs a loud warning and continues startup.
- Failure scenario: a rolling deploy overlap is tolerated, but a misconfigured second permanent web instance keeps serving. Each process has its own upload quota tracker, queue memory, fast rate-limit maps, restore process flag, and backfill status. DB advisory locks reduce some races, but user-visible state and abuse controls can still diverge.
- Suggested fix: preserve single-instance deployment as an operational invariant. If scale-out is introduced, first move the stateful guards/queues/rate buckets into a shared store or make persistent contention fail closed after the rolling-deploy grace period.

### TRC-22-04 — Proxy/rate-limit causal evidence can collapse under a mismatched edge chain

- Severity: Medium
- Confidence: Medium
- Status: Risk / manual-validation
- Causal path:
  - `apps/web/nginx/default.conf:20-28` notes edge limiter keys use nginx's TCP peer.
  - `apps/web/nginx/default.conf:59-71` overwrites XFF with `$remote_addr`, correct only when that address is the true client.
  - `apps/web/src/lib/rate-limit.ts:175-216` either derives a trusted client IP from configured proxy headers or returns `unknown`.
- Failure scenario: CDN/LB -> nginx -> app without realip/hop alignment. Nginx limits by LB IP, the app may limit by LB IP or `unknown`, and audit/rate-limit records cannot separate users. A noisy client can cause broad 429s; a distributed attacker can hide behind edge aggregation depending on topology.
- Suggested fix: add deployment evidence for the actual proxy chain: sample request headers at app, nginx access log client IP, `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, and `real_ip` config. Treat mismatches as release blockers for abuse-control claims.

## Retired Or Lowered Hypotheses

- Restore importing over known current writers: lowered. The code sets durable maintenance, holds DB/upload/backfill locks, and drains shared-group view counts, image queue, background writes, maintenance sweeps, and admin mutations before import (`db-actions.ts:580-635`).
- LR upload parse-slot leak on multipart parse errors: lowered. The route releases the parse slot in a `finally` and settles quota claims on parse failure per inspected `api/admin/lr/upload/route.ts`.
- Failed image retry reuses stale processing settings: lowered. `retryFailedImage` clears failure/settings fields under a failed-state predicate before requeueing.
- Backup download path traversal: lowered. The route validates the filename, resolves/realpaths containment, opens a descriptor, stats it, and streams that descriptor (`api/admin/db/download/route.ts:21-89`).
- Public privacy field regression: lowered. `data.ts:368-488` maintains explicit public omit blocks and compile-time guards; targeted privacy tests passed.

## Missed-Issue Sweep

- Cross-request state reviewed: upload quota tracker, image queue maps, permanently failed IDs, retry maps, admin mutation barrier, maintenance sweeps, background DB write queues, singleton guard, proxy-derived IP buckets.
- Restore/upload/delete interleavings reviewed: upload blocks on maintenance and upload-processing contract lock; restore drains queue/background/admin mutation paths; delete removes queue state before DB delete and records pending cleanup before deleting image rows.
- Retry/background reviewed: image retry, queue permanent failure, semantic backfill gating, analytics DB writes, pending session revocations, maintenance scheduler. The only confirmed missing retry driver is `pending_file_deletions`.
- Product constraints preserved: no payment path, no culling/scoring flow, no supported remote storage path in causal flows.

## Uninspected Or Partially Inspected

- No live restore/upload/delete race was executed against a real MySQL/filesystem deployment.
- No production nginx/CDN/request-header trace was available.
- Full Playwright/admin browser flows and full test suite were not run in this lane.
- Binary image fixtures, generated build output, and live upload directories were not inspected.
