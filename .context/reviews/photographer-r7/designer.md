# GalleryKit Color/HDR UI/UX Review — Photographer Perspective (R7)

**Reviewer:** Designer (UI/UX specialist agent)  
**Date:** 2026-05-12  
**Scope:** User-facing surfaces that communicate color information to photographers and gallery visitors  
**Components reviewed:** `photo-viewer.tsx`, `color-details-section.tsx`, `lightbox-color-pip.tsx`, `histogram.tsx`, `wide-gamut-hint.tsx`, `settings-client.tsx`, `info-bottom-sheet.tsx`, `lightbox.tsx`, `en.json`, `ko.json`

---

## Executive Summary

The color/HDR communication surface has matured significantly through cycles R3–R6. The accordion deduplication logic, source-vs-delivered bit depth pairing, Bradford adaptation tooltip, and wide-gamut display detection are all well-implemented. However, several photographer-visible gaps remain: Korean i18n contains a critical mistranslation ("wide gamma" instead of "wide gamut"), the lightbox histogram is too compact to be useful, the "sRGB clipped" wording confuses highlight clipping with gamut clipping, and public viewers miss delivered-bit-depth information because `color_pipeline_decision` is admin-only.

---

## 1. Photo Viewer Sidebar / Color Details Accordion

### Finding 1.1: Public viewers cannot see delivered bit depth — an opaque gap for the intended audience
**Confidence:** High

**DOM structure:** The `deliveredBitDepth` row (lines 302–310 in `color-details-section.tsx`) is gated on `image.color_pipeline_decision`, which is admin-only per `_PrivacySensitiveKeys` in `data.ts`. For public visitors, the accordion shows only:
- Color Space (ICC profile name)
- Color Primaries (resolved)
- Transfer Function (admin-only — hidden)
- Delivered Formats (public — visible)
- Source Bit Depth (public — visible)
- HDR badge (admin-only — hidden)

**Photographer-visible impact:** A public visitor viewing a Display P3 photo sees "Color Space: Display P3" and "Source Bit Depth: 14-bit" but has no idea whether the gallery is delivering 8-bit or 10-bit derivatives. They cannot tell if the P3 badge means anything tangible in terms of delivered quality. This undermines the photographer-intent premise.

**Suggested improvement:** Derive a public-safe `delivered_bit_depth_label` string server-side (e.g., in `data.ts` or via a derived field in the query) that does not expose the raw `color_pipeline_decision` enum but still tells the visitor "8-bit" or "10-bit AVIF / 8-bit WebP+JPEG". The label can be computed from `color_pipeline_decision` on the server and included in `publicSelectFields` as a non-sensitive derived string.

---

### Finding 1.2: Default-open behavior is intuitive for wide-gamut, but HDR auto-open is admin-only
**Confidence:** High

**DOM structure:** `isNonTrivialColor` (line 122–126) includes `(isAdmin && isHdr)` — HDR photos only auto-expand the accordion for admins. For public viewers, an HDR photo that was downconverted to SDR at ingest will show the accordion collapsed (unless it is also wide-gamut).

**Photographer-visible impact:** This is intentional per the privacy model (HDR fields are admin-only), but it creates an asymmetry: a public viewer sees a photo tagged as "Display P3" with no indication it was originally HDR. The `is_hdr` field gates the HDR badge, which is also admin-only. The public simply sees a wide-gamut photo with no HDR context.

**Suggested improvement:** Consider whether the HDR badge should be public-facing once WI-09 (HDR AVIF delivery) ships. Until then, the current behavior is honest — the gallery is not delivering HDR — but a photographer might want visitors to know the source was HDR even if delivery is SDR-only. This is a product decision, not a bug.

---

### Finding 1.3: "Color Space" vs "Color Primaries" labels are technically correct but may confuse photographers
**Confidence:** Medium

**DOM structure:** The accordion uses `"Color Space"` (`t('viewer.colorSpace')`) for the ICC profile name row and `"Color Primaries"` (`t('viewer.colorPrimaries')`) for the resolved NCLX/ICC-chromaticity row. When the two match, the deduplication logic (line 219–252) collapses them into a single "Color Space" row.

