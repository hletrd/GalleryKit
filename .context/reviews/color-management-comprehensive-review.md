# GalleryKit — Comprehensive Color Management Review

**Date:** 2026-05-07
**Predecessor:** `.context/reviews/photographer-color-review.md` (kept; this expands on it).
**Companion plan:** `.context/plans/35-color-management-implementation-spec.md`.
**Premise:** Photos arrive after culling, refinement, and editing. The job is to deliver the photographer's intent — gamut, tonality, dynamic range — accurately to every viewer, on every supported display, through every supported browser.
**Scope of this document:** color reproduction, ICC profile management, HDR workflow, internal color formats, wide-color-gamut coverage (P3, Adobe RGB, ProPhoto, Rec.2020), display chromaticity primitives, browser color support. **No edit / culling / scoring features.**

---

## 0. How to read this document

§1 sets up the color-science vocabulary the rest of the doc assumes (chromaticity primitives, transfer functions, HDR, gain maps, tone mapping). Skim if familiar; reference if not.

§2 is the photographer's workflow lens: five concrete delivery scenarios with the specific failure mode the gallery hits today.

§3 is the format / display / browser support matrix — exhaustive, version-pinned where it matters.

§4 is a deep walk-through of the current pipeline: every encoder branch, every header, every cache layer, every place a color decision happens.

§5 is the gap inventory, severity-rated, with each gap traced to the workflow scenario it breaks.

§6 is verification methodology — how to prove a fix works.

§7 is what we should not change.

The companion plan (`.context/plans/35-color-management-implementation-spec.md`) translates §5 into code-level deliverables.

---

## 1. Color science context

### 1.1 Chromaticity primitives — the actual numbers

A color space is defined by three primary chromaticities (R, G, B in CIE xy) plus a white point. The numbers below are the targets every encoder, every display, and every browser is supposed to honor. When two surfaces disagree on these numbers, you get color drift.

| Space | Rx Ry | Gx Gy | Bx By | White |
|---|---|---|---|---|
| sRGB / BT.709 | 0.640 0.330 | 0.300 0.600 | 0.150 0.060 | D65 (0.3127 0.3290) |
| Display P3 (D65) | 0.680 0.320 | 0.265 0.690 | 0.150 0.060 | D65 (0.3127 0.3290) |
| DCI-P3 (theatrical) | 0.680 0.320 | 0.265 0.690 | 0.150 0.060 | DCI (0.314 0.351, ~6300 K) |
| Adobe RGB (1998) | 0.640 0.330 | 0.210 0.710 | 0.150 0.060 | D65 |
| ProPhoto (ROMM) | 0.7347 0.2653 | 0.1596 0.8404 | 0.0366 0.0001 | D50 (0.3457 0.3585) |
| BT.2020 / Rec.2020 | 0.708 0.292 | 0.170 0.797 | 0.131 0.046 | D65 |
| ACEScg (AP1) | 0.713 0.293 | 0.165 0.830 | 0.128 0.044 | D60 |

Observations relevant to the gallery:

- **Display P3 vs DCI-P3:** identical primaries, different white point. Confusing them silently warm-shifts the photo. The codebase's allowlist treats both as `'p3'` and rests on the AVIF encoder converting white-point internally — this is correct for most cases but should be documented (and the schema should track which one was the source, since print or HDR-grade workflows care).
- **Adobe RGB:** wider greens and blues than sRGB; smaller than P3 in greens. ProPhoto greens extend past P3.
- **ProPhoto blue chromaticity (0.0366, 0.0001):** essentially imaginary — outside the spectral locus. ~13% of ProPhoto cannot be physically produced; it exists for editing headroom. Any conversion target (sRGB, P3, even Rec.2020) clips part of ProPhoto's blue.
- **D65 vs D50:** D65 is the cool-daylight white point used by sRGB, P3, AdobeRGB, Rec.2020. D50 is print-warm, used by ProPhoto and most ICC v2 reference. Profile conversion must apply the chromatic adaptation transform (Bradford by default in libvips/LCMS2) to bridge the white-point gap.

### 1.2 Transfer functions

