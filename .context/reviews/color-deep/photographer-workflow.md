# GalleryKit — Photographer Workflow Review
## Color Journey: Camera to Viewer

**Reviewer perspective**: working professional photographer delivering to clients and end-viewers via GalleryKit.  
**Premise**: photos arrive post-cull, post-edit. This review covers delivery only: upload → display → share.  
**Companion reading**: `pro-photog/workflow.md` covers IPTC, RAW formats, watermarking, culling, and plugin gaps that are out of scope here but remain blocking for many pros.

---

## What GalleryKit Actually Does to Color Today

Before the persona walk-throughs, it helps to state the pipeline precisely, because the behavior differs significantly from what photographers typically assume "upload a JPEG and serve it" means.

**Upload → processing** (`apps/web/src/lib/process-image.ts`):

1. Sharp reads the original, calls `metadata()` to extract the ICC profile buffer.
2. `extractIccProfileName()` parses the ICC `desc` tag from the binary buffer (lines 498–555).
3. `resolveAvifIccProfile()` decides the AVIF output profile: `p3` if the source is Display P3 / P3-D65 / DCI-P3; `p3-from-wide` if Adobe RGB / ProPhoto / Rec.2020; `srgb` otherwise (lines 468–496).
4. `processImageFormats()` fans out to AVIF + WebP + JPEG in parallel:
   - **AVIF**: `pipelineColorspace('rgb16')` for wide-gamut sources, then `.toColorspace(avifIcc).withIccProfile(avifIcc)`, 10-bit when the build supports it (lines 759–820).
   - **WebP**: `.toColorspace(targetIcc).withIccProfile(targetIcc)`, P3-tagged when the source is P3 (lines 773–781).
   - **JPEG**: same P3/sRGB decision as WebP, 4:4:4 chroma for wide-gamut (lines 823–837).
5. `detectColorSignals()` records `color_primaries`, `transfer_function`, `is_hdr`, and `matrix_coefficients` in the DB for UI and future HDR delivery.

**What is NOT done**:
- No HDR gain-map extraction or delivery (HEIF MPF structure stripped on decode).
- No CICP signaling in served AVIF files (deferred, tracked as US-CM12 in code comments).
- No tone-mapping or EDR conversion for PQ/HLG inputs.
- No WebP HDR path (WebP Extended Format supports 10-bit HDR in theory but Sharp does not surface it).
- No display-calibration awareness for the viewer side.

**Delivery** (`apps/web/src/components/photo-viewer.tsx`, lines 398–423):

```html
<picture>
  <source type="image/avif" srcSet="...AVIF variants..." />
  <source type="image/webp" srcSet="...WebP variants..." />
  <img src="...JPEG fallback..." />
</picture>
```

The browser picks AVIF if supported (Chrome 85+, Firefox 93+, Safari 16+), WebP as first fallback (Chrome 32+, Firefox 65+, Safari 14+), then JPEG. AVIF and WebP may carry P3 ICC if the source was P3 or wider. JPEG is P3-tagged for wide-gamut sources too (post US-CM02 change). All four format paths are SDR; no browser-HDR AVIF path exists today.

---

## Persona Matrix

| Persona | Source gamut | Source transfer | Upload format | AVIF served | WebP served | JPEG served | HDR intent preserved |
|---|---|---|---|---|---|---|---|
| iPhone P3 + HDR shooter | Display P3 | PQ (HEIF nclx) | HEIF/HEIC | P3, SDR | P3, SDR | P3, SDR | **No — gain map stripped** |
| DSLR Adobe RGB enthusiast | Adobe RGB | Gamma 2.2 | JPEG | P3 (converted from AdobeRGB) | P3 (converted) | P3 (converted) | N/A |
| Lightroom ProPhoto pro | ProPhoto / sRGB web export | sRGB or Gamma 1.8 | JPEG (sRGB export) or JPEG (ProPhoto export) | sRGB or P3-from-wide | sRGB or P3 | sRGB or P3 | N/A |
| Capture One commercial pro | Varies (sRGB / P3 / AdobeRGB) | sRGB / Gamma 2.2 | JPEG or TIFF | sRGB / P3 / P3-from-wide | same | same | N/A |
| Wedding / portrait photographer | Display P3 (LR export) | sRGB | JPEG | P3 | P3 | P3 | N/A |
| Landscape / fine-art photographer | Rec.2020 or ProPhoto | PQ or sRGB | TIFF or JPEG | P3 (converted from Rec.2020) | P3 | P3 | **No — PQ stripped; SDR P3 only** |

---

## Persona 1 — iPhone P3 + HDR Shooter

**Capture step**: iPhone 15 Pro, Photographic Styles active. "HDR" mode on. The device captures a 10-bit HEIF with a Display P3 color primaries ICC, a PQ (SMPTE ST 2084) transfer function in the nclx box, and an HDR gain map as a secondary image in the MPF structure. The gain map carries `hdrgm:GainMapVersion` in XMP. Viewing the original on the iPhone 15 Pro screen shows extended highlight detail: the sky blows to pure white on an sRGB display but blooms naturally on an EDR-capable screen.

**Edit step**: minimal — crop and style adjustment in Lightroom Mobile, exported as HEIF Display P3 + PQ. The export preserves the gain map.

