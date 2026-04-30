# Plan 208 — Cycle 4 Restore Maintenance Readiness and Public-Read Guarding

**Status:** DONE
**Source review:** `.context/reviews/_aggregate.md`
**Scope:** Fix the restore-maintenance gaps that currently keep public read traffic and readiness green during DB restore work.

## Findings covered

| ID | Title | Severity | Confidence | Source citation |
| --- | --- | --- | --- | --- |
| F1 | Public read surfaces stay live during restore maintenance, causing inconsistent UX and avoidable load | MEDIUM | HIGH | `apps/web/src/lib/restore-maintenance.ts:1-38`, `apps/web/src/app/actions/public.ts:1-76`, `apps/web/src/app/[locale]/admin/db-actions.ts:244-286`, `.context/reviews/_aggregate.md` |
| F2 | `/api/health` does not honor restore maintenance, contradicting repo docs and keeping readiness green during restore | MEDIUM | HIGH | `apps/web/src/app/api/health/route.ts:1-18`, `apps/web/src/lib/restore-maintenance.ts:1-38`, `CLAUDE.md:177-180`, `.context/reviews/_aggregate.md` |

## Implementation tasks

### Task 1 — Gate expensive public server actions during restore maintenance [F1]
**Files:**
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/__tests__/public-actions.test.ts`

**Changes completed:**
1. Added an immediate restore-maintenance short circuit to `loadMoreImages()`.
2. Added an immediate restore-maintenance short circuit to `searchImagesAction()` before header, rate-limit, and DB work.
3. Added regression coverage proving both public server actions return empty results without touching downstream dependencies while maintenance is active.

**Exit criterion:** Public infinite-scroll and search server actions do not touch the DB during restore maintenance, and the behavior is regression-tested. ✅

### Task 2 — Make readiness fail during restore maintenance [F2]
**Files:**
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/__tests__/health-route.test.ts`

**Changes completed:**
1. Updated `/api/health` to return a restore-specific degraded response when `isRestoreMaintenanceActive()` is true.
2. Preserved the existing DB reachability probe outside maintenance mode.
3. Added regression coverage for restore-maintenance, healthy-DB, and DB-failure branches.

**Exit criterion:** `/api/health` returns `503` during restore maintenance even if the DB is reachable, and tests lock that contract. ✅

## Deferred items
- None in this plan. Invalidated reviewer claims were filtered in `.context/reviews/_aggregate.md` and do not require scheduling.

## Progress
- [x] Task 1 — Gate expensive public server actions during restore maintenance
- [x] Task 2 — Make readiness fail during restore maintenance

## Verification evidence
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (34 files / 184 tests)
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed / 3 skipped opt-in admin specs)
- `npm run build` ✅