| Function | Input → Output | Used by |
|---|---|---|
| sRGB OETF | piecewise: linear segment near black, ~γ 2.4 above | sRGB, Display P3 |
| γ 1.8 | x^(1/1.8) | ProPhoto (legacy) |
| γ 2.2 | x^(1/2.2) | Adobe RGB |
| DCI gamma 2.6 | x^(1/2.6) | DCI-P3 (cinema) |
| BT.1886 | similar to γ 2.4 | UHD SDR |
| PQ (SMPTE ST 2084) | non-linear; absolute luminance up to 10 000 cd/m² | HDR10, HDR10+, Dolby Vision |
| HLG (BT.2100) | hybrid log-gamma; relative luminance | HDR broadcast, Apple HDR |
| Linear | identity | rendering / scratch |

Failing to apply the right inverse transform when reading a source desaturates and lifts shadows. Failing to apply the right transform on encode creates the inverse of the source's photographic curve. Both produce flatness or muddiness.

### 1.3 What HDR actually means in delivery

HDR is a triplet:

- **Primaries:** typically Rec.2020 (largest), or Display P3 carried as Rec.2020-fits-in-Rec.2020.
- **Transfer:** PQ or HLG.
- **Bit depth:** 10-bit minimum (banding is visible at 8-bit with PQ).

These three are signaled together via **CICP** (Coding-Independent Code Points): a triplet `(color_primaries, transfer_characteristics, matrix_coefficients)` written into the bitstream. AVIF and HEIF carry CICP in the `colr` box (variant `nclx`). JPEG and WebP cannot carry CICP — they have ICC and that is all.

Additional optional HDR metadata:

- **SMPTE 2086 (mastering display):** primaries + min/max luminance the photo was graded on. Helps the consumer's display tone-map to its own peak.
- **CTA-861 MaxCLL / MaxFALL:** max content light level + max frame-average. Peak-luminance signals.
- **Apple gain map:** SDR base + per-pixel multiplier giving HDR detail. Format-specific (HEIF, JPEG XR, JPEG with Apple-specific marker). Not standardized; renders as plain SDR on non-Apple software. Sharp / libheif do not currently transcode it through.

Tone mapping is the inverse problem: how to compress an HDR signal down to a display's peak. Algorithms in roughly increasing quality:

- Clip (worst): everything above peak → peak white. Hard clipping; loses highlight detail.
- Reinhard: simple `x / (1 + x)`. Soft compression but desaturates.
- Hable filmic ("Uncharted 2"): better filmic curve. Common in games.
- ACES: industry-standard filmic curve. Heavy compute.
- BT.2390: ITU reference for HDR-to-SDR. Best reference, but slow without a LUT.

For gallery purposes: BT.2390 is the right reference. For implementation, a precomputed 3D LUT or a Hable approximation is acceptable as a v1.

### 1.4 Camera-side intent

The photographer's source is shaped by their camera and editor:

| Camera / source | Likely color carriage | Notes |
|---|---|---|
| iPhone 7+ default | Display P3 JPEG (HEIF since iOS 11) | iOS Photos saves P3 in HEIF; export-as-JPEG embeds Display P3 ICC. |
| iPhone 12+ ProRAW + HDR mode | HEIF with PQ HDR + Apple gain map | Out of Lightroom's box if Apple-aware export is used. |
| Sony / Canon / Nikon DSLR JPEG | Adobe RGB or sRGB (camera setting) | DSLR menu default varies. Most enthusiasts toggle Adobe RGB. |
| Lightroom export → JPEG | sRGB / Adobe RGB / ProPhoto / Display P3 — user choice | Lightroom default is sRGB JPEG; editors-who-care export P3 or Adobe RGB. |
| Capture One export | similar choices to Lightroom | |
| Affinity / Photoshop with HDR mode | OpenEXR or 16-bit PSD (not web-deliverable) → exported as PQ AVIF/HEIF | Manual export step; few photographers do this today, but it's growing. |

Take-away: assuming "users export Display P3 because they have an iPhone" is increasingly safe. Assuming "users only deliver sRGB" is increasingly wrong.

### 1.5 Display side

