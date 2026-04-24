# Code Reviewer Review — Cycle 1

**Recovered from read-only subagent output.**

## Inventory
Reviewed 259 tracked review-relevant files: app routes, server actions, lib modules, components, DB/schema, config, scripts, unit tests, and E2E tests.

## Verification
- `npm run typecheck` passed in the review lane.
- `npm test` passed: 52/52 files, 310/310 tests.
- `npm run lint` passed.
- Final sweep covered auth/origin handling, file/command boundaries, dynamic HTML/script injection, secret patterns, rate limiting, and route revalidation.

## Findings

### CODE-001 — “Download original” actually downloads the processed JPEG derivative
- **Type:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Files/regions:** `apps/web/src/components/photo-viewer.tsx:101-103`, `apps/web/src/components/photo-viewer.tsx:550-556`, `README.md:166`
- **Problem:** The viewer builds `downloadHref` from `/uploads/jpeg/${image.filename_jpeg}` while rendering `viewer.downloadOriginal`. Public routes intentionally serve processed derivatives, not private originals.
- **Concrete failure scenario:** A user uploads HEIC/RAW/high-bit-depth source media, clicks “Download original,” and receives a converted JPEG, losing original format/fidelity while the UI says otherwise.
- **Suggested fix:** Either implement a true authorized original-download route or rename the action/filename to “Download JPEG” / `photo-<id>.jpg` and reserve “original” for the private source asset.

### CODE-002 — Sitemap silently drops older photos after 24,000 images
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/sitemap.ts:14-17`, `apps/web/src/app/sitemap.ts:19-23`, `apps/web/src/app/sitemap.ts:41-49`
- **Problem:** A single sitemap hard-caps image URLs at 24,000 before locale expansion.
- **Concrete failure scenario:** Galleries with more than 24,000 processed images omit older photo pages from `sitemap.xml`, weakening search discovery.
- **Suggested fix:** Use paginated sitemap generation / sitemap index chunks, or otherwise avoid silent truncation.

### CODE-003 — Sitemap `lastModified` churns on every request for non-image pages
- **Type:** Confirmed issue
- **Severity:** Medium
- **Confidence:** High
- **Files/regions:** `apps/web/src/app/sitemap.ts:25-35`
- **Problem:** Homepage/topic entries use `new Date()`, so unchanged pages appear modified on every sitemap generation.
- **Concrete failure scenario:** Search engines repeatedly recrawl unchanged pages and the sitemap is less cacheable.
- **Suggested fix:** Use stable persisted timestamps or omit `lastModified` where no stable signal exists.

### CODE-004 — `uploadImages` is carrying too many responsibilities
- **Type:** Likely risk
- **Severity:** Low
- **Confidence:** Medium
- **Files/regions:** `apps/web/src/app/actions/images.ts:83-347`
- **Problem:** Upload validation, quota reservation, EXIF privacy mutation, DB insert, tag linking, queue dispatch, cleanup, and audit logging are coupled in one function.
- **Concrete failure scenario:** A future change to quota/GPS/tag handling regresses an unrelated branch because the control flow is too dense.
- **Suggested fix:** Split into tested helpers with narrow contracts.

## Final sweep
No additional code-quality findings were confirmed in the review lane.
