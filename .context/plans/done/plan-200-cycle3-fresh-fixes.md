# Implementation Plan — Cycle 3 Fresh Fixes

## Prior fixes (already committed)

### A1: Remove redundant group_concat_max_len SET SESSION (C3R-01) -- DONE (commit 00000002f)

### B1: Align escapeCsvField with stripControlChars for C1 controls (C3R-02) -- DONE (commit 00000002f)

## New fixes

## Plan C: Short-circuit searchImages when first query returns enough results (C3-01)

### C1: Add early return after main query in searchImages
- File: `apps/web/src/lib/data.ts`
- Lines: 682-763
- The `searchImages` function runs 3 sequential DB queries: (1) main LIKE search, (2) tag-name LIKE search, (3) alias LIKE search.
- When the main query returns `effectiveLimit` results, the tag and alias queries are wasted work.
- Add a short-circuit check after the main query: if `results.length >= effectiveLimit`, return the results immediately without running the tag and alias queries.
- This reduces DB load for popular search terms that already match in title/description/camera_model/topic/label fields.

## Plan D: Optimize deleteImageVariants when sizes are known (C3-02)

### D1: Skip opendir scan when sizes list covers all known variants
- File: `apps/web/src/lib/process-image.ts`
- Lines: 170-198
- The `deleteImageVariants` function iterates the entire directory to find variant files matching the pattern `{name}_*{ext}`.
- When `sizes` is provided (the common path), all variant filenames are deterministic: `{name}_{size}{ext}` for each size in the array plus the base filename.
- The `opendir` scan is only needed to catch leftover variants from a prior `sizes` config that no longer matches.
- Keep the `opendir` scan as a fallback for non-standard variants, but only when `sizes` is empty (undefined).
- When `sizes` is provided, just delete the known filenames directly from `filesToDelete` without the scan.
