# Perf Reviewer — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Findings (New — Not in Prior Cycles)

### LOW Severity (3)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-P01 | `exportImagesCsv` materializes the entire CSV in memory (up to 50K rows). The code releases the DB results array before joining, but the `csvLines[]` array and final joined string still coexist briefly. For 50K rows with long tag lists, this peaks at ~15-25MB heap. A streaming/chunked response would avoid this spike. | `app/[locale]/admin/db-actions.ts:51-99` | Medium |
| C3-P02 | `deleteImageVariants` with `sizes=[]` runs `opendir` + full directory scan on every image deletion. For a gallery with 10K images (10K+ files per format dir), each single-image delete pays a readdir cost. The scan is only needed to catch variants from prior configs — after the first cleanup pass, subsequent scans are wasted I/O. | `lib/process-image.ts:186-203` | Medium |
| C3-P03 | `getImage` runs 3 parallel DB queries (tags + prev + next). The prev/next queries are complex NULL-safe OR chains that cannot use a simple index. For a gallery with tens of thousands of images, these queries may be slow. The `cache()` wrapper deduplicates within a single request but does not cache across requests. | `lib/data.ts:531-601` | Low |

### INFO (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-P04 | `getImagesLitePage` uses `COUNT(*) OVER()` window function for total count. This is a MySQL 8.0+ feature and is correct. However, `COUNT(*) OVER()` computes the count for every row in the result, which means the optimizer must scan all matching rows even when paginating. For large galleries, the first page of 30 images may trigger a full-table scan for the count. This is a known MySQL window-function trade-off and is acceptable at personal-gallery scale. | `lib/data.ts:432-455` | Info |

## Verified Controls (No Regressions)

- React `cache()` deduplication for SSR
- `Promise.all` for parallel DB queries
- `tagNamesAgg` shared constant prevents drift
- Sharp `clone()` avoids triple buffer decode
- Upload streaming via `pipeline()` avoids heap materialization
- View count buffer swap with atomic Map reference
- Queue shutdown drain with 15-second timeout
- Orphaned .tmp file cleanup at bootstrap
