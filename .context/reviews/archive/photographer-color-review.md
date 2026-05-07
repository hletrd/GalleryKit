# GalleryKit — Professional Photographer's Color Review

**Date:** 2026-05-07
**Scope:** Color reproduction, ICC profile management, HDR workflow, internal color formats, wide gamut coverage, browser color support.
**Audience:** Engineering team + product reviewer.
**Premise:** Photos arrive at GalleryKit fully culled, refined, and edited. The job is to deliver the photographer's intended look to every viewer's display without drift, regardless of source gamut, transfer function, or downstream client.

---

## Executive Summary

GalleryKit's encode chain is meaningfully more correct than most self-hosted galleries. Strict P3 detection, per-format ICC tagging, 16-bit linear-light resize for wide gamut, 10-bit AVIF for wide gamut, and atomic `IMAGE_PIPELINE_VERSION`-bound cache invalidation form a strong baseline. None of those should be removed.

The gaps that actually affect a photographer's intent cluster into three workstreams:

| # | Workstream | Severity | Impact |
|---|------------|----------|--------|
| 1 | **HDR delivery** | High | HDR sources (PQ, HLG) are silently flattened to SDR. The display-layer `(dynamic-range: high)` flag is wired but unused. |
| 2 | **Wide-gamut beyond AVIF** | High | WebP and JPEG variants always sRGB. AVIF-less clients (legacy Chromium-on-Linux, ancient Safari) on P3 monitors get sRGB-clipped output. |
| 3 | **Wider-than-P3 sources** | Medium | Adobe RGB, ProPhoto, and Rec.2020 sources are gamut-mapped to sRGB. They could land in Display P3 (a smaller intent loss) on AVIF-capable clients. |

Several lower-severity items round out the picture: histogram is computed from sRGB-clipped JPEG, the gratis "Download JPEG" surfaces an sRGB derivative without disclosure, no rendering-intent control exposed, OG/embed images stay SDR sRGB unconditionally, and there is no observability layer for color decisions made during encode.

This review describes the current pipeline, the color-science context that makes the gaps matter, the browser support landscape, and a phased plan in the companion document `.context/plans/34-color-management-roadmap.md`.

---

## 1. Color Theory and Workflow Context

### 1.1 Color spaces and gamuts encountered in modern photography

Photographers ship into the gallery from a wide spread of working spaces. The pipeline must route each correctly.

| Working space | Primaries | White point | Transfer | Origin / typical use |
|---|---|---|---|---|
| **sRGB / IEC 61966-2-1** | ITU-R BT.709 | D65 | sRGB OETF (~γ 2.2 piecewise) | Default web, default JPEG-out-of-camera, oldest cameras. ~35% of CIE xy. |
| **Display P3 (D65)** | DCI-P3 | D65 | sRGB OETF | iPhone since 7, iPad Pro, MacBook (2016+), iMac, modern Galaxy phones. ~45% of CIE xy. ~25% larger than sRGB. |
| **DCI-P3 (theatrical)** | DCI-P3 | DCI white (~6300 K) | DCI gamma 2.6 | Cinema. Rare in stills. |
| **Adobe RGB (1998)** | custom (wider greens than sRGB, similar reds, narrower blues than P3) | D65 | γ 2.2 | DSLR default for many bodies, prepress. ~50% of CIE xy. |
| **ProPhoto RGB (ROMM)** | custom (extends past visible blue, very wide green) | D50 | γ 1.8 piecewise | Lightroom default working space. ~90% of visible. ~13% imaginary primaries. |
| **ITU-R BT.2020 / Rec.2020** | very wide (greens past visible-monitor reach) | D65 | γ 2.4-ish or gamma + linear segment | UHD SDR, baseline for HDR carriage. ~75% of CIE xy. |
| **camera-native (RAW)** | wider than ProPhoto in many cameras | D65-ish | linear | Pre-rendering. Out of scope per premise — culling/edit happens before upload. |