| Display class | Gamut | Peak (cd/m²) | Examples |
|---|---|---|---|
| Office IPS sRGB | ~99% sRGB | 250-350 | Most office monitors. |
| Laptop / phone P3 | ~99% Display P3 | 400-1000 | MacBook Pro 2016+, iPhone 7+, modern Android flagships. |
| Wide-gamut prepress monitor | 99% Adobe RGB / 95% P3 | 250-350 | BenQ SW271, EIZO CG279X. |
| HDR10 monitor (LCD) | ~95% P3 | 600-1500 | Apple Studio Display, MacBook Pro M-series. |
| HDR10 OLED | ~99% P3, ~70% Rec.2020 | 600-2000 (peak), 150 (sustained) | LG OLED, Sony A95L. |
| Apple XDR (mini-LED) | ~99% P3 | 1600 (peak), 1000 (sustained) | Pro Display XDR, MacBook Pro 14"/16" 2021+. |
| Phone HDR (OLED) | ~99% P3, ~70% Rec.2020 | 1000-2500 (sustained varies) | iPhone 12+, Galaxy S21+, Pixel 6+. |

Implications:

- The modal modern viewer is on a P3 capable display. The minority on sRGB-only.
- HDR is not niche on modern phones. Most flagship phones since 2020 are HDR-capable.
- Peak luminance varies enough that PQ tone mapping must respect the consumer display's peak via mastering metadata.

### 1.6 Browser color management — version-pinned facts

These are the answers from current specs and current shipping browsers (mid-2026). Earlier than the listed version, behavior was partial / spotty.

| Capability | Safari (mac/iOS) | Chrome / Edge | Firefox |
|---|---|---|---|
| `<img>` honors embedded ICC v2 | yes (always) | yes (Chrome 85+) | yes |
| `<img>` honors embedded ICC v4 | yes | partial (Chrome 85+, gated by display profile) | partial (gfx.color_management.mode=1) |
| `@media (color-gamut: p3)` | yes (10.1+) | yes (84+) | yes (110+) |
| `@media (color-gamut: rec2020)` | yes | yes (rare display match) | yes |
| `@media (dynamic-range: high)` | yes (13.1+) | yes (109+) | yes (110+) |
| `<picture> <source media="...">` | yes (always) | yes (always) | yes (always) |
| `<picture> <source type="image/avif">` | yes (16+) | yes (85+) | yes (113+) |
| AVIF SDR decode | yes | yes | yes (113+) |
| AVIF PQ HDR decode + render | yes (16+) | yes (Chrome 116+ for `<img>` HDR) | partial (decodes; HDR rendering varies) |
| AVIF HLG decode + render | yes (17+) | partial (Chrome 122+ tonemaps to SDR) | partial |
| WebP ICC profile | yes | yes | yes |
| JPEG ICC profile | yes (always) | yes (always) | yes (always) |
| Canvas `colorSpace: 'display-p3'` | yes (16.4+) | yes (113+) | yes (119+) |
| Canvas `colorSpace: 'rec2020'` | partial | partial | partial |
| CSS `color(display-p3 ...)` | yes | yes | yes |
| CSS `color(rec2020 ...)` | yes | yes | yes |
| CSS `color-mix()` | yes | yes | yes |
| OKLCH | yes | yes | yes |

Notable quirks:

- **Firefox ICC v4** is off by default for non-tagged images, but ON for tagged. Most well-tagged P3 / Adobe RGB sources work fine.
- **Chrome HDR canvas** requires `getContextAttributes({ colorSpace: 'rec2020', colorType: 'float16' })` for HDR-aware rendering; the gallery does not need this for basic delivery (img tag is enough).
- **Safari quirks:** when rendering an HDR AVIF in `<img>` on a non-HDR display, Safari tone-maps via its own algorithm. No control surface.
- **iOS Safari memory caps:** large 10-bit AVIF (>10 MP, >5 MB) can OOM on iPhones with 4 GB RAM. The gallery's resize ladder mitigates this by serving the smallest variant that fits the viewport.
- **Service Worker passthrough:** when a SW caches an image response, ETag-based revalidation depends on the SW honoring `Cache-Control: must-revalidate`. The gallery's SW (`gk-images-v1`, 50 MB cap) needs verification that it respects revalidation on pipeline-version bumps.

---

## 2. Workflow scenarios — how the gallery breaks intent today

