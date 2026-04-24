# Performance Review — Cycle 1 (2026-04-24)

## Scope and inventory covered
Reviewed the data/query layer, pagination paths, image cleanup, upload/processing pipeline, and the photo-viewer/admin client interactions across the repository. Focused on CPU, memory, I/O, caching, SSR/ISR, queueing, and browser responsiveness.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 2
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### PERF1-01 — Exact counts are computed on the hot path for both public galleries and admin pagination
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files:** `apps/web/src/lib/data.ts:253-276`, `apps/web/src/lib/data.ts:359-385`, `apps/web/src/app/[locale]/(public)/page.tsx:108-159`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:121-159`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:14-23`
- **Why it is a problem:** Public gallery pages compute `COUNT(*) OVER()` inside the paginated query, and the admin dashboard separately runs `COUNT(*)` over the full `images` table. Both are exact counts on request paths that are already doing sorting, tag resolution, and SSR/ISR work. On a growing library, this turns simple page renders into table-wide scans.
- **Concrete failure scenario:** A gallery with tens of thousands of images starts serving noticeably slower homepage/topic renders and admin dashboard reloads because every request pays for a full count pass before HTML can stream. The public pages also combine that count with per-row tag-name subqueries, so the cost grows with the page size as well as the library size.
- **Suggested fix:** Move exact counts off the hot path. Options: maintain a denormalized image-count record updated on mutation, cache counts separately from the rendered page, or stop showing exact totals in the initial render and fetch them asynchronously.

### PERF1-02 — Single and bulk image deletes rescan upload directories once per file
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Files:** `apps/web/src/lib/process-image.ts:165-204`, `apps/web/src/app/actions/images.ts:411-419`, `apps/web/src/app/actions/images.ts:517-535`
- **Why it is a problem:** `deleteImageVariants(..., [])` falls into the legacy-variant directory scan path. The single-delete path calls it for WebP/AVIF/JPEG on every delete, and the bulk-delete path does the same inside a per-image loop. That means each request can walk the entire upload directory multiple times just to remove derivative files.
- **Concrete failure scenario:** An admin bulk-deletes 100 images from a gallery with thousands of derivatives per format. The request performs 300 directory scans before it finishes, monopolizing I/O and keeping the server action open far longer than the DB delete itself.
- **Suggested fix:** Scan each derivative directory once per request, not once per image, or separate legacy cleanup into a background maintenance sweep. If the current configured sizes are known, pass them directly and reserve the `[]` legacy-scan mode for a rare one-time repair job.

## Likely Issues

### PERF1-03 — Zoomed photo interaction does layout reads on every pointer move
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Files:** `apps/web/src/components/image-zoom.tsx:24-39`, `apps/web/src/components/image-zoom.tsx:86-95`
- **Why it is a problem:** Both mouse and touch drag handlers call `getBoundingClientRect()` on every move event and immediately write a new transform. That is a classic layout-read/layout-write loop on the main thread, and it runs while the user is actively interacting with the photo.
- **Concrete failure scenario:** On a laptop trackpad or phone, dragging around a zoomed photo stutters because the browser keeps recomputing layout bounds before applying the next transform. The effect becomes more visible on slower CPUs or when the page is already busy decoding the image.
- **Suggested fix:** Cache the element bounds when zoom starts, refresh them only on resize/zoom-entry, and throttle pointer updates through `requestAnimationFrame` so the DOM write happens at most once per frame.

### PERF1-04 — Every admin-tag combobox mounts its own filter work and outside-click listener
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Files:** `apps/web/src/components/tag-input.tsx:51-68`, `apps/web/src/components/tag-input.tsx:127-141`, `apps/web/src/components/image-manager.tsx:359-429`
- **Why it is a problem:** Each `TagInput` instance filters the full available tag list, repeatedly normalizes tag names, and installs a document-level mousedown listener. The admin image manager renders one of these per row, so the work scales with the number of visible images even though the user is typically editing only one row at a time.
- **Concrete failure scenario:** On the dashboard, a 50-row page with a few hundred tags feels sluggish to open and to edit because every mounted combobox pays the filtering/listener cost up front. Typing into one row also leaves dozens of other listeners active and ready to run on every click.
- **Suggested fix:** Mount the combobox only for the active row, or centralize the tag picker so the normalization/filtering data and outside-click handling are shared instead of duplicated per row.

## Final sweep
No additional perf-critical files surfaced beyond the hot-path counts, directory-scan cleanup, and the interaction-heavy photo/admin widgets above.
