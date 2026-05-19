# Photographer Perspective Review — GalleryKit UI/UX (R5)

**Reviewer:** Professional photographer (color accuracy, metadata visibility, workflow efficiency)
**Date:** 2026-05-18
**Scope:** Photo viewer, color details accordion, lightbox color pip, mobile bottom sheet, masonry grid, wide gamut hint, admin settings, admin dashboard, upload flow, touch targets, accessibility, i18n
**Confidence labels:** High / Medium / Low

---

## Executive Summary

GalleryKit's photographer-visible color surface is mature and well-architected. The decision to gate color/HDR badges on `useDisplayCapability` (layered `screen.colorGamut` → MQ → conservative Firefox default) is the correct trade-off. The copy-to-clipboard JSON, Bradford tooltip, and clip-to-P3 disclosures show genuine photographer empathy. No CRIT-level issues were found. Five confirmed issues (MED–LOW) and three risks are documented below.

---

## 1. Photo Viewer Color Display

### 1.1 `<picture>` Element Gamut Delivery — CONFIRMED CORRECT
**File:** `apps/web/src/components/photo-viewer.tsx` (lines 496–530)

The `<picture>` element orders sources correctly: AVIF first (`type="image/avif"`), then WebP (`type="image/webp"`), then JPEG fallback. The `sizes` attribute uses `photoViewerSizes` derived from `getPhotoViewerImageSizes(showInfo)`, which accounts for whether the info sidebar is pinned. The responsive `srcSet` on each `<source>` maps to the configured `imageSizes`.

The JPEG fallback path (lines 462–471, `handleJpegError`) implements the R22-M1 sized-derivative → base-filename fallback, so legacy photos missing a `_1536.jpg` cleanly degrade to the base file.

**Finding:** None. The delivery chain is honest and technically sound.

### 1.2 Blur Crossfade During Navigation — CONFIRMED CORRECT
**File:** `apps/web/src/components/photo-viewer.tsx` (lines 721–751)

The blur placeholder lives on a `motion.div` **outside** `AnimatePresence` so it persists across image changes. It fades out via `animate={{ opacity: imageLoaded ? 0 : 1 }}` when `onLoad` fires on the `<img>`. A 3-second fallback timer (`setTimeout(() => setImageLoaded(true), 3000)`) catches cached images where `onLoad` may fire before the listener attaches.

**Risk (Low):** The 3-second fallback on a very slow connection could fade the blur before any pixels decode, briefly showing a blank area. This is an acceptable edge-case trade-off; no fix recommended.

### 1.3 Color Badge Gating — CONFIRMED CORRECT
**File:** `apps/web/src/components/photo-viewer.tsx` (lines 370–384), `apps/web/src/app/[locale]/globals.css` (lines 167–184)

The `gamut-p3-badge` and `hdr-badge` classes use CSS gating via `data-display-gamut` (set by `useDisplayCapability`) and `@media (dynamic-range: high)`. The `force_show_color_chips` toggle injects `:root[data-force-show-color-chips="true"]` with `!important`, overriding display detection. This is the right layering — badges are truthful by default, overridable for demos.

### 1.4 `force_show_color_chips` Discoverability — ACCEPTABLE
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (lines 243–257)

The toggle is in the "Image Processing" card, grouped with other color-impacting settings. The label "Force Show Color Chips" is slightly vague — it could be clearer that this affects the public-facing viewer, not just the admin view. However, the hint text (`settings.forceShowColorChipsHint`) explains the use case well.

---

## 2. Color Details Accordion

### 2.1 Metadata Surfacing — EXCELLENT
**File:** `apps/web/src/components/color-details-section.tsx` (lines 247–515)

The accordion surfaces: ICC profile name, primaries, transfer function, pipeline decision (admin), matrix coefficients (admin), EXIF color space (admin), source bit depth, delivered bit depth, delivered formats, downscale status (admin), HDR badge, gain map row (admin). The deduplication of ICC + primaries (`primariesMatchIccName`) avoids visual noise when both denote the same gamut.

