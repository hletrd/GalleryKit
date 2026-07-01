# Cycle 65 Performance / Concurrency Review

## Inventory

- Image queue, Sharp processing, bootstrap scan, shutdown/quiesce, and derivative verification.
- Backfill concurrency, advisory locks, restore drains, and batch runners.
- Public listings, search/similar routes, semantic scan limits, service worker caching, and UI responsiveness.

## Findings

### C65-05 - Similar-photo fetch keeps running after the panel is closed

- Severity/confidence: Low / High.
- File/line: `apps/web/src/components/similar-photos.tsx:70`, `apps/web/src/components/similar-photos.tsx:77`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`.
- Evidence: `SimilarPhotos` aborts only on component unmount. Closing the disclosure does not abort the in-flight request or clear the loading state.
- Failure scenario: in production semantic-search mode, a visitor opens Similar Photos and immediately closes it on a slow connection. The UI no longer needs the result, but the request can keep consuming DB/CPU work and semantic rate budget until completion or server-side abort observation.
- Suggested fix: abort the current controller when closing, reset `loading`, keep `fetchedRef` false, and guard late responses against closed/unmounted state.

## Validation

- Read-only review; no tests run in this lane.
