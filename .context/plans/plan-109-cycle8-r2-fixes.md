# Plan 109 — Cycle 8 Re-review Fixes

**Created:** 2026-04-19 (Cycle 8)
**Status:** DONE

---

## Scope

Addresses findings from the Cycle 8 re-review aggregate (`_aggregate-cycle8-r2.md`).

### C8R2-01: `searchImages` tag query does not exclude main results at SQL level [MEDIUM] [HIGH confidence] — DONE
- **File:** `apps/web/src/lib/data.ts` lines 609-641
- **Fix:** Add a `NOT IN` exclusion clause to the tag search query so it doesn't return IDs already found by the main query. This ensures the `remainingLimit` slots are used efficiently and the combined result reaches the expected count.
- **Implementation:**
  1. After the main query returns `results`, extract the IDs: `const mainIds = results.map(r => r.id);`
  2. In the tag query, add a `WHERE images.id NOT IN (mainIds)` condition when `mainIds.length > 0`:
     ```ts
     const tagConditions = [eq(images.processed, true), like(tags.name, searchTerm)];
     if (mainIds.length > 0) {
         tagConditions.push(notInArray(images.id, mainIds));
     }
     ```
  3. Import `notInArray` from drizzle-orm (already using `inArray` elsewhere in the file).
  4. Keep the `seen` Set as defense-in-depth but the SQL-level exclusion ensures correctness.
  5. The `effectiveLimit` for the tag query remains as `remainingLimit` since duplicates are now excluded at the SQL level.
- **Commit:** `00000006ddc2d1b9d7badfa14cd849397c4cc261`

### C8R2-02: Desktop sidebar tag name formatting mismatch vs mobile bottom sheet [LOW] [MEDIUM confidence] — DONE
- **File:** `apps/web/src/components/photo-viewer.tsx` line 344
- **Fix:** Remove the `.replace(/_/g, ' ')` from the desktop sidebar tag name formatting to match the mobile bottom sheet's behavior (displaying tag names as authored). Both components now consistently show raw tag names.
- **Implementation:**
  1. Changed `image.tags.map((tag: TagInfo) => \`#${tag.name.replace(/_/g, ' ')}\`).join(' ')` to `image.tags.map((tag: TagInfo) => \`#${tag.name}\`).join(' ')`
  2. This matches the bottom sheet's behavior in `info-bottom-sheet.tsx` line 121.
- **Commit:** `0000000dc3cc2652d296a6aba04d32236448cd94`

---

## Not In Scope (Deferred)

See existing deferred items from prior cycles (unchanged).

## Gate Checks

After all changes:
- [x] `eslint` passes
- [x] `next build` succeeds
- [x] `vitest` passes (66/66 tests)
- [x] `tsc --noEmit` passes
