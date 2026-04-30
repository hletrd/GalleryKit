# Plan 79 — Cycle 33 Fixes (C33-01, C33-02, C33-03)

**Created:** 2026-04-19 (Cycle 33)
**Status:** DONE
**Severity:** 1 MEDIUM, 2 LOW

---

## C33-01: `getImageIdsForSitemap()` DB over-fetch [MEDIUM, High Confidence]

**File:** `apps/web/src/lib/data.ts:597-606` + `apps/web/src/app/sitemap.ts:17,42`

**Problem:** `getImageIdsForSitemap()` fetches up to 50,000 rows from the DB but sitemap.ts only uses `images.slice(0, MAX_SITEMAP_IMAGES)` where `MAX_SITEMAP_IMAGES = 24000`. This wastes DB I/O, connection pool time, and Node.js heap memory for ~26,000+ rows that are immediately discarded on every sitemap revalidation.

**Plan:**
1. Change `getImageIdsForSitemap()` in `lib/data.ts` to accept an optional `limit` parameter (default: 25000, matching sitemap needs with a small buffer).
2. Pass `MAX_SITEMAP_IMAGES` from sitemap.ts as the limit to avoid the slice + discard pattern.
3. Keep the `.slice(0, MAX_SITEMAP_IMAGES)` as a safety belt in sitemap.ts in case the limit param is ever removed or changed independently.

**Exit criterion:** DB query returns at most `MAX_SITEMAP_IMAGES + buffer` rows; no rows discarded by slice on typical galleries.

---

## C33-02: Dead import `formatUploadLimit` [LOW, High Confidence]

**File:** `apps/web/src/app/actions/images.ts:15`

**Problem:** `formatUploadLimit` is imported but never called. Only `MAX_TOTAL_UPLOAD_BYTES` is used.

**Plan:**
1. Remove `formatUploadLimit` from the import statement in `images.ts`.
2. Change: `import { formatUploadLimit, MAX_TOTAL_UPLOAD_BYTES } from '@/lib/upload-limits';` → `import { MAX_TOTAL_UPLOAD_BYTES } from '@/lib/upload-limits';`

---

## C33-03: Dead function `isReservedRouteSegment` [LOW, High Confidence]

**File:** `apps/web/src/lib/validation.ts:30-32`

**Problem:** `isReservedRouteSegment()` and `RESERVED_ROUTE_SEGMENTS` are exported but never imported or called anywhere. Only `isReservedTopicRouteSegment()` is used.

**Plan:**
1. Remove the `RESERVED_ROUTE_SEGMENTS` constant and `isReservedRouteSegment` function from `validation.ts`.
2. Verify no test references exist (checked: `validation.test.ts` does not import `isReservedRouteSegment`).

---

## Implementation Order

1. C33-01 (MEDIUM) — sitemap DB over-fetch
2. C33-02 (LOW) — dead import
3. C33-03 (LOW) — dead function

Each fix gets its own commit.