Take-away: assuming "all originals are sRGB" is wrong. Display P3 originals from iPhone are now the modal case. ProPhoto and Adobe RGB show up in the curated workflow.

### 1.2 Transfer functions

| Function | Use | Notes |
|---|---|---|
| **sRGB OETF** | sRGB, P3 | Piecewise: linear segment near black, ~γ 2.4 above. |
| **γ 1.8** | ProPhoto | Different inverse needed; failing to apply it desaturates and lifts shadows. |
| **γ 2.2** | Adobe RGB | Conventionally 2.2, sometimes implemented as sRGB OETF for compatibility. |
| **PQ (SMPTE ST 2084)** | HDR10, HDR10+, Dolby Vision | Absolute luminance up to 10 000 cd/m². Encoder must signal CICP `transfer = 16`. |
| **HLG (BT.2100)** | UHD broadcast HDR | Relative-luminance HDR. CICP `transfer = 18`. Backwards-degrading on SDR displays. |

The codebase currently reads only the ICC profile name string. It does not track transfer or primaries as first-class fields. That conflates Display P3 (sRGB OETF) with DCI-P3 (gamma 2.6), and silently demotes any HDR transfer to SDR sRGB OETF.

### 1.3 HDR fundamentals

- **HDR signal**: triplet of (primaries, transfer, matrix) signaled via CICP (Coding-Independent Code Points) in the bitstream. AVIF and HEIF carry CICP natively; JPEG and WebP do not (without proprietary extensions).
- **Static HDR metadata**: SMPTE ST 2086 (mastering display max/min luminance and primaries), CTA-861 MaxCLL (max content light level), MaxFALL (max frame-average light level). Optional but improves tone mapping on displays with lower peak brightness.
- **Dynamic HDR**: HDR10+ or Dolby Vision. Per-scene metadata. Out of scope for a self-hosted gallery — encoder support is heavy.
- **Apple gain map**: HEIF / JPEG-XR side files describing per-pixel HDR boost over an SDR base. iOS-originated files often carry gain maps. Sharp does not currently emit them; libheif does not preserve them through transcode.
- **Tone mapping**: the math that compresses HDR luminance into SDR (or HDR with a lower peak). Bad tone mapping clips highlights or crushes shadows; good tone mapping preserves perceived mid-tone exposure (BT.2390 reference, Hable, ACES, etc.).

### 1.4 Image format color carriage

