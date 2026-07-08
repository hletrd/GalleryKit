# Run-10 Cycle 28/100 Implementation Plan

Status: COMPLETED LOCALLY - SIGNED PUSHED AS `d985f549`; DEPLOY EVIDENCE SUPERSEDED BY CYCLE 29
Aggregate: `.context/reviews/run10-cycle28/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `8753b939a780984b2c988fb6b75ed23ebad98ec9`

## Scope

This plan schedules the bounded Cycle 28 aggregate findings that are safe to fix now and records all other current findings in `deferred.md` with severity/confidence preserved.

Repo rules read before scheduling/deferring: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/run10-cycle27/plan.md`, `.context/plans/run10-cycle27/deferred.md`, `.context/plans/deferred-carry-forward.md`, and the Cycle 28 review artifacts.

## Scheduled Work Packages

### WP1 - Sized JPEG grid fallback

Findings: `AGG-C28-01`

Files:

- `apps/web/src/components/grid-picture.tsx`
- `apps/web/src/components/masonry-card.tsx`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/__tests__/grid-picture-fallback-boundary.test.ts`

Plan:

1. Add a separate `fallbackSrc` recovery prop to `GridPicture`.
2. Use sized JPEG derivatives as the normal JPEG candidate/src on grid surfaces.
3. Keep the base JPEG only as delegated recovery after derivative failure.
4. Add source-contract coverage for the split.

Acceptance:

- JPEG-only clients select sized JPEG derivatives for grid thumbnails.
- Legacy missing-derivative rows can still recover to the base JPEG.

Status: implemented; gate evidence pending.

### WP2 - Server-action scanner placement guard

Findings: `AGG-C28-02`

Files:

- `apps/web/scripts/check-action-origin.ts`
- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`

Plan:

1. Scan all server-action-capable files under `src/app`.
2. Fail `lint:action-origin` when a top-level `'use server'` file is outside the approved scan set.
3. Lock the behavior with a source contract.

Acceptance:

- A future out-of-directory server-action module cannot silently bypass same-origin and mutation-barrier scanning.

Status: implemented; gate evidence pending.

### WP3 - Public restore/freshness source contracts

Findings: `AGG-C28-03`, `AGG-C28-04`

Files:

- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`

Plan:

1. Strengthen public restore-maintenance checks to assert guard ordering before each page's first DB/rate-limit work marker.
2. Add a dedicated `revalidate = 0` source contract for DB-backed public pages.

Acceptance:

- A public page cannot move maintenance UI below DB work while retaining a passing substring test.
- Removing dynamic freshness from a DB-backed public page fails unit tests.

Status: implemented; gate evidence pending.

### WP4 - Cycle ledger closure

Findings: `AGG-C28-06`

Files:

- `.context/plans/run10-cycle27/plan.md`
- `.context/plans/README.md`
- `.context/plans/run10-cycle28/plan.md`

Plan:

1. Record Cycle 27 signed commit/push evidence honestly.
2. Mark Cycle 27 deploy evidence as absent before Cycle 28 and superseded by Cycle 28's required per-cycle deploy.
3. Move active plan index to Cycle 28.
4. Record Cycle 28 gate, push, deploy, and live-smoke evidence after completion.

Acceptance:

- The plan index no longer treats Cycle 27 as active.
- Cycle 27 no longer says signed push is pending.
- Cycle 28 records current production closure evidence after deploy.

Status: pending terminal gate/deploy evidence.

### WP5 - Restore-maintenance landmark neutrality

Findings: `AGG-C28-07`

Files:

- `apps/web/src/components/public-restore-maintenance.tsx`
- `apps/web/src/__tests__/privacy-page-landmark.test.ts`

Plan:

1. Change `PublicRestoreMaintenance` from a landmark-owning `<main>` to a layout-neutral wrapper.
2. Keep the live status region and heading.
3. Add a regression test that the shared maintenance component does not render `<main>`.

Acceptance:

- Public/admin layouts remain the only `main` landmark owners during restore maintenance.

Status: implemented; gate evidence pending.

## Finding Disposition Map

Scheduled here: `AGG-C28-01`, `AGG-C28-02`, `AGG-C28-03`, `AGG-C28-04`, `AGG-C28-06`, `AGG-C28-07`.

Deferred in `deferred.md`: `AGG-C28-05`, `AGG-C28-08`.

## Progress

- [x] Prompt 1 review artifacts written and aggregated.
- [x] Prompt 2 plan/deferred records written.
- [x] WP1 sized JPEG grid fallback.
- [x] WP2 server-action scanner placement guard.
- [x] WP3 public restore/freshness source contracts.
- [x] WP4 ledger closure source edits.
- [x] WP5 restore-maintenance landmark neutrality.
- [x] Required gates.
- [x] Signed commit/push for implementation.
- [ ] Per-cycle deploy and live smoke. Not recorded before Cycle 29; Cycle 29's per-cycle deploy supersedes production evidence for this pushed history.

## Gate Evidence

- Focused tests passed: `npm test --workspace=apps/web -- --run src/__tests__/grid-picture-fallback-boundary.test.ts src/__tests__/privacy-page-landmark.test.ts src/__tests__/cycle-28-source-contracts.test.ts src/__tests__/check-action-origin.test.ts` (4 files, 128 tests).
- Full lint passed: `npm run lint --workspace=apps/web`.
- Admin API auth lint passed: `npm run lint:api-auth --workspace=apps/web`.
- Server-action origin lint passed: `npm run lint:action-origin --workspace=apps/web`.
- Public route rate-limit lint passed: `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Typecheck passed: `npm run typecheck --workspace=apps/web`.
- Production build passed: `npm run build --workspace=apps/web`.
- Full unit suite passed: `npm test --workspace=apps/web` (361 files passed, 2 skipped; 3382 tests passed, 4 skipped).
- E2E not run: selected changes are source/component contracts for image fallback URL selection, scanner placement, public-page source ordering/freshness, and a layout-neutral maintenance wrapper; no interactive browser-only flow changed. Authenticated all-admin-page e2e expansion is explicitly deferred in `deferred.md` as `AGG-C28-05`.

## Terminal Evidence

- Signed implementation commit: `d985f549afa73b23cdccf5d8fea30f4bfc840847` (`git log --format='%h %G? %s'` reports `G`).
- Push state before Cycle 29 implementation: `d985f549` was `HEAD`, `origin/master`, and `origin/HEAD` at Cycle 29 start.
- Deploy/live-smoke evidence: not committed before Cycle 29. Cycle 29's required per-cycle deploy is the current production closure pass for all pushed history through Cycle 29.
