# Cycle 4 RPF (end-only) — Aggregate Review

## Method

Deep code review focused on professional photographer workflow: import/ingest flow, metadata handling, EXIF display, gallery browsing UX, sharing workflows, organization, search/discovery, download/export, mobile experience, and workflow friction. All relevant source files examined across 323 TypeScript files.

## Gate baseline

- `npm run lint` clean.
- `tsc --noEmit` clean.
- `npm test` 1012 passed across 118 files.
- `git status` clean on master (ignoring untracked NFS/temp files).

## Cycles 1-3 RPF carry-forward verification

All prior cycle fixes verified in code. 26 issues fixed across cycles 1-3. Focus on NEW findings not yet discovered.

## Cross-agent agreement (high-signal duplicates)

- **C4-RPF-01 (Lightbox missing `reactionsEnabled` in shared-group view)** — code-reviewer, designer, critic converge. Shared group PhotoViewer omits `reactionsEnabled` and `licensePrices` props.
- **C4-RPF-02 (JSON-LD `exifData` values not sanitized)** — code-reviewer, security-reviewer converge. `UNICODE_FORMAT_CHARS` sanitization applied to `name` and `description` in OG route but not to JSON-LD `exifData` values.
- **C4-RPF-03 (Photo viewer EXIF date/time lacks `suppressHydrationWarning`)** — code-reviewer, designer converge. EXIF date display in sidebar differs from capture-date section rendering.
- **C4-RPF-04 (Lightbox `aria-roledescription="slide"` without carousel parent)** — designer, test-engineer converge. WCAG ARIA requires parent `role="group"` with `aria-roledescription="carousel"` for slide semantics.

## Findings (severity-sorted)

### MEDIUM

#### C4-RPF-01 — Shared group PhotoViewer missing `reactionsEnabled` and `licensePrices` props

- File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:145-157`
- Reviewers: code-reviewer, designer, critic
- Severity: **Medium** | Confidence: **High**
- **What:** The shared group page passes `PhotoViewer` without `reactionsEnabled` or `licensePrices`. This means visitors to shared group pages cannot react to photos (reaction buttons are hidden), even if the admin has enabled reactions globally. The config is already fetched (`getGalleryConfig()`) but not passed through. For a photographer sharing a client gallery, this breaks the expected social interaction.
- **Fix (this cycle):** Pass `reactionsEnabled={config.reactionsEnabled}` and `licensePrices={config.licensePrices}` to the shared group's PhotoViewer component.

#### C4-RPF-02 — JSON-LD `exifData` values not sanitized against Unicode formatting chars

- File: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:198-204`
- Reviewers: code-reviewer, security-reviewer
- Severity: **Medium** | Confidence: **High**
- **What:** The OG route (`api/og/photo/[id]/route.tsx:58-60`) applies `sanitizeForOg()` (which strips `UNICODE_FORMAT_CHARS`) to the photo title and site title. However, the photo page's JSON-LD block embeds `camera_model`, `lens_model`, and other EXIF strings directly into the structured data without sanitization. While admin validation rejects these characters at write time, a defense-in-depth strip here would match the OG route's pattern and close any future gap (e.g., data imported from a raw DB restore that bypasses validation).
- **Fix (this cycle):** Apply `sanitizeForOg()` to all string EXIF values in the JSON-LD `exifData` array.

#### C4-RPF-03 — EXIF info sidebar displays date and time separately with inconsistent formatting

- File: `apps/web/src/components/photo-viewer.tsx:636-639` vs `818-828`
- Reviewers: code-reviewer, designer
- Severity: **Medium** | Confidence: **High**
- **What:** In the desktop info sidebar, the capture date appears twice:
  1. In the `CardHeader` (line 638): `formattedCaptureDate` alone, without `suppressHydrationWarning`
  2. In the `CardContent` (lines 818-828): both `formattedCaptureDate` and `formattedCaptureTime`, both with `suppressHydrationWarning`
  
  The `CardHeader` date at line 638 is missing `suppressHydrationWarning`, which means on pages with `revalidate=0`, the date could differ between SSR and client hydration (e.g., if the server's locale formatting produces a slightly different result from the client's). This creates a React hydration mismatch warning. The duplicate rendering is also confusing — a photographer would see the date shown twice in the sidebar with slightly different formatting.

- **Fix (this cycle):** Add `suppressHydrationWarning` to the `CardHeader` date span. Consider removing the duplicate date from the `CardHeader` since the `CardContent` section already shows date and time together with calendar/clock icons.

#### C4-RPF-04 — Lightbox `aria-roledescription="slide"` without carousel parent semantics

- File: `apps/web/src/components/lightbox.tsx:419`
- Reviewers: designer, test-engineer
- Severity: **Medium** | Confidence: **High**
- **What:** The `<img>` in the lightbox has `aria-roledescription="slide"` (line 419), but the parent `<picture>` element has no `role="group"` or `aria-roledescription="carousel"`. Per WAI-ARIA carousel pattern, `aria-roledescription="slide"` is only meaningful when nested inside a carousel container. Without the parent, screen readers announce "slide" as the role description of a standalone image, which is confusing. The image counter "1 / 5" is correctly set as an `aria-label` on the img.
- **Fix (this cycle):** Remove `aria-roledescription="slide"` from the img since the lightbox is a single-image dialog (not a carousel with automatic rotation that benefits from the carousel ARIA pattern). The image position is already announced via `aria-label`.

### LOW

#### C4-RPF-05 — Upload sequential processing is O(N) wall-clock time for N files

