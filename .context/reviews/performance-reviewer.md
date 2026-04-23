# Performance Review — Cycle 1 (leader-validated)

## Scope and inventory covered
Reviewed the current HEAD across public route entrypoints, shared-link/shared-group entrypoints, the photo viewer, related helpers, and the current test surface. This file is leader-authored because an exact `perf-reviewer` agent is not registered in this environment; findings below were validated directly against the current code.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### PERF1-01 — Photo/share entrypoints still serialize independent cached reads on the request hot path
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:25-29,41,68`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:33-46,84-95`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:28-40,95-97`
- **Why it is a problem:** These routes wait for `getImageCached()` / `getImageByShareKeyCached()` / `getSharedGroupCached()` before starting other cacheable reads such as `getGalleryConfig()`, and the shared-photo/shared-group metadata functions also serialize locale/translation/SEO fetches instead of overlapping them.
- **Concrete failure scenario:** Cold photo/share requests pay extra DB/cache round trips before the first byte, which is especially noticeable on OG crawlers and direct shared-link visits where only one request is made.
- **Suggested fix:** Start locale/translation/SEO/config reads in `Promise.all` groups as early as possible, then only keep the truly data-dependent steps sequential.

### PERF1-02 — Photo viewer JPEG fallback bypasses configured derivatives and can download the largest asset unnecessarily
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-viewer.tsx:179-223`
- **Why it is a problem:** When AVIF/WebP is unavailable (or when one derivative family is missing), the viewer falls back to `image.filename_jpeg` without `srcSet`/`sizes`, which points at the largest processed JPEG rather than the closest configured derivative.
- **Concrete failure scenario:** A browser or intermediary that ignores the AVIF/WebP `<source>` tags downloads a 4096px-class JPEG even when the viewport only needs a 1536px-class image, increasing transfer size and delaying LCP.
- **Suggested fix:** Use configured JPEG derivatives for the fallback path too — ideally via `srcSet` + `sizes`, or at minimum via a nearest-sized fallback URL.

## Final sweep
Validated that the previously reported exact-multiple infinite-scroll issue is already fixed in the current checkout (`loadMoreImages()` now returns `{ images, hasMore }` and the unit tests cover the terminal-page contract), so it is intentionally excluded from this cycle's performance findings.
