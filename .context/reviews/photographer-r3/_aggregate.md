# Photographer-Perspective Review R3 — Aggregate

**Date:** 2026-05-08
**Reviewer perspective:** professional photographer + end-user-workflow.
**Premise (per task brief):** photos arrive AFTER culling/refinement/editing. The product's job is to deliver the photographer's intent — gamut, tonality, dynamic range — to every viewer's display, on every supported browser, AS THE PHOTOGRAPHER INTENDED. **No edit / culling / scoring features.**

**Per-angle reviews (this directory):**

| File | Angle | Length |
|---|---|---|
| `color-fidelity.md` | Color science + wide-gamut delivery (P3, AdobeRGB, ProPhoto, Rec.2020) + browser/display matrix | long |
| `hdr-workflow.md` | HDR intake, detection, delivery state, badges, downloads, CICP signaling | long |
| `internal-formats.md` | AVIF/WebP/JPEG bit-depth, ICC embedding, compression, encoder paths | medium |
| `ui-ux-photographer.md` | Information architecture, accordion behavior, lightbox, mobile bottom sheet, photographer audit ergonomics | long |

---

## State of the codebase (2026-05-08)

Plans 34-37 have largely shipped. Spot checks confirmed:

- `IMAGE_PIPELINE_VERSION = 5` in `process-image.ts:109`.
- `colr` ISOBMFF parser is correct (`color-detection.ts:156-220`): Box not FullBox, walks `meta`/`iprp`/`ipco`, bounded depth/scan.
- NCLX maps match ITU-T H.273 (`color-detection.ts:125-147`): primaries 11=DCI-P3, 12=P3-D65; transfer 13=sRGB, 16=PQ, 18=HLG.
- ICC parser consolidated in `icc-extractor.ts` with `mluc` UTF-16BE.
- `color_space` column now stores the EXIF tag value (`'sRGB'`/`'Uncalibrated'`); `icc_profile_name` holds the ICC description (`process-image.ts:975-986`, `actions/images.ts:333-339`).
- `color_pipeline_decision` returns `p3-from-{adobergb,prophoto,rec2020}` for the Phase 2 sources; humanizer + download-label gate match (`process-image.ts:407-432`, `color-details-section.tsx:32-43`, `photo-viewer.tsx:834`).
- DCI-P3 path skips `pipelineColorspace('rgb16')` so the Bradford D65 adaptation in `toColorspace('p3')` works on the source ICC (`process-image.ts:732-737`).
- Wide-gamut sources >50 MP downscale before fan-out (`process-image.ts:660-677`).
- Sharp shared-state hardened: `rgb16` path uses a fresh `sharp(processingInputPath, …)` per format (`process-image.ts:733-737`).
- `force_srgb_derivatives` admin toggle wired through `image-queue.ts:296-321` → `processImageFormats(…, forceSrgbDerivatives)` (only affects WebP/JPEG; admin help text is honest about this).
- HDR `<picture><source media="(dynamic-range: high)">` element has been **removed** from `photo-viewer.tsx`, `lightbox.tsx`, `home-client.tsx` (no per-image `is_hdr` check, no `_hdr.avif` srcSet emission). Good — closes the pre-launch landmine flagged in plan-37 A4.
- OG route always emits sRGB JPEG (no P3 over sRGB-clipped pixels).
- Color details accordion has `aria-expanded`/`aria-controls`, sibling-button calibration tooltip, focus-visible rings, forced-colors mode.
- `color_pipeline_decision` is admin-only via `_PrivacySensitiveKeys` compile-time guard.
- ColorDetailsSection is rendered in BOTH the desktop sidebar and the mobile bottom sheet.

The codebase is now in much better shape than R2 found it. The R3 findings below are NEW — surfaced by reading the code as it is today, against the photographer-intent premise.

---

## Severity-rated summary (R3)

