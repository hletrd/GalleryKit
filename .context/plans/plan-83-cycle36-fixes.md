# Plan 83 — Cycle 36 Fixes (C36-01)

**Created:** 2026-04-19 (Cycle 36)
**Status:** DONE
**Severity:** 1 LOW

---

## C36-01: Dashboard page `parseInt` without upper-bound cap on page number [LOW, Medium Confidence]

**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:10`

**Problem:** `parseInt(pageParam || '1', 10)` is called without capping the page number. While the fallback `|| 1` handles NaN, extremely large page numbers (e.g., `?page=999999999999`) create a huge OFFSET in the MySQL query. MySQL must scan and discard all preceding rows, consuming CPU and memory. This is an admin-only page, so the attack surface is limited, but it is still defense-in-depth.

**Plan:**
1. After `parseInt`, add `Math.min(page, 1000)` to cap the page number at a reasonable maximum (1000 pages * 50 items = 50,000 items, well beyond any realistic admin dashboard usage).
2. This mirrors the pattern used in `getImagesLite` which caps `effectiveLimit` at 100.

**Exit criterion:** Dashboard page number is capped at 1000, preventing extreme OFFSET values.

---

## Deferred

### C36-02: `Number(result.insertId)` BigInt coercion [LOW, Low Confidence]
**File:** `apps/web/src/app/actions/sharing.ts:166`
**Reason:** Theoretical only — galleries never approach 2^53 rows. `Number.isFinite` already validates NaN/Infinity.
**Exit criterion:** If the app ever supports tables approaching 2^53 rows or mysql2 config changes BigInt handling.

### C36-03: `flushGroupViewCounts` re-buffers without retry limit [LOW, High Confidence]
**File:** `apps/web/src/lib/data.ts:40-46`
**Reason:** Same as deferred C30-04 from cycle 30. Hard cap of 1000 entries prevents memory issues. Only affects view count accuracy during extended DB outages, not stability.
**Exit criterion:** If view count accuracy becomes critical; implement a max-retry counter per buffered entry.

---

## Implementation Order

1. C36-01 (LOW) — add page number cap in dashboard page (1 commit)
