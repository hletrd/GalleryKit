# Aggregate Review -- Cycle 2 (Run 2)

**Date**: 2026-05-05
**Reviewers**: code-reviewer, security-reviewer, perf-reviewer, photographer-workflow, debugger, verifier, architect
**Focus**: Professional photographer workflow, code quality, security, performance, correctness

---

## REVIEW SCOPE

Reviewed all critical source files including:
- `data.ts` (full file, 1367 lines) — data access layer
- `images.ts` (full file, 970 lines) — upload/delete/update actions
- `sharing.ts` (full file, 382 lines) — share link management
- `tags.ts` (full file, 462 lines) — tag CRUD actions
- `public.ts` (full file, 318 lines) — public server actions
- `process-image.ts` (full file, 990 lines) — image processing pipeline
- `photo-viewer.tsx` (full file, 895 lines) — photo viewer component
- `info-bottom-sheet.tsx` (full file, 443 lines) — mobile info sheet
- `home-client.tsx` (full file, 329 lines) — gallery grid
- `search.tsx` (full file, 370 lines) — search overlay
- `gallery-config.ts` (full file, 148 lines) — gallery configuration
- `image-types.ts` (full file, 88 lines) — shared type definitions
- `photo-title.ts` (full file, 111 lines) — title/alt text utilities
- `exif-datetime.ts` (full file, 78 lines) — EXIF date formatting
- `schema.ts` (full file, 283 lines) — database schema
- `g/[key]/page.tsx` (full file, 240 lines) — shared group page
- `p/[id]/page.tsx` (full file, 294 lines) — photo page

---

## AGGREGATE FINDINGS (Deduplicated, Highest Severity Preserved)

### LOW

| # | Finding | Severity | Confidence | Sources | File(s) |
|---|---------|----------|------------|---------|---------|
| 1 | `bulkUpdateImages` per-row UPDATE loop for alt_text_suggested | Low | High | perf, code | images.ts:906-917 |
| 2 | Shared group query fetches EXIF fields unused by public page | Low | Medium | perf, photographer | data.ts:1004-1021, g/[key]/page.tsx |

---

## FINDING DETAILS

### Finding 1: `bulkUpdateImages` per-row UPDATE loop for `applyAltSuggested`

**File**: `apps/web/src/app/actions/images.ts:906-917`

**Description**: When `applyAltSuggested === 'title'` or `'description'`, the code fetches all qualifying rows, then executes a separate `UPDATE` for each image that has a suggested caption and no existing admin-set value. For batches of 100 images (the max), this issues up to 100 individual UPDATE statements inside a transaction.

**Why it matters**: At personal-gallery scale (batches typically < 50), the latency is acceptable (~50-100ms for 100 round-trips on localhost MySQL). But the pattern could be replaced with a single `UPDATE ... CASE WHEN ... END` SQL statement that applies all per-row values atomically.

**Suggested fix**: Build a CASE WHEN expression:
```sql
UPDATE images SET title = CASE id WHEN 1 THEN 'Caption A' WHEN 2 THEN 'Caption B' END WHERE id IN (1, 2) AND title IS NULL
```

**Previous cycle**: Deferred as DEFERRED-11 / "Low" severity in cycle 1 run 2 aggregate. Still valid. Remains deferrable.

---

### Finding 2: Shared group query fetches EXIF fields unused by public page

**File**: `apps/web/src/lib/data.ts:1004-1021`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`

**Description**: `getSharedGroup()` uses `publicSelectFields` which includes `camera_model`, `lens_model`, `iso`, `f_number`, `exposure_time`, `focal_length`, `color_space`, `white_balance`, `metering_mode`, `exposure_compensation`, `exposure_program`, `flash`, `bit_depth`, and other EXIF fields. The shared group grid page (`g/[key]/page.tsx`) only displays image thumbnails and titles — no EXIF data is rendered on the grid view.

When a specific photo is selected (`?photoId=...`), the page renders `PhotoViewer` which does use EXIF data. So the fields ARE needed for the selected-photo view, but the grid-only path fetches all EXIF for all images unnecessarily.

**Why it matters**: For a shared group with 100 images viewed in grid mode, the DB returns ~15 unused EXIF columns per row. The overhead is negligible at personal-gallery scale but represents unnecessary I/O.

**Suggested fix**: This is low priority. A split-query approach (grid-only fields for listing, full fields for selected photo) would add complexity for minimal benefit.

---

## CROSS-AGENT AGREEMENT

No strong cross-agent signals — these are the only new findings after 47+ prior review cycles.

---

## PREVIOUSLY IDENTIFIED (Still Valid, Not Re-listed)

These findings from prior cycles remain valid and unaddressed:
- No original-format download for admin (DEFERRED from multiple cycles)
- Sequential file upload bottleneck
- No EXIF-based search/filter (range queries)
- Upload processing has no progress visibility
- No manual photo ordering within topics
- No bulk download/export
- EXIF Artist/Copyright fields missing (DEFERRED-01 from cycle 1 run 2)
- Downloaded JPEG EXIF metadata stripped (DEFERRED-02 from cycle 1 run 2)
- JPEG download serving derivative not original (DEFERRED-03 from cycle 1 run 2)
- "Uncalibrated" color space display (DEFERRED-05 from cycle 1 run 2)

---

## SECURITY

No security findings. The codebase maintains excellent security posture:
- All admin actions verify auth + same-origin
- Input sanitization is thorough (control chars, unicode formatting, length)
- Rate limiting is layered (in-memory + DB-backed)
- Privacy fields properly excluded from public queries with compile-time guards
- File upload validation covers path traversal, symlinks, decompression bombs

---

## OVERALL ASSESSMENT

After 47+ prior review cycles, the codebase is exceptionally mature. The review surface is largely exhausted — no new correctness bugs, security issues, or high-severity findings were identified. The two low-severity findings are optimizations that have been previously identified and deferred.