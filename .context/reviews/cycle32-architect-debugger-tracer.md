# Cycle 32 Architect / Debugger / Tracer Review

Date: 2026-07-08 KST
Reviewed HEAD: `4a728335ada304371743689de7f5bbf8670985b5`
Role lane: architect + debugger + tracer

## Scope

Read-only review of current HEAD, with exactly this provenance file written. I focused on current architecture/design risks, cross-file causal paths, race conditions, restore/write-drain boundaries, scanner regression surfaces, and defects introduced or still present at `4a728335` or later. I did not modify source files and did not commit.

## Relevant Inventory

- Guidance and dedupe baseline: `AGENTS.md`, `CLAUDE.md`, `.context/plans/deferred-carry-forward.md`, `.context/reviews/run10-cycle29/_aggregate.md`, `.context/reviews/run10-cycle29/code-reviewer-debugger-tracer.md`, `.context/reviews/run10-cycle29/architect-perf-reviewer.md`, `.context/reviews/run10-cycle30/_aggregate.md`, `.context/reviews/run10-cycle31/_aggregate.md`, `.context/reviews/run10-cycle31/code-debug-tracer.md`, `.context/reviews/run10-cycle31/architect-perf-reviewer.md`.
- Current delta from the latest full product-code baseline: `apps/web/src/lib/data-timeline.ts`, `apps/web/src/__tests__/data-timeline-behavior.test.ts`, `apps/web/src/__tests__/client-server-only-boundary.test.ts`, `apps/web/scripts/check-action-origin.ts`, plus review/plan/docs files.
- Timeline/date surfaces: `apps/web/src/lib/data-timeline.ts:93-104`, `apps/web/src/lib/data-timeline.ts:199-225`, `apps/web/src/lib/data-timeline.ts:247-270`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/components/on-this-day-widget.tsx`.
- Server-action and boundary scanners: `apps/web/scripts/check-action-origin.ts:130-154`, `apps/web/scripts/check-action-origin.ts:178-254`, `apps/web/src/__tests__/check-action-origin.test.ts:1114-1147`, `apps/web/src/__tests__/client-server-only-boundary.test.ts:138-247`, `apps/web/src/__tests__/client-server-only-boundary.test.ts:584-617`.
- Restore/write-drain and race surfaces: `apps/web/src/app/[locale]/admin/db-actions.ts:421-722`, `apps/web/src/lib/admin-mutation-barrier.ts:76-134`, `apps/web/src/lib/background-db-writes.ts:11-112`, `apps/web/src/lib/maintenance-scheduler.ts:35-85`, `apps/web/src/lib/restore-drain-checklist.ts:39-50`, `apps/web/src/lib/image-queue.ts:506-522`, `apps/web/src/lib/image-queue.ts:739-761`, `apps/web/src/lib/image-queue.ts:1114-1141`.
- Pending deletion and delete/retry surfaces: `apps/web/src/app/actions/images.ts:730-880`, `apps/web/src/lib/pending-file-deletions.ts:82-138`, `CLAUDE.md` pending-file-deletion table note.
- Public restore-maintenance and API guard surfaces were grep-swept across `apps/web/src/app`, `apps/web/src/components`, and `apps/web/src/lib`.

## Findings

No new non-duplicative current defects were confirmed.

## Evidence And Dedupe Notes

- The December timeline boundary fix is coherent at current HEAD. `archiveRange(2025, 12)` now emits `2025-12-01 00:00:00` through `2026-01-01 00:00:00` (`apps/web/src/lib/data-timeline.ts:93-104`), and current production callers still use the year-wide path rather than a dormant per-month route.
- The app-wide server-action placement detector covers top-level unscanned modules and inline function-level server actions (`apps/web/scripts/check-action-origin.ts:218-254`). Current source contains only approved top-level action-module directives; there are no current inline `'use server'` directives outside comments.
- Restore still sets the durable maintenance window before the drain checklist and drains shared-group view-counts, image queue, background DB writes, maintenance sweeps, and foreground admin mutation slots before import (`apps/web/src/app/[locale]/admin/db-actions.ts:545-637`). The drain orchestrator short-circuits on the first failed stage (`apps/web/src/lib/restore-drain-checklist.ts:39-50`).
- The known concurrent-restore auth-before-lock ordering remains the tracked `C27-02` deferred item, not a fresh Cycle 32 finding. The known `deleteImages` sequential pending-deletion insert shape remains tracked as `D10b-05 / AGG-C10b-03`, not a fresh finding.
- Public expensive route and action guard checks passed at current HEAD, so I found no new unwrapped admin API route, missing action origin/barrier guard, or expensive public route without a rate-limit contract.

## Validation

Passed:

```text
git diff --check HEAD

npm run lint:action-origin --workspace=apps/web
All mutating server actions enforce same-origin provenance.

npm run lint:api-auth --workspace=apps/web
OK: src/app/api/admin/db/download/route.ts
OK: src/app/api/admin/lr/upload/route.ts

npm run lint:public-route-rate-limit --workspace=apps/web
All scanned public expensive/mutating route handlers passed or carried documented exemptions.

npm test --workspace=apps/web -- --run src/__tests__/data-timeline-behavior.test.ts src/__tests__/client-server-only-boundary.test.ts
Test Files  2 passed
Tests       17 passed
```

Not run: full lint, typecheck, build, full Vitest, Playwright e2e, production deploy, host-nginx validation, and load testing. This was a read-only review lane and no product source changed.

## Stop Condition

Final sweep found no new current architecture, debugger, tracer, race-condition, or causal-flow defect at `4a728335ada304371743689de7f5bbf8670985b5`. Existing deferred risks remain in their authoritative registers with exit criteria and were not re-filed.