### 2.2 Delivered Bit Depth Labels — CONFIRMED ACCURATE
**File:** `apps/web/src/components/color-details-section.tsx` (lines 424–443)

The label branches on `image.avif_10bit === true`:
- True → `10-bit AVIF (P3), 8-bit WebP/JPEG ({webpJpegGamut})`
- False → `8-bit AVIF (P3), 8-bit WebP/JPEG ({webpJpegGamut})`

This correctly tracks the per-image 10-bit probe result.

### 2.3 Copy-to-Clipboard JSON — USEFUL, MINOR GAP
**File:** `apps/web/src/components/color-details-section.tsx` (lines 218–245)

The JSON includes: `iccProfileName`, `primaries`, `transfer`, `matrix`, `decision`, `isHdr`, `hasGainMap`, `sourceBitDepth`. The omission of `pipeline_version` is documented (R10-L16) and correct — it's deploy metadata, not photographer metadata.

**Issue: `avif_10bit` missing from clipboard JSON (Low)**
- **File:** `apps/web/src/components/color-details-section.tsx` (lines 225–233), `apps/web/src/components/lightbox-color-pip.tsx` (lines 73–82)
- **Problem:** The `avif_10bit` field determines whether the visitor is seeing 10-bit or 8-bit AVIF. This is meaningful audit data when sharing "what am I looking at?" with a support forum.
- **Fix:** Add `avif10bit: image.avif_10bit ?? null` to the copied JSON in both components.

