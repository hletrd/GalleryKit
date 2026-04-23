# Architect — Cycle 2 Review (2026-04-23)

## SUMMARY
- The current architectural smell is inconsistent request-scoped caching in the public read path.

## INVENTORY
- Shared read helpers: `apps/web/src/lib/data.ts`, `apps/web/src/lib/gallery-config.ts`
- Public consumers: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

## FINDINGS

### ARCH2-01 — Tag aggregation lacks the request-scoped caching already used by adjacent hot-path helpers
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:229-246`, `apps/web/src/lib/data.ts:786-832`, `apps/web/src/app/[locale]/(public)/page.tsx:22-31,83-86`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:23-33,110-122`
- **Why it is a problem:** The repo deliberately wraps repeated SSR reads in `cache()` (`getTopicBySlugCached`, `getTopicsCached`, `getSeoSettings`, `getGalleryConfig`), but `getTags()` is still a raw query even though the route stack reuses it.
- **Concrete failure scenario:** Public route metadata and body rendering repeatedly compute the same grouped tag aggregates within one request lifecycle while neighboring helpers are already deduped.
- **Suggested fix:** Add `getTagsCached(topic?)`, switch the public route stack to it, and keep the raw helper for truly uncached callers if needed.

## FINAL SWEEP
- No broader layering rewrite is warranted. A small, consistent request-cache seam is the right architectural fix.