**Upload step**: GalleryKit accepts `.heif` (in `ALLOWED_EXTENSIONS`, `process-image.ts` line 109). Sharp reads the HEIF. `detectColorSignals()` runs `parseCicpFromHeif()` on the first 1 MB of the file (`color-detection.ts`, lines 246–261), which does find the nclx box, decodes primaries = 12 (P3-D65), transfer = 13 (PQ). So `colorSignals.isHdr = true` is stored in the DB. So far so good.

**The failure mode**: Sharp's `sharp.avif()` / `sharp.jpeg()` decode path reads the HDR HEIF by tone-mapping or simply ignoring the gain map. The MPF secondary image (the gain-map layer) is discarded. The 10-bit PQ values in the base image are rendered by libvips' default display-referred pipeline, which effectively treats PQ as if it were standard sRGB gamma. The result is a slightly overexposed-looking flat SDR image. The AVIF derivative carries P3 ICC (`color_primaries = 'p3-d65'` from the nclx parse) but the pixel values are wrong: they are the PQ-encoded values decoded through an incorrect transfer curve, not a proper tone-mapped SDR rendering.

**Delivery step**: An iPhone 15 Pro visitor loading the gallery sees the AVIF served with P3 ICC. Safari applies its normal P3 rendering. But the highlight bloom that made the photo dramatic on the original is gone, replaced by blown-out whites. The saturation appears higher than the photographer intended (because PQ-encoded values near peak white, when decoded as sRGB gamma, produce values above 1.0 that the browser clips to white in a different way than the HDR tone-mapping path would).

**What is lost**: The entire HDR gain-map story. The photographer uploaded a photo that looks spectacular on any HDR-capable display; every viewer receives a flat SDR render. The DB knows `is_hdr = true` but no code path acts on that fact for serving.

**Code evidence**: `process-image.ts` line 592 — the Sharp constructor uses default decode options. No `--hdr` flag, no gain-map-aware decode. The `_hdr.avif` filename pattern referenced in `photo-viewer.tsx` lines 213–225 (the HDR AVIF download check via HEAD request) implies a future path but the pipeline never generates a file matching that pattern. `hdrExists` is always `false` in practice today.

**Alternative comparison**: Pixieset serves the original HEIC on download (preserving the gain map) but does not deliver HDR-specific web formats. SmugMug on iOS Safari can deliver HEIC natively for Safari users (preserving the gain map end-to-end on Apple devices). PhotoShelter delivers originals as purchased assets. GalleryKit falls between these: it processes more aggressively (always transcoding) and loses the gain map without offering the original as a free download.

---

## Persona 2 — DSLR Adobe RGB Enthusiast

**Capture step**: Sony A7R V or Canon R5, in-camera JPEG with Adobe RGB color space. The EXIF `ColorSpace` tag is 65535 (Uncalibrated). The JPEG has an embedded `Adobe RGB (1998)` ICC profile.

**Edit step**: Lightroom selects, possibly an exposure tweak, exported as JPEG with embedded Adobe RGB ICC.

**Upload step**: `extractIccProfileName()` parses the ICC and returns `"Adobe RGB (1998)"`. `resolveAvifIccProfile()` returns `'p3-from-wide'` (line 485). `resolveColorPipelineDecision()` returns `'srgb-from-adobergb'` (line 425).

**Processing**: The AVIF pipeline path uses `pipelineColorspace('rgb16')` (wide-gamut path triggered by `isWideGamutSource = true`), then `toColorspace('p3').withIccProfile('p3')`. So the AVIF derivative is a genuine P3-gamut image with the Adobe RGB pixels converted to P3 pixel values. WebP and JPEG follow the same logic: `targetIcc = 'p3'`, so those derivatives are also P3-tagged. `color_primaries` stored in DB is `'adobergb'` (from the detection step, not the pipeline decision), `transfer_function` is `'gamma22'`.

**Delivery step**: Chrome on an Android phone picks AVIF, displays P3. A P3-capable screen (most 2022+ flagship Android and all iPhone 12+, all MacBooks) renders the full Adobe RGB saturation mapped into the P3 gamut — which covers roughly 90% of Adobe RGB. A Windows laptop with an sRGB display receives P3-tagged AVIF; the browser (Chrome on Windows) tries ICC-managed display; if the OS display profile is sRGB, Chrome color-manages the P3 values to sRGB and the result is accurate but with a slight saturation reduction for the out-of-sRGB-gamut colors. Firefox on the same Windows machine also ICC-manages. An old browser that ignores ICC profiles (IE 11, very old Safari) would render the P3 values through the sRGB gamma and the photo would appear modestly oversaturated.

**What is preserved**: Most of the Adobe RGB saturation advantage, mapped to P3. This is better than the previous behavior (pre-CM-CRIT-1 fix) which embedded P3 ICC over unconverted Adobe RGB pixel values — that was actively wrong. The current behavior is a known trade-off: some Adobe RGB colors (particularly certain greens) that fall outside P3 are clipped to the P3 gamut boundary.

**What is lost**: The ~10% of Adobe RGB that exceeds P3. A highly-saturated forest green or certain cyan-green foliage tones from a 45-megapixel file will be subtly desaturated in the P3-clipped AVIF. The original Adobe RGB JPEG, which the photographer intended as their deliverable, is not available for the viewer to download for free — the download button offers a JPEG which is now P3-tagged, not Adobe RGB.

