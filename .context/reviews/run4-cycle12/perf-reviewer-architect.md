# Run-4 Cycle 12 — perf-reviewer / architect angle

Distinct full-inventory in-context pass (single-subagent constraint documented
in `_aggregate.md`).

## Inventory examined
- Queue topology: `lib/image-queue.ts` (PQueue concurrency model, claim
  connections, retry-map bounds, bootstrap batching/cursor), the THREE
  quiesce/drain/backfill `onIdle` call sites and their queue lifecycles,
  `lib/queue-shutdown.ts`, `lib/admin-backfill-runner.ts:308-334` (dedicated
  never-paused PQueue — onIdle drains normally there).
- Hot serving path: `lib/serve-upload.ts` (settings-hash SWR cache, HEAD
  short-circuit, 304 path), ETag composition.
- Buffered-analytics machine in `lib/data.ts` (chunked flush, caps, backoff)
  post-c11.
- Upload path allocation behavior in `app/actions/images.ts` (per-file loop,
  tracker claim/settle), `lib/upload-tracker-state.ts` prune/caps.

## FINDINGS

### COR-R4C12-01 (perf/architect facet) — pool-connection leak + permanent capacity loss while quiesce hangs (HIGH / High)
Shared root cause (see code angle). Architect/perf-specific impact:
- The hung `restoreDatabase` server action holds TWO checked-out pool
  connections (restore lock conn + upload-contract lock conn) out of a
  10-connection pool with queue limit 20 — a permanent 20% pool capacity
  loss per hang (and a second hang attempt is blocked at the restore lock,
  so the leak is bounded to one wedge per process, which is small comfort
  because the wedge itself is total for uploads/processing).
- Architectural asymmetry is the root smell: THREE consumers await
  `onIdle()` under three different queue lifecycles —
  `drainProcessingQueueForShutdown` (paused queue, but clear-BEFORE-await:
  safe), `admin-backfill-runner` (running queue: safe), and
  `quiesceImageProcessingQueueForRestore` (paused queue, clear-AFTER-await:
  deadlock). The fix should converge quiesce onto the drain ordering so there
  is exactly ONE paused-queue pattern in the codebase, locked by tests.
- `state.shutdownPromise` memoization in drain has no quiesce counterpart,
  but quiesce is single-entry by construction (`LOCK_DB_RESTORE` serializes
  restores), so no memo is needed — verified, no action.

## Verified-sound surfaces (no findings)
- `serve-upload.ts` SWR settings-hash cache (R4C3/R4C4) still sound: single
  inflight refresh, stale-served-immediately, cold-start single await,
  failure keeps last hash. No per-request DB SELECT on the derivative flood
  path.
- `data.ts` flush machine post-c11: chunked (20), bounded buffer (1000) +
  retry map (500), exponential backoff capped at 5 min, `.unref()` on every
  arm site. The c11 re-arm adds at most one extra timer per slow-flush window
  — negligible.
- Bootstrap query: covered-column select, `notInArray` bounded by the
  permanently-failed cap (1000 ids → IN-list size bounded), batch 500 with
  cursor continuation via `onIdle().then(...)` on a RUNNING queue — drains
  normally, no deadlock interaction with the quiesce fix (continuation is
  guarded by `shuttingDown` / maintenance checks).
- Upload loop: sequential per-file processing is the documented single-writer
  design; tracker prune is O(n) on a 2000-cap map per upload action — noise.

## Risks needing manual validation (none scheduled)
- None this cycle. The quiesce fix is fully verifiable in unit scope because
  `quiesceImageProcessingQueueForRestore` accepts an injected queue.