- File: `apps/web/src/components/upload-dropzone.tsx:246`
- Reviewers: perf-reviewer, critic
- Severity: **Low** | Confidence: **High**
- **What:** The client sends files one at a time in a sequential `for` loop. Each file waits for the previous file's server-side processing (EXIF extraction, DB insert, queue enqueue) to complete before the next starts. For a photographer uploading 50 wedding photos (~150MB each), this could take 10+ minutes even on a fast server. The sequential approach was chosen to avoid lock contention with the `gallerykit_upload_processing_contract` advisory lock, but the lock is per-call (not per-file), so the real bottleneck is that the server action processes files in a batch — sending them individually means N separate round-trips.
- **Defer:** Requires architectural change to either batch multiple files into a single FormData (breaking the current per-file progress UX) or implement a server-side streaming upload endpoint. The sequential approach is correct and safe; it's just slow for large batches.
- **Exit:** when upload performance becomes a documented user complaint, or when a bulk-upload API endpoint is planned.

#### C4-RPF-06 — Shared group grid uses single-size srcSet (no responsive image sizing)

- File: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:183-198`
- Reviewers: perf-reviewer, designer
- Severity: **Low** | Confidence: **Medium**
- **What:** The shared group grid uses a single `{gridImageSize}` for AVIF/WebP srcSet instead of multiple sizes. On a 4K display, the browser loads the 1536px variant even though a 640px thumbnail would suffice for the grid card. The home page grid (`home-client.tsx:220-232`) correctly uses two sizes (`smallSize` + `mediumSize`). This wastes bandwidth on shared group pages.
- **Defer:** Cosmetic perf issue; shared group pages are typically small (10-20 images). Low bandwidth impact.
- **Exit:** at next shared-group polish pass.

#### C4-RPF-07 — `decimalToRational` tolerance of 0.001 allows approximate shutter speed display

- File: `apps/web/src/lib/process-image.ts:828`
- Reviewers: code-reviewer
- Severity: **Low** | Confidence: **Medium**
- **What:** `decimalToRational` uses `Math.abs(1 / denominator - val) < 0.001` to determine if a decimal exposure time can be represented as a clean fraction. For `val = 0.008` (1/125), this works. But for `val = 0.0078` (closest to 1/128), `Math.round(1/0.0078) = 128`, and `|1/128 - 0.0078| = 0.0000125`, which passes the tolerance, yielding "1/128". While technically correct, the photographer sees "1/128" instead of "1/125" which is the standard camera-displayed value. This is an inherent limitation of the rational approximation — cameras internally use the nearest standard speed but EXIF may record the exact value.
- **Defer:** Would require a lookup table of standard shutter speeds (1/8000, 1/4000, 1/2000, 1/1000, 1/500, 1/250, 1/125, 1/60, 1/30, 1/15, 1/8, 1/4, 0.5, 1, 2, etc.) to snap to the nearest standard speed. This is a known limitation in EXIF processing.
- **Exit:** when shutter speed display accuracy becomes a documented user complaint.

#### C4-RPF-08 — OG image route fetches JPEG via localhost HTTP (potential self-fetch failure)

- File: `apps/web/src/app/api/og/photo/[id]/route.tsx:66-73`
- Reviewers: architect, tracer
- Severity: **Low** | Confidence: **Medium**
- **What:** The OG route constructs the photo URL as `${origin}/uploads/jpeg/${jpegFilename}` and fetches it via `fetch(photoUrl)`. The `origin` is derived from `new URL(req.url).origin`. In a Docker standalone deployment behind a reverse proxy, `req.url` may contain the internal port (e.g., `http://localhost:3000`), which works. However, if the reverse proxy rewrites the Host header or if the app is behind a load balancer with a different internal URL, the self-fetch could fail. The fallback (redirect to site OG image) handles this gracefully.
- **Defer:** The fallback response already covers this edge case. A fix would require fetching the file directly from disk instead of via HTTP, which would bypass Next.js's static file serving pipeline.
- **Exit:** when first deployment misconfiguration is reported where OG images consistently show the fallback.

### INFORMATIONAL

#### C4-RPF-09 — `formatShutterSpeed` applies `s` suffix to non-standard decimal values

- File: `apps/web/src/lib/image-types.ts:74-88`
- Reviewers: code-reviewer
- Severity: **Informational** | Confidence: **High**
- **What:** When `exposureTime` is a string like "0.3" (not parseable to a clean fraction), `formatShutterSpeed` returns "0.3s". This is correct behavior — the `s` suffix clarifies it's a whole-second value. Just documenting the intended behavior.

#### C4-RPF-10 — Photo viewer upload button shows file count but not estimated time remaining

- File: `apps/web/src/components/upload-dropzone.tsx:366-381`
- Reviewers: critic
- Severity: **Informational** | Confidence: **High**
- **What:** The progress bar shows percentage and count but not estimated time remaining. For large batches, a photographer has no way to know if the upload will take 2 minutes or 20 minutes. This is a UX nicety, not a bug.

## Disposition completeness check

Every finding is accounted for:
- Scheduled in plan: C4-RPF-01..04 (fix this cycle)
- Deferred: C4-RPF-05..08 (with exit criteria)
- Informational: C4-RPF-09..10 (documentation only)
- Cycles 1-3 carry-forward: verified in code; nothing silently dropped.

## AGENT FAILURES

None.

## Summary

Cycle 4 RPF surfaces 4 fixable issues from a professional photographer's perspective: a shared-group page that silently hides reactions despite admin enabling them, unsanitized JSON-LD EXIF values (missing the defense-in-depth the OG route already applies), a hydration-mismatch-prone duplicate EXIF date rendering, and an incorrect `aria-roledescription="slide"` without carousel semantics. The remaining 4 deferred items are low-severity performance/polish issues with clear exit criteria. The codebase is in excellent shape for photographer workflows after cycles 1-3's 26 fixes — remaining gaps are minor UX polish rather than correctness bugs.