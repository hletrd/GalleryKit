# Cycle 12 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 12 (`deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`, `go on`)

## Review fan-out summary

Completed specialist notes this cycle:
- `code-reviewer`
- `security-reviewer`
- `critic`
- `test-engineer`
- manual ultradeep repo-wide sweep

Agent failures / stalls preserved for provenance:
- `verifier` — stalled and was shut down after repeated waits
- `debugger` — retried in a fresh lane but stalled before producing a cycle-12 report; prior-cycle notes were not treated as current evidence
- `designer` — spawned late after thread-pressure recovery, then shut down before producing a cycle-12 report
- `dependency-expert` — spawned late after thread-pressure recovery, then shut down before producing a cycle-12 report

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C12-01 | HIGH | High | code-reviewer, manual sweep | Unicode tag slugs are accepted on writes but silently rejected by the public tag-filter/read path. | `apps/web/src/lib/validation.ts`, `apps/web/src/lib/tag-records.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts` |
| C12-02 | MEDIUM | High | code-reviewer, manual sweep | EXIF datetime parsing/formatting still accepts impossible calendar dates and later normalizes them into different timestamps. | `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/exif-datetime.ts` |
| C12-03 | HIGH | High | code-reviewer, manual sweep | The container health check still treats DB readiness as liveness, so transient DB outages can restart an otherwise-live web process. | `apps/web/Dockerfile`, `apps/web/src/app/api/health/route.ts` |
| C12-04 | MEDIUM | High | manual sweep | `hasTrustedSameOrigin()` can reject legitimate same-origin requests when `Host`/`X-Forwarded-Host` includes a default port (`:80`/`:443`) that browser `Origin` omits. | `apps/web/src/lib/request-origin.ts`, `apps/web/src/__tests__/request-origin.test.ts` |

## Deferred / operational findings

| ID | Severity | Confidence | Signals | Reason deferred this cycle | Primary citations |
|---|---|---|---|---|---|
| D12-01 | HIGH | High | code-reviewer, critic | Backup/restore still snapshots SQL only, not the filesystem-backed image corpus; fixing this safely requires a broader product/runtime contract than a bounded hardening pass. | `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/upload-paths.ts`, `README.md` |
| D12-02 | HIGH | High | security-reviewer | Historical example secrets/default credentials in git history require operational secret rotation/session invalidation, not just repo edits. | historical `apps/web/.env.local.example`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts` |
| D12-03 | MEDIUM | High | security-reviewer, critic | Restore maintenance and several counters/queues remain process-local; a robust multi-instance fix is larger architectural work. | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts` |
| D12-04 | LOW | High | security-reviewer | Public `/api/health` still exposes backend state; once liveness is split from readiness, public exposure/monitoring policy should be revisited separately. | `apps/web/src/app/api/health/route.ts`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf` |
| D12-05 | MEDIUM | High | test-engineer | High-value auth/share/storage/process-image/route tests remain missing, but comprehensive coverage work is its own lane. | `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/app/api/*` |

## Plan routing

- **Implement in Plan 195:** `C12-01` through `C12-04`.
- **Defer in Plan 196:** `D12-01` through `D12-05`.

## Aggregate conclusion

The highest-value bounded cycle-12 work is to realign cross-file contracts that still affect live behavior without requiring schema or product redesign: make public tag filtering honor the Unicode slug contract already enforced on writes, reject impossible EXIF calendar values consistently in parse + display paths, separate container liveness from DB readiness, and normalize default-port origins so legitimate same-origin login requests are not rejected behind common proxies. The remaining backup/restore, historical secret-rotation, process-local coordination, and broader test-surface follow-ups are real but better preserved as explicit deferred work.
