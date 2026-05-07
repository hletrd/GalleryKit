# GalleryKit Color Delivery — Format & Browser Compatibility Reference

**Scope:** Format color-carriage capability, per-browser color-management behavior, display class matrix, codec library specifics, `<picture>` source-selection algorithm, HDR detection accuracy, and canvas P3 source-fetch behavior. Version-pinned as of May 2026. No code changes proposed.

**Pipeline context:**
- Sharp 0.34.x encodes AVIF / WebP / JPEG from processed originals.
- AVIF: P3 sources get 10-bit + Display-P3 ICC. Wider-than-P3 sources (AdobeRGB, ProPhoto, Rec.2020) are converted to P3 via `pipelineColorspace('rgb16')` + `withIccProfile('p3')`. Everything else is sRGB 8-bit AVIF.
- WebP / JPEG: same `targetIcc` logic — P3-tagged when source is P3, sRGB otherwise.
- `<picture>` uses `type=` only; no `media=` attribute today.
- `globals.css` sets `--display-gamut` and `--display-hdr` CSS custom properties via `@media (color-gamut: p3)` / `@media (dynamic-range: high)` but nothing in the render path consumes them for photo delivery.
- Schema stores `color_space` (EXIF tag 0xA001 string), `bit_depth`, `color_primaries`, `transfer_function`, `is_hdr` (derived from CICP nclx box or ICC heuristics).

---

## 1. Format Color-Carriage Table

| Format | ICC v2 | ICC v4 | CICP / nclx | PQ transfer | HLG transfer | Max bit depth | Notes | Browser % (modern, May 2026) |
|--------|--------|--------|-------------|-------------|-------------|--------------|-------|------------------------------|
| JPEG | Yes | Yes (rarely used) | No | No | No | 8-bit (12-bit JPEG-XT obscure) | sRGB assumed when no profile embedded; 4:4:4 chroma optional | ~99% |
| PNG | Yes | Yes | No | No | No | 16-bit | Wide-gamut PNG rare but valid; HDR via APNG proposals not finalized | ~99% |
| WebP | Yes (since 2011 extended format) | Technically yes (container supports arbitrary ICC) | No | No | No | 8-bit lossy, 8-bit lossless | Animated WebP ignores ICC profile in libwebp (color managed as sRGB); static WebP honors ICC | ~97% |
| AVIF | Yes | Yes | Yes (ISOBMFF `colr` nclx box) | Yes (TC=16 / SMPTE ST 2084) | Yes (TC=18 / ARIB STD-B67) | 10-bit (prebuilt Sharp), 12-bit (custom build) | CICP and ICC co-exist; CICP takes decode priority if both present | ~93% |
| HEIF/HEIC | Yes | Yes | Yes (nclx box) | Yes | Yes | 10-bit common, 12-bit possible | Uses libheif under the hood; HEVC-based; not deliverable on web without server transcoding | N/A (no browser `<img>` support) |
| TIFF | Yes | Yes | No (TIFF/EP has CICP extensions but non-standard) | Rare (via custom tags) | Rare | 16/32-bit float | Not deliverable as `<img>` in any browser; original-store format only | 0% |
| JPEG XL | Yes | Yes | Yes (ColorEncoding struct) | Yes | Yes | 32-bit float per channel | Safari 17+ native; Chrome 145+ Canary flag; Firefox Nightly only; not production-safe | ~20% (Safari-only in stable browsers as of May 2026) |

**GalleryKit delivery gap:** AVIF output from Sharp uses `withIccProfile('p3')` which embeds an ICC profile. Sharp/libvips does **not** write an nclx CICP box (see Section 5). Browsers that decode AVIF using CICP-first logic will fall through to ICC, which is correct for SDR P3. For a future HDR AVIF delivery path, CICP signaling must be added via post-processing or a build of libvips with nclx support.

---

## 2. Browser Color-Management Matrix

### 2a. `<img>` ICC v2 honoring

| Browser | ICC v2 in `<img>` | Since version | Notes |
|---------|------------------|---------------|-------|
| Safari macOS | Yes, always | Safari 3+ | Full ColorSync pipeline; also converts to display profile |
| Safari iOS | Yes, always | iOS 3+ | Same CoreGraphics pipeline |
| Chrome macOS/Win | Yes, always | Chrome 22+ | Respects both embedded profile and display ICC profile |
| Chrome Linux | Yes | Chrome 22+ | Uses X11 color atoms if present; unreliable on uncalibrated displays (see Quirk 3) |
| Firefox | Yes | Firefox 3.5+ (Gecko 1.9.1) | `gfx.color_management.mode = 2` is the default since Firefox 3.5; tagged-image-only mode |
| Edge | Yes, always | Edge 18+ | Chromium-based since Edge 79; same as Chrome |