**Photographer-visible impact:** Most photographers conflate "color space" and "color primaries" in casual speech. Seeing both labels when they differ (e.g., ICC says "Adobe RGB" but primaries resolve to "BT.2020") is technically valuable but may cause head-scratching. The deduplication when they match is a good mitigation.

**Suggested improvement:** No code change needed. The deduplication logic handles the common case. For the rare mismatch case, the clarity is worth the minor confusion — photographers who upload custom profiles will appreciate seeing both values.

---

### Finding 1.4: Copy-to-clipboard exports raw JSON — useful for forums, but no human-readable alternative
**Confidence:** Low

**DOM structure:** The copy button (line 206–214) writes a JSON blob with `iccProfileName`, `primaries`, `transfer`, `matrix`, `decision`, `isHdr`, `hasGainMap`, `sourceBitDepth`, `pipelineVersion`.

**Photographer-visible impact:** For pasting into a support ticket or forum post, JSON is machine-parseable and excellent. For sharing with a client or on social media, a prose summary would be more approachable.

**Suggested improvement:** (Optional, Low priority) Add a second copy mode or format the JSON as a compact single-line summary when the target is likely social. E.g., "Display P3 · PQ · 10-bit AVIF · Pipeline v6". Not critical.

---

## 2. Lightbox Color Pip

### Finding 2.1: Expanded panel histogram is too small to be diagnostically useful
**Confidence:** High

**DOM structure:** In `lightbox-color-pip.tsx` (line 131–133), the Histogram is rendered with `className="w-full max-w-[200px]"`. The Histogram component itself uses a 240×120 canvas. The `max-w-[200px]` constraint shrinks it below its native canvas size.

**Photographer-visible impact:** A 200px-wide histogram in a semi-transparent black panel overlaid on a photo is difficult to read. Grid lines are crammed, clip indicators are barely visible, and the channel separation in RGB mode is muddled. Photographers use histograms to evaluate exposure and color balance — a 200px widget is more of a novelty than a tool.

**Suggested improvement:** Increase `max-w` to at least `280px` or remove the cap entirely and let the histogram breathe. Alternatively, render the histogram at full width (the panel already has `min-w-[180px]`) and increase the panel's minimum width to `280px`. The canvas should render at its native 240×120 resolution without CSS shrinking.

---

### Finding 2.2: Expanded panel lacks source/delivered bit depth and format chips
**Confidence:** Medium

**DOM structure:** The expanded panel (lines 102–143) shows only primaries, transfer, and pipeline decision. No `sourceBitDepth`, `deliveredBitDepth`, or `deliveredFormats`.

**Photographer-visible impact:** The lightbox is the immersive viewing mode. A photographer who opens the color pip during a portfolio review wants the full audit picture, not a subset. Missing bit depth and format info means they must exit lightbox to see the complete color story in the sidebar.

**Suggested improvement:** Add `sourceBitDepth`, `deliveredBitDepth`, and `deliveredFormats` rows to the lightbox pip panel, mirroring the sidebar accordion. Keep the layout compact (two-column flex or inline chips).

---

### Finding 2.3: Closed-state pip uses "·" separator which can wrap awkwardly on small screens
**Confidence:** Medium

**DOM structure:** The closed pip (lines 85–99) renders: `{primaries} · {transfer} · {HDR badge}`. On a narrow phone in landscape lightbox mode, this can wrap to two lines within the rounded pill.

**Photographer-visible impact:** A wrapped pill looks unpolished and reduces scannability. The HDR badge might wrap to a second line, separated from its context.

**Suggested improvement:** Add `whitespace-nowrap` to the button, or use `flex items-center gap-1.5` more explicitly. The pill already has `inline-flex` so wrapping should not happen, but verify on iPhone SE (375px width) in landscape.

---

### Finding 2.4: No keyboard shortcut indicator for the lightbox pip toggle
**Confidence:** Low

**DOM structure:** The button has `title="${t('aria.toggleColorPip')} (C)"` (line 83), which is good. But there is no visual hint that `C` toggles the pip unless the user hovers long enough for the tooltip.

