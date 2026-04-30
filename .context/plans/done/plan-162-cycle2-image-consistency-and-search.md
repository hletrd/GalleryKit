# Plan 162 — Cycle 2 Image Variant, Search, and SSR Consistency

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/_aggregate.md`, `architect.md`, `code-reviewer.md`, `debugger.md`, `tracer.md`, `verifier.md`

## Scope
Fix the confirmed public/admin bugs caused by inconsistent image-variant assumptions, search deduplication, and SSR-unsafe rendering.

## Planned items

### C162-01 — Remove hard-coded `_640` assumptions and delete variants independent of the current config
- **Findings:** `AG2-04`
- **Goal:** Prevent thumbnail 404s after `image_sizes` changes and ensure deletion cleans up every generated variant, not just the current config.
- **Files to touch:**
  - `apps/web/src/components/search.tsx`
  - `apps/web/src/components/image-manager.tsx`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/process-image.ts`
  - related tests if practical

### C162-02 — Ensure tag search returns the expected number of unique images
- **Findings:** `AG2-09`
- **Goal:** Avoid limiting duplicate join rows before dedupe in `searchImages()`.
- **Files to touch:**
  - `apps/web/src/lib/data.ts`
  - search-related tests

### C162-03 — Fix SSR-safe photo rendering and schema metadata drift
- **Findings:** `AG2-12`, `AG2-16`
- **Goal:** Remove server-render-time `document` access from `PhotoViewer` and align Drizzle schema field types with committed migrations.
- **Files to touch:**
  - `apps/web/src/components/photo-viewer.tsx`
  - `apps/web/src/db/schema.ts`
  - tests impacted by those changes

## Ralph progress
- 2026-04-20: Plan created from cycle-2 aggregate review.
- 2026-04-20: Replaced hard-coded `_640` preview assumptions in public search and admin image previews with base generated assets, and updated variant deletion cleanup to remove historical suffixed files instead of relying only on the current configured size list.
- 2026-04-20: Fixed tag-search deduplication by grouping duplicate image/tag join rows before the result limit is applied.
- 2026-04-20: Removed server-render-time `document` access from `PhotoViewer` and aligned Drizzle schema bigint fields with the committed migration snapshot for `original_file_size` and `bucket_start`.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.