### 2b. `<img>` ICC v4 honoring

| Browser | ICC v4 in `<img>` | Default | Pref / override | Notes |
|---------|------------------|---------|----------------|-------|
| Chrome | Yes | On by default | No user pref needed | Full ICC v4 support |
| Safari | Yes | On by default | No user pref needed | Full ICC v4 support |
| Edge | Yes | On by default | No user pref needed | Chromium; same as Chrome |
| Firefox | Partial | **Off by default** | `gfx.color_management.enablev4 = true` in `about:config` | Bug 488800 open ~14 years. The pref allows the profile to be used but uses ICC v4 as if it were v2 (adapted primaries and whitepoint treated as unadapted). As of 2026 this remains unfixed in stable Firefox. XYB-encoded JPEGs look green in Firefox without this pref. |

**GalleryKit note:** The pipeline embeds Apple's Display-P3 ICC (v2-compatible) via `withIccProfile('p3')`. This is safe in Firefox because P3 is an ICC v2 profile distributed by Apple. The v4 gap only matters if an upstream tool generates a v4-only ICC.

### 2c. AVIF SDR decode and render

| Browser | AVIF SDR `<img>` | Since version | Notes |
|---------|-----------------|---------------|-------|
| Chrome | Yes | Chrome 85 (Aug 2020) | Full support including animation |
| Firefox | Yes | Firefox 93 (Oct 2021) | Full support |
| Safari macOS | Yes | Safari 16.1 / macOS Ventura (Oct 2022); retroactively Safari 16.4 for Monterey/Big Sur (Mar 2023) | Software decoder (no GPU acceleration); hardware AVIF decode on A15+ SoCs from iOS 16 |
| Safari iOS | Yes | iOS 16 (Sep 2022) | |
| Edge | Yes | Edge 121 (Jan 2024) | Edge 118–120 had the flag removed before support shipped; avoid relying on Edge 118–120 |
| Samsung Internet | Yes | v14.0 (2021) | |

### 2d. AVIF PQ HDR `<img>` rendering

| Browser | AVIF PQ HDR `<img>` | Notes |
|---------|---------------------|-------|
| Chrome | Yes | Requires HDR-capable display + OS HDR mode. Tonemaps to SDR on non-HDR displays. Content Color Volume (CCV) metadata honored since Chrome 110 (Feb 2023) |
| Edge | Yes | Same Chromium engine |
| Safari | Yes | Safari/WebKit v26+ (WWDC 2025 announcement; ships with iOS 26 / macOS 26). Earlier versions clip HDR to SDR |
| Firefox | Partial | Rec.2100 PQ loaded; rendered as 16-bit SDR document on macOS (no HDR tone-map output). HLG not supported at all in current stable Firefox |

### 2e. AVIF HLG HDR `<img>` rendering

| Browser | AVIF HLG HDR `<img>` | Notes |
|---------|----------------------|-------|
| Chrome | Yes | HLG content tonemapped to SDR on non-EDR displays; displayed as HDR on capable displays |
| Edge | Yes | Same as Chrome |
| Safari | Yes | v26+ only (WWDC 2025). Prior versions: HDR content displays clipped on iOS |
| Firefox | No | `Rec. 2100 HLG transfer characteristic not supported — images loaded as SDR 16-bits-per-channel` (Bugzilla meta bug 1539685). Not expected in stable Firefox in the near term. |

### 2f. WebP ICC profile in `<img>`

| Browser | WebP ICC `<img>` | Notes |
|---------|-----------------|-------|
| Chrome | Yes (static only) | ICC honored in static WebP since Chrome first shipped WebP support. Animated WebP: ICC **ignored** by libwebp (historical design decision for decoder performance). |
| Firefox | Yes (static only) | Firefox WebP support since Jan 2019; static ICC honored. Same animated caveat. |
| Safari | Yes (static only) | WebP support since Sep 2020 / Safari 14. Same animated caveat. |
| Edge | Yes (static only) | Chromium; same as Chrome. |

**GalleryKit note:** The pipeline only generates static WebP. The animated-WebP ICC gap is not relevant here.

### 2g. JPEG ICC profile in `<img>`

All major browsers have honored embedded JPEG ICC profiles since approximately 2010. There are no current version-gated caveats for sRGB or Display-P3 ICC v2 JPEG. Edge cases: JPEG with no APP2 marker is assumed sRGB by all browsers. CMYK JPEG (APP2 CMYK profile) renders inconsistently: Safari and Chrome attempt conversion; Firefox often renders inverted or skips profile.

### 2h. `@media (color-gamut: p3)` accuracy

