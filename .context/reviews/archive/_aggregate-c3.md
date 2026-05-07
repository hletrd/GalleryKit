# Aggregate Review — Cycle 3 (RPF end-only)

## Review Scope
Full codebase review from a professional photographer's workflow perspective, focused on: ingest/upload UX, EXIF metadata accuracy, gallery browsing fluidity, sharing workflows, organization, search, download/export, mobile responsiveness, and workflow friction. Assumed photos arrive fully edited and culled.

## Findings

### NEW-FIXABLE-01: `formatShutterSpeed` adds 's' suffix to fractional shutter speeds
- **File**: `apps/web/src/lib/image-types.ts`, lines 69-80
- **Severity**: Low | **Confidence**: Medium
- **Description**: The function produces "1/125s" for fractional exposure times, which is non-standard photography notation. Standard convention shows fractions without an 's' suffix (e.g., "1/125") since the fraction inherently represents seconds. Only whole-second values (e.g., "1" or "30") should receive the 's' suffix to become "1s" or "30s".
- **Impact**: Every photographer viewing the EXIF panel sees non-standard notation. While not a data bug, it signals unfamiliarity with photography conventions and undermines professional credibility.
- **Fix**: Only append 's' when the value is a whole number (>= 1 and not a fraction).

### NEW-FIXABLE-02: JSON-LD exposure_time uses non-standard format
- **File**: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, line 203
- **Severity**: Low | **Confidence**: Medium
- **Description**: The structured data emits `value: "${image.exposure_time}s"` which produces "1/125s" in the JSON-LD. Schema.org `PropertyValue` for exposure time should use the rational fraction form without an 's' suffix, matching the EXIF standard.
- **Impact**: SEO crawlers and image indexing services see non-standard exposure time notation.
- **Fix**: Remove the 's' suffix from the JSON-LD value, or use the formatShutterSpeed function after fixing it.

### NEW-FIXABLE-03: Shared group gallery grid uses WebP-only instead of AVIF/WebP `<picture>` element
- **File**: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, lines 184-191
- **Severity**: Low | **Confidence**: High
- **Description**: The shared group grid view uses Next.js `<Image>` with a single WebP source URL. The homepage and photo viewer use proper `<picture>` elements with AVIF and WebP `<source>` children for format negotiation. Shared group visitors always download WebP instead of the ~30% smaller AVIF format.
- **Impact**: Shared group pages load slower than the main gallery, especially on mobile. Photographers sharing curated sets with clients get a degraded experience.
- **Fix**: Use `<picture>` with AVIF/WebP sources matching the homepage pattern.

### NEW-FIXABLE-04: `sizedImageSrcSet` has redundant `findNearestImageSize` call
- **File**: `apps/web/src/lib/image-url.ts`, lines 44-48
- **Severity**: Low | **Confidence**: High
- **Description**: Each srcSet entry maps `size` through `findNearestImageSize(imageSizes, size)`, but since `size` already comes FROM `imageSizes`, the lookup always returns `size` itself. The `w` descriptor should just use `size` directly.
- **Fix**: Replace `findNearestImageSize(imageSizes, size)` with `size`.

### DEFERRED-01: `original_format` and `original_file_size` hidden from public EXIF panel
- **File**: `apps/web/src/lib/data.ts` (publicSelectFields), `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`
- **Severity**: Low | **Confidence**: Medium
- **Description**: These fields are classified as privacy-sensitive in the compile-time guard (`_PrivacySensitiveKeys`). The EXIF panel sections for format/size silently don't render on public pages. Photographers may want visitors to see "JPEG, 24.5 MB" or "HEIC" as quality context.
- **Reason for deferral**: Requires a security review of whether exposing format type and file size to unauthenticated users creates any information-leak risk. The existing compile-time guard explicitly classifies these as sensitive.
- **Exit criterion**: Security reviewer confirms `original_format` (e.g., "JPEG") and `original_file_size` (e.g., 24500000) are safe for public exposure, then update `_PrivacySensitiveKeys` and `publicSelectFields`.

### DEFERRED-02: Admin dashboard offset-based pagination performance
- **File**: `apps/web/src/lib/data.ts` (`getAdminImagesLite`)
- **Severity**: Low | **Confidence**: Medium
- **Description**: Admin listing uses offset-based pagination while public gallery supports cursor-based. For galleries with thousands of images, deep page offsets get progressively slower.
- **Reason for deferral**: Requires UI changes to admin dashboard for cursor-based navigation. Admin dashboard is low-traffic compared to public pages.
- **Exit criterion**: Admin reports sluggish pagination at >5000 images.

## AGENT FAILURES
No agent failures — this cycle was a single-agent comprehensive review.