**Photographer-visible impact:** Keyboard-driven workflow users (the primary audience for lightbox shortcuts) already know `C` from the sidebar shortcut hint. In lightbox, the hint is absent because the shortcuts bar is hidden. Users may forget the mapping.

**Suggested improvement:** Not critical — the title tooltip is sufficient. Power users will memorize the shortcut after a few uses.

---

## 3. Histogram

### Finding 3.1: "sRGB clipped" label conflates gamut clipping with highlight/shadow clipping
**Confidence:** High

**DOM structure:** In `histogram.tsx` (line 501): `{isClipped && <span className="ml-1 text-amber-700 font-medium">({t('viewer.histogramSrgbClipped')})</span>}`. The label is "sRGB clipped" (en) / "sRGB 클리핑" (ko). This appears next to the histogram title.

**Photographer-visible impact:** In photography vernacular, "clipped" universally means "data lost at the highlight or shadow end of the tonal range" (blown highlights or crushed blacks). "sRGB clipped" sounds like the image has blown highlights due to sRGB conversion, which is not what the label means. It actually means "the histogram data is computed from an sRGB-downsampled version of the image because your display cannot show P3 colors."

**Suggested improvement:** Rename to "sRGB preview" or "sRGB gamut preview" in English, and "sRGB 미리보기" or "sRGB 색역 미리보기" in Korean. This removes the ambiguity with highlight clipping. Alternatively, use an info icon with a tooltip instead of inline text: "Histogram reflects sRGB approximation; P3 data is not visible on this display."

---

### Finding 3.2: RGB overlay mode channel separation is hard to read at small sizes
**Confidence:** Medium

**DOM structure:** RGB mode (lines 254–274) draws all three channels with `globalAlpha = 0.5` overlaid. Each channel is normalized to the shared maximum of all three channels.

**Photographer-visible impact:** When the R, G, and B curves overlap significantly (e.g., a neutral gray image), the overlay produces a muddy brownish-gray fill that obscures individual channel shapes. Photographers looking for color casts need to cycle to individual R/G/B modes to diagnose.

**Suggested improvement:** Consider using line charts (outlines only, no fills) for RGB mode, or reduce opacity to 0.3. Filled area charts work well for single-channel modes but are suboptimal for overlay. Alternatively, keep the fill but add a subtle stroke outline in each channel color to improve edge definition.

---

### Finding 3.3: No peak-level indicator or numeric readout
**Confidence:** Low

**DOM structure:** The histogram draws normalized fills with no horizontal reference for "where is the bulk of the data."

**Photographer-visible impact:** Photographers accustomed to Lightroom or Capture One expect a mean/median indicator or a highlight on the peak bin. Without it, reading exposure bias requires visual estimation.

**Suggested improvement:** (Nice-to-have) Add a thin vertical line at the mean luminance value, or highlight the peak bin with a slightly brighter fill. This is a polish item, not a blocker.

---

### Finding 3.4: Mode cycle only goes forward — no way to cycle backward
**Confidence:** Low

**DOM structure:** `cycleMode` (line 483–488) advances `MODE_CYCLE` index by +1 modulo 5.

**Photographer-visible impact:** If a user overshoots their desired mode, they must click 4 more times to wrap around. With only 5 modes this is minor, but Shift+H or right-click to cycle backward would be ergonomic.

**Suggested improvement:** Add a `Shift+H` handler in `photo-viewer.tsx` and `lightbox.tsx` that cycles backward. Map to `aria-label` text update.

---

## 4. Wide-Gamut Hint

### Finding 4.1: Hint text is clear, well-positioned, and correctly gated
**Confidence:** High (positive finding)

**DOM structure:** `wide-gamut-hint.tsx` renders an amber banner with `bg-amber-50 text-amber-800 border border-amber-200` (light mode) / `dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40` (dark mode).

**Photographer-visible impact:** The hint is visually distinct but not alarming. The wording ("Your display shows the sRGB version of this photo. The full color gamut is available on Display P3 / wide-gamut screens.") is honest and actionable — it tells the visitor what they are missing and what they need to see the full image.

**Suggested improvement:** None. This component is well-executed. The SSR-gated mount logic (R5-H1) prevents layout shift.

---