| Browser / Platform | Accuracy | Known issues |
|-------------------|----------|-------------|
| Safari macOS | High | Queries ColorSync display profile; accurate on factory-calibrated Apple displays |
| Safari iOS | High | Returns `true` on iPhone 7+ / iPad Pro 2015+ which have factory P3 displays |
| Chrome macOS | High | Same underlying OS display query |
| Chrome Windows | Medium | Returns `true` only when OS reports a wide-gamut display profile; false on uncalibrated sRGB monitors |
| Chrome Linux | Low reliability | No ICC profile infrastructure on most Linux desktops; query may return `false` on a capable display (false negative) or `true` on a generic sRGB display if the GPU driver reports wide-gamut capabilities without verifying the panel. No dedicated Chromium bug fix confirmed as of May 2026. |
| Firefox | Returns `false` always for `p3` | Tracked in MDN compat-data issue #21422. Firefox does not implement `color-gamut: p3` matching even on P3-capable displays. |
| Edge | Same as Chrome on given OS | Chromium engine |

**GalleryKit implication:** The `gamut-p3-badge` CSS rule (`.gamut-p3-badge { display: none } @media (color-gamut: p3) { ... display: inline-block }`) will never show the P3 badge in Firefox regardless of display capability.

### 2i. `@media (dynamic-range: high)` accuracy

See Section 7 for full treatment.

### 2j. Canvas `colorSpace: 'display-p3'`

| Browser | Support | Since version |
|---------|---------|---------------|
| Safari | Yes | Safari 15.2 (Dec 2021) — first browser to ship; covers `getContext('2d', {colorSpace:'display-p3'})`, `getImageData`, `putImageData`, `drawImage` |
| Chrome | Yes | Chrome 94 (Oct 2021) for `getImageData`/`putImageData`/`drawImage`; Chrome 92 for `ImageData.colorSpace` |
| Firefox | Partial | `drawingBufferColorSpace` for WebGL works since Firefox 122 (Oct 2024). 2D canvas `colorSpace` parameter not confirmed as fully shipped in stable Firefox as of May 2026. |
| Edge | Yes | Chromium; same as Chrome |

### 2k. Canvas `colorSpace: 'rec2020'` + `colorType: 'float16'`

| Feature | Status | Notes |
|---------|--------|-------|
| `colorSpace: 'rec2020'` in Canvas 2D | Not in spec yet | Explicitly deferred from the canvas color space proposal. Standardization disputes about gamut definition and required bit depth blocked inclusion. |
| `colorType: 'float16'` (Canvas 2D) | In HTML Living Standard | Chrome implementing; Safari in progress; Firefox in progress. `pixelFormat: 'rgba-float16'` uses `Float16Array`. Not production-stable across all browsers as of May 2026. |
| `rgba16float` texture format in WebGPU | Yes | `GPUCanvasContext.configure({ format: 'rgba16float', colorSpace: 'display-p3' })` is valid in Chrome and Safari with WebGPU support. |

### 2l. CSS `color(display-p3 ...)` and `color(rec2020 ...)`

Both are in **CSS Color Module Level 4** and are universally supported in modern browsers as of 2025. Global coverage exceeds 92% on Can I Use. Devices without P3 displays apply gamut mapping (clip to sRGB). The `color(rec2020 ...)` syntax is accepted but rec2020 colors outside the display's physical gamut are clipped identically.