**The DB `color_space` field confusion**: The EXIF tag `ColorSpace = 65535` is stored as `'Uncalibrated'` in `images.color_space` (from `extractExifForDb`, `process-image.ts` lines 1007–1018). The info panel shows `Color Space: Uncalibrated`. Simultaneously `color_primaries = 'adobergb'` and `icc_profile_name = 'Adobe RGB (1998)'` are stored elsewhere. The viewer who clicks the Info panel sees `Uncalibrated` and has no idea the photo is actually Adobe RGB. The `P3` badge in the info panel appears because the `gamut-p3-badge` logic checks `image.color_space.toLowerCase().includes('p3')` — which is false for `'Uncalibrated'`. So no P3 badge shows even though the AVIF is P3-tagged. The "Color Details" section (`photo-viewer.tsx` line 816) does show `Color Primaries: Adobe RGB` but only when the user expands that collapsible section.

**Alternative comparison**: SmugMug serves the original uploaded JPEG to the viewer unchanged (no format conversion), so an Adobe RGB JPEG stays Adobe RGB in the browser, with the well-known caveat that browsers which ignore ICC profiles render it as oversaturated sRGB. Pixieset does the same. PhotoShelter does the same for public gallery viewing. GalleryKit's active conversion is more technically correct for the majority of users but introduces the gamut-clipping trade-off and the `Uncalibrated` label confusion.

---

## Persona 3 — Lightroom ProPhoto Pro

**Capture step**: Sony A1, captures RAW. Lightroom default working space is ProPhoto RGB internally. Two export scenarios:

- **Scenario A — archive export**: JPEG with embedded ProPhoto ICC profile. This is uncommon for web delivery but some photographers do it for archive purposes, sending the "web" and "archive" to the same folder before upload.
- **Scenario B — web export**: JPEG with sRGB ICC (the correct practice for web delivery). The photographer explicitly chose sRGB in the LR Export dialog.
- **Scenario C — the mistake**: JPEG exported from LR with Display P3 ICC (Lightroom added Display P3 as an export option in LR 12; some photographers use it for web thinking "wider gamut is better").

**Scenario A — ProPhoto JPEG upload**:

`extractIccProfileName()` returns `"ProPhoto RGB"` or `"ROMM RGB"`. `resolveAvifIccProfile()` returns `'p3-from-wide'`. The pipeline runs `pipelineColorspace('rgb16')` and converts to P3. The result is a P3-gamut AVIF. The conversion from ProPhoto to P3 involves large gamut clipping: ProPhoto RGB covers roughly twice the area of sRGB in the CIE diagram; P3 is only about 25% larger than sRGB. All the highly-saturated colors in the LR ProPhoto working space that live in the outer ProPhoto gamut but outside P3 are clipped. This includes a very common failure: bright greens shot in a rainforest, certain pure sunset reds in the low-saturation ProPhoto encoding. The result is not visually catastrophic — most real-world colors are inside P3 — but a technically-minded photographer who exports ProPhoto specifically to preserve maximum saturation will find their photo subtly less saturated in the gallery than when viewed locally in LR with a P3-calibrated display.

**Scenario B — sRGB JPEG**: pipeline returns `'srgb'`, AVIF is sRGB-tagged, WebP and JPEG are sRGB. Correct and lossless for the intended web delivery. This is the best-case path.

**Scenario C — Display P3 JPEG**: `resolveAvifIccProfile()` returns `'p3'` (exact P3 match). No conversion needed. AVIF, WebP, JPEG are all P3-tagged. A P3-capable viewer sees the full intent. An sRGB-only viewer's browser color-manages the P3 values to sRGB, slightly reducing saturation for out-of-sRGB colors. This is the correct and expected behavior; the photographer made a good choice.

**What the photographer can verify**: The "Color Details" section in the info panel shows `Color Primaries: ProPhoto RGB` and `Transfer Function: Gamma 1.8` for Scenario A. The `color_pipeline_decision` stored in the DB (`srgb-from-prophoto` or `p3-from-wide`, depending on pipeline version) is not surfaced to the user anywhere in the UI. There is no message that says "your ProPhoto export was converted to P3 for web delivery." The photographer has no way to know from the gallery UI alone that this conversion happened.

**Alternative comparison**: LR's own web gallery feature (deprecated) would serve the original file unchanged. SmugMug / Pixieset serve the ProPhoto JPEG as-is; old browsers misrender it as saturated (the historical ProPhoto-on-web problem), but modern color-managed browsers handle it correctly. GalleryKit's active conversion to P3 is arguably better UX for the average viewer while still being a silent surprise to the technically-aware photographer.

---

## Persona 4 — Capture One Commercial Pro

**Capture step**: Phase One IQ4, Canon R5, or Fuji GFX. Capture One is the preferred tool for commercial/fashion/still-life because of its tethering quality and per-camera color profiles.

**Export scenarios**: Capture One's output profile dialog offers sRGB, Adobe RGB, Display P3, and any installed custom ICC. Commercial pros export:
- sRGB TIFF/JPEG for digital-use deliverables.
- Adobe RGB TIFF for prepress/print deliverables.
- Display P3 JPEG for Instagram/portfolio (Capture One adds P3 export prominently in recent versions).

**Upload step — P3 JPEG from Capture One**: `extractIccProfileName()` returns `"Display P3"`. `resolveAvifIccProfile()` returns `'p3'`. Pipeline: no conversion, P3-tagged AVIF and WebP and JPEG. Color intent is fully preserved. This is the best-case persona for GalleryKit's current pipeline.

**Upload step — sRGB JPEG from Capture One**: `resolveAvifIccProfile()` returns `'srgb'`. AVIF is sRGB. Correct and clean.