Five photographer personas, ordered by how much intent the gallery currently loses. Each maps to a specific gap in §5.

### 2.1 Scenario A — iPhone P3 HDR shooter (highest impact)

**Workflow:**
1. Photographer captures with iPhone 15 Pro, Photographic Styles + HDR enabled.
2. Edits in Lightroom Mobile → exports as HEIF Display P3 + PQ HDR.
3. Uploads to GalleryKit.
4. Visitor on iPhone 15 Pro / MacBook XDR / OLED TV opens the gallery.

**Intent:** HDR specular highlights (sun glints, water reflections, neon at night) extending 4-5 stops above SDR white.

**What happens today:**
- HEIF ingestion: `metadata.icc` reads the Display P3 ICC, profile name matches `'Display P3'` → `resolveAvifIccProfile` returns `'p3'`. Good.
- The PQ transfer characteristic is ignored. Sharp's `toColorspace('p3')` outputs SDR Display P3.
- AVIF encoded as 10-bit Display P3 SDR.
- The PQ headroom collapses. On the XDR display, the photo looks "good but flat" — the photographer's specular highlights are gone.

**Gap:** H1 (HDR not delivered) + L2 (no CICP plumbing).

### 2.2 Scenario B — DSLR Adobe RGB enthusiast

**Workflow:**
1. Sony A7R5 set to Adobe RGB JPEG out of camera. Or Lightroom export with Adobe RGB working space.
2. Photographer uploads.
3. Visitor on MacBook Pro M3 (P3 display).

**Intent:** Adobe RGB greens (foliage, jade) and blues (sky, ocean), saturated beyond sRGB.

**What happens today:**
- ICC name matches `'Adobe RGB (1998)'` (or similar). Allowlist falls through to `'srgb'`.
- AVIF, WebP, JPEG all encoded as sRGB. Pixels gamut-mapped from Adobe RGB → sRGB at encode.
- On the P3 display, the photo renders with sRGB primaries. The greens and blues that motivated the Adobe RGB workflow are clipped.

**Gap:** M1 (wider-than-P3 sources clipped) + H2 (WebP/JPEG always sRGB even when source could land in P3).

### 2.3 Scenario C — Lightroom / Capture One ProPhoto pipeline

**Workflow:**
1. Photographer works in Lightroom (default ProPhoto working space) → exports as JPEG ProPhoto (or "Prophoto.icc embedded").
2. Uploads.
3. Visitor on any modern device.

**Intent:** ProPhoto green and red headroom for landscape (lichen, autumn leaves) or skin tones (warm magentas).

**What happens today:**
- ProPhoto allowlist match → falls through to `'srgb'`.
- Wide-gamut source loses its widest greens, reds, and skin headroom on any display.

**Gap:** M1 + H2.

### 2.4 Scenario D — Display P3 portfolio shooter on legacy browser

**Workflow:**
1. Photographer exports from Capture One as JPEG with Display P3 ICC.
2. Uploads.
3. Visitor on a Windows ThinkPad with P3 display, running an Edge build that fell out of date and lost AVIF support, OR on an embedded WebView (Steam Deck, Slack desktop).

**Intent:** Display P3 saturation on their P3-capable monitor.

**What happens today:**
- Source recognized as P3. AVIF emitted as P3 (good).
- WebP and JPEG always sRGB. The legacy browser falls through `<picture>` to WebP or JPEG fallback. Visitor sees sRGB-clipped output on their P3 display.

**Gap:** H2 (WebP/JPEG always sRGB).

### 2.5 Scenario E — Cross-platform sharing via iMessage / Slack

**Workflow:**
1. Photographer's gallery URL is pasted into iMessage / Slack / Discord.
2. The platform fetches the OG image preview.
3. Recipient opens the link preview on iPhone 15 Pro (P3 + HDR).

**Intent:** Preview thumbnail looks like the actual photo.

**What happens today:**
- OG route serves a 1200×630 SDR sRGB JPEG (Satori-rendered).
- Even when the source is Display P3 or HDR, the preview is sRGB-clipped, SDR-tone-mapped.
- iMessage 17+ is capable of rendering P3 previews. The preview falls below the source's intent.

**Gap:** L3 (OG always sRGB).

