# Code Reviewer — Cycle 2 Review (2026-04-23)

## SUMMARY
- Confirmed 2 current maintainability/performance issues in the public metadata path.
- No fresh high-severity correctness regressions were confirmed in the current checkout.

## INVENTORY
- Data helpers: `apps/web/src/lib/data.ts`
- Public route consumers: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Public search path: `apps/web/src/app/actions/public.ts`, `apps/web/src/components/search.tsx`
- Validation sweep for stale fixes: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`

## FINDINGS

### CR2-01 — Public metadata and page renders duplicate expensive `getTags()` work and metadata does it even without tag filters
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:229-246`, `apps/web/src/app/[locale]/(public)/page.tsx:24-25,83-86`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:32-33,111-122`
- **Why it is a problem:** `getTags()` performs a grouped aggregate over `tags`/`imageTags`/`images`, but the home/topic metadata paths call it unconditionally, and the page body calls it again. This creates avoidable duplicate DB work on hot unauthenticated routes.
- **Concrete failure scenario:** A crawler or cold visitor requests `/` or `/topic`; the metadata pass queries tag aggregates, then the page render repeats the same aggregate. Topic pages repeat the same pattern per topic.
- **Suggested fix:** Export a request-scoped `getTagsCached(topic?)` helper and use it on public pages. Also skip the metadata tag query entirely when `tags` search params are absent.

### CR2-02 — Home metadata still loads fallback OG dependencies even when a custom OG image is configured
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:22-31,44-54`
- **Why it is a problem:** When `seo.og_image_url` is set, the metadata response never uses `latestImage` or `getGalleryConfig()`, but the route still performs both lookups.
- **Concrete failure scenario:** Sites with a fixed custom OG image pay an unnecessary `getImagesLite(...limit=1)` query plus config parsing on every metadata render.
- **Suggested fix:** Short-circuit the custom-OG branch before fetching the latest image or gallery config.

## FINAL SWEEP
- Re-checked previously stale cycle-2 findings against the current tree. The request-origin default-port mismatch, SQL restore `CREATE TABLE` false positive, and missing `nosniff` headers are already fixed and were not carried forward.