**Upload step — TIFF from Capture One** (`'image/tiff'`, `.tiff` in `ALLOWED_EXTENSIONS`): Sharp reads TIFF. If the TIFF has an embedded Adobe RGB ICC, `resolveAvifIccProfile()` returns `'p3-from-wide'`, conversion to P3 proceeds. If it is a 16-bit ProPhoto TIFF, same `'p3-from-wide'` path. The `pipelineColorspace('rgb16')` flag is applied in both cases (line 769–771) which runs the resize in 16-bit space — a genuine quality benefit for the 16-bit TIFF source.

**The TIFF sizing problem**: A Phase One IQ4 150 MP TIFF (14204 × 10652 pixels, 16-bit) at ~600 MB will hit the 200 MB hard cap at `process-image.ts` line 113 and fail with `'File too large. Maximum size is 200MB'`. This is a separate issue (PP-HIGH-1 in `pro-photog/workflow.md`) but its interaction with color is significant: the commercial photographer who exports the highest-quality TIFF for maximum color fidelity is the same photographer most likely to be blocked by the size cap.

**The JPEG chroma issue**: Capture One exports JPEGs with 4:2:0 chroma subsampling by default. When the source is wide-gamut and `isWideGamutSource = true`, the pipeline overrides to 4:4:4 (`process-image.ts` line 835). This is a quality improvement. However, the reverse is also true: a sRGB Capture One JPEG might arrive with the photographer's careful 4:4:4 export (Capture One Quality 100% always uses 4:4:4) but the pipeline encodes the JPEG derivative at 4:2:0 (Sharp's default for sRGB sources). For skin tones and saturated fashion colors, this is a detectable quality loss.