### 2.6 Cross-cutting workflow concerns

- **Free download UX:** the "Download JPEG" button serves the sRGB JPEG derivative. Photographers and clients downloading expect the photo, not a derivative. Disclosure or alternative formats needed (M4).
- **Histogram audit:** photographers reading the histogram for exposure verification need it to reflect the source's gamut, not a sRGB-clipped variant. Histogram canvas already requests `colorSpace: 'display-p3'` on P3 displays (good) but reads from the JPEG (sRGB-clipped) URL — half-fixed. (M2)
- **Image archival vs delivery:** original file under `data/uploads/original/` is preserved untouched. This is the right boundary; delivery derivatives are where intent recovery work goes.

---

## 3. Format / display / browser interaction matrix

### 3.1 Format color carriage — what each format can carry

| Format | ICC | CICP | HDR transfer | Bit depth | Wide-gamut tagging | Notes |
|---|---|---|---|---|---|---|
| JPEG (JFIF + Exif) | yes (APP2 marker) | no | no (Apple gain map is non-standard side-channel) | 8 | via ICC | Universal; cannot carry HDR. |
| PNG | yes (iCCP, sRGB chunk) | no | no | 8 / 16 | via iCCP | Lossless; large files. |
| WebP | yes (since libwebp 1.0, 2018) | no | no | 8 | via ICC | AVIF-less browsers' best fallback. |
| AVIF | yes (`colr` box `prof`) | yes (`colr` `nclx`) | yes (PQ, HLG) | 8 / 10 / 12 | via ICC or CICP (CICP wins) | Best modern format. HDR-capable. |
| HEIF / HEIC | yes (`colr` `prof`) | yes (`colr` `nclx`) | yes | 8 / 10 / 12 | via ICC or CICP | Apple-favored. Patent-encumbered for some uses. |
| TIFF | yes | no | rare | 8 / 16 / 32 | via ICC | Raster archival. |
| JPEG XL | yes | yes | yes | 8 / 10 / 12 / 16 | via either | Strong format; browser support still rolling. |

Take-away for delivery:

- **AVIF is the only format that carries everything we need (P3, Adobe RGB via P3 fallback, HDR via CICP, 10-bit).**
- **WebP and JPEG are SDR-only; they can carry P3 / Adobe RGB pixels via ICC but cannot carry PQ / HLG.**
- **HEIF is excellent for archive but not for web delivery (browser support spotty).**

### 3.2 Browser variant selection by `<picture>`

The gallery's `<picture>` selects by MIME type only today. Adding `media` attributes lets us tier by display capability:

```html
<picture>
  <!-- HDR variant for HDR-capable displays + browsers that decode PQ AVIF -->
  <source media="(dynamic-range: high)" type="image/avif" srcset="...hdr.avif" />
  <!-- SDR P3 AVIF for any AVIF-capable browser -->
  <source type="image/avif" srcset="....avif" />
  <!-- P3 WebP for AVIF-less browsers on P3 displays -->
  <source type="image/webp" srcset="....webp" />
  <!-- sRGB JPEG fallback -->
  <img src="....jpg" />
</picture>
```

Spec compliance: `<source media="...">` is universally supported. Browser without HDR support either falls through (no match) or matches and renders SDR-tonemapped.

### 3.3 Display detection edge cases