| Format | ICC profile | CICP | HDR transfers | Wide gamut tagging |
|---|---|---|---|---|
| **JPEG** | yes (APP2 ICC marker) | no | no (Apple's gain map is a non-standard side file) | yes via ICC |
| **PNG** | iCCP, sRGB, cHRM/gAMA chunks | no | no | yes via iCCP |
| **WebP** | yes since libwebp 1.0 (2018) | no | no | yes via ICC |
| **AVIF** | yes (`colr` box `prof`) | yes (`colr` box `nclx`) | yes (PQ, HLG via CICP) | yes via either ICC or CICP |
| **HEIF** | yes (`colr` `prof`) | yes (`colr` `nclx`) | yes (PQ, HLG via CICP) | yes |
| **TIFF** | yes (full ICC) | implementation-specific | rarely | yes |
| **JPEG-XL** | yes | yes (via JBRD or CICP-equivalent box) | yes | yes |

Take-away: AVIF is the only universally-deployed format that carries HDR cleanly today. WebP and JPEG cap at SDR wide gamut via ICC; they can carry P3 / Adobe RGB pixel values with the right ICC tag, but cannot carry PQ or HLG. The pipeline must therefore degrade HDR into a P3 SDR variant for WebP/JPEG fallback, while serving the HDR AVIF as the preferred source.

### 1.5 Display capabilities, in practice

| Display class | Gamut | Transfer | Examples |
|---|---|---|---|
| sRGB monitor | sRGB | sRGB | most office monitors, older laptops |
| Display P3 monitor | P3 | sRGB | MacBook 2016+, iPad Pro, iPhone 7+, modern flagship Android |
| Adobe RGB monitor | ~ Adobe RGB | γ 2.2 | BenQ SW271, EIZO CG279X, prepress monitors |
| HDR monitor (HDR10) | P3 → Rec.2020 | PQ | Apple XDR, LG OLED C-series, Samsung S95 |
| HDR phone | P3 → Rec.2020 | PQ + HLG via DolbyVision/HDR10+ | iPhone 12+, Pixel 6+, Samsung S22+ |

Modern phones and laptops are wide-gamut + HDR-capable. The gallery's audience increasingly sits on those displays. SDR-sRGB-only delivery wastes the photographer's intent on those clients.

### 1.6 Browser color support landscape

| Browser | ICC v2 | ICC v4 | AVIF (SDR) | AVIF (HDR/PQ) | WebP ICC | `color-gamut` MQ | `dynamic-range` MQ | `color()` CSS | Canvas P3 |
|---|---|---|---|---|---|---|---|---|---|
| Safari 17+ (macOS, iOS) | yes | yes | yes | partial (PQ AVIF and HEIC OK; HLG limited) | yes | yes | yes | yes | yes (`getContextAttributes({colorSpace:'display-p3'})`) |
| Chrome 122+ | yes | partial | yes | yes (Chrome 116+ added PQ AVIF for HDR canvas + img) | yes | yes | yes | yes | yes (since 113) |
| Firefox 124+ | yes | partial (ICC v4 behind pref) | yes | partial (FF 113 added basic; HDR rendering still maturing) | yes | yes | yes | yes | yes (since 119) |
| Edge | matches Chrome | matches Chrome | yes | yes | yes | yes | yes | yes | yes |
| iOS WKWebView | matches Safari | matches Safari | yes | partial | yes | yes | yes | yes | yes |
| Older browsers (~5%) | partial | no | no | no | partial | partial | no | no | no |

Take-aways:

- ICC profile support is essentially universal in the modern web. WebP and JPEG color tagging work everywhere that opens the image.
- AVIF SDR is universal in modern browsers. AVIF HDR rendering is browser- and OS-dependent, but degrades gracefully (the SDR fallback path is the same picture-element selection we already have).
- `(dynamic-range: high)` is reliable enough to use as a `<source>` `media` selector for HDR variants.
- `<picture>` `type="image/avif"` already steers AVIF-capable clients to AVIF, which is the right vector for HDR carriage.

### 1.7 Photographer's intent — what we owe the upstream

The photographer ships an intent: a specific look on a specific reference display class, with a specific tonal mapping in mind. The gallery preserves intent by (a) carrying the source primaries / transfer through to delivery whenever the client can render them, (b) gracefully degrading on clients that cannot, and (c) telling the photographer what was actually delivered. The pipeline must not surprise the photographer by silently flattening intent.

---

## 2. Current Pipeline — Detailed Walk-through

### 2.1 Ingestion (`saveOriginalAndGetMetadata` in `lib/process-image.ts`)

- Sharp opens with `failOn: 'error'`, `sequentialRead: true`, `autoOrient: true`, `limitInputPixels: 256 MP`.
- `metadata()` exposes `width`, `height`, `depth`, `icc` (ICC buffer), `exif`, `orientation`.
- `extractIccProfileName(metadata.icc)` parses the ICC `desc` tag with bounded loop count and string lengths. This is the only color-science signal flowing forward from ingestion. It is a string like `"Display P3"` or `"sRGB IEC61966-2.1"`.
- `metadata.depth` is mapped from Sharp's string union (`'uchar'` / `'ushort'` / etc.) to a numeric bit depth via `DEPTH_TO_BITS`.
- A 16-pixel JPEG q40 blur preview is generated for the `blur_data_url` field. sRGB; fine for placeholder.

What is NOT extracted at ingestion:

- ICC profile description vs. specific tag content (specific primaries / white-point chromaticities).
- CICP triplet (`color_primaries`, `transfer_characteristics`, `matrix_coefficients`).
- HDR transfer signaling (PQ / HLG).
- Mastering display metadata (SMPTE 2086) or MaxCLL / MaxFALL.
- Apple gain map presence.
- ICC profile version (v2 vs v4).

### 2.2 Output decision (`resolveAvifIccProfile`)

- Strict allowlist mapping:
  - `Display P3` / `P3-D65` / `DCI-P3` → `'p3'`.
  - everything else (including ProPhoto, Adobe RGB, Rec.2020, sRGB) → `'srgb'`.
- The function operates on the lowercase ICC profile description string. No fallback to ICC profile primary chromaticities, so a profile description like `"My Custom P3 Profile"` falls through to sRGB.

### 2.3 Encode (`processImageFormats`)

For each output size, three formats are emitted in parallel:

- **WebP**: `toColorspace('srgb')` + `withIccProfile('srgb')` + `webp({ quality })`. Always sRGB.
- **AVIF**: `toColorspace(avifIcc)` + `withIccProfile(avifIcc)` + `avif({ quality, effort: 6, bitdepth: 10? })`. P3 when `avifIcc === 'p3'`, sRGB otherwise. Bit depth 10 gated on lazy probe.
- **JPEG**: `toColorspace('srgb')` + `withIccProfile('srgb')` + `jpeg({ quality, chromaSubsampling: '4:4:4'? })`. Always sRGB. 4:4:4 chroma when source is P3.

Wide-gamut sources (`avifIcc === 'p3'`) get a `pipelineColorspace('rgb16')` resize, which runs the bicubic scaler in 16-bit linear light. This kills gamma-space halos and desaturation in P3 outputs.

### 2.4 Cache invalidation

- `IMAGE_PIPELINE_VERSION = 3` is bumped on encoder semantic changes.
- `serve-upload.ts` builds an ETag from `(version, mtime, size)` and serves with `Cache-Control: public, max-age=86400, must-revalidate`. Browsers revalidate; a pipeline bump invalidates without operator action.

### 2.5 Display layer

CSS:

- `:root { --display-gamut: srgb; }` then `@media (color-gamut: p3) { --display-gamut: p3; }`. Custom property is set but **not consumed** by any rule beyond the P3 badge gate.
- `:root { --display-hdr: true; }` set under `@media (dynamic-range: high)`. **Not consumed anywhere.**
- `@supports (color: oklch())` overrides UI accent tokens with OKLCH. This affects only chrome / shell colors, not photo rendering.
- `.gamut-p3-badge { display: none; }` then `@media (color-gamut: p3) { .gamut-p3-badge { display: inline-block; } }`. Only the P3 EXIF badge in the photo viewer respects display gamut.

Rendering:

- `<picture>` in `photo-viewer.tsx`, `home-client.tsx`, and `lightbox.tsx` uses `<source type="image/avif">` then `<source type="image/webp">` then `<img>` JPEG fallback. Selection is by MIME type only — no `media` query, no `sizes` differentiation across gamut/dynamic-range.

### 2.6 OG / embed (`/api/og/photo/[id]/route.tsx`)

- Generates a 1200×630 SDR sRGB JPEG via Satori + the pre-encoded medium JPEG derivative (1536-wide, sRGB).
- No alternative HDR or P3 OG path. iOS iMessage 17+ would color-manage a P3 JPEG but does not currently see one.

### 2.7 Histogram (`Histogram` component)

- Reads the small JPEG (640-wide, sRGB) into a canvas, samples pixels, draws an RGB histogram. Capped at 256×256 sample grid for performance.
- For sRGB sources this matches the photographer's intent exactly. For P3/wider sources, the histogram represents the sRGB-clipped variant — saturation peaks above sRGB primaries are reported as flat boundary values.

### 2.8 Schema fields tracking color

- `images.color_space` (varchar 255) — ICC profile description string, surfaced in EXIF panel.
- `images.icc_profile_name` (varchar 255) — duplicate of color_space, also surfaced.
- `images.bit_depth` (int) — nominal source bit depth, surfaced.
- No `transfer_function`, `color_primaries`, `matrix_coefficients`, `mastering_display_metadata`, `max_cll`, `max_fall`, `is_hdr`.

---

## 3. Findings, Severity-Rated

Severity is the impact on photographer intent, not a code-quality grade.

### High severity

**H1. HDR delivery is absent end-to-end.**

`(dynamic-range: high)` is detected in CSS but no `<source media="..." srcset="...">` ever consumes it. The encoder produces SDR-sRGB or SDR-P3 only. An iPhone 15 Pro ProRAW captured with PQ HDR loses 4-5 stops of highlight headroom on delivery. On an XDR display, the photographer's recovered cloud detail and specular highlights clip to SDR white. There is no schema column tracking source HDR transfer, no encoder branch emitting HDR AVIF (`bitdepth: 10` + CICP `transfer: 16`), and no `<picture>` source with `media="(dynamic-range: high)"`.

Photographers shooting HDR: invisible on the gallery.

**H2. WebP and JPEG fallbacks lose wide-gamut intent.**

The "always sRGB for universal compatibility" comment is conservative beyond modern need. WebP has supported ICC since 2018; JPEG ICC is universal. When an AVIF-supporting browser is available, intent flows through. When it is not — older Chromium-on-Linux without `aom`, very old Firefox builds, embedded browsers — the fallback WebP and JPEG are sRGB-clipped even on a P3 monitor, losing saturation that the photographer intended.

This is a smaller audience than (H1) but a code-trivial fix.

### Medium severity

**M1. Wider-than-P3 sources are always clipped to sRGB.**

Adobe RGB / ProPhoto / Rec.2020 sources go through `srgb` in `resolveAvifIccProfile` because the function's allowlist is P3-only. Photographers working in ProPhoto (Lightroom default), or Adobe RGB (DSLR default), get sRGB-clipped output even on P3 monitors that could render most of the wider gamut.

The fix is to map ProPhoto / Adobe RGB / Rec.2020 to **Display P3** rather than sRGB on the AVIF path. P3 is the largest universally renderable gamut. Pixel conversion from ProPhoto → P3 still loses the most-saturated greens (P3 is smaller than ProPhoto), but recovers most of what sRGB throws away.

**M2. Histogram is computed from sRGB-clipped JPEG.**

Reading the histogram is a primary feedback loop for photographers verifying exposure and saturation. When the photo is a P3 source, the histogram is wrong — saturation peaks pile up at the sRGB boundary even when the AVIF variant carries them correctly.

The fix is to read from the AVIF (smallest-size representative) when available, with a feature-detect fallback to JPEG. Modern browsers can decode AVIF into a `<canvas>` and `getImageData()` (assuming `colorSpace: 'display-p3'` context attributes for a P3 canvas).

**M3. No rendering intent / black-point compensation control.**

`toColorspace()` uses LCMS2 defaults (relative colorimetric, BPC on). For high-key portraits or saturated landscapes, perceptual rendering intent often preserves photographic gradients better — at the cost of some hue shift. There is no admin-facing toggle.

**M4. The "Download JPEG" button surfaces an sRGB derivative without disclosure.**

A free download labeled "Download JPEG" implies "this is the photo." For a P3 source, that download is the sRGB rendition — a deliberately-tonemapped, gamut-clipped derivative. Photographers and clients downloading expect either (a) the original or (b) clear labeling that this is a derivative.

For paid licensees, the post-checkout token route delivers the original. The free path needs disclosure: rename to "Download JPEG (sRGB)" at minimum, or expose AVIF download for P3 sources.

### Low severity

**L1. ICC profile detection is string-match only.**

`resolveAvifIccProfile` operates on the lowercase profile description. A custom or vendor-named ICC profile that happens to use Display P3 primaries falls through to sRGB. A more robust path parses the ICC profile's `wtpt` (white point) and `rXYZ`/`gXYZ`/`bXYZ` (primary chromaticities) tags and matches against known gamut presets within tolerance.

**L2. No CICP plumbing.**

CICP triplet (primaries, transfer, matrix) is the canonical color signaling for AVIF / HEIF. The encoder does not pass CICP, so the AVIF emits ICC-only (which works) but cannot signal HDR transfer. CICP is the prerequisite for (H1).

**L3. OG / embed images stay SDR sRGB unconditionally.**

iOS iMessage 17+ color-manages embedded P3 JPEGs in link previews. The OG image route flattens to sRGB by default. Low-volume but a missed opportunity for cross-platform intent preservation.

**L4. Blur placeholder is sRGB.**

The 16-pixel JPEG q40 placeholder is tagged sRGB. Acceptable for a blur preview, but for P3 sources the placeholder hue drifts slightly from the final image. Low cost and low value to fix, but worth noting.

**L5. RAW / DNG pseudo-support.**

`ALLOWED_EXTENSIONS` includes `.arw`. Sharp / libvips processes RAW via libraw default demosaic + default color matrix. The output is libraw's render, not the photographer's. Per premise, RAW upload is not expected — but a user who mis-uploads a `.arw` gets a "successful" render with non-photographer-intent colors. Either reject `.arw` at upload or add a clear "RAW files are converted with default settings — please export from your editor first" warning.

**L6. No observability for color decisions.**

`resolveAvifIccProfile` outputs `'p3'` or `'srgb'` with no logging or per-image audit trail. When a regression lands ("my P3 photos look flat"), there is no way to see which branch a specific image took during encode. A small audit table or a `color_pipeline_decision` text column would help future debugging.

**L7. No test card / test image fixture.**

There is no fixed reference image with known wide-gamut colors that gets re-encoded on each pipeline change and visually-diffed. A small set of reference images (sRGB ramp, P3 saturated patches, ProPhoto skin tone, HDR PQ ramp) would catch encoder regressions before users do.

**L8. Calibration awareness UX.**

A photo on an uncalibrated display will look wrong regardless of pipeline correctness. This is not the gallery's job to fix, but a one-line "Display calibration affects color accuracy" hint in the EXIF panel for wide-gamut sources sets honest expectations.

---

## 4. What NOT to Change

These are working correctly and removing them would regress quality:

- The strict P3 allowlist in `resolveAvifIccProfile` (better to extend than relax).
- `IMAGE_PIPELINE_VERSION` + ETag invalidation pattern (correct caching contract).
- `pipelineColorspace('rgb16')` gated on wide-gamut (cost/quality split is right).
- 4:4:4 chroma subsampling for wide-gamut JPEG (measurable improvement on saturated content).
- 10-bit AVIF probe + lazy memoization (correct concurrency pattern).
- Strip-EXIF-from-AVIF/WebP/JPEG (closes GPS leak; in-app EXIF panel is enough).
- `failOn: 'error'` + `sequentialRead: true` defaults (right safety/perf balance).
- The current display detection (`@media (color-gamut: p3)` and `@media (dynamic-range: high)`) — wire them in, do not remove them.

---

## 5. Workflow Considerations

### 5.1 Premise reminder

Per task: photos arrive after culling, refinement, and editing. The gallery is a delivery system, not an editing tool. No discussion of edit / scoring features.

### 5.2 Where intent must be preserved

| Surface | Current | Should preserve |
|---|---|---|
| Upload pipeline | sRGB and P3 carried via AVIF only | All source gamuts → AVIF (and matching WebP/JPEG) with correct ICC. |
| Photo viewer | `<picture>` AVIF→WebP→JPEG | Add HDR `<source media="(dynamic-range: high)">` for HDR sources. |
| Lightbox | same as viewer | same. |
| Histogram | reads sRGB JPEG | Read AVIF when supported. |
| OG / share embed | SDR sRGB only | Add P3 variant for clients that color-manage previews. |
| Download (free) | sRGB JPEG, mislabeled | Disclose sRGB; offer AVIF for P3 sources. |
| Download (paid) | original file | Already correct. |
| Atom feed | SDR sRGB | Acceptable; feed clients vary widely. |

### 5.3 What the photographer should be told

The EXIF panel shows `Color Space` and a P3 badge. That is good. Add:

- HDR badge (with "HDR" label) when source is HDR, gated to display only on HDR-capable viewers.
- Bit depth label clarification (e.g. "10-bit HDR" vs just "10-bit").
- Optional "Show what was delivered" debug overlay for the photographer's own audit (which gamut tag is on the AVIF the viewer is currently rendering).

### 5.4 Original archival vs. delivery

The original file is stored under `data/uploads/original/` and delivered only on paid token. This is the correct boundary: pixel-exact original to licensees, web-optimized derivatives to viewers. The derivatives are where intent preservation matters, because that is what 99% of viewers see.

---

## 6. Browser Support Validation Matrix

For each fix proposal in the plan, the matrix below maps target outcomes to browser support.

| Feature | Safari (mac/iOS) | Chrome | Firefox | Edge | Implication |
|---|---|---|---|---|---|
| `<picture> <source type="image/avif">` | yes | yes | yes (FF 113+) | yes | AVIF preferential delivery is universal in modern browsers. |
| `<picture> <source media="(dynamic-range: high)">` | yes | yes (Chrome 109+) | yes (FF 110+) | yes | HDR variant selection is universal in modern browsers. |
| AVIF with PQ transfer (CICP `transfer = 16`) | yes (macOS 13+, iOS 16+) | yes (Chrome 116+ for HDR canvas) | partial (FF 113+, basic decode; rendering quality improving) | yes | HDR PQ delivery works on modern Apple + Chromium. Firefox graceful-degrades to SDR. |
| WebP with embedded ICC | yes (libwebp ≥ 1.0 era) | yes | yes | yes | P3 WebP fallback is universal. |
| JPEG with embedded ICC | yes (always) | yes (always) | yes (always) | yes | P3 JPEG fallback is universal. |
| Canvas `getContextAttributes({colorSpace:'display-p3'})` | yes (Safari 16.4+) | yes (Chrome 113+) | yes (FF 119+) | yes | P3 histogram canvas is universal in modern browsers. |
| `@media (color-gamut: p3)` | yes | yes | yes | yes | Already used; confirmed reliable. |
| `@media (dynamic-range: high)` | yes (Safari 13.1+) | yes (Chrome 109+) | yes (FF 110+) | yes | HDR display detection is universal in modern browsers. |
| `color()` CSS (`color(display-p3 1 0 0)`) | yes | yes | yes | yes | UI accents safely upgradable to wide gamut. (Already partially done via OKLCH.) |
| ICC v4 profiles | yes | partial | partial (pref) | partial | Prefer v2 ICCs for embedding to maximize reliability. Sharp emits v2 by default — fine. |
| Apple gain-map JPEG | yes (iOS/macOS) | partial | no | partial | Skip; emit AVIF HDR instead. |

The two fixes that matter most (HDR AVIF delivery + wide-gamut WebP/JPEG ICC) sit on universally-supported features. There is no compatibility blocker.

---

## 7. Suggested Reading and References

- ICC: https://www.color.org/icc_specs2.xalter
- BT.709 / BT.2020: https://www.itu.int/rec/R-REC-BT.709 https://www.itu.int/rec/R-REC-BT.2020
- BT.2100 (HDR): https://www.itu.int/rec/R-REC-BT.2100
- AVIF (CICP): https://aomediacodec.github.io/av1-avif/
- HEIF (ISO/IEC 23008-12)
- libvips colorspace / ICC: https://www.libvips.org/API/current/libvips-colour.html
- Sharp `pipelineColorspace`: https://sharp.pixelplumbing.com/api-colour
- Apple gain map (informal): https://developer.apple.com/documentation/avfoundation/cataloged_videos/working_with_hdr_video_content
- Firefox color management: https://bugzilla.mozilla.org/show_bug.cgi?id=Color%20management

---

## 8. Companion Plan

Implementation phasing, schema changes, and verification strategy live in `.context/plans/34-color-management-roadmap.md`.
