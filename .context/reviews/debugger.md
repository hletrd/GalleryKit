# Cycle 1 Group A — Debugger Review

Date: 2026-07-18 KST
Review HEAD: `64f6ac63`
Role: latent failures, exception paths, recovery behavior, diagnosability
Mode: review-only.

## Inventory and method

I read `AGENTS.md` and `CLAUDE.md`, inventoried the complete app/script/migration/e2e tree, then traced failure branches in startup/shutdown, GeoIP analytics, DB pool acquisition, restore/import, uploads and GPS stripping, image queue retry/cleanup, backfills, semantic inference, public data fetches, deploy/health checks, migrations, and external package loading. I grep-swept catches, ignored rejections, timers, file reads/renames, advisory locks, and process exits across all TypeScript/JavaScript sources. Security scanners, ESLint, TypeScript, key parity, and targeted analytics/config tests passed.

## Findings

### DBG-A-01 — GeoIP can fail permanently with no error signal

- Severity: Medium
- Confidence: High
- Classification: confirmed diagnosability defect; new in this review
- Citations: `apps/web/src/instrumentation.ts:12-20`; `apps/web/src/lib/analytics.ts:34-61`; `apps/web/next.config.ts:54-59`
- Failure scenario: `geoip-lite` imports but cannot find/read its data after a packaging or filesystem change. Startup catches and discards the exception; the first analytics lookup also catches, installs a permanent null function, and every view becomes `XX`. Liveness and readiness remain green. This is the same user-visible symptom the recent `serverExternalPackages` fix was written to correct, but the runtime still cannot tell an operator if it returns.
- Fix: production startup should log/fail a dedicated analytics readiness check when the required module/data lookup is broken. Add a standalone artifact test that asserts the package data exists and a child-process smoke that performs a known lookup from the built output.

### DBG-A-02 — Failed deploy health exits before the disk-recovery step

- Severity: Medium
- Confidence: High
- Classification: confirmed recovery-path weakness; unresolved carry-forward
- Citations: `apps/web/deploy.sh:51-76`; `apps/web/deploy.sh:79-104`; `AGENTS.md` deploy disk-hygiene invariant
- Failure scenario: `docker compose up -d --build` creates unused layers, or the new container starts but fails health on a disk-constrained host. `set -e` or the explicit health failure exits before container/image/builder pruning. The next deploy has less free space and may fail even earlier—the cleanup intended to recover the constrained host is reachable only after a successful health check.
- Fix: retain prune-after-up for the success contract, but add a failure trap that performs only the same safe unused-artifact pruning after collecting logs, never prunes volumes with `-a`, reports disk, and preserves the failed container/log evidence needed for diagnosis.

### DBG-A-03 — Near-limit GPS stripping can turn a valid upload into an OOM restart

- Severity: Medium
- Confidence: Medium
- Classification: likely production failure; unresolved carry-forward
- Citations: `apps/web/src/lib/upload-limits.ts:1-6`; `apps/web/src/app/actions/images.ts:350-381`; `apps/web/src/lib/process-image.ts:1725-1805`
- Failure scenario: a 200 MiB original is accepted, written to disk, then fully read into a Buffer for container-aware GPS stripping. A malformed container can additionally trigger Sharp re-encoding while the Buffer remains live. Concurrent image/CLIP work increases RSS enough for an OOM kill; the admin sees a generic failed upload and the process restarts.
- Fix: use bounded file/range scrubbers or a memory-limited worker, and add near-limit RSS measurement plus explicit memory admission. Keep the fail-closed deletion behavior for formats whose privacy cannot be guaranteed.

### DBG-A-04 — Valid-looking multi-file uploads can fail before application error handling

- Severity: Low-Medium
- Confidence: Medium-High
- Classification: latent interface/failure-path mismatch; unresolved carry-forward
- Citations: `apps/web/src/app/actions/images.ts:106-143`; `apps/web/src/app/actions/images.ts:197-207`; `apps/web/src/lib/upload-limits.ts:19-35`; `apps/web/next.config.ts:111-119`
- Failure scenario: a future client calls the exported plural server action with two files whose total is below the app’s 2 GiB limit but above the 266 MiB framework cap. Next rejects while parsing, before action validation, localized responses, logging, or quota logic runs. The action's defensive error paths are unreachable for part of its advertised domain.
- Fix: enforce and document one file per invocation, or implement a streaming batch route with pre-parse limits and structured failures.

### DBG-A-05 — Background pool starvation presents as unrelated request failures

- Severity: High
- Confidence: High
- Classification: confirmed latent failure mode; unresolved carry-forward
- Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:109-142`; `apps/web/src/lib/background-db-writes.ts:34-75`
- Failure scenario: queue and backfill each run at their independently calculated cap while analytics writes are active. Foreground routes enter the pool queue (`queueLimit: 20`) and eventually surface DB timeouts/500s. Logs point at whichever page query failed, not the background consumers that exhausted the shared capacity.
- Fix: centralize admission and expose pool wait/active/background-lane metrics. A health diagnostic should show active queue workers, backfill workers, pending analytics, and pool saturation together.

## Failure paths cleared

- `stripGpsFromOriginal()` returns false on unsupported/anomalous privacy cases, and both upload paths delete/reject rather than retaining GPS silently.
- Image queue permanent failures persist diagnostics; delete-mid-processing and delete-mid-reencode variants are cleaned.
- Pending file deletion rows are durable and retried by maintenance; ledger removal happens after file cleanup.
- Graceful shutdown races queue/backfill/maintenance/view/background drains against a bounded timeout and exits nonzero if truncated.
- Restore finalization keeps durable maintenance active on marker-clear failure rather than falsely reopening mutations.
- Current GeoIP standalone output does contain the required data files; DBG-A-01 is about future failure detection, not a current missing artifact.

## Final missed-failure sweep

I rechecked unhandled promises, swallowed exceptions, abort paths, timer cleanup, lock release on throws, temp-file cleanup, stale in-memory state across restart, framework pre-parse failures, health/deploy error branches, and malformed migration states. No additional latent failure was confirmed.
