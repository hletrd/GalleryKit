# Run-10 Cycle 29/100 Code Reviewer / Debugger / Tracer Review

Date: 2026-07-08 KST
Reviewed HEAD: `d985f549afa73b23cdccf5d8fea30f4bfc840847`
Role lane: code-reviewer + debugger + tracer

## Scope

Fresh current-HEAD review only. I focused on correctness, logic, edge cases, race conditions, and suspicious data/control flows around the current Cycle 28 implementation, then swept adjacent runtime paths likely to falsify those changes. I did not edit application source.

## Quick Inventory

- Guidance/context: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/run10-cycle27/deferred.md`, `.context/plans/run10-cycle28/plan.md`, `.context/plans/run10-cycle28/deferred.md`, `.context/reviews/run10-cycle28/_aggregate.md`, `.context/reviews/run10-cycle28/code-architect-debugger-tracer.md`, `.context/reviews/run10-cycle29/document-critic-reviewer.md`.
- Current Cycle 28 implementation files: `apps/web/scripts/check-action-origin.ts`, `apps/web/src/components/grid-picture.tsx`, `apps/web/src/components/grid-picture-fallback-boundary.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/public-restore-maintenance.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`.
- Adjacent source/tests: `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts`, `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/privacy-page-landmark.test.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/instrumentation.ts`.

## Findings

No new non-duplicative current code/debug/tracer findings.

## Review Notes

- Server-action scanner placement: current top-level `'use server'` modules are only under the approved scanned set (`apps/web/src/app/actions/*` plus `apps/web/src/app/[locale]/admin/db-actions.ts`). `lint:action-origin` passed and reported no unscanned modules. I did not refile broader future inline-action coverage because no current inline `'use server'` action exists at this HEAD.
- Grid fallback change: the normal JPEG candidate now uses sized derivatives and delegates base-JPEG recovery through `fallbackSrc`. The underlying filename columns are non-null in the schema, and `findNearestImageSize()` has a default fallback for empty size arrays, so I did not confirm a current runtime edge failure.
- Restore maintenance/public-page ordering: DB-backed public pages now have body and metadata short-circuits before DB/rate-limit work. The known concurrent restore auth-before-lock exception remains tracked as `AGG-C27-02` in `.context/plans/run10-cycle27/deferred.md`; I did not duplicate it.
- Async restore drains: shared-group view counts, image queue, background DB writes, maintenance sweeps, and foreground admin mutations are all represented in the current restore drain checklist. I did not confirm a new missed writer in the checked paths.

## Not Re-Reported

- Cycle 28 deferred items `AGG-C28-05` and `AGG-C28-08` remain valid deferred test/operator items with exit criteria in `.context/plans/run10-cycle28/deferred.md`; they are not fresh code defects.
- The current-cycle documentation/control-ledger issues are already captured in `.context/reviews/run10-cycle29/document-critic-reviewer.md` as `DOC-C29-01` and `DOC-C29-02`, so this code/debug/tracer lane does not count them again.
- The historical `.context/plans/cycle-29-2026-06-30-*` pair is not the current run-10 Cycle 29 ledger; `.context/plans/README.md` warns about historical cycle-name ambiguity.

## Verification

Targeted validation passed:

```text
npm test --workspace=apps/web -- --run src/__tests__/grid-picture-fallback-boundary.test.ts src/__tests__/cycle-28-source-contracts.test.ts src/__tests__/check-action-origin.test.ts
Test Files  3 passed (3)
Tests       126 passed (126)

npm run lint:action-origin --workspace=apps/web
All mutating server actions enforce same-origin provenance.
```

Git state observed during review:

```text
HEAD: d985f549
origin/master: d985f549
```

No full lint/typecheck/build/test suite was run for this read-only review lane because no application code was changed.