### Finding 4.2: Hint appears below the accordion, which may be collapsed
**Confidence:** Medium

**DOM structure:** In `photo-viewer.tsx` (line 671), `<WideGamutHint>` is rendered after `<ColorDetailsSection>`. In `info-bottom-sheet.tsx` (line 290), the same ordering applies.

**Photographer-visible impact:** If the Color Details accordion is collapsed (e.g., for an sRGB photo where `isNonTrivialColor` is false), the WideGamutHint never renders because `isWideGamut` is false for sRGB sources. For wide-gamut photos, the accordion is default-open, so the hint appears below it. This is fine.

However, consider the case where a photographer manually collapses the Color Details accordion on a wide-gamut photo. The hint remains visible below. This is correct behavior — the hint should persist regardless of accordion state.

**Suggested improvement:** None. The ordering is correct.

---

## 5. Admin Settings (Color-Related Tunables)

### Finding 5.1: "SDR JPEG Chroma" label is imprecise — conflates dynamic range with gamut
**Confidence:** Medium

**DOM structure:** `settings-client.tsx` (line 254) labels the second chroma setting as `"SDR JPEG Chroma"` (`t('settings.sdrJpegChroma')`). The hint clarifies: "sRGB / non-wide-gamut JPEG derivatives."

**Photographer-visible impact:** "SDR" means Standard Dynamic Range, which is about luminance/tonality, not chroma subsampling. A photographer might reasonably ask: "Why is there an SDR chroma setting but no HDR chroma setting?" The answer is that this setting applies to sRGB/non-wide-gamut sources, which happen to also be SDR (since HDR ingest is rejected by default). But the label conflates two orthogonal concepts.

**Suggested improvement:** Rename to "sRGB JPEG Chroma" or "Standard Gamut JPEG Chroma" in English, and "sRGB JPEG 색도" or "일반 색역 JPEG 색도" in Korean. Update the hint to remove "SDR" references.

---

### Finding 5.2: No indication that chroma/effort changes require re-processing existing images
**Confidence:** Medium

