# Cycle 7 Perf Review (manual fallback)

## Inventory
- Reviewed image pipeline outputs, thumbnail consumers, query helpers, and share-view buffering paths.
- Focused on hot-path data/image delivery costs rather than broad architectural redesigns.

## Confirmed Issues

### P7-01 — Thumbnail consumers bypass the generated small JPEG derivatives
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/components/search.tsx:208-215`, `apps/web/src/components/image-manager.tsx:342-349`, `apps/web/src/lib/process-image.ts:393-406`
- **Why it is a problem:** the UI pays large-image decode/download costs for surfaces that only need 48px–128px previews.
- **Concrete failure scenario:** search results or the admin table become noticeably slower on cold cache because each tiny preview requests the largest JPEG variant.
- **Suggested fix:** route thumbnail-sized surfaces to the nearest configured generated derivative instead of the base JPEG alias.
