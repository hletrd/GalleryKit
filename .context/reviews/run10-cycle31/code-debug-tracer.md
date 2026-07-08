# Run-10 Cycle 31/100 Code / Debugger / Tracer Review

Date: 2026-07-08 KST
Reviewed HEAD: `707470083a27c78e1c9d1da176ade75f94ad6af4`
Role lane: code-reviewer + debugger + tracer

## Inventory

- Guidance and dedupe baseline: `AGENTS.md`, `CLAUDE.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/run10-cycle27/deferred.md`, `.context/plans/run10-cycle28/deferred.md`, `.context/plans/run10-cycle29/deferred.md`, `.context/plans/run10-cycle30/deferred.md`, `.context/reviews/run10-cycle29/code-reviewer-debugger-tracer.md`, `.context/reviews/run10-cycle30/code-reviewer-debugger-tracer.md`, `.context/reviews/run10-cycle30/_aggregate.md`, `.context/plans/cycle-10b-2026-07-08-deferred.md`.
- Current delta since Cycle 30 start: `.context/*` ledgers, `.gitignore`, `CLAUDE.md`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/__tests__/data-timeline-behavior.test.ts`, `apps/web/src/__tests__/client-server-only-boundary.test.ts`.
- Runtime/data-flow files read for adjacent risk: `apps/web/src/app/[locale]/(public)/timeline/page.tsx`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/on-this-day-widget.tsx`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`.
- Source sweeps: timeline/archive callers, pending-file-deletion flow, client component imports, Server Action import false-positive boundary, restore drain/finalizer path, admin/API/public-route lint gates.

## Findings

No new non-duplicative correctness, edge-case, race-condition, error-handling, or data-flow findings were confirmed.

## Non-Findings / Dedupe Notes

- Timeline December range fix is coherent. `archiveRange()` now wraps `month === 12` to `end: YYYY+1-01-01` at `apps/web/src/lib/data-timeline.ts:93-103`, and the behavior tests pin December, mid-year, year-wide, and single-digit month bounds at `apps/web/src/__tests__/data-timeline-behavior.test.ts:59-91`. Current public callers still request only year-wide data: timeline page calls `getTimelineImages(selectedYear)` at `apps/web/src/app/[locale]/(public)/timeline/page.tsx:90-95`, and year-in-review calls `getYearInReviewImages(yearNum)` at `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:92-103`.
- The Cycle 30 client-boundary false-positive is not present at this HEAD. The scanner follows `@/components` value edges but still deliberately skips `@/app` Server Action edges at `apps/web/src/__tests__/client-server-only-boundary.test.ts:156-166`; executable coverage for both cases is at `apps/web/src/__tests__/client-server-only-boundary.test.ts:584-617`.
- The known restore auth/maintenance ordering item remains the same deferred item, not a new finding. Current `restoreDatabase()` still does same-origin and admin auth before lock/maintenance acquisition at `apps/web/src/app/[locale]/admin/db-actions.ts:421-428`, matching `AGG-C27-02` in `.context/plans/run10-cycle27/deferred.md:13-16`.
- The restore finalizer/test-strength gap remains unchanged and tracked as `AGG-C27-04`; current finalizer cleanup/resume/drain logic is at `apps/web/src/app/[locale]/admin/db-actions.ts:650-702`, while the deferred register keeps the exit criterion at `.context/plans/run10-cycle27/deferred.md:15-17`.
- The bulk delete pending-file-deletion loop is already carried as `D10b-05 / AGG-C10b-03`, not a fresh Cycle 31 finding. Current code still inserts one pending row per image before the batched delete at `apps/web/src/app/actions/images.ts:808-836`; the existing deferral and correctness-sensitive fix criteria are recorded at `.context/plans/cycle-10b-2026-07-08-deferred.md:99-122`.
- Cycle 28 admin e2e and proxy-real-IP items remain test/operator scope, not newly confirmed code defects. They are unchanged in `.context/plans/run10-cycle28/deferred.md:13-16`.

## Validation

- `npm test --workspace=apps/web -- --run src/__tests__/data-timeline-behavior.test.ts src/__tests__/client-server-only-boundary.test.ts` passed: 2 files, 17 tests.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `git diff --check` passed.

## Final Missed-Issue Sweep

- Auth/action/API/rate-limit gates were freshly executed and passed; no new unguarded admin mutation, unwrapped admin API route, or expensive public route without rate-limit coverage was found.
- Restore, background-write, and pending-file-deletion paths were re-read around current high-risk citations. Only already-registered carry-forward items remained.
- No new schema, privacy-field, service-worker/offline-cache, image-processing delete/retry, timeline archive, or client/server bundle-boundary defect was confirmed in this lane.