**DOM structure:** The settings page shows locked fields (`image_sizes`, `strip_gps_on_upload`) with clear "locked because photos exist" messaging. But `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, and `avif_effort` are editable even when photos exist.

**Photographer-visible impact:** A photographer changes the AVIF effort from 6 to 9 and expects all existing photos to be re-encoded automatically. They are not. The change only affects new uploads. The photographer must run the backfill script manually. There is no UI indication of this.

**Suggested improvement:** Add a warning banner or inline hint below the Image Processing card when `hasExistingImages` is true: "Changes to chroma subsampling, AVIF effort, or sRGB forcing only apply to new uploads. Run the backfill script to re-encode existing images." This is especially important for `force_srgb_derivatives`, which fundamentally changes the delivery contract.

---

### Finding 5.3: "Force Show Color Chips" label uses developer terminology
**Confidence:** Low

**DOM structure:** Label: `"Force Show Color Chips"` (`t('settings.forceShowColorChips')`). Hint: "P3 gamut badge and HDR badge are always visible."

**Photographer-visible impact:** "Chips" is a UI component term, not a photography term. Photographers will understand "badge" or "indicator" more naturally.

**Suggested improvement:** Rename to "Always Show Gamut/HDR Badges" in English and "색역/HDR 배지 항상 표시" in Korean.

---

### Finding 5.4: `wide_gamut_max_source_pixels` input lacks unit suffix and context
**Confidence:** Low

**DOM structure:** The input is a raw number field (line 272–281) with `min={10000000} max={200000000} step={1000000}`. The placeholder shows the default (50000000).

**Photographer-visible impact:** Entering "50000000" is error-prone. A photographer might type "50" thinking it means 50 MP, then accidentally set the cap to 50 pixels.

**Suggested improvement:** Format the displayed value as "50,000,000 (50 MP)" or add a secondary read-only label that shows the MP equivalent. Add a custom formatter to the input that accepts "50M" or "50 MP" syntax.

---

## 6. Mobile Experience

### Finding 6.1: Bottom sheet reordering for non-trivial color is good, but sRGB photos bury the histogram
**Confidence:** Medium

**DOM structure:** In `info-bottom-sheet.tsx`, lines 295–376 show Histogram + Capture Date + Download BEFORE EXIF when `isNonTrivialColor` is true. Lines 513–594 show them AFTER EXIF for sRGB sources.

**Photographer-visible impact:** For sRGB photos, the histogram is buried at the bottom of the sheet after all EXIF data. A photographer on mobile who wants to check exposure must scroll past camera, lens, focal length, aperture, shutter, ISO, dimensions, format, white balance, metering, exposure comp, exposure program, and flash before reaching the histogram.

**Suggested improvement:** Elevate the histogram for ALL photos, not just non-trivial color ones. Exposure evaluation is equally important for sRGB and wide-gamut images. Move the histogram to immediately after the Color Details accordion (or as the first element in the expanded content), regardless of `isNonTrivialColor`.

---

### Finding 6.2: Peek state shows no color metadata — missed at-a-glance opportunity
**Confidence:** Medium

**DOM structure:** The peek state (lines 230–257) shows title, camera model, and capture date. No color primaries, no P3 badge, no HDR indicator.

**Photographer-visible impact:** On mobile, the bottom sheet opens in "peek" mode showing 140px of content. A photographer browsing a wide-gamut portfolio cannot tell at a glance which photos are P3 or HDR without expanding the sheet fully.

**Suggested improvement:** Add a compact color indicator to the peek state — e.g., a small "P3" or "HDR" pill next to the camera model, or append the primaries name to the title row. Keep it to one line.

---

### Finding 6.3: Lightbox color pip touch target is adequate but competing with swipe navigation
**Confidence:** Low

**DOM structure:** The lightbox color pip button (line 77–99) has `min-h-11` and sits at `absolute bottom-4 left-4`. The lightbox also handles swipe navigation via `handleTouchStart`/`handleTouchEnd` on the backdrop.

**Photographer-visible impact:** On a phone, the bottom-left corner is a natural resting position for the left thumb during one-handed use. A swipe-right gesture (previous photo) starting from the bottom-left might accidentally trigger the color pip instead.

**Suggested improvement:** Add `touch-action: none` or an explicit touch-start guard to the pip button so that swipe gestures originating on the pip are handled by the lightbox navigation layer, not the pip toggle. Alternatively, move the pip to the bottom-center (between the nav arrows) where it is less likely to conflict with swipe gestures.

---

## 7. i18n (English + Korean)

### Finding 7.1: CRITICAL — Korean uses "와이드 감마" (wide gamma) instead of "광색역" (wide gamut) in three settings labels
**Confidence:** High

**Affected keys:**
- `settings.wideGamutJpegChroma`: `"와이드 감마 JPEG 색도"` (should be `"광색역 JPEG 색도"`)
- `settings.wideGamutJpegChromaHint`: `"와이드 감마 JPEG 변환본의 색도 샘플링입니다."` (should be `"광색역 JPEG 변환본의 색도 샘플링입니다."`)
- `settings.wideGamutMaxSourcePixels`: `"와이드 감마 최대 원본 픽셀 수"` (should be `"광색역 최대 원본 픽셀 수"`)
- `settings.wideGamutMaxSourcePixelsHint`: contains "와이드 감마" (should be "광색역")

**Photographer-visible impact:** "감마" (gamma) and "색역" (gamut/color range) are completely different concepts in color science. A Korean photographer reading "와이드 감마" will understand "wide gamma" (e.g., gamma 1.8 vs 2.4) and will be confused about why there is a "wide gamma JPEG" setting. This mistranslation undermines professional credibility.

**Suggested improvement:** Replace every instance of "와이드 감마" with "광색역" in `ko.json`. The upload warning at `upload.wideGamutDownscaleWarning` already correctly uses "광색역" — this confirms the correct term exists in the file.

---

### Finding 7.2: "sRGB 클리핑" in Korean perpetuates the highlight-clipping ambiguity
**Confidence:** Medium

**Affected key:** `viewer.histogramSrgbClipped`: `"sRGB 클리핑"`

**Photographer-visible impact:** Same issue as Finding 3.1, compounded by the fact that "클리핑" is a borrowed English term that Korean photographers associate exclusively with highlight/shadow clipping (하이라이트 클리핑).

**Suggested improvement:** Change to `"sRGB 색역 미리보기"` (sRGB gamut preview) or `"sRGB 범위로 표시됨"` (displayed in sRGB range).

---

### Finding 7.3: "AVIF 인코딩 노력도" is awkward — "노력도" is not a standard technical term
**Confidence:** Medium

**Affected key:** `settings.avifEffort`: `"AVIF 인코딩 노력도"`

**Photographer-visible impact:** "노력도" literally means "effort degree" — it sounds like a machine-translated string. Korean photographers and developers use "품질 수준" (quality level), "압축 강도" (compression strength), or "인코딩 단계" (encoding stage).

**Suggested improvement:** Change to `"AVIF 압축 품질"` or `"AVIF 인코딩 수준"`.

---

### Finding 7.4: "색상 파이프라인" is literal but acceptable; "색상 처리 경로" would be more natural
**Confidence:** Low

**Affected key:** `viewer.colorPipelineDecision`: `"색상 파이프라인"`

**Photographer-visible impact:** "파이프라인" is widely understood in Korean tech circles, but for a photographer-facing UI, "색상 처리 경로" (color processing path) or "색상 변환 방식" (color conversion method) would feel more approachable.

**Suggested improvement:** Optional. Current term is acceptable for a technical audience. If GalleryKit targets non-technical photographers, consider softening.

---

### Finding 7.5: English "Color Pipeline" is also technical — consider softer label
**Confidence:** Low

**Affected key:** `viewer.colorPipelineDecision`: `"Color pipeline"`

**Photographer-visible impact:** Same as Finding 7.4. "Pipeline" is dev terminology. "Color conversion" or "Processing path" would be more photographer-native.

**Suggested improvement:** Optional. The current term is accurate and photographers who care about ICC profiles will understand it.

---

## Summary Table

| # | Finding | Component | Severity | Confidence |
|---|---------|-----------|----------|------------|
| 1.1 | Public viewers miss delivered bit depth | `color-details-section.tsx` | Medium | High |
| 1.2 | HDR auto-open is admin-only (by design) | `color-details-section.tsx` | Low | High |
| 2.1 | Lightbox histogram too small | `lightbox-color-pip.tsx` | Medium | High |
| 2.2 | Lightbox pip lacks bit depth / formats | `lightbox-color-pip.tsx` | Low | Medium |
| 3.1 | "sRGB clipped" confuses gamut vs highlight clipping | `histogram.tsx` | Medium | High |
| 3.2 | RGB overlay mode readability | `histogram.tsx` | Low | Medium |
| 5.1 | "SDR JPEG Chroma" conflates DR and gamut | `settings-client.tsx` | Low | Medium |
| 5.2 | No re-processing warning for existing images | `settings-client.tsx` | Medium | Medium |
| 6.1 | sRGB photos bury histogram in mobile sheet | `info-bottom-sheet.tsx` | Low | Medium |
| 6.2 | Peek state lacks color indicator | `info-bottom-sheet.tsx` | Low | Medium |
| 7.1 | **CRITICAL: "와이드 감마" → "광색역"** | `ko.json` | **High** | **High** |
| 7.2 | "sRGB 클리핑" ambiguity in Korean | `ko.json` | Medium | Medium |
| 7.3 | "AVIF 인코딩 노력도" awkwardness | `ko.json` | Low | Medium |

---

## Recommended Priority Order

1. **Fix Korean mistranslation (7.1)** — "와이드 감마" to "광색역" — this is a credibility-impacting bug.
2. **Clarify "sRGB clipped" wording (3.1 / 7.2)** — rename to "sRGB preview" in both locales.
3. **Increase lightbox histogram size (2.1)** — remove or raise `max-w-[200px]` cap.
4. **Add delivered-bit-depth for public viewers (1.1)** — derive a public-safe label server-side.
5. **Add re-processing warning in settings (5.2)** — inform photographers that changes only affect new uploads.
6. **Elevate histogram for all mobile photos (6.1)** — move histogram above EXIF regardless of color triviality.
