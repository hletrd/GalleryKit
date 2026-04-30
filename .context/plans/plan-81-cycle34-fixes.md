# Plan 81 — Cycle 34 Fixes (C34-01, C34-02)

**Created:** 2026-04-19 (Cycle 34)
**Status:** DONE
**Severity:** 1 MEDIUM, 1 LOW

---

## C34-01: Sitemap default limit mismatch + redundant slice [MEDIUM, High Confidence]

**File:** `apps/web/src/lib/data.ts:597-607` + `apps/web/src/app/sitemap.ts:21,42`

**Problem:** `getImageIdsForSitemap()` has a default limit of 25000, but the sitemap consumer uses `MAX_SITEMAP_IMAGES = 24000`. The sitemap correctly passes the limit when calling the function, but the mismatched default is a foot-gun for future callers. Additionally, `sitemap.ts` line 42 has `images.slice(0, MAX_SITEMAP_IMAGES)` which is now redundant since the DB query already returns at most 24000 rows.

**Plan:**
1. Change the default limit parameter in `getImageIdsForSitemap()` from 25000 to 24000 to match `MAX_SITEMAP_IMAGES`. This way the default aligns with the primary consumer.
2. Remove the redundant `images.slice(0, MAX_SITEMAP_IMAGES)` line in sitemap.ts and use `images` directly since the DB query already caps at 24000 rows.
3. Remove the `cappedImages` intermediate variable and rename references.

**Exit criterion:** `getImageIdsForSitemap()` default matches `MAX_SITEMAP_IMAGES`; sitemap.ts no longer slices already-limited results.

---

## C34-02: Missing `return` before `notFound()` in shared photo page [LOW, Medium Confidence]

**File:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:63`

**Problem:** `notFound()` is called without `return` on line 63, inconsistent with every other `notFound()` call in the codebase (which all use `return notFound()`). While functionally harmless (notFound throws a special error), the inconsistency is misleading.

**Plan:**
1. Change `notFound();` to `return notFound();` on line 63 of the shared photo page.

---

## Implementation Order

1. C34-01 (MEDIUM) — sitemap default limit alignment + redundant slice removal
2. C34-02 (LOW) — add return before notFound()

Each fix gets its own commit.
