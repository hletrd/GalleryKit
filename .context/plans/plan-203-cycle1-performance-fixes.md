# Plan 203 — Cycle 1 Performance Fixes

**Status:** DONE
**Source review:** `.context/reviews/_aggregate.md`
**Scope:** Implement the two current-cycle performance wins scheduled from AGG-01 and AGG-02.

## Findings covered

| ID | Title | Severity | Confidence | Source citation |
| --- | --- | --- | --- | --- |
| AGG-01 | Shared public-route topic data is not request-cached | MEDIUM | HIGH | `apps/web/src/lib/data.ts:202-204, 786-790`, `apps/web/src/components/nav.tsx:2-8`, `apps/web/src/app/[locale]/(public)/page.tsx:82-84`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-120` |
| AGG-02 | Photo viewer overstates image display width when the desktop info panel is open | LOW | HIGH | `apps/web/src/components/photo-viewer.tsx:202-223` |

## Implementation tasks

### Task 1 — Deduplicate shared topic reads on hot public routes [AGG-01]
**Files:**
- `apps/web/src/lib/data.ts`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

**Changes completed:**
1. Added `getTopicsCached` alongside the existing cached data exports.
2. Switched `Nav`, the public home page, and the topic page to the cached helper.
3. Kept the topic data shape and page behavior unchanged.

**Exit criterion:** Home/topic public renders do not issue avoidable duplicate `topics` reads within the same request tree. ✅

### Task 2 — Make viewer image source hints match the actual desktop layout [AGG-02]
**Files:**
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`

**Changes completed:**
1. Added a deterministic `getPhotoViewerImageSizes()` helper in the shared gallery config module.
2. Switched the photo viewer AVIF/WebP `<source>` tags to a sidebar-aware `sizes` hint.
3. Added focused regression coverage for the helper.

**Exit criterion:** The photo viewer advertises a narrower display width when the desktop sidebar is open, and the helper is covered by unit tests. ✅

## Deferred items
- None in this plan. Deferred findings are recorded separately in `.context/plans/204-deferred-cycle1-performance-review.md`.

## Progress
- [x] Task 1 — Deduplicate shared topic reads on hot public routes
- [x] Task 2 — Make viewer image source hints match the actual desktop layout

## Verification evidence
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (173 tests)
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed / 3 skipped)
- `npm run build` ✅