| Severity | Count | Items |
|---|---|---|
| **CRIT** | 4 | R3-C1 HDR download menu still serves 404 `_hdr.avif`; R3-C2 PQ/HLG sources pass through libheif decoded as raw RGB (silent miscolor); R3-C3 WebP/JPEG wide-gamut path skips rgb16 pipeline (gamma-space conversion); R3-C4 `is_hdr` exposed publicly without HDR delivery (false promise) |
| **HIGH** | 7 | R3-H1 wide-gamut → P3 uses default relative-colorimetric clip (no soft-rolloff for AdobeRGB/ProPhoto/Rec.2020 source); R3-H2 lightbox/fullscreen mode has no color metadata surface; R3-H3 ColorDetails accordion collapsed by default (photographer's audit hidden); R3-H4 histogram has no clip / over-exposure markers / 99th-percentile indicator; R3-H5 bit_depth field shows source depth, not delivered; R3-H6 `(P3)` and `(HDR)` chips invisible on non-P3/non-HDR displays even for photographer demoing to client; R3-H7 Firefox `(color-gamut: p3)` MQ false-negative blocks histogram canvas-P3 path |
| **MED** | 8 | R3-M1 EXIF panel headline shows ICC name only, primaries hidden; R3-M2 P3 chip / sRGB-clipped indicator below WCAG 4.5:1 contrast; R3-M3 AdobeRGB/ProPhoto/Rec.2020 source delivers P3 AVIF (good) but P3 *WebP* via 8-bit gamma-space (bad); R3-M4 no "delivered formats" surface (which variants actually shipped); R3-M5 no Korean translation for `transferFunction` / `colorPrimaries`; R3-M6 download menu has no descriptive preview ("what is HDR AVIF?"); R3-M7 mobile bottom sheet expanded layout is multi-screen scroll; R3-M8 `display: inline-flex !important` on `.hdr-badge` is a sledgehammer |
| **LOW** | 9 | R3-L1 missing per-image "show all metadata regardless of display capability" admin toggle; R3-L2 download-original is not exposed in UI; R3-L3 no soft-proof / target-display preview; R3-L4 calibration tooltip body text is dense; R3-L5 admin-only re-process from UI; R3-L6 keyboard shortcut `c` for color details; R3-L7 histogram height fixed at 120 px; R3-L8 EXIF panel doesn't show EXIF `ColorSpace` tag value alongside ICC name; R3-L9 `bit_depth` schema column has no soft-cap / 8/10/12/14/16 enum |

Convergent findings (≥2 angle reviews) are bolded in the per-angle files.

---

## Convergent findings — what every angle agrees is broken

### R3-C1 — HDR download menu still serves a 404 `_hdr.avif` URL ✓✓✓

**Reviewers:** color-fidelity (CF-CRIT-1), hdr-workflow (HW-CRIT-1), ui-ux-photographer (UX-CRIT-1).

**Code:**
- `photo-viewer.tsx:189-190` — `hdrAvifFilename = filename_avif.replace(/\.avif$/i, '_hdr.avif')`; `hdrDownloadHref` constructed unconditionally.
- `photo-viewer.tsx:859-869` — gated only on `image?.is_hdr && hdrDownloadHref`. **No file-existence check.**

**Effect:** for any photo with `is_hdr === true`, the dropdown shows a "Download HDR AVIF" item that points to a URL the encoder never wrote. Click → 404. `_hdr.avif` files **do not exist** anywhere on disk; WI-09 is deferred.

This is exactly the same landmine that plan-37 A4 closed for the inline `<picture> <source media="dynamic-range:high">` element — relocated unfixed to the download dropdown.

After A1 (NCLX map fix) and the cicp-recheck backfill have run, **genuine PQ ProRAW** rows have `is_hdr=true` legitimately. iPhone HEIC false-positives have been corrected. So today the dropdown 404s for the small set of users who legitimately have HDR sources — the exact audience this product is supposed to serve well.

**Mobile bottom-sheet** mirrors only two of the three download menu items (`info-bottom-sheet.tsx:471-490`) — it actually OMITS the HDR item. So the desktop user sees the broken option; the mobile user is silently better-off but inconsistently. Either way: download UI is misaligned with delivery reality.

**Severity:** CRIT. Photographer's audit story breaks at the moment the photographer wants to download their genuine HDR source.

---

### R3-C2 — Genuine PQ / HLG sources are decoded as raw 8/16-bit RGB (silent miscolor) ✓✓

**Reviewers:** color-fidelity (CF-CRIT-2), hdr-workflow (HW-CRIT-2).

**Code path:**
1. `color-detection.ts:228-288` — correctly detects `transferFunction = 'pq'` or `'hlg'` and `isHdr = true` from CICP nclx.
2. `process-image.ts:684-867` `processImageFormats` — does not branch on `isHdr`. PQ/HLG sources go through the standard `image.clone().resize()` or `sharp(processingInputPath).pipelineColorspace('rgb16').resize()` path.
3. Sharp / libvips / libheif decoder for HEIF reads PQ-encoded code values into RGB pixel buffers. **Without applying the inverse PQ EOTF.** The buffer is then encoded as P3 (or sRGB) AVIF/WebP/JPEG, which interprets the values as gamma-2.2 / sRGB.

**Effect:** PQ pixel `0.5` (≈ 100 nits in scene-linear) ≠ sRGB pixel `0.5` (≈ 18 % gray). The encoder treats PQ values as if they were already gamma-encoded. Result: shadows lift unnaturally, midtones look cyan/magenta-shifted, highlights crush. The output AVIF embeds Display P3 ICC over malformed pixel values.

A photographer who shoots PQ ProRAW on iPhone 15 Pro and uploads the file expects "the photographer's intent of the photo accurately reflected in the output." Today they get a wrong-tonality SDR that's labeled P3. **No test fixture exercises this end-to-end; the breakage is invisible to the test suite.**

**Severity:** CRIT — silent miscolor on the exact source class the schema is designed to recognize.

**Fix shape:** EITHER (a) reject HDR sources at upload until WI-09 (HDR encoder) lands, with a clear error message; OR (b) apply BT.2390 / ACES tonemap from PQ → SDR before encoding (Sharp lacks `tonemap_bt2390`; would need an avifenc shell-out or a manual JS curve). Option (a) is honest; option (b) is the eventual product. Today neither is implemented.

---

### R3-C3 — WebP / JPEG wide-gamut path skips `pipelineColorspace('rgb16')` ✓✓

**Reviewers:** color-fidelity (CF-CRIT-3), internal-formats (IF-HIGH-1).

**Code:** `process-image.ts:732-804`.

**The split:**
```ts
const needsRgb16 = isWideGamutSource && !isDciP3;
const base = needsRgb16
    ? sharp(processingInputPath, { … }).pipelineColorspace('rgb16').resize({ width: resizeWidth })
    : image.clone().resize({ width: resizeWidth });

if (format === 'webp') {
    await base.toColorspace(targetIcc).withIccProfile(targetIcc).webp({…})
} else if (format === 'avif') {
    await base.toColorspace(avifIcc).withIccProfile(avifIcc).avif({…})
} else {
    await base.toColorspace(targetIcc).withIccProfile(targetIcc).jpeg({…})
}
```

`base` is computed once, BUT `needsRgb16` switches the entire `base` between rgb16-decoded vs. clone-of-shared-image. This means **all three formats** share the same `base`. The intent is that AVIF (which uses `avifIcc='p3'`) gets the rgb16 quality. But WebP / JPEG also use `targetIcc='p3'` (when `forceSrgbDerivatives` is false) — which means they ride the same rgb16 base and are also high-quality.

So far so good. But examine: when source is wide-gamut and NOT DCI-P3, `needsRgb16=true`, ALL three formats use `pipelineColorspace('rgb16')`. Is that right?

- AVIF: `toColorspace('p3').withIccProfile('p3').avif({bitdepth: 10})` — gets full benefit. ✓
- WebP: `toColorspace('p3').withIccProfile('p3').webp({quality: 90})` — encodes 8-bit gamma-space P3 from rgb16 linear. WebP doesn't support 10-bit; the rgb16 → 8-bit gamma quantization is fine since the encoder downsamples cleanly. ✓ Quality is preserved within WebP's 8-bit ceiling.
- JPEG: `toColorspace('p3').withIccProfile('p3').jpeg({quality: 90, chromaSubsampling: '4:4:4'})` — same as WebP, 8-bit gamma. ✓ With 4:4:4 chroma the full hue is preserved.

**OK — actually the rgb16 path is shared. So the "split" concern is wrong; all three formats benefit.** ✓

**Where the real concern lives:** `isDciP3` source (`needsRgb16=false`). DCI-P3 goes through `image.clone().resize()` which inherits the shared decoded buffer. Since the source ICC is DCI-P3 with the DCI white point (0.314, 0.351), the call `toColorspace('p3').withIccProfile('p3')` does the LCMS Bradford adaptation to D65. Per WI-12 + the existing test fixture this is mathematically correct (mean ΔE = 0).

**But:** `image` is the **PARENT** Sharp instance from `process-image.ts:684`. Three parallel `Promise.all` clones (`generateForFormat('webp', …)`, `…('avif', …)`, `…('jpeg', …)`) all call `image.clone()`. With `failOn:'error', sequentialRead:true, autoOrient:true` these are independent operation pipelines, and `clone()` reuses the decoded buffer per Sharp's documented contract — **but does not share `pipelineColorspace`/`toColorspace` state**. WI-14 already addressed shared state in the rgb16 path. ✓

**The actual finding is narrower:** when `forceSrgbDerivatives=true` AND source is wide-gamut AND NOT DCI-P3, AVIF still emits P3 (`avifIcc='p3'`) but WebP/JPEG go to sRGB (`targetIcc='srgb'`). Photographer expects "force sRGB" to apply to AVIF too — the help text is explicit ("AVIF variants always carry their original gamut"), but in a paranoid e-commerce / stock context the toggle name is misleading.

**Downgrade severity to MED:** CF-MED-1 (renamed to R3-M3 above). The CRIT is overcalled on this one — re-reading the code, the rgb16 path covers all three formats. The remaining gap is the AVIF-vs-WebP/JPEG behavior split under `force_srgb_derivatives`, which is intentional but mislabeled.

**Net:** R3-C3 is **MED**, not CRIT. Reclassified.

---

### R3-C4 — `is_hdr` is exposed publicly while HDR is never delivered ✓✓✓

**Reviewers:** color-fidelity (CF-HIGH-3), hdr-workflow (HW-CRIT-3), ui-ux-photographer (UX-HIGH-1).

**Code:**
- `data.ts:217` — `is_hdr` is in `adminSelectFields`.
- `data.ts:312` — `_omitColorPipelineDecision` removes only `color_pipeline_decision` from public fields. `is_hdr` is NOT omitted.
- `data.ts:314` — `publicSelectFields = …adminSelectFields without { latitude, longitude, … }`. `is_hdr` flows through.
- `color-details-section.tsx:130-141` — public renders the HDR badge whenever `image.is_hdr === true`.
- `globals.css:172-173` — badge is gated on `@media (dynamic-range: high)`, so on non-HDR displays it's hidden.

**Effect chain:**
1. Genuine PQ ProRAW iPhone shot uploaded.
2. Encoder (R3-C2) decodes PQ as raw RGB → emits SDR P3 AVIF with malformed pixels.
3. DB row has `is_hdr = true`.
4. Visitor with iPhone 15 Pro (HDR display) sees the HDR badge in the EXIF panel.
5. Photo bytes are SDR — no HDR variant exists.
6. Visitor sees "HDR" tag, malformed-tonality SDR image. **The badge promises something the delivery never fulfills.**

This is the false-promise version of the R2 false-positive HDR-badge bug. R2 fixed the NCLX map (so iPhone HEIC isn't false-positive HDR anymore). But for the small set of legitimately-HDR sources, the badge now correctly *fires*, while the actual delivery is still SDR-tonemapped-by-accident. **The R2 fix made this finding sharper, not better.**

Two coherent product directions:

**Direction A (honest):** treat `is_hdr` as INTERNAL ONLY (admin select). Public never sees the badge. Photographer & admin see the badge as "this source IS HDR; we deliver it tonemapped to SDR until WI-09 ships." Rejects the false promise.

**Direction B (eventually-correct):** ship WI-09 (HDR encoder via avifenc) + the `<picture> media="(dynamic-range: high)"` source. Then the badge is honest: HDR display visitors get HDR pixels, SDR display visitors get the tonemapped SDR. **Today the public side is half-shipped: the badge UI exists, the delivery does not.**

**Severity:** CRIT — the photographer's intent of HDR photography is silently mis-represented to viewers.

---

## Single-reviewer findings worth surfacing

### From color-fidelity.md

- **CF-HIGH-1** — AdobeRGB / ProPhoto / Rec.2020 → P3 path uses Sharp's default rendering intent (relative colorimetric without BPC). Saturated greens / cyans clip hard. Documented in the resolver comment as "may clip" but the photographer-intent of those colors is silently lost. Soft-rolloff (CIECAM02 / perceptual) is deferred (WI-13).
- **CF-HIGH-2** — `bit_depth` reported in EXIF panel is the SOURCE depth (8/10/12/14/16), not the DELIVERED depth (8 for sRGB AVIF/WebP/JPEG, 10 for wide-gamut AVIF, never 12+). Photographer reads "16-bit" expecting 16-bit delivery; the AVIF caps at 10-bit. The EXIF row is misleading.
- **CF-MED-2** — No surface for "your display cannot show this photo's full saturation." Wide-gamut photo displayed on a sRGB screen is silently sRGB-clipped by the browser; no hint to the visitor or photographer that "additional saturation is available — upgrade your display / browser."
- **CF-MED-3** — DCI-P3 source (rare in stills) gets correct Bradford adaptation, but the audit label says "P3 (from DCI-P3)" — accurate but jargon-heavy. Photographer wants "DCI-P3 cinema source mastered to home P3" or similar plain language.

### From hdr-workflow.md

- **HW-HIGH-1** — `transfer_function` and `matrix_coefficients` schema columns exist but are detected only via NCLX. ICC-only HDR profiles (PQ-as-ICC, e.g. some pro mastering exports) fall through to the heuristic which checks `desc.includes('pq')` — fragile, name-based.
- **HW-HIGH-2** — No fallback HDR display surface for legitimate HDR uploads. A photographer who shoots HLG on Sony / Canon / Nikon and uploads a tagged HEIF gets `is_hdr=true` but no encoded delivery → C2 silent miscolor. Plus no warning at upload time.
- **HW-MED-1** — HDR badge styling is `bg-amber-100 text-amber-700` light, `bg-amber-900/30 text-amber-300` dark. On non-HDR displays the badge is hidden (correct), but on HDR displays the muted amber doesn't read as "this is special." Vendors like Apple Photos / SmugMug use a high-contrast pill or a dynamic gradient.

### From internal-formats.md

- **IF-HIGH-2** — `_hdr.avif` filename convention is hard-coded in the photo viewer (`replace(/\.avif$/i, '_hdr.avif')`) — not a constant, not a helper. Any future filename-scheme change has to find every replace site. Fragile.
- **IF-MED-1** — Sharp's `withIccProfile('p3')` ships Apple's Display P3 ICC. For DCI-P3 source post-Bradford, the ICC tag is therefore Display P3, not DCI-P3 — correct (since white-point is now D65), but the *audit decision label* says "p3-from-dcip3" which can confuse. Match the label to delivered profile, not source-tagged-as-source.
- **IF-MED-2** — JPEG variants always emit `chromaSubsampling: '4:4:4'` for wide-gamut sources. File-size cost is +20-30% vs `4:2:0`. Correct for color fidelity but no admin override.
- **IF-LOW-1** — AVIF `effort: 6` is documented. Encode time difference between effort 4 vs 6 on a 4096-wide is ~1 s vs ~2.5 s. For a personal gallery this is fine. For an operator with a 10k-photo backlog, exposing this as an admin setting would be helpful.

### From ui-ux-photographer.md

- **UX-HIGH-2** — Lightbox / fullscreen mode has zero color metadata UI. The lightbox is when the photographer is most likely to demo a photo to a client. The HDR badge / P3 chip / color pipeline are all in the `Card` sidebar, hidden behind the lightbox backdrop.
- **UX-HIGH-3** — ColorDetailsSection accordion defaults to **collapsed**. For a serious photographer, the color audit IS the headline metadata. Defaulting to collapsed pushes the photographer's intent below "f/8, ISO 100" clutter.
- **UX-HIGH-4** — Histogram has no clip indicators (top/bottom blink, 0/255 markers, % below black / % above white) and no per-channel maxima callout. Pro-grade tools (RawTherapee, darktable, Capture One) ALL have clip blink. Today our histogram is read-only-decoration; the photographer cannot use it to verify exposure intent.
- **UX-MED-1** — `(P3)` chip in EXIF panel and `Color details` accordion duplicate the gamut signal. Two surfaces for the same data.
- **UX-MED-2** — Mobile bottom sheet expanded layout: Tags + Description + EXIF grid + ColorDetails + Histogram + capture date + Download dropdown is 2-3 viewport heights inside a draggable sheet. Drag-while-scrolling can accidentally collapse.
- **UX-MED-3** — Korean translations missing for `transferFunction` and `colorPrimaries` row labels, and `forceSrgbDerivativesHint` admin tooltip body. Korean photographers see English-fallback prose.
- **UX-MED-4** — Color details "Color Space" + "Color primaries" deduplication via `primariesMatchIcc` is string-toLowerCase-equality. For "Display P3" vs "Display P3 - ACES" vs "P3-D65" the strings differ; deduplication fails, both render. Edge case but visible on test fixtures.
- **UX-LOW-1** — No keyboard shortcut for the Color Details accordion. `i` toggles info, `f` toggles lightbox; `c` is unbound.

---

## What is correct (do not change)

Verified against the photographer-intent premise:

- ETag formula `W/"v${IMAGE_PIPELINE_VERSION}-${mtime}-${size}"` invalidates correctly on encoder change.
- DCI-P3 → Display P3 Bradford adaptation: mathematically correct (ΔE = 0 on CC24 per WI-12 test fixture).
- Strict P3 allowlist in `resolveAvifIccProfile`: photographer-tagged P3 sources stay P3; ICC-name strings parsed from `desc` and `mluc`.
- `force_srgb_derivatives` admin escape hatch for legacy embedders.
- 4:4:4 chroma subsampling for wide-gamut JPEG (preserves the saturated hues that 4:2:0 would smear).
- 10-bit AVIF on capable Sharp builds, with lazy probe + 8-bit fallback.
- `colr` parser is now spec-correct (Box not FullBox; bounded depth/scan).
- NCLX maps match ITU-T H.273.
- ICC `mluc` parsed as UTF-16BE (not the legacy ASCII bug).
- `color_space` column now stores EXIF tag, `icc_profile_name` stores ICC description.
- `color_pipeline_decision` is admin-only via compile-time guard.
- HDR `<picture> <source media="(dynamic-range: high)">` is **deleted** until WI-09 lands (no 404 landmine on the inline path; only the download menu has the residual landmine).
- Calibration tooltip is a sibling button with proper a11y (focus-visible, keyboard-reachable, screen-reader announced).
- Forced-colors mode rules for `.hdr-badge` and `.gamut-p3-badge`.
- HDR badge gated on `@media (dynamic-range: high)` so visitors with SDR displays don't see a misleading promise.
- Histogram cached AVIF probe at module scope — no double-fetch per nav.
- `pipelineColorspace('rgb16')` skipped for DCI-P3 to preserve source ICC for the Bradford transform.
- 50 MP wide-gamut source downscale before fan-out (memory pressure mitigation).

---

## Recommended next steps

The companion plan `.context/plans/38-photographer-r3-followup.md` orders work as:

1. **R3-C1** — close the HDR download dropdown landmine. Either gate on real `hdr_variant_exists` column, or hide the menu item entirely until WI-09 ships. CRIT.
2. **R3-C2** — make HDR ingest honest: at upload, either auto-tonemap PQ/HLG to SDR (avifenc shell-out OR JS BT.2390 curve) or reject with a "HDR delivery not available; export as SDR P3 first" error. CRIT.
3. **R3-C4** — make `is_hdr` admin-only (move to admin select fields, drop from public) until WI-09 lands. Public HDR badge silently disappears for now. Can be flipped back when delivery is honest.
4. **R3-H1** — soft-rolloff (CIECAM02 / perceptual intent) for AdobeRGB/ProPhoto/Rec.2020 → P3, gated behind admin opt-in due to LCMS2 dependency.
5. **R3-H2** — surface the color metadata in lightbox / fullscreen (HDR pip, P3 pip, tap to expand).
6. **R3-H3** — open ColorDetails by default for wide-gamut and HDR sources.
7. **R3-H4** — histogram clip indicators (top/bottom blink, % below black / % above white, 0/255 grid).
8. **R3-H5** — distinguish "source bit depth" from "delivered bit depth" in the EXIF panel.
9. **R3-H6** — admin opt-in to show `(P3)` / `(HDR)` chips regardless of display capability.
10. **R3-H7** — replace `_cachedSupportsCanvasP3` MQ check with a runtime canvas-P3 feature probe so Firefox + P3 display works.
11. **R3-M\*** / **R3-L\*** — polish bundle (Korean translations, deduplication strings, mobile sheet IA, etc.).

Items 1-3 are the critical path. Items 4-10 are HIGH-impact ergonomics. The plan file has acceptance criteria and rollback for each.

---

## Open product questions

These need answers before any of the items above land:

1. **Direction A vs B for HDR.** Direction A (admin-only `is_hdr` until WI-09) is honest and ships today. Direction B (full HDR encoder + delivery) is months. Recommendation: **A now, B later** — the badge can be re-enabled when delivery catches up.

2. **PQ/HLG ingest behavior.** Reject + error message vs. auto-tonemap on upload? Reject is honest but loses the photo; auto-tonemap is best-effort but requires implementation of BT.2390 / ACES. Recommendation: **reject with clear error message** until WI-09 lands.

3. **Soft-rolloff for AdobeRGB/ProPhoto/Rec.2020 → P3.** Gated behind LCMS2 binding (pure-JS fallback exists but slow). Recommendation: **defer to WI-13 (already out of scope per plan-36)**; document the clip in the audit label as "may clip."

4. **Color details default state.** Always-open vs. open-only-for-wide-gamut/HDR vs. user-pinned across sessions? Recommendation: **open by default for HDR or wide-gamut sources**; otherwise collapsed.

5. **Histogram pixel dimensions.** 240×120 today. Pro tools use 256×200+. Recommendation: **height bump to 160 px** with proportional clip-indicator strip below.

6. **Korean phrasing for `transferFunction`.** "전달 함수" (literal) vs "감마 / HDR 표현 방식" (descriptive)? Recommendation: **descriptive** for non-pro audience.

7. **Lightbox color pip placement.** Bottom-left corner (matches the "1 / 12" position indicator) vs. top-right vs. fade-in-on-hover? Recommendation: **bottom-left, fade in on mouse move**.

---

## Reference

- `.context/reviews/photographer-r3/color-fidelity.md` — color science + wide-gamut + browser/display compatibility matrix.
- `.context/reviews/photographer-r3/hdr-workflow.md` — HDR ingest, detection, delivery state, badges, downloads, CICP.
- `.context/reviews/photographer-r3/internal-formats.md` — AVIF/WebP/JPEG bit-depth, ICC embedding, encoder paths.
- `.context/reviews/photographer-r3/ui-ux-photographer.md` — info architecture, accordion, lightbox, mobile, photographer audit ergonomics.
- `.context/plans/38-photographer-r3-followup.md` — companion plan with phased fixes.
- Predecessor plans/reviews retained: 34, 35, 36, 37; `.context/reviews/{color-deep,color-r2,ui-ux-r2,pro-photog,color-mgmt}/`.