- `(color-gamut: p3)` returns `true` for any display ≥ P3. A high-end P3 monitor and an Apple XDR both return `true`.
- `(color-gamut: rec2020)` is rarely true in practice (consumer displays don't quite hit Rec.2020).
- `(dynamic-range: high)` returns `true` when the display is HDR-capable AND the OS reports HDR mode active. On macOS, this is gated by the OS knowing HDR is supported by the display + the user's "Use HDR" toggle in System Settings.
- `(forced-colors: active)` is the high-contrast mode signal — orthogonal to gamut, but relevant: when active, photo color overlays should not interfere with system colors. Already handled via the `@media (forced-colors: active)` block in `globals.css`.

### 3.4 Service worker and CDN interactions

- The SW (`/sw.js`, cache name `gk-images-v1`, 50 MB LRU cap) caches image responses. ETag built from `(IMAGE_PIPELINE_VERSION, mtime, size)` — bumping the version forces revalidation.
- If a CDN sits in front of the origin, `Cache-Control: public, max-age=86400, must-revalidate` plus the ETag is the contract. The CDN must honor `must-revalidate` semantics (most do).
- Adding HDR variants (`*_hdr.avif`) requires SW caching to handle the new URL pattern. The current SW does not partition by URL pattern; new URLs cache automatically.
- Vary header: not currently set. If we later switch on Accept (rare), we'd need `Vary: Accept`. Not needed for `<picture>`-based selection because the URL itself is variant-specific.

---

## 4. Current pipeline — exhaustive walk-through

(Largely overlaps with the predecessor review; included here for self-containment.)

### 4.1 Ingestion

- File extensions allowlist: `.jpg .jpeg .png .webp .avif .arw .heic .heif .tiff .tif .gif .bmp`. Note `.arw` (Sony RAW) — see §5 L5.
- Sharp opens with `failOn:'error'`, `sequentialRead:true`, `autoOrient:true`, `limitInputPixels:256 MP`.
- `metadata()` returns `width`, `height`, `depth`, `icc` (Buffer), `exif` (Buffer), `orientation`.
- `extractIccProfileName(metadata.icc)` parses the `desc` tag (cap: 100 tags, bounded string lengths).
- `metadata.depth` mapped to numeric bit depth via `DEPTH_TO_BITS` (`'uchar'` → 8, `'ushort'` → 16, etc.).
- A 16-pixel JPEG q40 blur preview built and assert-validated as `data:image/jpeg;base64,...`.

NOT extracted today:

- ICC profile primary chromaticities (`rXYZ`, `gXYZ`, `bXYZ`).
- ICC white point (`wtpt`) — relevant for D65 vs D50 distinction.
- ICC profile version (v2 vs v4).
- HEIF / AVIF `colr` box `nclx` payload (CICP triplet).
- Mastering display metadata (SMPTE 2086).
- MaxCLL / MaxFALL.
- Apple gain map presence indicator.

### 4.2 Encoder branch decision

`resolveAvifIccProfile(iccProfileName)` — strict allowlist:

```
'Display P3'                 → 'p3'
'Display P3 - …'             → 'p3'
'P3-D65'                     → 'p3'
'DCI-P3' / 'DCI-P3 …'        → 'p3'
'sRGB IEC61966-2.1'          → 'srgb'
'Adobe RGB (1998)'           → 'srgb'  # falls through
'ProPhoto RGB' / 'ProPhoto'  → 'srgb'  # falls through
'ITU-R BT.2020' / 'Rec.2020' → 'srgb'  # falls through
unknown / null               → 'srgb'
```

### 4.3 Encode chain

- `image = sharp(inputPath, { limitInputPixels, failOn:'error', sequentialRead:true, autoOrient:true })`.
- For each configured size, three formats emitted in parallel via `Promise.all`:

WebP (always sRGB):
```
image.clone().resize({ width }).toColorspace('srgb').withIccProfile('srgb').webp({ quality }).toFile(...)
```

AVIF (sRGB or P3 based on `avifIcc`):
```
const base = isWideGamutSource
  ? image.clone().pipelineColorspace('rgb16').resize({ width })
  : image.clone().resize({ width });
base.toColorspace(avifIcc).withIccProfile(avifIcc).avif({
  quality, effort: 6,
  ...(wantHighBitdepth ? { bitdepth: 10 } : {}),
}).toFile(...);
```

JPEG (always sRGB):
```
base.toColorspace('srgb').withIccProfile('srgb').jpeg({
  quality, ...(isWideGamutSource ? { chromaSubsampling: '4:4:4' } : {})
}).toFile(...);
```

### 4.4 Cache invalidation

`IMAGE_PIPELINE_VERSION = 3`. Bumped on encoder semantic changes. ETag in `serve-upload.ts` is `W/"v${version}-${mtime}-${size}"`. Cache-Control: `public, max-age=86400, must-revalidate`. Browsers and SW revalidate; pipeline bump invalidates without manual cache-bust.

### 4.5 Display layer

- `globals.css` sets `--display-gamut: srgb;` then upgrades to `p3` under `@media (color-gamut: p3)`. Custom property is used **only** by the `gamut-p3-badge` class — NO photo-rendering rule consumes it.
- `--display-hdr: true` set under `@media (dynamic-range: high)`. NO rule consumes it.
- `<picture>` in `home-client.tsx`, `photo-viewer.tsx`, `lightbox.tsx` selects on `type="image/avif"` then `type="image/webp"` then `<img>` JPEG. NO `media` attribute.
- `<canvas>` in `histogram.tsx` requests `colorSpace: 'display-p3'` on P3 displays — already correct on the canvas side. But the source URL is the JPEG (sRGB-clipped), so the canvas reads sRGB-clipped pixels.

### 4.6 OG / share

`/api/og/photo/[id]/route.tsx` produces a 1200×630 SDR sRGB JPEG via Satori, embedding the medium JPEG (1536-wide, sRGB) + title overlay. No HDR, no P3, no alternative.

### 4.7 Schema fields

- `images.color_space` — ICC profile description string.
- `images.icc_profile_name` — duplicate (unclear why both columns exist; see L9).
- `images.bit_depth` — numeric.

NOT in schema:

- transfer function / CICP fields
- mastering display metadata
- HDR flag
- gain map indicator
- canonical primaries (separate from human-readable name)

---

## 5. Gap inventory, severity-rated, traced to scenarios

### High

**H1. HDR not delivered end-to-end. (Scenario A)**

Detection in CSS exists; consumption nowhere. Encoder produces SDR only, regardless of source HDR transfer. Schema does not track transfer function. CICP not extracted from HEIF/AVIF inputs. `<picture>` does not branch on `(dynamic-range: high)`.

**H2. WebP and JPEG fallbacks always sRGB. (Scenarios B, C, D)**

Both formats carry ICC universally in modern browsers. Forcing sRGB on every source loses wide-gamut intent on AVIF-less clients. The "universal compatibility" rationale is stale.

### Medium

**M1. Wider-than-P3 sources clipped to sRGB. (Scenarios B, C)**

Adobe RGB / ProPhoto / Rec.2020 sources fall through to sRGB instead of mapping to the closest universally-renderable wide gamut (Display P3). Display P3 is the right target for the AVIF path; pixel conversion ProPhoto → P3 still loses widest greens but preserves most photographic content.

**M2. Histogram reads sRGB-clipped JPEG. (Photographer audit)**

Canvas already requests `colorSpace: 'display-p3'` on P3 displays. But the source URL is the JPEG variant (sRGB-clipped). Reading from the AVIF (smallest representative size) preserves wide-gamut histogram fidelity.

**M3. No rendering intent / BPC control. (Niche workflows)**

Sharp / libvips defaults are relative-colorimetric + BPC on. Photographer who wants perceptual gamut compression on ProPhoto → P3 has no toggle.

**M4. Free "Download JPEG" undisclosed sRGB. (Scenario D, plus expectations)**

Button labeled "Download JPEG" implies "the photo." For wide-gamut sources, it's a derivative. Disclosure or alternative formats needed.

### Low

**L1. ICC detection is string-match only.** Custom ICC profiles or vendor-named variants fall through. Need to parse `wtpt` + `r/g/bXYZ` chromaticities and match against gamut presets within ΔE tolerance.

**L2. No CICP plumbing.** Prerequisite for H1.

**L3. OG always SDR sRGB.** Cross-platform sharing previews stay SDR. iMessage 17+ would render P3 previews; gallery doesn't expose them.

**L4. Blur placeholder is sRGB.** 16-pixel JPEG q40, sRGB-tagged. Acceptable; documented for completeness.

**L5. RAW pseudo-support.** `.arw` accepted; output is libraw default render, not photographer intent. Either reject or warn.

**L6. No audit trail for color decisions.** Hard to debug regressions.

**L7. No reference test card fixtures.** Pipeline regressions invisible until users report.

**L8. No calibration awareness UX.** Wide-gamut photos look wrong on uncalibrated displays. One-line hint sets honest expectations.

**L9. `color_space` and `icc_profile_name` columns appear redundant.** Schema cleanup; not a color-correctness issue.

**L10. Service worker cache verification for HDR variants.** When HDR variants land, verify the SW handles the new URL pattern correctly and that ETag-based revalidation works through it.

---

## 6. Verification methodology

Every fix in the companion plan has acceptance criteria. The cross-cutting verification surfaces are:

### 6.1 Reference fixture set (build-time)

Committed under `apps/web/__test_fixtures__/color/` (or hosted on a test instance):

- `srgb-macbeth.jpg` — sRGB ColorChecker 24-patch, 256×384.
- `p3-macbeth.jpg` — same patches in Display P3.
- `adobergb-skintone.jpg` — Macbeth skin patches in Adobe RGB.
- `prophoto-landscape.jpg` — ProPhoto with saturated foliage at the edge of P3.
- `rec2020-saturation-rainbow.jpg` — full saturation rainbow in Rec.2020.
- `srgb-gradient.png` — 256-step black-to-white gradient (banding test).
- `p3-saturation-pattern.heif` — 10-bit Display P3 saturation steps.
- `pq-hdr-sun.heif` — PQ HDR with sun glint specular (when HDR phase lands).
- `hlg-hdr-landscape.heif` — HLG HDR landscape.

Tests verify per fixture:

- Output ICC tag matches expected (read with `node-icc` or libheif binding).
- AVIF CICP fields match expected (parse `colr` box).
- Output checksum / perceptual hash within tolerance of recorded baseline.
- ΔE76 between source and rendered AVIF ≤ 1 per ColorChecker patch (after gamut mapping).

### 6.2 Manual smoke matrix (per-phase)

| Device | OS | Browser | Display | Tests |
|---|---|---|---|---|
| MacBook Pro M3 | macOS 15 | Safari 17 | Internal P3 + HDR | All scenarios A-E |
| MacBook Pro M3 | macOS 15 | Chrome 122 | Same | Scenarios B-E |
| ThinkPad X1 | Windows 11 | Edge 122 | Dell U2723QE (P3) | Scenarios B-D |
| ThinkPad X1 | Windows 11 | Firefox 124 | Same | Scenarios B-D |
| iPhone 15 Pro | iOS 17 | Safari Mobile | Internal P3 + HDR | Scenarios A, E |
| Pixel 8 | Android 14 | Chrome | Internal P3 (no HDR cert) | Scenarios B, C, E |

Per device, per scenario:

- Inspect Network panel: which variant URL was selected.
- Visual smoke: P3 saturation visible vs. matching content on a known-correct reference (e.g. iCloud Photos for an iPhone original).
- DevTools "Computed" panel: confirm `color-gamut` and `dynamic-range` MQ values match reality.

### 6.3 Production observability

- Audit column populated for every new image. Distribution graphed.
- Server log for unrecognized profile names → flag into a low-volume alert.
- Browser console "Sec-CH-UA" + a custom debug header that records which variant was selected per request, sampled at 1% of traffic.

### 6.4 Continuous integration

- Pipeline test re-encodes the fixture set on each PR. Hash-stability assertion fails if encoder behavior changes silently.
- A `IMAGE_PIPELINE_VERSION` bump must come with a baseline update. CI enforces this with a check ("version bumped without baseline update" → red).

---

## 7. What we should not change

- Strict P3 allowlist in `resolveAvifIccProfile` — extend, don't relax.
- `pipelineColorspace('rgb16')` for wide-gamut resize — keep cost/quality split.
- 4:4:4 chroma subsampling for wide-gamut JPEG.
- 10-bit AVIF probe + lazy memoization.
- `IMAGE_PIPELINE_VERSION` + ETag invalidation pattern.
- EXIF stripping from AVIF / WebP / JPEG (privacy guard).
- `failOn:'error'` + `sequentialRead:true` Sharp defaults.
- Blur placeholder in sRGB JPEG (acceptable trade-off).
- Histogram canvas requesting `colorSpace: 'display-p3'` on P3 displays — keep.
- Existing CSS detection (`@media (color-gamut: p3)` and `@media (dynamic-range: high)`) — wire them in, don't remove.
- ICC profile description displayed in EXIF panel — keep.

---

## 8. Companion implementation spec

Per-phase code-level deliverables, acceptance tests, performance budgets, risk matrix, rollback procedure, and operator runbook live in `.context/plans/35-color-management-implementation-spec.md`.
