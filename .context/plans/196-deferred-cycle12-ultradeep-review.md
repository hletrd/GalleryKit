# Plan 196 — Deferred Cycle 12 Ultradeep Review Items

**Source review:** Cycle 12 Aggregate Review deferred items (`D12-01` through `D12-05`)
**Status:** TODO / deferred

Deferred-fix rules honored:
- Every deferred item preserves its original severity/confidence.
- No severity was downgraded to justify deferral.
- Repo policy still applies when these items are eventually picked up.

| ID | File / Citation | Severity | Confidence | Reason for deferral this cycle | Exit criterion / reopen trigger |
|---|---|---|---|---|---|
| D12-01 | `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/upload-paths.ts`, `README.md` | HIGH | HIGH | DB + filesystem round-trip backup/restore needs a broader product/runtime contract than a bounded hardening pass. | Reopen when DB + upload-volume restore semantics are explicitly designed. |
| D12-02 | historical `apps/web/.env.local.example`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts` | HIGH | HIGH | Secret rotation/session invalidation is an operational follow-up outside the repo, not a code-only fix. | Reopen when operators are ready to rotate secrets, invalidate sessions, and reset bootstrap/admin credentials. |
| D12-03 | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts` | MEDIUM | HIGH | Shared maintenance state / durable counters need architectural work across processes and deployments. | Reopen when multi-instance correctness work is scheduled. |
| D12-04 | `apps/web/src/app/api/health/route.ts`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile` | LOW | HIGH | Public-health exposure policy should be revisited after the liveness/readiness split lands, not mixed into the same bounded code pass. | Reopen when monitoring/proxy exposure policy is being tightened. |
| D12-05 | `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/app/api/*` | MEDIUM | HIGH | Closing the broader missing test surface is a dedicated test-engineering lane rather than a narrow bug-fix pass. | Reopen when a coverage-focused cycle is scheduled. |
