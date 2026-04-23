# Critic — Cycle 2 Review (2026-04-23)

## SUMMARY
- The most credible current risks are performance regressions hidden in the public metadata/render stack, not correctness or security failures.

## INVENTORY
- Public route metadata and page composition: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Shared data helpers: `apps/web/src/lib/data.ts`
- Public search hot path: `apps/web/src/app/actions/public.ts`, `apps/web/src/components/search.tsx`

## FINDINGS

### CRI2-01 — Tag aggregation is still treated as cheap even though the public route stack executes it redundantly
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:229-246`, `apps/web/src/app/[locale]/(public)/page.tsx:24-25,83-86`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:32-33,111-122`
- **Why it is a problem:** The repo already caches other SSR hot-path reads (`getTopicsCached`, `getSeoSettings`, `getGalleryConfig`), but tag aggregation remains uncached and duplicated across metadata + page rendering.
- **Concrete failure scenario:** Under crawler traffic or repeated cache misses, grouped tag queries become recurring overhead on the busiest public routes.
- **Suggested fix:** Add a cached tag helper and avoid running tag validation when no `tags` query parameter exists.

### CRI2-02 — The homepage metadata path still does fallback work after the admin has explicitly configured a custom OG asset
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:22-31,44-54`
- **Why it is a problem:** The code asks the database for a latest image and reads gallery config even when the branch that uses those values is dead because `seo.og_image_url` is set.
- **Concrete failure scenario:** The app keeps paying a needless hot-path query for every metadata render on branded deployments that always use a fixed OG image.
- **Suggested fix:** Return early from the custom-OG branch.

## FINAL SWEEP
- I revisited older review artifacts only to verify staleness. The strong signal in the current codebase is performance debt in metadata/render composition rather than a hidden correctness bug.
