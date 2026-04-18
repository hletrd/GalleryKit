# Plan 27: Routing, Metadata, and View-State Consistency — R8

**Priority:** HIGH
**Estimated effort:** 3-4 hours
**Sources:** Comprehensive audit 2026-04-18 findings #1, #8, #9, #10, #11, #12, #13
**Status:** IN PROGRESS

---

## Scope
- Canonical/default-locale URL generation consistency
- Shared-group `photoId` URL synchronization
- Landmark/skip-link correctness
- Search result race protection
- Manifest icon path correctness
- Tag-filter redundant refresh removal
- Topic heading correctness

## Planned items
1. Centralize locale-aware URL generation for metadata and navigation
2. Sync shared-group viewer navigation into the query string
3. Remove nested `<main>` landmarks and fix skip-link targets
4. Guard search results against stale async responses
5. Point manifest icons at real icon routes/assets
6. Remove redundant tag-filter refresh churn
7. Show topic-specific heading on topic pages

## Ralph progress
- 2026-04-18: Plan created from the full audit. No implementation committed yet.