Sources: [Chrome for Developers — Access more colors](https://developer.chrome.com/docs/css-ui/access-colors-spaces), [MDN color-gamut](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/color-gamut)

### 2m. OKLCH

Universally supported. `oklch()` is in CSS Color Level 4; all major browsers as of Chrome 111, Firefox 113, Safari 15.4. Can I Use shows >92% global coverage in Q2 2025. Out-of-gamut OKLCH values are automatically gamut-mapped by the browser. GalleryKit already uses OKLCH for UI tokens in the `@supports (color: oklch(0 0 0))` block in `globals.css`.

---

## 3. Browser Quirks List

**Quirk 1 — iOS Safari software-only AVIF decoder**
Safari on iOS uses the OS image decoder (ImageIO), which is software-only for AVIF. On iPhone 15 and earlier, AVIF decoding is CPU-bound. A single 4K 10-bit AVIF can allocate 200–400 MB of decoded bitmap memory. Safari on iPhone has a fluctuating hard memory cap (typically 1.5 GB after sustained use, up to 3 GB after a fresh restart). Large AVIF images at maximum configured size (4096 px) can trigger page-reload / OOM on older iPhones. Confirmed behavior via Apple Developer Forums (thread 761666) and SDWebImage issue #3604 (iOS 17 beta 7 AVIF force-decode crash).

**Quirk 2 — Edge 118–120 AVIF gap**
Microsoft removed the AVIF feature flag in Edge 118 before shipping default support, then shipped it in Edge 121 (Jan 2024). Visitors on Edge 118, 119, or 120 see the JPEG fallback from `<picture>` even on a modern Windows 11 machine. This affects a small population but is not zero.

**Quirk 3 — Chrome Linux `(color-gamut: p3)` unreliability**
On Linux desktops without a system color profile (common on Ubuntu with generic GPU drivers), Chrome may return `false` for `(color-gamut: p3)` on a physically capable wide-gamut display (false negative). Conversely, if the GPU driver advertises wide-gamut capability without the panel backing it, Chrome may return `true` (false positive). There is no authoritative Chromium bug fix for this as of May 2026. The `--display-gamut: p3` CSS custom property set by GalleryKit's globals.css would be wrong on such systems.

**Quirk 4 — Firefox ICC v4 default-off**
Firefox stable has `gfx.color_management.enablev4 = false` by default (bug 488800, open since ~2009, landed in Nightly but not yet promoted to stable as of May 2026). ICC v4 profiles are parsed but adapted primaries/whitepoint are treated as unadapted v2 values. GalleryKit embeds Apple's Display-P3 ICC (a v2 profile), so this does not affect current output. Future use of ICC v4 profiles from editing tools would render incorrectly in stock Firefox without the user toggling the pref.

**Quirk 5 — Firefox `@media (color-gamut: p3)` always false**
Firefox stable does not implement `(color-gamut: p3)` matching regardless of actual display capability (MDN compat-data issue #21422). The `gamut-p3-badge` badge and any future CSS that branches on this query will silently fail for Firefox users on P3 displays.

**Quirk 6 — macOS battery optimization silences HDR**
When "Optimize video streaming while on battery" is enabled in macOS System Settings > Battery, macOS plays HDR content in SDR. The `@media (dynamic-range: high)` query returns `false` on a MacBook Pro M3 that physically supports HDR when this setting is active and the machine is on battery. This is a false negative. The battery setting path: System Settings > Battery > (uncheck "Optimize video streaming while on battery").

**Quirk 7 — macOS Sonoma 14.1 HDR availability bug**
A documented bug in macOS Sonoma 14.1 limits HDR availability depending on the active display resolution and refresh rate. At certain high-refresh-rate modes on some external displays, `(dynamic-range: high)` returns `false` even when the display and OS are HDR-capable. Fixed in Sonoma 14.2+.

**Quirk 8 — macOS "Use HDR" toggle required for external displays**
On macOS, the "High Dynamic Range" toggle appears in System Settings > Displays only for third-party external displays that advertise HDR10 support. It does NOT appear for Apple's own displays (built-in MacBook Pro, Pro Display XDR) because those are always in EDR mode. On external displays the toggle is opt-in; `(dynamic-range: high)` returns `false` until the user enables it. This is a significant source of false negatives for HDR gallery visitors on professional external monitor setups.

**Quirk 9 — Animated WebP ignores ICC profile in libwebp**
libwebp ignores ICC profiles in animated WebP files; this was an explicit design decision for decoder performance. All animated WebP files are treated as sRGB regardless of any embedded `ICCP` chunk. This does not affect GalleryKit today (static WebP only) but is a trap for future animation features.

**Quirk 10 — AVIF without ICC profile and CICP-only AVIF in Firefox pre-fix**
If an AVIF file uses only CICP/nclx color signaling (no embedded ICC profile), Firefox historically fell back to BT.709/sRGB decode, rendering wide-gamut AVIF incorrectly. This was tracked in Bugzilla 1634741. The fix landed but the practical concern remains: GalleryKit's Sharp pipeline embeds an ICC profile via `withIccProfile()`, which provides the necessary colorimetric anchor for all browsers including older Firefox. Stripping the ICC profile from AVIF output (e.g., to reduce file size) would break color accuracy in Firefox.

**Quirk 11 — `<picture>` `type=` checking is synchronous; `media=` is reactive**
`type=` is evaluated before the fetch — the browser skips a `<source>` immediately if it does not support the MIME type, without any network request. `media=` is evaluated at selection time and re-evaluated when the viewport changes. On first paint, the browser may select a source based on the initial viewport, then re-evaluate `media=` conditions on resize. Since GalleryKit uses only `type=` (not `media=`), this difference is moot today but becomes relevant if adaptive-resolution switching via `media=` is added.

**Quirk 12 — Sharp prebuilt binaries: AVIF limited to 8-bit per Sharp docs, overridden by probe**
Sharp's official npm documentation states "prebuilt binaries support a bit depth of 8 only" for AVIF. GalleryKit works around this via the `canUseHighBitdepthAvif()` probe (a 2×2 10-bit encode test at startup). On Docker Linux with a libheif-capable build, this probe succeeds and 10-bit is used. On some environments (WSL2 Ubuntu 24.04, minimal Alpine images without libheif), the probe fails and the pipeline gracefully degrades to 8-bit AVIF. The 10-bit path is not guaranteed in all deployment environments.

---

## 4. Display Capability Table

| Display class | Approx P3 coverage | Approx AdobeRGB coverage | Peak luminance (typical) | HDR certification | OS color pipeline | Notes |
|---------------|--------------------|--------------------------|--------------------------|-------------------|-------------------|-------|
| Office sRGB IPS (e.g., Dell P2419H) | ~72% DCI-P3 | ~56% AdobeRGB | 250–350 nits | None / sRGB only | Windows ICM (sRGB passthrough), macOS ColorSync (limited), Linux (no default CM) | `(color-gamut: p3)` returns false on a properly calibrated system |
| MacBook Pro M3 internal (Liquid Retina XDR) | ~100% DCI-P3 | ~75% AdobeRGB | 1000 nits sustained, 1600 nits peak | ProMotion; Apple EDR; no HDR10 cert | macOS ColorSync + EDR; always-on HDR via EDR pipeline | `(dynamic-range: high)` returns true; `(color-gamut: p3)` true |
| Apple Pro Display XDR | ~100% DCI-P3, ~97% AdobeRGB | ~97% AdobeRGB | 1000 nits sustained, 1600 nits peak (XDR mode) | No HDR10 cert (proprietary EDR); HDR10 content playable | macOS ColorSync + EDR | Reference display; needs external GPU on Mac mini; `(dynamic-range: high)` true |
| LG OLED HDR TV (e.g., LG C3 series) | ~98% DCI-P3 | ~74% AdobeRGB | ~800 nits peak (OLED brightness wall) | HDR10, HDR10+, Dolby Vision, HLG | Smart TV WebOS browser; or external Chrome/Edge on connected PC with Windows HDR | When used as PC monitor with Windows 11 "Auto HDR": `(dynamic-range: high)` true. HDR10+ and Dolby Vision metadata ignored by browser rendering path. |
| iPhone 15 Pro internal (Super Retina XDR) | ~100% DCI-P3 | ~76% AdobeRGB | 2000 nits peak (outdoor) | ProMotion; Apple EDR; supports HDR10 and Dolby Vision content | iOS CoreGraphics + EDR pipeline | `(dynamic-range: high)` true; `(color-gamut: p3)` true; software AVIF decoder; 10-bit AVIF memory risk on A15 and earlier models |
| Google Pixel 8 internal | ~100% DCI-P3 (rated) | ~77% AdobeRGB | 1400 nits peak (HDR boost) | HDR10+; no Dolby Vision | Android color management (libhwui with color profile awareness) | Chrome Android: `(color-gamut: p3)` true; `(dynamic-range: high)` true on Pixel 8 if Android HDR mode is active |
| BenQ SW270C (Adobe RGB professional) | ~99% AdobeRGB, ~100% DCI-P3 | ~99% AdobeRGB | 350 nits | No HDR cert | Windows ICM with hardware LUT; macOS ColorSync | Wide-gamut display with hardware color management; P3-tagged AVIF displays correctly; no HDR |

**Color primaries reference (xy chromaticities, CIE 1931):**
- sRGB / BT.709: R (0.640, 0.330) G (0.300, 0.600) B (0.150, 0.060) D65 whitepoint
- Display P3 / DCI-P3-D65: R (0.680, 0.320) G (0.265, 0.690) B (0.150, 0.060) D65 whitepoint
- AdobeRGB (1998): R (0.640, 0.330) G (0.210, 0.710) B (0.150, 0.060) D65 whitepoint
- Rec.2020 / BT.2020: R (0.708, 0.292) G (0.170, 0.797) B (0.131, 0.046) D65 whitepoint

---

## 5. Codec Library Specifics

### Sharp 0.34.x (libvips backend)

**Bundled library versions (Sharp 0.34.x prebuilt, Linux x64):**
- libvips: ~8.16.x
- libheif: ~1.17–1.18 (AVIF encode/decode via libavif)
- libavif: ~1.0–1.1 (linked into libheif)
- AV1 encoder in prebuilt: **libaom** (AOMedia AV1 reference encoder). SVT-AV1 and rav1e are **not** included in Sharp's prebuilt binaries; they require a custom libvips build. macOS prebuilt uses the same libaom.
- libwebp: ~1.4.x (ICC support since libwebp 1.0, April 2018)

**Sharp AVIF encoder API (relevant to GalleryKit):**
```typescript
sharp(input).avif({ quality: 85, effort: 6, bitdepth: 10 })
```
- `quality`: 1–100 mapped to libaom quantizer. Effort 6 ≈ `aomenc --cpu-used=2` (slow encoder, smaller files).
- `bitdepth`: 8 or 10. 12-bit requires a custom libvips build — not available in Sharp prebuilt.
- `chromaSubsampling`: defaults to 4:2:0 for AVIF; not overridable via Sharp API. libavif handles chroma subsampling internally.

**CICP / nclx signaling in Sharp/libvips:**
Sharp does NOT expose a CICP API. `withIccProfile('p3')` embeds the Display-P3 ICC profile as an ICC `colr` box. libvips does not currently write an nclx `colr` box in AVIF output — this is confirmed by a May 2025 blog post by a libvips user and by libvips issue #3912 ("Add nclx->icc colour management to heifload"). For HDR AVIF delivery (PQ/HLG), CICP signaling is required to tell the decoder the transfer function; without it, browsers default to BT.709/sRGB transfer and HDR content appears clipped or washed out. The GalleryKit color-detection module parses the nclx box from incoming HEIF/AVIF originals, but the outgoing AVIF only carries an ICC profile — sufficient for SDR P3 delivery, insufficient for true HDR output.

**Sharp WebP encoder ICC embedding:**
```typescript
sharp(input).toColorspace('p3').withIccProfile('p3').webp({ quality: 90 })
```
`withIccProfile()` writes the ICC profile into the WebP `ICCP` chunk (RIFF-based). This is a static chunk and is honored by all major browsers for static WebP since the respective browser versions listed in Section 2f.

**aomenc (libaom) vs libavif vs SVT-AV1:**
- Sharp prebuilt: libaom only. Effort 6 maps to `cpu-used=2`. At effort 6, libaom is 3–5× slower than SVT-AV1 for equivalent quality but produces files 8–15% smaller. For a personal gallery that amortizes encode cost over many views, effort 6 is the right trade-off.
- SVT-AV1 produces comparable quality to libaom at much lower CPU cost; Sharp prebuilt does not bundle it.
- rav1e has good quality but high memory usage; also not in prebuilt.
- Custom libvips + SVT-AV1 build is possible but requires compiling libvips from source and is not covered by Sharp's npm install automation.

---

## 6. `<picture>` Source-Selection Algorithm

Source: [WHATWG HTML Living Standard — embedded content](https://html.spec.whatwg.org/multipage/embedded-content.html)

**Evaluation order:**

1. The browser iterates `<source>` elements in **document order** (top to bottom).
2. For each `<source>`:
   a. If a `media` attribute is present, evaluate the media query. If it does not match the current environment, skip this `<source>`.
   b. If a `type` attribute is present, check if the browser supports the MIME type. If the type is unsupported, **skip immediately without a network request**.
   c. If both `media` and `type` pass (or are absent), use the `srcset` / `src` from this `<source>`.
3. If no `<source>` matches, fall back to the `<img>` element's `src` / `srcset`.

**Key rule: `type` is checked before the fetch.** The browser does not need to download the resource to determine if it supports the type. A browser that does not support AVIF (`image/avif`) skips the first `<source>` without any network round-trip and proceeds to the WebP `<source>`.

**`media` vs `type` interaction:**
Both attributes are evaluated in sequence per `<source>`. There is no global ordering between attributes — if a `<source>` has both `media` and `type`, both must match. In GalleryKit's current markup:
```html
<source type="image/avif" srcSet="..." sizes="..." />
<source type="image/webp" srcSet="..." sizes="..." />
<img src="..." srcSet="..." sizes="..." />
```
No `media=` attribute is present. The browser selects the first `<source>` whose `type` is supported. AVIF wins on Chrome 85+, Firefox 93+, Safari 16.1+, Edge 121+. WebP wins on older browsers that support WebP but not AVIF (Safari 14–15, Edge 18–90). JPEG fallback wins on everything else.

**`media=` reactivity:** Unlike `<video>`/`<audio>`, the `<picture>` source selection reacts to viewport/environment changes in real time. The browser re-runs the selection algorithm on `resize`. Since GalleryKit uses no `media=`, this is not currently relevant but is the mechanism that would enable art-direction or resolution switching by viewport.

**If `<source>` matches `media` but type is unsupported:** The browser skips the source (type check fails), continues to the next source. The user sees the next matching fallback format — correct degradation.

**Spec reference:** [WHATWG — The source element](https://html.spec.whatwg.org/dev/embedded-content.html), [MDN — `<picture>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/picture)

---

## 7. HDR Display-Detection Accuracy (`@media (dynamic-range: high)`)

The spec requires both display hardware capability **and** OS HDR mode to be active. The query does not measure actual peak luminance.

### Platform behavior

| Platform | Auto-detect HDR? | User action required | False-negative cases |
|----------|-----------------|----------------------|----------------------|
| macOS (built-in display: MacBook Pro, iMac) | Yes — Apple EDR always on | None; `(dynamic-range: high)` is true as long as the display is on and brightness is above the base SDR level | Battery optimization: "Optimize video streaming while on battery" silences EDR for video; may affect the media query. macOS Sonoma 14.1 bug at certain resolutions/refresh rates. |
| macOS (external HDR display) | No | User must toggle "High Dynamic Range" in System Settings > Displays | Toggle is visible only for HDR10-certified third-party displays. Pro Display XDR always shows EDR (no toggle needed). Common false negative: high-nit displays that do not advertise HDR10 in EDID. |
| iOS / iPadOS | Yes — automatic | None | Battery saver / Low Power Mode may reduce brightness below the EDR threshold. |
| Android (Pixel 8, Samsung S23+) | Typically auto | Some OEMs require "HDR video mode" toggle in Display Settings | Inconsistent across Android skins. Chrome Android queries the system HDR capability via `Display.isHdr()`. |
| Windows 11 (HDR-certified display) | Auto-on for certified displays | None (Windows 11 auto-enables HDR on new connection) | Some displays advertise HDR10 in EDID but cannot render it usefully (e.g., HDR400 displays with only 400 nits peak — essentially the same as SDR). |
| Windows 10 | No — manual | User must enable "Windows HD Color" in Display Settings | Major false-negative source; Windows 10 users on capable hardware commonly do not know to enable this. |
| Chrome Linux | Unreliable | Depends on compositor (KWin/Mutter HDR mode) | KDE Plasma 6 with HDR enabled: `(dynamic-range: high)` returns true in Chrome 125+. GNOME: HDR support in Mutter is experimental as of 2025. Most Linux desktop setups return false. |

### False-positive cases

Theoretical false positive: a display that claims HDR10 capability in EDID but physically peaks at ≤400 nits (HDR400 certification). `(dynamic-range: high)` returns `true` but the display cannot actually show meaningful HDR. On such a display, showing a `hdr-badge` badge is misleading to users. GalleryKit already shows the HDR badge only when `(dynamic-range: high)` matches, so this is an existing exposure.

### GalleryKit implication

The inline `<style>` in `photo-viewer.tsx` renders the `.hdr-badge` only when `(dynamic-range: high)` is active. This correctly suppresses the HDR badge on SDR displays. The false-negative cases above mean some visitors on genuine HDR displays will not see the badge if their OS HDR mode is off, which is appropriate behavior (if the OS is in SDR mode, the HDR rendering path is not active anyway).

---

## 8. Canvas P3 Source-Fetch Behavior

**Spec:** [WHATWG HTML Living Standard — The canvas element](https://html.spec.whatwg.org/multipage/canvas.html), [WICG Canvas Color Space Proposal](https://github.com/WICG/canvas-color-space/blob/main/CanvasColorSpaceProposal.md)

### What happens when `drawImage` is called with a P3-tagged AVIF source

The `drawImage` method performs color-space conversion from the source's embedded color space to the canvas's backing-store color space.

| Canvas context `colorSpace` | Source image | Conversion |
|----------------------------|-------------|-----------|
| `srgb` (default) | P3-tagged AVIF | Browser converts P3 → sRGB. Out-of-sRGB-gamut P3 colors are **clipped** to sRGB [0,1] range. Wide-gamut detail is permanently lost. |
| `display-p3` | P3-tagged AVIF | No conversion needed; P3 pixels land in P3 canvas. Colors preserved. |
| `display-p3` | sRGB JPEG | sRGB → P3 matrix applied. No data loss (sRGB is a subset of P3). |

**Browser implementations:**

- **Safari (all versions with P3 canvas support):** Honors source ICC profile in `drawImage`. P3 source drawn to P3 canvas: no conversion. P3 source drawn to sRGB canvas: gamut clip.
- **Chrome 94+:** Same behavior as Safari. `drawImage` performs color-space conversion based on the image's embedded ICC profile.
- **Firefox:** AVIF color issues in `drawImage` historically stemmed from Firefox not doing ICC-based color management for all web content (Bugzilla 1634741). Images drawn to canvas without ICC profiles are treated as sRGB. When AVIF carries an ICC profile, Firefox should convert correctly, but this has historically had bugs. `drawImage` on a Display-P3 canvas in Firefox is partially implemented as of May 2026.

**AVIF without ICC profile (CICP-only):**
If a source AVIF has only an nclx CICP box (no ICC profile), the browser's handling in `drawImage` varies. The WICG proposal notes that a CICP-described AVIF "will likely not contain an ICC profile" and that "it would be inappropriate to fall back to sRGB." Chrome and Safari honor CICP color info in `drawImage`. Firefox has historically defaulted to sRGB for CICP-only AVIF sources drawn to canvas.

**GalleryKit context:**
GalleryKit does not use canvas for photo rendering. The `Histogram` component (`histogram.tsx`) draws the JPEG or AVIF thumbnail into a canvas for the histogram computation. It does not specify a `colorSpace` parameter, so the default sRGB canvas is used. When drawing a P3-tagged AVIF into an sRGB canvas, P3 colors are clipped — the histogram reflects sRGB-clipped values, not the full P3 gamut. This means the histogram may underrepresent saturation for P3 sources. The practical impact is minor: the histogram is a display aid, not a color-critical analysis tool.

**Source: WebKit blog** — [Wide Gamut 2D Graphics using HTML Canvas](https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/)

---

## Summary: GalleryKit-Specific Gaps

| Gap | Risk level | Notes |
|-----|-----------|-------|
| No CICP nclx in AVIF output | Medium (future HDR path blocked) | Current SDR P3 output is correct via ICC. HDR delivery requires CICP; libvips does not yet write nclx boxes. |
| `(color-gamut: p3)` never true in Firefox | Low (badge cosmetic only) | P3 badge will never render for Firefox users. No impact on color delivery. |
| AVIF 10-bit iOS OOM on large images | Medium | 4096 px AVIF on iPhone models with <4 GB RAM may trigger page reload. Serving a smaller size (e.g., 2048 px max to iOS Safari via UA detection or `media=`) would mitigate. |
| Histogram P3 clip on sRGB canvas | Low | Histogram is cosmetic; consider specifying `colorSpace: 'display-p3'` in the canvas context for future accuracy. |
| `--display-hdr` CSS var set but not consumed | None (dead code currently) | `@media (dynamic-range: high) { :root { --display-hdr: true; } }` is defined but no render path reads it for photo delivery decisions. |
| WebP ICC ignored in animated WebP | N/A | Not applicable; pipeline generates static WebP only. |
| Edge 118–120 AVIF gap | Very low | Edge 118–120 users see JPEG fallback; `<picture>` degrades correctly. |

---

## Sources

- [AVIF browser support — Can I Use](https://caniuse.com/avif)
- [AVIF2Anything browser support guide 2025](https://www.avif2anything.com/blog/browser-support-avif-2025)
- [Mozilla Bugzilla 488800 — qcms ICC v4](https://bugzilla.mozilla.org/show_bug.cgi?id=488800)
- [Mozilla Bugzilla 1634741 — AVIF color space support](https://bugzilla.mozilla.org/show_bug.cgi?id=1634741)
- [Mozilla Bugzilla 1539685 — HDR meta bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1539685)
- [WICG Canvas Color Space Proposal](https://github.com/WICG/canvas-color-space/blob/main/CanvasColorSpaceProposal.md)
- [WebKit blog — Wide Gamut 2D Graphics using HTML Canvas](https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/)
- [Chrome for Developers — Access more colors and new spaces](https://developer.chrome.com/docs/css-ui/access-colors-spaces)
- [MDN — color-gamut media feature](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/color-gamut)
- [MDN — `<picture>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/picture)
- [WHATWG HTML Living Standard — embedded content](https://html.spec.whatwg.org/multipage/embedded-content.html)
- [WHATWG HTML Living Standard — canvas element](https://html.spec.whatwg.org/multipage/canvas.html)
- [Sharp npm package documentation](https://sharp.pixelplumbing.com/api-output/)
- [libvips issue #3912 — nclx colour management](https://github.com/libvips/libvips/issues/3912)
- [libavif CHANGELOG](https://github.com/AOMediaCodec/libavif/blob/main/CHANGELOG.md)
- [SDWebImage issue #3604 — iOS 17 AVIF force-decode crash](https://github.com/SDWebImage/SDWebImage/issues/3604)
- [Apple Developer Forums — Safari memory cap](https://developer.apple.com/forums/thread/761666)
- [MDN compat-data issue #21422 — color-gamut Firefox](https://github.com/mdn/browser-compat-data/issues/21422)
- [Greg Benz — Safari now supports HDR photography (WWDC 2025)](https://gregbenzphotography.com/photography-reviews/apple-safari-now-supports-hdr-photography/)
- [JPEG XL — Safari support](https://www.jpegxl.io/tutorials/safari/)
- [Reupen's blog — Playing around with HDR AVIF images (May 2025)](https://blog.yuo.be/2025/05/08/playing-around-with-hdr-avif-images/)
- [OKLCH in CSS — Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
