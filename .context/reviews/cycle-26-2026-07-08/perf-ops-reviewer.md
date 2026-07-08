# Cycle 26 Performance / Ops Review

Role: perf-ops-reviewer read-only lane
Date: 2026-07-08 KST
HEAD reviewed: `101ebef57ae2a379cce4b5fa04dccd538c438b0c`
Scope: performance, concurrency, DB pool pressure, background jobs, deployment/ops contracts, cache behavior, rate limiting, and resource cleanup.

## Inspected Inventory

- Governing docs: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, `.context/plans/deferred-carry-forward.md`, Cycle 24/25 deferred registers, and current root review artifacts for historical/current issue separation.
- DB/pool/concurrency: `apps/web/src/db/index.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/view-retention.ts`, `apps/web/src/lib/pending-file-deletions.ts`.
- Rate limiting and public pressure surfaces: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, public/search/share/OG rate-limit contracts by source inspection.
- Cache/serving/deploy: `apps/web/next.config.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/public/sw.template.js`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/instrumentation.ts`.

## Finding

### C26-PERFOPS-01 - Queue and color backfill still budget DB pool capacity independently

Severity: Medium-High
Confidence: High
Status: Current issue, previously documented/deferred, not fixed at reviewed HEAD.

Evidence:

- `apps/web/src/db/index.ts:31-42` fixes the shared MySQL pool at `POOL_CONNECTION_LIMIT = 10` with `queueLimit: 20`.
- `apps/web/src/lib/image-queue.ts:121-153` computes queue concurrency from the pool as if the image queue were the only background DB-pinning worker, then `apps/web/src/lib/image-queue.ts:447-456` initializes the `PQueue` with that independent cap.
- Queue workers hold a per-image advisory-lock connection before long image work (`apps/web/src/lib/image-queue.ts:761-768`), run `processImageFormats()` while that claim is held (`apps/web/src/lib/image-queue.ts:883-898`), and perform transient DB updates before releasing in `finally` (`apps/web/src/lib/image-queue.ts:916-918`, `apps/web/src/lib/image-queue.ts:1079-1085`).
- `apps/web/src/lib/admin-backfill-runner.ts:106-143` computes a separate backfill cap with its own live-traffic reserve. The runner also pins a global backfill lock (`apps/web/src/lib/admin-backfill-runner.ts:324-352`), takes per-image locks (`apps/web/src/lib/admin-backfill-runner.ts:535-546`), runs image re-encode work while locked (`apps/web/src/lib/admin-backfill-runner.ts:550-565`), updates DB state (`apps/web/src/lib/admin-backfill-runner.ts:616-630`), and releases the per-image claim only after that work (`apps/web/src/lib/admin-backfill-runner.ts:668-672`).
- The backfill queue uses its independent cap at `apps/web/src/lib/admin-backfill-runner.ts:716-727`.
- `CLAUDE.md:275-284` documents the same mutual over-subscription window as current: image queue and admin backfill reserve live headroom independently and can overlap under different locks.

Failure scenario:

An operator raises the documented knobs toward their pool-budget caps, for example effective queue concurrency 2 and admin backfill concurrency 2 on the shipped 10-connection pool. A large upload backlog keeps the image queue busy while an admin starts "Re-encode existing photos." The queue can pin about 2 workers times 2 connections, and backfill can pin 1 global lock plus 2 workers times 2 connections. That leaves roughly one free pool connection before analytics writes, maintenance, semantic side effects, or foreground photo-page query fan-out enter the system. Foreground requests can then sit behind encode-duration lock holds and hit the pool queue limit even though each subsystem independently believes it reserved live capacity.

Suggested fix:

Replace the independent formulas with a shared background DB budget. Queue processing, in-app color backfill, sidecar-equivalent backfills when in-process, analytics drains, and semantic embedding writes should acquire permits from one process-wide coordinator with an explicit foreground reserve. A smaller near-term fix is to make in-app backfill pause/quiesce the upload image queue, or dynamically reduce one subsystem's effective concurrency while the other is active. Add a regression test around `POOL_CONNECTION_LIMIT = 10` proving the combined queue + backfill permits cannot exceed the shared background budget.

## Final Missed-Issue Sweep

- Re-checked scheduler and cleanup paths: maintenance sweeps are single-flight, retention deletes are chunked, pending file deletion drains are bounded, and analytics writes have concurrency plus backlog caps.
- Re-checked cache paths: derivative static headers match the non-immutable revalidation contract, `serve-upload.ts` avoids per-request settings DB lookups with a short TTL, and the service worker excludes admin/revocable HTML while bounding image and HTML caches.
- Re-checked deploy/health paths: deploy waits for liveness before Docker pruning and preserves the documented bind-mount/no-`volume prune -a` safety contract. Host-nginx application remains an operator boundary already documented in `CLAUDE.md`; I did not file it as a new code issue.
- Re-checked public rate limiting: OG, share, feed, semantic, search, login, and admin-token helpers are bounded and documented by rollback pattern. No new missing pre-increment or cleanup issue was confirmed.
- I did not edit source code. I wrote only this review file.
