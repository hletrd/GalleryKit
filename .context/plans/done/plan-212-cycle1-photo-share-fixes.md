# Plan 212 — Cycle 1 Photo/Share Performance and Title Consistency Fixes

**Status:** DONE
**Source review:** `.context/reviews/_aggregate.md`
**Scope:** Implement all validated current-cycle findings from AGG-01 through AGG-03, including the user-injected deep performance review follow-up.

## Findings covered

| ID | Title | Severity | Confidence | Source citation |
| --- | --- | --- | --- | --- |
| AGG-01 | Photo/share route entrypoints still serialize independent cached reads on the request hot path | MEDIUM | HIGH | `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:25-29,41,68`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:33-46,84-95`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:28-40,95-97` |
| AGG-02 | Untitled photo pages use inconsistent fallback titles across metadata, JSON-LD, and viewer UI | MEDIUM | HIGH | `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:53-63,140-145`, `apps/web/src/components/photo-viewer.tsx:366-371`, `apps/web/src/components/info-bottom-sheet.tsx:119-123` |
| AGG-03 | Photo viewer JPEG fallback bypasses configured derivatives and can download the largest asset unnecessarily | MEDIUM | HIGH | `apps/web/src/components/photo-viewer.tsx:179-223` |

## Implementation tasks

### Task 1 — Parallelize independent photo/share entrypoint reads [AGG-01]
**Files:**
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- any directly related shared helper if needed

**Planned changes:**
1. Rework the affected metadata/page functions so locale, translations, SEO config, gallery config, and image/group fetches are started in `Promise.all` groups whenever there is no real dependency.
2. Keep 404 / invalid-id behavior unchanged.
3. Add or update focused regression tests where practical so the intended async contract is locked by shape/behavior rather than comments.

**Exit criterion:** The affected photo/share entrypoints no longer serialize independent cached reads on the request hot path. ⏳

### Task 2 — Centralize photo display-title fallback logic [AGG-02]
**Files:**
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- shared helper file to be chosen during implementation
- related tests

**Planned changes:**
1. Extract one shared helper for public photo display-title generation.
2. Reuse that helper for metadata, JSON-LD/breadcrumb data, desktop sidebar, and mobile bottom sheet.
3. Preserve the current tag/title-first behavior while making the untitled fallback deterministic and consistent.

**Exit criterion:** Untitled photos render the same fallback title across metadata, JSON-LD, and viewer UI. ⏳

### Task 3 — Use configured JPEG derivatives for the photo-viewer fallback path [AGG-03]
**Files:**
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/lib/image-url.ts` or another existing helper only if needed
- related tests

**Planned changes:**
1. Replace the raw full-size JPEG fallback with configured derivative URLs.
2. Prefer a responsive JPEG `srcSet` + `sizes` contract when possible; otherwise use the nearest appropriate derivative as the baseline fallback.
3. Add regression coverage for the fallback URL selection logic.

**Exit criterion:** The photo viewer no longer defaults to the largest JPEG when rendering the fallback path. ⏳

## Deferred items
- None. All validated current-cycle findings are scheduled in this plan.

## Progress
- [x] Task 1 — Parallelize independent photo/share entrypoint reads
- [x] Task 2 — Centralize photo display-title fallback logic
- [x] Task 3 — Use configured JPEG derivatives for the photo-viewer fallback path

## Verification plan
- `npm run build --workspaces`
- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npx tsc --noEmit -p apps/web/tsconfig.json`
- `npm run test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`

## Verification evidence
- `npm run build --workspaces` ✅
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npx tsc --noEmit -p apps/web/tsconfig.json` ✅
- `npm run test --workspace=apps/web` ✅ (203 tests)
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed / 3 skipped)