**Issue: Copy failure uses wrong i18n key (Low)**
- **File:** `apps/web/src/components/color-details-section.tsx` (line 243), `apps/web/src/components/lightbox-color-pip.tsx` (line 91)
- **Problem:** Both use `t('imageManager.copyFailed')` which reads "Group link created, but copying it failed on this browser" — a message for the share-link flow, not color metadata copy.
- **Fix:** Use `t('viewer.copyFailed')` (already defined as "Share link created, but copying it failed..." — wait, that's also wrong). Create a dedicated key `viewer.copyColorMetadataFailed`.

### 2.4 DCI-P3 Bradford Tooltip — CLEAR AND PRECISE
**File:** `apps/web/src/components/color-details-section.tsx` (lines 358–373)

The tooltip trigger (Info icon) next to the `p3-from-dcip3` pipeline label explains: "White point adapted from DCI white (0.314, 0.351) to D65 (0.3127, 0.3290) via Bradford chromatic adaptation." This is exactly the detail a photographer needs to understand why a DCI-P3 source is delivered as Display P3.

### 2.5 ProPhoto / Rec.2020 Clip-to-P3 Disclosures — CLEAR
**File:** `apps/web/src/components/color-details-section.tsx` (lines 347–351)

The amber "Clipped to P3" chip appears for `p3-from-prophoto` and `p3-from-rec2020`. The label is short but honest. Combined with the `wideGamutHintWithSource` variant that names the source gamut, photographers on P3 displays understand they're not seeing the full source gamut.

---

## 3. Lightbox Color Pip

### 3.1 Closed Pip Informativeness — GOOD
**File:** `apps/web/src/components/lightbox-color-pip.tsx` (lines 115–140)

The closed pip shows: `Display P3 · PQ · HDR-capable` (example). The text is small (text-xs) but legible against the `bg-black/70` backdrop. The `min-h-11` class gives the pip a 44 px touch target.

**Issue: Screen reader cannot access closed pip color info (Medium)**
- **File:** `apps/web/src/components/lightbox-color-pip.tsx` (line 122)
- **Problem:** The button has `aria-label={t('aria.toggleColorPip')}` ("Toggle color info"). This overrides the visual text content entirely. A screen reader user hears only "Toggle color info" and learns nothing about the photo's color space.
- **Concrete failure:** A blind photographer using a screen reader opens the lightbox and has no way to know whether the photo is sRGB, P3, or HDR without expanding the pip.
- **Fix:** Change to `aria-label={`${t('aria.toggleColorPip')}: ${primaries || ''} ${transfer || ''} ${isHdr ? t('viewer.hdrBadge') : ''}`}` or add a visually-hidden span inside the button and remove the overriding `aria-label`.

### 3.2 Expanded Panel Metadata — COMPREHENSIVE
**File:** `apps/web/src/components/lightbox-color-pip.tsx` (lines 141–267)

The expanded panel replicates the color-details-section rows: primaries, transfer, pipeline decision, delivered bit depth, delivered formats, plus a histogram and copy-to-clipboard button. The DCI-P3 Bradford tooltip is replicated here (R9-M8).

### 3.3 Histogram Compactness — ACCEPTABLE
**File:** `apps/web/src/components/lightbox-color-pip.tsx` (lines 234–245)

The histogram is wrapped in a `max-w-[200px]` container inside the panel. On a small laptop screen, 200 px is readable. The histogram is only mounted when the panel is open (lazy-mount), preventing worker spawn on the 99% path.

### 3.4 Delivered Chips Accuracy (R10-L20) — CONFIRMED CORRECT
**File:** `apps/web/src/components/lightbox-color-pip.tsx` (lines 186–228)

The delivered bit depth and format chips replicate the logic from `color-details-section.tsx` exactly, including the `forceSrgbDerivatives` branching for WebP/JPEG gamut labels.

---

## 4. Mobile Bottom Sheet

### 4.1 Peek State Informativeness — GOOD
**File:** `apps/web/src/components/info-bottom-sheet.tsx` (lines 245–287)

The peek state shows: title, camera model, capture date, and for non-trivial color photos, a color primaries chip + HDR badge (admin only). The R10-L19 color chip in the peek state is a nice touch — photographers can see at a glance that a photo has wide-gamut color without expanding the sheet.

### 4.2 Expanded Content Ordering — LOGICAL
**File:** `apps/web/src/components/info-bottom-sheet.tsx` (lines 294–535)

Order: tags → description → color details accordion → wide gamut hint → EXIF grid → histogram → capture date/time → download. This mirrors the desktop sidebar ordering. The color details appear before EXIF, which is correct — color is more photographer-relevant than camera settings for the "what am I looking at?" use case.

### 4.3 Histogram Visibility — CONFIRMED
**File:** `apps/web/src/components/info-bottom-sheet.tsx` (lines 456–469)

The histogram is rendered in the expanded state with the same priority chain (AVIF → sized JPEG → base fallback) as the desktop sidebar.

### 4.4 Download Flow — SMOOTH
**File:** `apps/web/src/components/info-bottom-sheet.tsx` (lines 487–533)

Wide-gamut sources get a dropdown with two options: sRGB JPEG and P3 AVIF. Each has a descriptive subtitle. The touch targets are `min-h-11`. On non-wide-gamut sources, a single "Download JPEG" button appears.

**Finding:** The button label uses `isP3Pipeline(image.color_pipeline_decision)` to decide between "Download (8-bit Display P3 JPEG)" and "Download JPEG". For ProPhoto/Rec.2020 sources (which deliver as P3), this correctly labels the download as P3 JPEG even though the source was wider.

---

## 5. Masonry Grid

### 5.1 Public Grid Gamut/HDR Badges (R10-H5) — PRESENT AND SIZED CORRECTLY
**File:** `apps/web/src/components/home-client.tsx` (lines 349–354)

The public masonry grid shows a `gamut-p3-badge` for wide-gamut photos. The badge has `min-h-11 min-w-11`, meeting the 44 px touch target floor. It uses `display: none` by default and only appears on P3-capable displays via the CSS `[data-display-gamut="p3"]` / `[data-display-gamut="rec2020"]` selectors.

**Issue: Masonry P3 badge lacks accessible name (Medium)**
- **File:** `apps/web/src/components/home-client.tsx` (lines 349–354)
- **Problem:** The badge `<span>` has no `role` or `aria-label`. While `display: none` removes it from the accessibility tree on sRGB displays, on P3 displays it appears in the DOM but conveys no semantic meaning to screen readers.
- **Fix:** Add `role="img" aria-label={t('viewer.colorDetailsWithGamut', { gamut: 'P3' })}` to the badge span.

### 5.2 Badge Touch Target — CONFIRMED 44 PX
**File:** `apps/web/src/components/home-client.tsx` (line 351)

The badge carries `min-h-11 min-w-11 px-2 py-1`, giving it a 44 px minimum. This is larger than the visual text requires, which is the right trade-off for touch accessibility.

### 5.3 Admin Grid Gamut Badges — PRESENT BUT INCOMPLETE
**File:** `apps/web/src/components/image-manager.tsx` (lines 491–498)

The admin table shows "P3" or "sRGB" in the Gamut column. This is useful for quick scanning.

**Issue: Admin gamut column omits HDR status (Low)**
- **File:** `apps/web/src/components/image-manager.tsx` (lines 491–498)
- **Problem:** The ImageManager's `ImageType` interface includes `color_primaries` but not `transfer_function` or `is_hdr`. The Gamut column cannot show HDR status even though the admin has access to this data.
- **Concrete scenario:** An admin uploads an iPhone HDR HEIC. The Gamut column shows "P3" but gives no indication the source was HDR-capable. The admin must open the photo viewer to see the HDR badge.
- **Fix:** Add `transfer_function` and `is_hdr` to `ImageType`, and render an HDR indicator alongside the P3 badge in the Gamut column when `is_hdr` is true.

---

## 6. Wide Gamut Hint

### 6.1 sRGB Display Visitor Informed — CORRECT AND HONEST
**File:** `apps/web/src/components/wide-gamut-hint.tsx` (lines 88–143)

The hint appears only when: `mounted && isWideGamut && isSrgbDisplay && !dismissed`. The text uses `wideGamutHintWithSource` for source-wider-than-P3 photos, naming both the delivery gamut (Display P3) and the source gamut (e.g., Rec. 2020). This is honest — it doesn't claim P3 displays show the "full" photo when the source is Rec.2020.

### 6.2 Dismissibility — WORKING
**File:** `apps/web/src/components/wide-gamut-hint.tsx` (lines 56–82)

Dismiss state is stored in `sessionStorage` keyed by `gamutFamily` (not raw `color_primaries`). This means dismissing the hint for one P3 photo suppresses it for all P3 photos in the session, but navigating to a Rec.2020 photo will re-show the hint. The per-session scope (not localStorage) is correct — the visitor may return on a different display.

### 6.3 Firefox Handling — APPROPRIATE
**File:** `apps/web/src/components/wide-gamut-hint.tsx` (lines 85–88)

Because `useDisplayCapability` returns `'srgb'` for all Firefox browsers (no `color-gamut` MQ support, and canvas-P3 probe is rejected as a false-positive source), the hint is hidden on Firefox. The documentation in `CLAUDE.md` (R10-H4) explains this trade-off: "better to hide the hint from everyone on Firefox than to nag P3-display Firefox users with an incorrect sRGB claim." This is the correct photographer-perspective decision.

---

## 7. Admin Settings

### 7.1 Color-Impacting Settings Grouping — CLEAR
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (lines 136–339)

All color/HDR settings live in the "Image Processing" card: `force_srgb_derivatives`, `allow_hdr_ingest`, `force_show_color_chips`, `wide_gamut_jpeg_chroma`, `avif_effort`, `sdr_jpeg_chroma`, `wide_gamut_max_source_pixels`. Each has a descriptive label and hint text.

### 7.2 Backfill Warning — CORRECTLY CONDITIONAL
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (lines 146–152)

The amber "Backfill required" banner appears only when `hasExistingImages && hasDirtyBackfillField`. The `COLOR_HDR_BACKFILL_KEYS` set correctly includes all encoder settings that affect existing photos' bytes. It does NOT appear for slideshow interval or auto-alt-text changes. This prevents banner fatigue.

### 7.3 Firefox Display Detection Gap Documented — PRESENT
**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (lines 259–264)

A blue informational box explicitly documents: "Firefox does not support the color-gamut media query, so gamut/HDR badges and the wide-gamut educational hint are hidden on all Firefox browsers regardless of actual display capability." This is excellent discoverability for the photographer-admin.

---

## 8. Admin Dashboard

### 8.1 Failed Images Visible with Retry — PRESENT
**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` (lines 64–103)

Failed images appear in a red-bordered section with thumbnail, error message, and a "Retry" button. The retry action calls `retryFailedImage()` and removes the image from the failed list on success.

**Issue: Retry failure gives no user feedback (Medium)**
- **File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx` (lines 46–50)
- **Problem:** When `retryFailedImage` returns an error, the code does `console.error('Retry failed:', result)` but shows no toast or UI signal. The admin clicks Retry, the button spins, and the image stays in the failed list with no explanation.
- **Concrete scenario:** An admin retries a failed image. The queue is stuck or the original file is corrupted. The admin sees no error message and doesn't know whether to check logs or try again.
- **Fix:** Add `toast.error(t('dashboard.retryFailed'))` on the error branch.

### 8.2 Color Pipeline Decision Audit — INCOMPLETE
**File:** `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`, `apps/web/src/components/image-manager.tsx`

The admin dashboard table shows a "Gamut" column (P3/sRGB) but does not show the full `color_pipeline_decision` (e.g., "P3 from ProPhoto; saturated cyans may clip"). Admins must open the individual photo viewer to audit pipeline decisions. For a photographer managing hundreds of uploads, this is a workflow inefficiency.

**Risk (Low):** Consider adding a hover tooltip or expandable row in the admin table that shows the pipeline decision and any clip warnings.

---

## 9. Upload Flow

### 9.1 HDR Rejection — CLEAR LOCALIZED ERROR
**File:** `apps/web/src/app/actions/images.ts` (lines 294–301), `apps/web/messages/en.json` (line 549), `apps/web/messages/ko.json` (line 549)

When `allowHdrIngest` is false (default) and a PQ/HLG source is detected, the upload is rejected with `t('hdrNotSupported')`. English: "HDR images (PQ/HLG) are not supported. Enable 'Allow HDR Ingest' in Settings to upload this file." Korean: "HDR 이미지(PQ/HLG)는 지원하지 않습니다. 이 파일을 업로드하려면 설정에서 'HDR 업로드 허용'을 켜세요." Both are actionable and localized.

### 9.2 Upload Quota Tracking — VISIBLE
**File:** `apps/web/src/app/actions/images.ts` (lines 183–265)

The upload tracker enforces per-IP + per-account cumulative limits. The client receives `error: t('uploadLimitReached')` when exceeded. The upload UI (`upload-dropzone.tsx`, not reviewed in depth) shows the limits in the hint text.

### 9.3 P3 Source Processing — CORRECT
**File:** `apps/web/src/app/actions/images.ts` (lines 308–312)

Wide-gamut sources exceeding 50 MP trigger `wideGamutDownscaleWarningCount`. The actual downscaling happens in the queue (`process-image.ts`), but the upload action captures the warning flag for the UI response. The `colorSignals` object (primaries, transfer, matrix, isHdr, hasGainMap) is passed to the queue job, preserving the full color metadata for the encoder decision.

---

## 10. Touch Targets

### 10.1 Confirmed 44 px+ Targets

| Element | File | Touch Target | Status |
|---------|------|-------------|--------|
| Lightbox color pip button | `lightbox-color-pip.tsx:120` | `min-h-11` (44 px) | OK |
| Color details accordion toggle | `color-details-section.tsx:262` | `min-h-[44px]` | OK |
| Calibration tooltip trigger | `color-details-section.tsx:271` | `min-h-[44px] min-w-[44px]` | OK |
| Copy color metadata button | `color-details-section.tsx:284` | `min-h-[44px] min-w-[44px]` | OK |
| DCI-P3 tooltip trigger (accordion) | `color-details-section.tsx:361` | `min-h-11 min-w-11` | OK |
| DCI-P3 tooltip trigger (lightbox) | `lightbox-color-pip.tsx:172` | `min-h-11 min-w-11` | OK |
| Histogram collapse button | `histogram.tsx:575` | `min-h-11 min-w-11` | OK |
| Histogram cycle-mode button | `histogram.tsx:662` | `min-h-11 min-w-11` | OK |
| Bottom sheet drag handle | `info-bottom-sheet.tsx:221` | `min-h-11` | OK |
| Bottom sheet close button | `info-bottom-sheet.tsx:247` | `min-h-11 min-w-11` | OK |
| Download dropdown trigger | `info-bottom-sheet.tsx:492` | `min-h-11` | OK |
| Masonry P3 badge | `home-client.tsx:351` | `min-h-11 min-w-11` | OK |
| Wide gamut hint dismiss | `wide-gamut-hint.tsx:135` | `min-h-11 min-w-11` | OK |
| Back to top button | `home-client.tsx:409` | `min-h-11 min-w-11` | OK |

### 10.2 Touch Target Audit Coverage Gap (Low/Risk)
**File:** `apps/web/src/__tests__/touch-target-audit.test.ts` (lines 39–56)

The audit scans `components/` and `app/[locale]/admin/` but does NOT scan `app/[locale]/p/` (photo viewer page) or the public masonry surfaces. While the color-related buttons in `photo-viewer.tsx` and `home-client.tsx` all appear to meet 44 px, the audit does not programmatically verify this. This is a coverage gap, not a confirmed violation.

---

## 11. Accessibility

### 11.1 HDR Badge — PROPERLY MARKED
**File:** `apps/web/src/components/color-details-section.tsx` (lines 477–485), `apps/web/src/components/lightbox-color-pip.tsx` (lines 131–138)

Both HDR badges have `role="img"` and `aria-label={t('viewer.hdrBadgeAriaLabel')}` ("HDR-capable display (SDR delivery)"). The badge is honest about SDR delivery.

### 11.2 Histogram — ACCESSIBLE
**File:** `apps/web/src/components/histogram.tsx` (lines 596–603)

The canvas has `role="img"` and `aria-label={t('aria.histogramLabel', { mode })}` which renders as "Color histogram, Luminance mode" (or RGB/Red/Green/Blue). The mode button has an `aria-label` for cycling. The key-type estimate (High-key/Low-key/Balanced) is wrapped in a tooltip for plain-language explanation.

### 11.3 Color Badges on Masonry — GAP
**File:** `apps/web/src/components/home-client.tsx` (lines 349–354)

As noted in section 5.1, the masonry P3 badge lacks `role` and `aria-label`. On P3 displays, screen reader users get a silent "P3" text with no context.

### 11.4 Color Details Keyboard Shortcuts — WORKING
**File:** `apps/web/src/components/photo-viewer.tsx` (lines 409–438)

The `c` key toggles the color details accordion (via `colorDetailsToggleRef` and `useImperativeHandle`). The `h` key cycles the histogram mode (via `histogramCycleRef`). Both shortcuts check `isEditableTarget(e)` to avoid firing while typing in an input.

---

## 12. i18n

### 12.1 Korean Color Terms — TECHNICALLY ACCURATE
**File:** `apps/web/messages/ko.json` (lines 261–376)

Key translations:
- "Color Space" → "색 공간" (correct)
- "Color primaries" → "색 재현 영역" (literally "color reproduction range" — correct technical term)
- "Transfer function" → "전달 함수" (correct)
- "Color pipeline" → "색상 파이프라인" (correct)
- "Matrix coefficients" → "행렬 계수" (correct)
- "Bit depth" → "비트 심도" (correct)
- "HDR-capable" → "HDR 지원" (correct)
- "Clipped to P3" → "P3로 클리핑" (correct)
- "sRGB preview" → "sRGB 색역 미리보기" (correct)

### 12.2 DCI-P3 Bradford Tooltip — EXCELLENT KOREAN
**File:** `apps/web/messages/ko.json` (line 359)

`"colorPipelineP3FromDcip3Tooltip": "DCI 백색점(0.314, 0.351)에서 D65(0.3127, 0.3290)로 Bradford 색채 적응을 통해 변환되었습니다."`

This is a precise, natural Korean technical sentence. "백색점" (white point) and "색채 적응" (chromatic adaptation) are the correct terms used in Korean color science literature.

### 12.3 Key-Type Terms — ACCEPTABLE TRANSLITERATIONS
**File:** `apps/web/messages/ko.json` (lines 300–305)

- "High-key" → "하이키" (transliteration)
- "Low-key" → "로우키" (transliteration)
- "Balanced" → "밸런스드" (transliteration)

These are commonly used by Korean photographers. The tooltips provide plain-language explanations in Korean, which compensates for the transliterated labels.

### 12.4 Minor: "Gamma" in Korean
**File:** `apps/web/messages/ko.json` (lines 343–344, 348–349)

- "Gamma 2.2" → "감마 2.2"
- "Gamma 2.4 (BT.1886)" → "감마 2.4 (BT.1886)"

"감마" is the standard Korean term. Correct.

---

## Commonly Missed Issues / Final Sweep

### A. `isNonTrivialColor` dead code branch in mobile bottom sheet (Low)
**File:** `apps/web/src/components/info-bottom-sheet.tsx` (lines 178–182)

The check includes `(image.color_pipeline_decision && image.color_pipeline_decision !== 'srgb')`. Since `color_pipeline_decision` is admin-only and the bottom sheet is used in both admin and public contexts, this branch is dead code for public visitors. The public `isNonTrivialColor` should only check `color_primaries` and `transfer_function` (the latter is also admin-only, so effectively just `color_primaries !== 'bt709'`).

**Impact:** None functional — dead code is harmless. But it creates a false impression that public visitors might see pipeline-based color chips.

### B. `useDisplayCapability` snapshot memoization works correctly (Confirmed)
**File:** `apps/web/src/lib/use-display-capability.ts` (lines 47–82)

The `_cachedSnapshot` module-level cache prevents the React #185 infinite render loop. The `detect()` function returns the same object reference when the underlying gamut/HDR state hasn't changed. This was a confirmed bug fix (R9-R3) and the current implementation is correct.

### C. `forced-colors: active` adjustments present (Confirmed)
**File:** `apps/web/src/app/[locale]/globals.css` (lines 187–204)

Windows High Contrast Mode overrides for `.hdr-badge`, `.gamut-p3-badge`, and `.lightbox-color-pip` are present. The badges use system `Highlight` / `HighlightText` colors. This is correct accessibility practice.

### D. `image-rendering: high-quality` on photo surfaces (Confirmed)
**File:** `apps/web/src/app/[locale]/globals.css` (lines 214–224)

The `.photo-viewer-image` and `.lightbox-image` classes get `image-rendering: high-quality` for better Lanczos-style downscaling on Safari 17.4+ and Chrome 108+. The comment correctly warns against `-webkit-optimize-contrast` (nearest-neighbor, bad for photos). The masonry grid intentionally does NOT get this rule to keep scroll-time CPU low. This is the right trade-off.

---

## Issue Summary Table

| # | Finding | Severity | Confidence | File(s) |
|---|---------|----------|------------|---------|
| 1 | Lightbox color pip aria-label overrides visual content, hiding color info from screen readers | Medium | High | `lightbox-color-pip.tsx:122` |
| 2 | Masonry P3 badge lacks `role`/`aria-label` for screen readers | Medium | High | `home-client.tsx:349-354` |
| 3 | Retry failure in admin dashboard gives no user feedback | Medium | High | `dashboard-client.tsx:46-50` |
| 4 | Color metadata copy failure uses wrong i18n key (share-link message) | Low | High | `color-details-section.tsx:243`, `lightbox-color-pip.tsx:91` |
| 5 | Clipboard JSON omits `avif_10bit` — meaningful audit data missing | Low | High | `color-details-section.tsx:225-233`, `lightbox-color-pip.tsx:73-82` |
| 6 | Admin gamut column omits HDR status | Low | Medium | `image-manager.tsx:491-498` |
| 7 | Mobile bottom sheet `isNonTrivialColor` includes dead admin-only branch | Low | High | `info-bottom-sheet.tsx:178-182` |
| 8 | Touch target audit doesn't cover public photo viewer / masonry surfaces | Low | Medium | `touch-target-audit.test.ts:39-56` |

---

## Files Reviewed

- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/color-details-section.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/wide-gamut-hint.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/lib/use-display-capability.ts`
- `apps/web/src/lib/color-primaries.ts`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