**Alternative comparison**: Capture One has a native "Publish to..." workflow for services that expose an HTTP endpoint. SmugMug has a Capture One plugin. GalleryKit does not (the LR upload route is technically vendor-neutral but is not documented or integrated with Capture One's publish protocol). Color-management-wise, SmugMug accepts whatever Capture One emits and serves it unchanged; GalleryKit converts wide-gamut sources, which is better for the sRGB-display majority but silently modifies the commercial file.

---

## Persona 5 — Wedding / Portrait Photographer

**Capture step**: Canon R5, Sony A7R V, or Nikon Z8. Shooting RAW, culling in Lightroom.

**Edit step**: Lightroom Classic, exports for web delivery. Modern Lightroom defaults to "sRGB" for web export but photographers who attended a workshop in the past two years were probably told to export Display P3 for richer colors on modern screens.

**Upload**: A mixed bag. 600 photos where 400 are sRGB JPEG (the pre-2022 workflow) and 200 are Display P3 JPEG (the newer workflow). Both process correctly per their ICC. The AVIF and WebP for the P3 subset are P3-tagged; the sRGB subset is sRGB.

**Gallery delivery — the viewer's experience**:

The photographer sends the client a shared-group URL: `/g/abc123`. The client is on an iPhone 14 Pro with Safari. Safari picks AVIF. The P3-tagged AVIFs render beautifully. The sRGB-tagged AVIFs also render beautifully (sRGB is a subset of P3; no gamut expansion). The color consistency across the gallery is excellent.

A second client family member is on a 2019 Windows laptop with Chrome and an sRGB display. Chrome on Windows is ICC-color-managed since Chrome 22. The P3 AVIF is converted to the display's sRGB profile. The result is subtly less saturated than what the iPhone viewer saw, but it is color-accurate for an sRGB display. No catastrophic failure.

A third viewer is on a Pixel 8 Android phone (Display P3 screen). Chrome on Android is ICC-managed. P3 AVIF renders at full P3 saturation. This viewer sees the same richness as the iPhone viewer.

**The silent inconsistency**: The 400 sRGB photos and 200 P3 photos render with very slightly different white-balance and saturation characteristics because they were edited in Lightroom under the assumption of consistent output, but they were exported with two different color spaces. In practice this is the photographer's workflow inconsistency, not a GalleryKit bug — but the gallery has no way to flag this to the photographer, and a professional delivering a "consistent" wedding gallery implicitly expects the gallery to surface such issues.

**The proofing confidence problem**: The photographer opens the gallery on their calibrated wide-gamut iMac to verify the client is seeing the right thing. They are seeing P3 on a P3-calibrated display. The client is seeing... what exactly? GalleryKit surfaces zero information about what the viewer is likely seeing on their device. The photographer cannot tell whether the skin tones they carefully graded in LR are rendering correctly for an sRGB-display client. There is no "preview as sRGB display" mode in the gallery.

**Alternative comparison**: Pixieset's gallery viewer does not offer a proofing simulation mode either, but Pixieset serves the original JPEG unchanged, so the photographer knows exactly what bytes the client sees. SmugMug serves originals similarly. With GalleryKit's active color pipeline, the photographer can no longer say "I uploaded a JPEG; the client sees that JPEG." The pipeline is more technically correct but introduces a gap between what the photographer sent and what the viewer receives that the gallery does not explain.

---

## Persona 6 — Landscape / Fine-Art Photographer

**Capture step**: Sony A7R V or Fuji GFX 100S, RAW capture. Editing in Lightroom with a Rec.2020 or custom wide-gamut working space. Two output scenarios:

- **SDR delivery**: Export TIFF with ProPhoto or Adobe RGB ICC. Scale to web, export sRGB JPEG or P3 JPEG for the gallery.
- **HDR PQ delivery**: Export AVIF with PQ transfer function (Lightroom can do this from a Rec.2020 working space in recent versions). This is a niche workflow but represents the leading edge of "gallery-quality" web delivery.

**SDR path (ProPhoto TIFF or P3 JPEG)**: handled correctly per Personas 3–4. P3 export from LR is the recommended path for GalleryKit today.

**HDR PQ AVIF upload**: This is where GalleryKit hits a hard boundary. Sharp reads the AVIF. `detectColorSignals()` runs `parseCicpFromHeif()` — wait, the format is AVIF, not HEIF, but the code branches on `format === 'heif' || format === 'avif'` (`color-detection.ts` line 246), so the nclx parse does run. If the AVIF has a nclx box with `transfer = 13` (PQ) and `primaries = 9` (BT.2020), then `colorSignals.isHdr = true` and `transferFunction = 'pq'` is stored correctly. The DB has the right metadata.

**The delivery failure**: `processImageFormats()` receives `iccProfileName` derived from the ICC profile in the AVIF (if present). If the AVIF was encoded with a Rec.2020 ICC and PQ, `resolveAvifIccProfile()` returns `'p3-from-wide'`. The pipeline then calls `image.clone().pipelineColorspace('rgb16').resize(...).toColorspace('p3').withIccProfile('p3').avif(...)`. This is a gamut-compressed, SDR-tone-mapped (implicitly by Sharp/libvips) re-encoding of a PQ HDR source. The HDR luminance information is permanently discarded. The output AVIF is tagged P3 SDR.

This is not a bug in GalleryKit — there is no complete HDR AVIF delivery path implemented yet. The code even has a placeholder: `hdrDownloadHref` builds a `_hdr.avif` URL in `photo-viewer.tsx` line 213, and the component does a HEAD request to check existence (lines 218–226), but the processing pipeline never emits a `{uuid}_hdr.avif` file. The DB column `is_hdr = true` tells the UI that the photographer uploaded HDR content; the UI correctly shows a HDR badge (hidden via CSS media query `@media (dynamic-range: high)`) but serves SDR content.

**What the fine-art photographer ships vs. what the viewer sees**: The photographer spent hours in a specialized HDR workflow in Lightroom, calibrated their color grading on a Sony BVM-HX310 reference monitor with PQ, and uploaded a 10-bit PQ AVIF expecting a modern HDR display to render the full dynamic range. The viewer with an HDR display sees a flat SDR rendering tone-mapped to P3. The viewer with an sRGB display also sees a flat SDR rendering, slightly oversaturated because of the P3 tagging.

**Alternative comparison**: There is no commercial gallery product that currently delivers end-to-end HDR AVIF natively (as of mid-2026). SmugMug, Pixieset, and PhotoShelter all face the same limitation. Where GalleryKit is ahead: it correctly detects the HDR signal and stores it, and has the architectural placeholder for HDR AVIF delivery. Where it falls short: it does not preserve and serve the original HEIF/AVIF either, which SmugMug/PhotoShelter do via paid download (the original file is the HDR deliverable for now). GalleryKit's free download button serves a P3 SDR JPEG, not the original HDR file.

---

## Cross-Cutting Workflow Concern 7 — Sharing Workflow

The photographer pastes a photo URL in iMessage, Slack, or email. The URL resolves to `/p/{id}`. The OG image comes from `/api/og/photo/{id}` (`photo-viewer page.tsx` lines 91–94).

The OG route (`apps/web/src/app/api/og/photo/[id]/route.tsx`):

1. Fetches the nearest JPEG derivative to 1536 px via an internal HTTP request (line 103).
2. Encodes it using Satori (next/og) as a 1200×630 PNG.
3. Post-processes through Sharp: `postProcessOgImage()` applies `.toColorspace(targetIcc).withIccProfile(targetIcc)` where `targetIcc` is `'p3'` for wide-gamut sources, `'srgb'` otherwise (lines 38–45).
4. Serves as `image/jpeg`.

**The P3 OG image on iMessage/Slack/Discord**:

iMessage on iOS 16+: renders inline images through the system image decoder, which is ICC-aware. A P3-tagged JPEG in an iMessage preview renders in P3 on an iPhone 12+ screen. The photographer's wide-gamut intent is preserved in the sharing preview on Apple devices.

iMessage on macOS Messages: same — ICC-managed, P3 renders on a P3 MacBook screen.

Slack 4.20+: Slack renders link unfurls via Chromium's image pipeline. The OG JPEG is ICC-managed in Chrome. P3 renders on a P3-capable display. On Windows sRGB Slack clients, the P3 JPEG is soft-proofed to sRGB. This is technically correct behavior.

Discord: similar to Slack. Discord's embedded image viewer is Chromium-based. ICC-managed.

**The failure case**: The OG image is a JPEG generated from a JPEG. The JPEG fetched internally is a derivative already processed by the pipeline — it may already be P3-tagged. The OG route fetches it, then Satori renders it as a PNG (Satori's output is always PNG regardless of input). Satori's PNG rendering is not ICC-aware — it treats all pixel values as display-referred sRGB. When `postProcessOgImage()` then tags the resulting JPEG as P3, it is tagging a JPEG where the pixel values went through an unmanaged step (Satori rendered a P3-source image as if it were sRGB), and then the output is tagged P3. The effect is that for a wide-gamut source, the OG preview is slightly more saturated than it should be (the P3 pixel values were rendered without ICC management in Satori, then re-tagged as P3 by Sharp — a double-interpretation error).

For an sRGB source, the same Satori un-managed path is correct because sRGB pixels treated as sRGB display values produce correct output when tagged sRGB.

**The 1200×630 constraint**: OG images are always 1200×630. Landscape photos look good. Portrait photos are center-cropped (Satori's `objectFit: 'cover'`). The photographer's carefully composed portrait shot may have the subject's face cropped out of the OG preview. There is no focal-point metadata to guide the crop.

---

## Cross-Cutting Workflow Concern 8 — Download Workflow

**Free public download** (`photo-viewer.tsx`, lines 912–965):

For a free photo (no `license_tier`), the download button serves:
- For an sRGB source: the JPEG derivative, sRGB-tagged.
- For a wide-gamut source: a dropdown showing "Download sRGB JPEG" and "Download P3 AVIF" (and "Download HDR AVIF" if `hdrExists`, which it currently never does).

The "sRGB JPEG" is the `/uploads/jpeg/` derivative. This is P3-tagged for wide-gamut sources (per US-CM02). The label says "sRGB JPEG" but the file may be P3-tagged. This label mismatch is a bug. The code at `photo-viewer.tsx` line 929 generates an anchor with the `jpeg` URL but the label `t('viewer.downloadSrgbJpeg')` — for an Adobe RGB source that was converted to P3, the download is a P3 JPEG, not an sRGB JPEG.

A wedding photographer client who clicks "Download JPEG" gets a P3-tagged JPEG. They open it in Windows Photos (ICC-unaware before Windows 11 22H2). Windows Photos renders the P3 values as sRGB values — the photo looks slightly more saturated than the intended look. They upload it to their Facebook album; Facebook's image processing strips the ICC profile; the photo now looks oversaturated to everyone.

**Paid download via entitlement** (`apps/web/src/app/api/download/[imageId]/route.ts`):

After Stripe purchase, `/api/download/{id}?token=...` streams `images.filename_original` from `UPLOAD_DIR_ORIGINAL`. This is the original file as uploaded: the raw JPEG, HEIF, TIFF, or whatever the photographer uploaded. Content-Type is `application/octet-stream`. The file is served with no color space annotation in the response beyond what is in the file itself.

For a ProPhoto TIFF original: the buyer receives the ProPhoto TIFF. Fine if they know what ProPhoto is; disastrous if they open it in a color-unaware application (most consumer apps) and get oversaturated or oddly-colored output.

For a 10-bit PQ HEIF original: the buyer receives the HDR HEIF. On an iPhone they see the full HDR. On Windows they get a flat decode. No documentation in the download UX explains what color space the file is in or what application to use.

**The print workflow implication** (one sentence as promised in the brief): the free JPEG download is sized at the largest configured derivative (default 4096 px), P3-tagged for wide-gamut sources, with Sharp's default 72 DPI — a print lab that reads DPI metadata will interpret this as a low-resolution file even when the pixel dimensions are more than adequate for an 8×10 at 300 DPI.

---

## Cross-Cutting Workflow Concern 9 — Professional Review Workflow

A photographer shares a gallery URL with an art director or picture editor. The reviewer needs to see the photo as the photographer intended it.

**What the reviewer actually sees**:

- On a calibrated wide-gamut monitor (common in creative agencies): the AVIF is P3-tagged. Safari or Chrome renders it in P3. If the monitor's ICC profile is accurate, the reviewer sees the correct P3 rendering. This is the best-case scenario and it works correctly.

- On a standard office monitor (sRGB): the P3 AVIF is soft-proofed to sRGB by the browser. The saturation is subtly reduced for out-of-sRGB colors. The reviewer is seeing a color-managed version but not the full gamut the photographer intended.

- On a color-uncalibrated wide-gamut monitor (consumer laptops with NTSC-like panels but no profile): the browser may or may not use the generic profile. On macOS, ColorSync ensures accurate rendering even for uncalibrated monitors. On Windows without a display profile set, Chrome defaults to treating the display as sRGB, which means P3 values render with slight oversaturation.

**The photographer's dilemma**: There is no mechanism in the gallery to tell the reviewer "you are viewing this on an sRGB-gamut display; colors may differ from the intended P3 rendering." The `calibrationTooltip` string (`photo-viewer.tsx` line 832, key `'viewer.calibrationTooltip'`) exists — it is the tooltip on the "Color Details" expand button — but it is a single static tooltip behind a collapsible section that most reviewers will never find.

**No confidence mechanism**: The photographer cannot verify, after the fact, whether the reviewer's color rendering was accurate. The gallery stores no viewer-side display profile data. An art director who approves a photo with the wrong colors is not flagged as viewing from an sRGB-only context.

---

## Cross-Cutting Workflow Concern 10 — Calibration Awareness

The gallery currently does zero proactive calibration awareness. There is:

- A tooltip on the collapsed "Color Details" section visible only in the info sidebar (which is hidden by default on all screen sizes until the user explicitly opens it).
- An HDR badge that appears only if `@media (dynamic-range: high)` matches — a CSS-only display condition that works correctly but is invisible to the user unless they open the Color Details section.

What is absent:
- Any notification to the viewer that the photo was shot in P3 and they should use a color-managed browser.
- Any notification that the viewer's display may not be color-calibrated.
- Any "View in sRGB simulation" toggle for proofing.
- Any note that the JPEG/AVIF carries a P3 ICC profile and what that means for print.
- Any system to detect `window.matchMedia('(color-gamut: p3)')` client-side and surface a "your display supports P3 gamut" badge versus a "this photo looks best on a wide-gamut display" note for sRGB-display viewers.

SmugMug and PhotoShelter also provide zero calibration-awareness tooling. Pixieset similarly. This is an industry-wide gap, not a GalleryKit-specific failure — but because GalleryKit actively converts and tags files with wide-gamut ICC profiles (unlike the serve-original approach of competitors), the calibration gap has more practical consequence here. A photographer using SmugMug can say "I uploaded the file; you're seeing that file." A photographer using GalleryKit cannot say this: the pipeline may have color-converted the file.

---

## Cross-Cutting Workflow Concern 11 — Cross-Platform Consistency

The `<picture>` element at `photo-viewer.tsx` lines 398–423 serves different bytes to different browsers. Here is what each platform actually receives for a Display P3 source:

| Viewer platform | Format selected | ICC profile | Pixel values | Visual result |
|---|---|---|---|---|
| iPhone 15 Pro, Safari 17 | AVIF | Display P3 | P3, 10-bit | Full P3 gamut, correct |
| MacBook Air M2, Safari 17 | AVIF | Display P3 | P3, 10-bit | Full P3 gamut, correct |
| MacBook Air M2, Chrome 124 | AVIF | Display P3 | P3, 10-bit | Full P3 gamut, correct |
| iPad Pro M2, Safari | AVIF | Display P3 | P3, 10-bit | Full P3 gamut, correct |
| Pixel 8, Chrome | AVIF | Display P3 | P3, 10-bit | P3 on P3 screen, soft-proofed on sRGB screen |
| Samsung Galaxy S24, Samsung Browser | AVIF (AVIF supported) | Display P3 | P3, 10-bit | P3 on AMOLED, correct |
| Windows 11, Chrome | AVIF | Display P3 | P3 values, browser soft-proofs to display profile | Correct if display profile exists |
| Windows 11, Firefox | AVIF | Display P3 | P3 values, ICC-managed | Same as Chrome |
| Windows 10, Edge Legacy | WebP | Display P3 | P3 | Renders P3 values — may appear slightly oversaturated on sRGB screens with no ICC management |
| HDR TV (Samsung QLED, webOS browser) | JPEG (typically) | P3 or sRGB | 8-bit SDR | SDR on HDR display, no HDR benefit |
| 4K HDR TV via Chromecast | JPEG (AVIF not universal on TVs) | P3 or sRGB | 8-bit SDR | Same |

The biggest consistency problem is the Windows path without a properly set display profile. A client who opens the gallery on a freshly-installed Windows 11 machine with a generic display profile will see P3 pixel values interpreted as sRGB — a modest saturation boost that makes the image look slightly different from what the photographer intended. The client might think "this photo looks a bit punchy" and approve an image that their print lab will render with a different saturation when the actual sRGB conversion happens at print time.

For an sRGB source, all four platforms render identically. The consistency issue is specific to the wide-gamut P3 path.

---

## Cross-Cutting Workflow Concern 13 — Comparison vs. Alternatives

| Feature / behavior | GalleryKit | SmugMug | Pixieset | PhotoShelter |
|---|---|---|---|---|
| **Source file treatment** | Transcodes to AVIF+WebP+JPEG; original private | Serves original unchanged (public or gated) | Serves original; generates derivatives | Serves original as purchased asset |
| **Color conversion on upload** | Yes — wide-gamut sources converted to P3 or P3-from-wide | No — original bytes served | No — original bytes served | No — original bytes served |
| **P3 AVIF delivery** | Yes, for P3 and wider sources | No (JPEG only for most plans) | No | No |
| **HDR AVIF delivery** | No (infrastructure placeholder only) | No | No | No |
| **HDR gain map preservation** | No — stripped at upload | Yes, on paid plans (original HEIC served) | Partial (original serves gain map if HEIC served) | Yes on original download |
| **OG image color profile** | P3-tagged JPEG for wide-gamut sources | sRGB JPEG | sRGB JPEG | sRGB JPEG |
| **Free download color space** | P3-tagged JPEG for wide-gamut sources (labeled "sRGB JPEG" — mislabeled) | Original file | Original file (web preview derivative) | Not free; paid = original |
| **Paid download** | Original file streamed, `application/octet-stream` | Original file, labeled by format | Original file | Original file |
| **Calibration guidance to viewer** | Tooltip behind 2-level UI disclosure | None | None | None |
| **ProPhoto / AdobeRGB → P3 conversion** | Yes, automatic and silent | No | No | No |
| **EXIF `ColorSpace = Uncalibrated` labeling** | Shows "Uncalibrated" in UI even when ICC profile is AdobeRGB | Shows "AdobeRGB" from ICC | Shows what EXIF says | Shows what EXIF says |
| **1:1 pixel zoom for focus verification** | No | Yes (SmugMug viewer has 1:1 zoom) | Yes | Yes |

**Where GalleryKit is ahead**: The active P3 AVIF delivery path is technically more correct than serving an untagged or wrongly-tagged file. SmugMug's default of serving the original JPEG unchanged means an AdobeRGB JPEG that renders as oversaturated on color-unmanaged browsers (a real problem in the pre-ICC era). GalleryKit's conversion eliminates that class of viewer-side failure. The `color_primaries`, `transfer_function`, and `is_hdr` metadata stored in the DB is more complete than any competitor currently surfaces in a public-facing gallery.

**Where GalleryKit falls short for the photographer's workflow**:

1. Silent modification. The photographer does not know the pipeline altered their color space. There is no upload-time notification: "Your Adobe RGB JPEG was converted to Display P3 for web delivery. The original is preserved for purchase/download." One sentence of upload feedback would close this gap entirely.

2. The "sRGB JPEG" label on the download button is wrong when the JPEG is P3-tagged. This is the most user-facing color-accuracy problem in the UI today.

3. HDR gain-map loss is silently fatal for iPhone P3 + HDR photographers. The DB knows the file was HDR but nothing in the delivery path acts on that fact.

4. Paid original downloads lack a color space label in the UI. A buyer receiving a ProPhoto TIFF should know it is ProPhoto before they open it in an ICC-unaware application.

---

## Cross-Cutting Workflow Concern 14 — Photographer's Audit Story

How does a photographer today verify "the gallery is showing my photo correctly"?

**What exists**:
- The Info sidebar / bottom sheet shows camera EXIF (ISO, shutter, aperture, focal length).
- The "Color Details" collapsible shows `Color Primaries` and `Transfer Function` — these reflect the detected source signals, not the pipeline output. A photographer who opens this for an Adobe RGB upload sees "Adobe RGB" and "Gamma 2.2" — which is the source. They cannot see that the served AVIF is P3, not Adobe RGB.
- The HDR badge (`@media (dynamic-range: high)`) appears on HDR-capable displays only if `is_hdr = true` in the DB.
- The histogram (`components/histogram.tsx`) shows a channel histogram drawn from the JPEG derivative (the AVIF URL is also passed as `avifUrl` to the histogram for a possible future path, but the current histogram renders from the JPEG). The histogram is rendered on an HTML Canvas; it shows per-channel (R, G, B) histograms with no gamut overlay, no clip indicators.

**What does not exist and should**:
- A "What color space is being served?" disclosure on the photo viewer: "AVIF: Display P3 (from Adobe RGB source)" or "JPEG: P3-tagged."
- A `color_pipeline_decision` display in the info panel for admins. The `color_pipeline_decision` column exists in the DB (`schema.ts` line 53) but is never surfaced anywhere in the UI.
- A "Preview as sRGB viewer" toggle that temporarily swaps the `<source type="image/avif">` for the JPEG and desaturates to simulate an sRGB-only display.
- A per-photo color audit page (admin-only) showing: source ICC name, pipeline decision, AVIF output ICC, WebP output ICC, JPEG output ICC, `is_hdr`, nclx transfer function if present.
- Histogram clipping indicators. The histogram component (`histogram.tsx`) never highlights clipped bins.
- A "Compare: source vs. served" tool for admins, showing the original JPEG color values against the served AVIF's color values at the pixel level.

The practical audit workflow a photographer uses today: open the gallery on a calibrated MacBook with Safari → look at the photo → open the info sidebar → expand Color Details → read "Color Primaries: Adobe RGB" → trust that the P3 conversion happened correctly (no visible confirmation) → done. There is no verification step. The photographer is trusting the pipeline.

---

## Summary of Color-Specific Failure Modes by Priority

| ID | Failure | Affected personas | Evidence |
|---|---|---|---|
| CW-CRIT-1 | HDR gain map stripped at upload; `is_hdr = true` in DB but SDR-only delivery | iPhone P3+HDR, Landscape/fine-art HDR | `process-image.ts` — no gain-map-aware decode; `photo-viewer.tsx:213–226` — `hdrDownloadHref` always 404 |
| CW-CRIT-2 | "Download sRGB JPEG" label on a P3-tagged JPEG file | All wide-gamut personas | `photo-viewer.tsx:929` — `t('viewer.downloadSrgbJpeg')` used for a JPEG that may be P3-tagged |
| CW-HIGH-1 | Silent color conversion with no photographer notification at upload | Adobe RGB, ProPhoto, Rec.2020 personas | `processImageFormats()` converts to P3 without any UI feedback to uploader |
| CW-HIGH-2 | `color_pipeline_decision` stored in DB but never surfaced in UI | All | `schema.ts:53` — column exists; no component reads it |
| CW-HIGH-3 | Paid original download has no color space disclosure | All personas using paid download | `download/[imageId]/route.ts` — serves raw bytes with `Content-Type: application/octet-stream` |
| CW-HIGH-4 | OG image Satori step is not ICC-aware; P3 re-tag after unmanaged render | All wide-gamut personas sharing links | `og/photo/[id]/route.tsx:38–45` — Satori renders unmanaged, then Sharp re-tags |
| CW-MED-1 | EXIF `ColorSpace = Uncalibrated` shown in UI even when ICC profile names the actual space | DSLR AdobeRGB persona | `process-image.ts:1007–1018` — stores EXIF tag value verbatim; ICC name in separate field |
| CW-MED-2 | No viewer-side calibration awareness; client may approve wrong colors on uncalibrated display | Wedding/portrait delivery | No `window.matchMedia('(color-gamut: p3)')` detection or disclosure |
| CW-MED-3 | No CICP signaling in served AVIF files | All AVIF consumers | `process-image.ts` — `.avif()` call has no `chromaSubsampling` CICP option; US-CM12 deferred |
| CW-LOW-1 | Histogram drawn from JPEG derivative, no clip indicators | All | `histogram.tsx` — no bin-count threshold for clip highlight |
| CW-LOW-1 | No "preview as sRGB" proofing mode | All color-critical delivery | Missing feature |
