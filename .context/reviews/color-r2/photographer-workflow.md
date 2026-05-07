# GalleryKit — Photographer Workflow Review (Round 2)
## Color Journey: Post-30-Commit State

**Reviewer perspective**: working professional photographer delivering to clients and end-viewers via GalleryKit.
**Premise**: photos arrive post-cull, post-edit. This review covers delivery only: upload → display → share.
**Baseline**: `color-deep/photographer-workflow.md` is the round-1 document. This review focuses on what changed and what intent now flows through correctly.

**Commits surveyed** (approximate span, newest to oldest):
```
03ef7a7  feat(color): DCI-P3 white-point adaptation, Sharp hardening, memory cap (WI-12, WI-14, WI-15)
6b1619d  feat(hdr): add picture media=dynamic-range:high source (WI-08)
aa2e7a9  feat(ui): dynamic download button label based on color_pipeline_decision
b74260a  feat(histogram): gate AVIF source on canvas-P3 + add sRGB-clipped indicator
97a1164  feat(ui): surface color_pipeline_decision in admin Color Details panel
99e23c7  fix(og): always emit sRGB ICC on OG JPEG regardless of source gamut
84c23a0  fix(upload): write EXIF ColorSpace to color_space, display ICC in UI
308afb0  refactor(color): consolidate extractIccProfileName to shared module
0481fdb  docs(color): document HDR AVIF + rendering intent deferral (US-CM12)
fca55fb  feat(color): pipeline version 5 ETag + backfill script (US-CM11)
b0a2cf6  feat(color): remove .arw from upload whitelist + calibration tooltip (US-CM10)
09582bb  feat(color): EXIF panel color details + HDR badge (US-CM09)
538f1f3  feat(og): wide-gamut OG images with ICC profile embedding
12ac8b6  feat(color): gamut-aware download disclosure (US-CM07)
3ba89f7  feat(color): histogram prefers AVIF for wide-gamut images (US-CM06)
709f790  feat(color): wider-than-P3 → P3 mapping for AVIF (Adobe/ProPhoto/Rec.2020)
4863a6f  feat(color): wide-gamut WebP/JPEG with force_srgb_derivatives toggle
af5f158  feat(color): add color_pipeline_decision observability column + resolver
```

---

## Pipeline State Summary

`resolveColorPipelineDecision` and `resolveAvifIccProfile` are two separate functions that serve different purposes. This split is the most important implementation detail to understand before reading the per-persona sections.

| Source ICC | `resolveColorPipelineDecision` (DB audit label) | `resolveAvifIccProfile` (actual AVIF encode) | Actual output ICC |
|---|---|---|---|
| Display P3 / P3-D65 | `p3-from-displayp3` | `p3` | P3 |
| DCI-P3 | `p3-from-dcip3` | `p3` | P3 (with Bradford D50→D65 adaptation) |
| Adobe RGB | `srgb-from-adobergb` | `p3-from-wide` | **P3** |
| ProPhoto RGB | `srgb-from-prophoto` | `p3-from-wide` | **P3** |
| Rec.2020 | `srgb-from-rec2020` | `p3-from-wide` | **P3** |
| sRGB / unknown | `srgb` | `srgb` | sRGB |

The DB audit label for Adobe RGB still reads `srgb-from-adobergb` (the comment block on line 400 of `process-image.ts` says "currently sRGB clip") but the actual AVIF/WebP/JPEG encode path follows `resolveAvifIccProfile`, which returns `p3-from-wide`. All three derivatives receive P3 ICC. The audit label is stale — it records what the pipeline *intended* when the `color_pipeline_decision` resolver was first written, not what the encode actually does today. This is a display accuracy bug in the admin panel (the admin sees `srgb-from-adobergb` but the file is P3). The encode itself is correct.

The `isWideGamutSource` flag in `processImageFormats` is derived from `resolveAvifIccProfile`, not `resolveColorPipelineDecision`, so the P3 encode path is active.

---

## Persona 1 — iPhone P3 + HDR Shooter

**What changed**: Nothing directly changes this persona's delivery outcome. The HDR encoder is formally deferred (`docs(color): document HDR AVIF + rendering intent deferral`, commit `0481fdb`). `HDR_FEATURE_ENABLED` (`feature-flags.ts` line 10) evaluates `process.env.NEXT_PUBLIC_HDR_FEATURE_FLAG === 'true'`, which defaults to `false`. The `<picture>` element's HDR source block (`photo-viewer.tsx` lines 413–420) is guarded by this flag:

```tsx
{HDR_FEATURE_ENABLED && image.is_hdr && baseAvif && (
    <source
        type="image/avif"
        srcSet={imageSizes.map(w => `${imageUrl(`/uploads/avif/${baseAvif}_hdr_${w}.avif`)} ${w}w`).join(', ')}
        sizes={photoViewerSizes}
        media="(dynamic-range: high)"
    />
)}
```

With `HDR_FEATURE_ENABLED = false`, the HDR source is never rendered into the DOM regardless of whether `is_hdr = true`. The `hdrExists` HEAD-request probe (`photo-viewer.tsx` lines 232–240) only fires when `image.is_hdr` is truthy, but because the pipeline never emits `_hdr.avif` files, the probe returns 404 and `hdrExists` stays `false`.

**What the photographer gets today**: An iPhone HEIF with gain-map is processed through Sharp's default decode path. The gain-map secondary image (MPF structure) is silently discarded. `detectColorSignals()` correctly identifies `is_hdr = true` and `transfer_function = 'pq'` from the nclx box, and these are stored in the DB. In the info panel, expanding Color Details shows "Transfer Function: PQ (ST 2084)" and — on an HDR-capable display — the HDR badge (amber, CSS-gated by `@media (dynamic-range: high)`, `photo-viewer.tsx` lines 878–891) will appear. The badge is informational only; it does not affect what bytes are served.

The served AVIF is P3 SDR. On an iPhone 15 Pro, the viewer sees a correctly P3-rendered image without the HDR luminance headroom. The photographer's gain-map work is not delivered; the gallery stores a permanent record (`is_hdr = true`) that the intent existed.

**Net change from round 1**: The HDR badge in Color Details is new (US-CM09). The formal deferral documentation is new. The delivery outcome is unchanged: SDR P3 AVIF.

---

## Persona 2 — DSLR Adobe RGB Enthusiast

**What changed**: The `feat(color): wider-than-P3 → P3 mapping` commit (`709f790`) is the core improvement. `resolveAvifIccProfile` now returns `p3-from-wide` for Adobe RGB sources, and `processImageFormats` runs `pipelineColorspace('rgb16')` before converting to P3. All three derivatives (AVIF, WebP, JPEG) receive P3 ICC.

**Walk-through**:

1. Photographer uploads a Canon R5 JPEG with embedded "Adobe RGB (1998)" ICC.
2. `extractIccProfileName()` (now in shared `@/lib/icc-extractor.ts` after `308afb0`) returns `"Adobe RGB (1998)"`.
3. `resolveAvifIccProfile("Adobe RGB (1998)")` → `p3-from-wide`. `isWideGamutSource = true`.
4. `processImageFormats` runs `sharp(inputPath, ...).pipelineColorspace('rgb16').resize(...)` for each size, then `.toColorspace('p3').withIccProfile('p3').avif(...)`. The 16-bit intermediate kills the edge halos and desaturation that gamma-space resize introduced in earlier versions.
5. `resolveColorPipelineDecision("Adobe RGB (1998)")` → `srgb-from-adobergb`. This stale label is stored in DB as `color_pipeline_decision`.

**What the admin sees in Color Details**: "Color Space: Adobe RGB (1998)" with a P3 badge (line 749: `icc_profile_name.toLowerCase().includes('p3')` — this is false for "Adobe RGB (1998)", so **no P3 badge appears**). The "Color primaries" row shows "Adobe RGB". The "Color pipeline" row (admin-only) shows "sRGB (from Adobe RGB)" — which is factually wrong; the served AVIF is P3. The download button label (line 947) checks `color_pipeline_decision?.startsWith('p3-from-')` — `srgb-from-adobergb` does not match `p3-from-`, so the button reads "Download JPEG" rather than "Download (Display P3 JPEG)".

**Persona-visible improvement**: The AVIF now carries genuine P3 pixel values converted from Adobe RGB via the rgb16 pipeline — a real improvement for viewers with P3-capable displays. The ~90% of Adobe RGB that overlaps P3 is now faithfully delivered rather than being clipped to sRGB. On a MacBook Pro M-series screen, the forest greens and saturated cyans that are inside the P3 gamut now render correctly.

**Residual gap**: The admin panel labels are inconsistent with actual delivery. The `color_pipeline_decision` value `srgb-from-adobergb` misleads the photographer into thinking their image was clipped to sRGB; it was not. The download button primary label does not signal P3 delivery for this case. The P3 badge in the Color Space row does not appear.

---

## Persona 3 — Lightroom ProPhoto Pro

**What changed**: Same `p3-from-wide` routing as Persona B. ProPhoto JPEG now produces P3 AVIF/WebP/JPEG rather than sRGB-clipped derivatives.

**Scenario A — ProPhoto JPEG**: `resolveAvifIccProfile("ProPhoto RGB")` → `p3-from-wide`. Pipeline converts to P3 with rgb16 intermediate. Most visible real-world colors survive the ProPhoto→P3 conversion; only the extreme outer ProPhoto gamut (certain pure Lightroom-synthetic saturated values, heavily saturated yellows in RAW processing) is clipped. The served AVIF is P3 — better than the previous sRGB clip. In the admin Color Details panel, "Color pipeline" shows "sRGB (from ProPhoto)" — again stale/misleading.

**Scenario B — sRGB JPEG**: unchanged, sRGB throughout, correct.

**Scenario C — Display P3 JPEG**: `resolveColorPipelineDecision` → `p3-from-displayp3`. `resolveAvifIccProfile` → `p3`. Both functions agree. The admin panel's "Color pipeline" row correctly shows "P3 (from Display P3)". Download button label shows "Download (Display P3 JPEG)". This is the one case where the pipeline label is accurate.

**Histogram improvement** (US-CM06, `b74260a`): For a ProPhoto source, `colorPrimaries = 'prophoto'`, `WIDE_GAMUT_PRIMARIES` contains `'prophoto'`, `isWideGamut = true`. On a P3-capable display with AVIF support, `preferAvif = true` and the histogram decodes from the AVIF derivative using a Display-P3 canvas context (`histogram.tsx` lines 125–131). The histogram header shows "(ProPhoto)" gamut label (line 225) and no "sRGB clipped" indicator when the P3 context path is taken. On an sRGB display, the histogram falls back to the JPEG source and shows "(sRGB clipped)" — a new and accurate disclosure that tells the photographer the histogram is quantized to sRGB. This is a genuine audit improvement.

**What the pro gains**: The histogram "sRGB clipped" indicator is a new, visible signal that rounds out the audit story when the photographer views their ProPhoto upload on a non-P3 display. For ProPhoto exports destined for fine-art printing, the P3 AVIF delivery is now demonstrably better than round 1.

---

## Persona 4 — Capture One Commercial Pro

**What changed**: Display P3 source — the best-case path — is verified unchanged. One new improvement: DCI-P3 source handling (WI-12, `03ef7a7`). Capture One can export with DCI-P3 ICC (the `DCI-P3` ICC profile, white point D50 rather than D65). Previously, `pipelineColorspace('rgb16')` was applied to DCI-P3 sources alongside other wide-gamut sources; the rgb16 path uses the source ICC for the initial colorspace transform, but DCI-P3's D50 white point led to a slightly wrong Bradford adaptation compared to treating it as a display-referred D65 source.

`processImageFormats` now detects `isDciP3 = true` (line 658) and skips the `rgb16` pipeline for DCI-P3 (`needsRgb16 = isWideGamutSource && !isDciP3`, line 727). The `toColorspace('p3')` call on a DCI-P3 source then uses Sharp's built-in Bradford D50→D65 adaptation, which is the correct path. The resulting AVIF is properly D65-white-pointed P3.

**Walk-through for sRGB and P3 Capture One exports**: both remain correct as in round 1. The sRGB path is `resolveAvifIccProfile` → `srgb`, no conversion. The P3 path is `p3-from-displayp3`, no pixel conversion needed.

**TIFF from Phase One**: the 200 MB size cap remains (`MAX_FILE_SIZE = 200 * 1024 * 1024`, line 115). A Phase One IQ4 150 MP TIFF exceeds this and is rejected at upload. No change in this cycle. For TIFFs that fit under the cap, the rgb16 pipeline plus p3-from-wide conversion is a genuine quality improvement over the previous sRGB clip.

**Net change**: The DCI-P3 white-point fix is persona-visible for photographers using Capture One's DCI-P3 output profile. The resulting AVIF will have slightly more accurate neutral tones and skin tones compared to the previous (incorrect) D50-treated path.

---

## Persona 5 — Wedding / Portrait Photographer

**What changed**: Three UI items directly affect proofing confidence.

**Calibration tooltip** (US-CM10, `b0a2cf6`): The Color Details expand button now has a `<Tooltip>` wrapping an `<Info>` icon. The tooltip text reads: "Display calibration affects color accuracy. Uncalibrated displays may render saturation and white balance differently than the photographer intended." (`messages/en.json` line 318). The tooltip is placed inline next to the "Color details" expand button (`photo-viewer.tsx` lines 847–856).

**Visibility assessment**: The tooltip is visible to any user who hovers or focuses the Info icon next to the "Color details" expand button — but the expand button itself is only visible when `image.color_primaries || image.is_hdr` is truthy (line 838). For a sRGB-exported wedding photo, `color_primaries = 'bt709'` is stored, so the Color Details section appears. However, the section is collapsed by default (`useState(false)`, line 231). The photographer must: open the Info sidebar → scroll to Color Details → notice the Info icon → hover it. This is three interactions deep. For non-admin viewers (clients), the tooltip is also visible — there is no `isAdmin` guard on the Color Details section or the tooltip. A client who finds the Info sidebar will see the calibration notice.

**Dynamic download label** (commit `aa2e7a9`): For a wide-gamut source whose `color_pipeline_decision` starts with `'p3-from-'`, the download button label changes from "Download JPEG" to "Download (Display P3 JPEG)" (`photo-viewer.tsx` lines 947–949). For Persona E (Display P3 JPEG export from Lightroom), `color_pipeline_decision = 'p3-from-displayp3'`, so the button reads "Download (Display P3 JPEG)". This is accurate and visible without opening any sidebar.

The dropdown still has a "Download (sRGB JPEG)" item (`t('viewer.downloadSrgbJpeg')`, line 960) for the JPEG download. The JPEG derivative is P3-tagged (`targetIcc = 'p3'` for a P3 source). So "Download (sRGB JPEG)" is still a mislabel for the P3 source case. The primary button label is now correct; the dropdown item label is not.

**Color Space row** (WI-03, `84c23a0`): The "Color Space" EXIF row in the info panel now shows `icc_profile_name` (e.g. "Display P3") rather than the EXIF `ColorSpace` tag value. For a Display P3 JPEG, this shows "Display P3" with a purple P3 badge. For an sRGB JPEG, it shows "sRGB IEC61966-2.1" or similar. This is a concrete improvement for proofing confidence: the photographer immediately sees the color space label of what was uploaded, not the opaque EXIF integer.

**What the wedding photographer gains**: The "Display P3 JPEG" download label, the "Display P3" Color Space row with P3 badge, and the calibration tooltip together tell a coherent (if three-click-deep) color story. A technically aware photographer can now confirm that their P3 exports are P3-delivered without inspecting raw headers.

---

## Persona 6 — Landscape / Fine-Art HDR

**What changed**: Formally deferred with documentation (`0481fdb`). The `HDR_FEATURE_ENABLED` flag defaults to `false`. The `<picture media="dynamic-range:high">` source block exists in the code but is suppressed at the template level. No HDR AVIF files are generated. For a PQ AVIF upload, `detectColorSignals()` correctly stores `is_hdr = true` and `transfer_function = 'pq'`. The Color Details section on an HDR-capable display shows the amber HDR badge.

**One regression to note**: the `<picture>` element now constructs HDR AVIF URLs as `{baseAvif}_hdr_{w}.avif` (`photo-viewer.tsx` line 416). Because `HDR_FEATURE_ENABLED` is `false`, these URLs are never inserted into the DOM and no 404 is triggered. A site operator who sets `NEXT_PUBLIC_HDR_FEATURE_FLAG=true` without having run the HDR encoder will cause every HDR-flagged photo to attempt loading `_hdr_{w}.avif` files that do not exist. Chrome and Safari both handle a missing `<source>` gracefully by falling through to the next source, so the fallback chain (standard AVIF → WebP → JPEG) would still serve correctly. No 404 crash, but a network error per HDR image per page load.

**Net change for Persona F**: The audit trail (HDR badge, PQ transfer function label) is improved. Delivery is unchanged: SDR P3 AVIF. The photographer's HDR PQ mastering work is still not delivered.

---

## Cross-Cutting Concern 7 — Sharing Workflow (OG Image)

**What shipped and what wins**:

Two OG-related commits shipped in sequence:
- `538f1f3` — `feat(og): wide-gamut OG images with ICC profile embedding`: originally emitted P3-tagged OG JPEG for wide-gamut sources.
- `99e23c7` — `fix(og): always emit sRGB ICC on OG JPEG regardless of source gamut`: reverted the P3 path.

The `fix` wins. `postProcessOgImage` (`og/photo/[id]/route.tsx` lines 38–44) now always calls `.toColorspace('srgb').withIccProfile('srgb').jpeg(...)`. The comment on line 34 explains the rationale: Satori internally flattens to sRGB via resvg. Tagging the Satori PNG output as P3 would mislead color-managed viewers because the pixel values were already clamped to sRGB during the resvg render. The fix correctly tags the OG JPEG as sRGB, matching the actual pixel content.

**For the sharing workflow**: every OG image is now sRGB-tagged JPEG, regardless of source gamut. iMessage, Slack, Discord, and Twitter/X all receive a consistent, correctly-tagged sRGB preview. The round-1 double-interpretation error (P3 re-tag over Satori-clipped sRGB pixels) is closed. The trade-off is that wide-gamut photographers lose the P3 OG preview; the gain is correctness. For practical purposes, OG images are viewed as small thumbnails in messaging apps where the gamut difference is imperceptible.

**What remains**: Satori's center-crop for portrait photos is unchanged. No focal-point awareness.

---

## Cross-Cutting Concern 8 — Download Workflow

**What changed** (US-CM07, `12ac8b6` plus `aa2e7a9`):

The download button for a free photo is now:

- **sRGB source**: single "Download JPEG" button (no dropdown). Correct.
- **Wide-gamut source, `color_pipeline_decision` starts with `p3-from-`**: primary button label is "Download (Display P3 JPEG)" with a dropdown containing:
  - "Download (sRGB JPEG)" — serves the JPEG derivative (P3-tagged, label is misleading)
  - "Download (Display P3 AVIF)" — serves the AVIF derivative (correctly P3)
  - "Download (HDR AVIF)" — appears only when `hdrExists = true` (currently never true)
- **Wide-gamut source, `color_pipeline_decision` is `srgb-from-adobergb` / `srgb-from-prophoto` / `srgb-from-rec2020`**: `color_pipeline_decision?.startsWith('p3-from-')` is false, so the primary button reads "Download JPEG" — the same label as sRGB. But the dropdown still appears because `isWideGamutSource` is derived from `color_primaries` (line 229), not `color_pipeline_decision`. The AVIF is P3 but the button label does not say so.

**Mental model walk-through for an Adobe RGB upload**:

1. Photographer uploads Adobe RGB JPEG. AVIF is P3. `color_pipeline_decision = 'srgb-from-adobergb'`.
2. Download button in sidebar shows "Download JPEG" (primary) with dropdown. Dropdown items: "Download (sRGB JPEG)" and "Download (Display P3 AVIF)".
3. Photographer clicks "Download (sRGB JPEG)" — receives a P3-tagged JPEG. The label is still wrong.
4. Photographer clicks "Download (Display P3 AVIF)" — receives the P3 AVIF. Correct, and now labeled correctly.

For a Display P3 upload:
1. Button reads "Download (Display P3 JPEG)". Accurate.
2. Dropdown: "Download (sRGB JPEG)" (misleading — JPEG is P3-tagged) and "Download (Display P3 AVIF)" (accurate).

The AVIF download path is now clearly labeled and is the recommended download for P3-capable recipients. The JPEG download-item label is still inaccurate for wide-gamut sources. This is a partial fix: the primary button label improved, the dropdown JPEG item label did not.

---

## Cross-Cutting Concern 9 — Professional Review Workflow

**What changed** (US-CM09, `09582bb` and `97a1164`):

The admin Color Details panel now shows a "Color pipeline" row (`photo-viewer.tsx` lines 872–876, gated `isAdmin && image.color_pipeline_decision`). The humanized labels are:

| DB value | Displayed label |
|---|---|
| `p3-from-displayp3` | "P3 (from Display P3)" |
| `p3-from-dcip3` | "P3 (from DCI-P3)" |
| `srgb-from-adobergb` | "sRGB (from Adobe RGB)" |
| `srgb-from-prophoto` | "sRGB (from ProPhoto)" |
| `srgb-from-rec2020` | "sRGB (from Rec. 2020)" |

As noted in the pipeline state summary, labels for Adobe RGB, ProPhoto, and Rec.2020 are stale — they describe the intended behavior of the older sRGB-clip pipeline rather than the current P3 delivery. An admin reviewing an Adobe RGB upload sees "Color pipeline: sRGB (from Adobe RGB)" and reasonably concludes the AVIF was clipped to sRGB, when in fact it was converted to P3.

**What the admin can now see**: Source ICC name (icc_profile_name, in the Color Space EXIF row), source color primaries (Color primaries row), source transfer function (Transfer function row), HDR flag (HDR badge), and pipeline decision (Color pipeline row, admin-only). This is a substantially richer audit trail than round 1, where `color_pipeline_decision` was not surfaced at all.

**What remains missing**: The pipeline decision label should reflect the actual AVIF output ICC, not a stale narrative. There is no "Served AVIF: Display P3" explicit disclosure.

---

## Cross-Cutting Concern 10 — Calibration Awareness

**What changed** (US-CM10, `b0a2cf6`):

The calibration tooltip is now live at `photo-viewer.tsx` lines 847–856. The tooltip text is: "Display calibration affects color accuracy. Uncalibrated displays may render saturation and white balance differently than the photographer intended."

**Prominence assessment**: The tooltip is attached to an Info icon next to the "Color details" expand button. The button itself is visible without opening the Info sidebar. However:

1. The "Color details" section appears only when `image.color_primaries || image.is_hdr`. For sRGB sources, `color_primaries = 'bt709'` is stored, so it will appear.
2. The section is collapsed by default. The Info icon is visible even when collapsed, to the right of the "Color details" label row.
3. On desktop, the Info sidebar is hidden until the user clicks the Info button (PanelRightOpen). On mobile, the info is in a bottom sheet requiring a swipe. So the full path for a non-admin viewer is: click Info → scroll to bottom of sidebar → find "Color details" row → hover/tap the Info icon.

This is better than round 1 (where no calibration text was surfaced to non-admin viewers at all) but it remains a low-discoverability feature. The calibration notice is not shown proactively at the top of the viewer or in the sharing URL metadata.

**`.arw` removal** (same commit, `b0a2cf6`): Sony `.arw` RAW files were removed from `ALLOWED_EXTENSIONS`. This is a calibration-adjacent quality improvement: RAW files decode differently in different applications and Sharp's RAW decode (via libvips/dcraw) does not produce calibrated color. Preventing `.arw` upload closes a class of unexpected color surprises. The practical impact on Persona B (DSLR Adobe RGB) is none — they upload processed JPEGs.

---

## Cross-Cutting Concern 11 — Cross-Platform Consistency

**What changed** (WI-08, `6b1619d`):

The `<picture>` element now conditionally renders a `media="(dynamic-range: high)"` HDR AVIF source block:

```tsx
{HDR_FEATURE_ENABLED && image.is_hdr && baseAvif && (
    <source
        type="image/avif"
        srcSet={...hdr_w.avif variants...}
        media="(dynamic-range: high)"
    />
)}
```

**Today with `HDR_FEATURE_ENABLED = false`**: the HDR source is never emitted into the DOM. No `<source media="(dynamic-range: high)">` element exists. HDR-display visitors receive the standard AVIF source. No 404 is triggered. The `media` attribute behavior is dormant but architecturally correct: when the encoder ships and `HDR_FEATURE_ENABLED` is set to `true`, the HDR source will fire first for compatible browsers, with the SDR AVIF as the automatic fallback (browsers ignore `<source>` elements whose `media` condition is false).

**Cross-platform delivery table (current, post-30-commit)**:

| Viewer platform | Format selected | ICC profile | Notes |
|---|---|---|---|
| iPhone 15 Pro, Safari 17 | AVIF | P3 (for P3+ source) | Full P3, correct |
| MacBook Pro M3, Safari 17 | AVIF | P3 | Full P3, correct |
| MacBook Pro M3, Chrome 124 | AVIF | P3 | Full P3, ICC-managed |
| Pixel 8, Chrome | AVIF | P3 | ICC-managed on P3 screen |
| Windows 11, Chrome | AVIF | P3 | Correct if display profile set |
| HDR TV browser | JPEG fallback (usually) | P3 or sRGB | SDR, no HDR benefit |
| Samsung Browser (old) | WebP | P3 | P3-tagged WebP |

The HDR delivery gap for HDR TVs and OLED monitors remains. With `HDR_FEATURE_ENABLED = false`, HDR-display visitors are in exactly the same position as round 1.

---

## Cross-Cutting Concern 12 — Photographer's Audit Story

**Round 1 gaps and their status**:

| Round 1 gap | Status after 30 commits |
|---|---|
| `color_pipeline_decision` never surfaced | Surfaced for admins in Color Details panel |
| No P3 badge for AdobeRGB-sourced images | Badge appears only when `icc_profile_name` contains "p3"; not shown for "Adobe RGB (1998)" |
| EXIF `color_space = Uncalibrated` shown in UI | Fixed: UI now shows `icc_profile_name` (e.g. "Adobe RGB (1998)") in the Color Space row |
| Calibration tooltip behind 2-level disclosure | Still behind 2-level disclosure but now visible to non-admin viewers |
| Histogram drawn from JPEG only, no clip indicator | Histogram now prefers AVIF on P3 displays; shows "(sRGB clipped)" when AVIF not available |
| "Download sRGB JPEG" mislabel | Partially fixed: primary button for `p3-from-*` cases now correct; dropdown JPEG item still mislabeled |
| `color_pipeline_decision` labels stale for wide-gamut | New gap: labels still say "sRGB from Adobe RGB" but actual output is P3 |
| No HDR delivery | Unchanged — encoder deferred |

**The audit story today**: An admin photographer opens a photo detail page, opens the Info sidebar, and sees:
- "Color Space: Adobe RGB (1998)" (from `icc_profile_name`)
- Expanding Color Details: "Color primaries: Adobe RGB", "Transfer function: Gamma 2.2", "Color pipeline: sRGB (from Adobe RGB)"

The last item is misleading. The photographer reads "sRGB" and concludes their AVIF was clipped to sRGB. They open the AVIF in a hex editor and find P3 ICC embedded. The audit trail is factually inaccurate on the most important piece of information: what ICC profile is in the served file.

The histogram, if viewed on a P3-capable display (e.g. MacBook Pro), loads the AVIF and shows the P3-gamut histogram with the "(Adobe RGB)" gamut label — which does accurately reflect the source gamut. This is a more accurate audit surface than the Color pipeline label.

---

## Cross-Cutting Concern 13 — Comparison vs. SmugMug / Pixieset / PhotoShelter

| Feature | GalleryKit (post-30-commit) | SmugMug | Pixieset | PhotoShelter |
|---|---|---|---|---|
| Source file treatment | Transcodes to AVIF+WebP+JPEG; original private | Serves original unchanged | Serves original; generates derivatives | Original as purchased asset |
| Color conversion on upload | Yes — wide-gamut → P3; sRGB → sRGB | No | No | No |
| P3 AVIF delivery | Yes, for all wide-gamut sources (P3, AdobeRGB, ProPhoto, Rec.2020) | No | No | No |
| AdobeRGB → P3 conversion quality | rgb16 16-bit pipeline, gamut-accurate within P3 bounds | N/A (served as-is) | N/A | N/A |
| HDR AVIF delivery | No (encoder deferred; flag disabled) | No | No | No |
| HDR gain-map preservation | No — stripped at encode | Yes on paid plans (original HEIC) | Partial (original if HEIC served) | Yes (original download) |
| OG image color profile | sRGB JPEG (always, post fix) | sRGB JPEG | sRGB JPEG | sRGB JPEG |
| Download label accuracy | Mostly correct for P3 sources; stale for AdobeRGB (shows "sRGB" pipeline) | N/A | N/A | N/A |
| Download AVIF option | Yes — "Download (Display P3 AVIF)" | No | No | No |
| Admin color audit panel | Yes — icc_profile_name, color_primaries, transfer_function, is_hdr, color_pipeline_decision | None | None | None |
| Calibration tooltip | Yes — visible to any viewer (3-click deep) | None | None | None |
| Histogram gamut awareness | Yes — P3 canvas context + sRGB-clipped indicator | None | None | None |
| Upload whitelist (RAW blocked) | Yes — .arw removed (WI-10) | RAW rejected at upload | RAW rejected | RAW accepted (stored) |
| EXIF color space display | ICC profile name shown (not EXIF integer) | ICC name from metadata | EXIF value | EXIF value |
| Pipeline audit for admins | Partial (label stale for AdobeRGB/ProPhoto/Rec.2020) | None | None | None |

**Where GalleryKit is now ahead**: The P3 AVIF delivery path for all wide-gamut sources is unique among consumer gallery platforms. The admin color audit panel (Color Details with pipeline decision, histogram, EXIF ICC name) is more detailed than any competitor. The AVIF download option is unique. The histogram's P3 canvas context and sRGB-clip indicator are not available in any competing product.

**Where GalleryKit still falls short**: HDR gain-map loss remains the hardest failure point vs. SmugMug/PhotoShelter which serve the original HEIC. The download JPEG item label is still misleading for the sRGB-dropdown item. The `color_pipeline_decision` DB values for AdobeRGB/ProPhoto/Rec.2020 have drifted from the actual behavior.

---

## Cross-Cutting Concern 14 — What Is Still Missing

Listed by practical impact to the working photographer:

**P1 — Stale `color_pipeline_decision` labels**: `srgb-from-adobergb`, `srgb-from-prophoto`, `srgb-from-rec2020` do not describe what the pipeline actually does (it converts to P3). The admin Color Details "Color pipeline" row misleads the photographer. The download button logic that gates on `color_pipeline_decision.startsWith('p3-from-')` also misses these cases, so the "Download (Display P3 JPEG)" primary label never appears for AdobeRGB/ProPhoto uploads. The fix is mechanical: update the three decision values to `p3-from-adobergb`, `p3-from-prophoto`, `p3-from-rec2020` (matching the `resolveAvifIccProfile` naming convention).

**P2 — "Download (sRGB JPEG)" mislabel in dropdown**: The dropdown item for the JPEG download is labeled "sRGB JPEG" but the JPEG derivative is P3-tagged for all wide-gamut sources. A client who downloads this JPEG and opens it in a color-unmanaged application (Windows Photos on older Windows 10, Facebook upload) will see P3 values interpreted as sRGB. The label should be "Download (P3 JPEG)" or "Download (P3 JPEG — best for modern devices)".

**P3 — HDR gain-map delivery**: No change in this cycle. iPhone P3+HDR and landscape/fine-art HDR photographers both lose their HDR content permanently at upload. The pipeline version 5 ETag + backfill script (`fca55fb`) allows re-processing existing uploads when the encoder ships, which is the correct architectural preparation. The gap remains open until WI-09 (HDR encoder) is implemented.

**P4 — No "served as P3" explicit disclosure for AdobeRGB uploads**: The Color Space row shows "Adobe RGB (1998)" (the source ICC). There is no row that says "Served AVIF: Display P3". The pipeline decision label is wrong (says sRGB). The histogram shows the source gamut label. The photographer cannot confirm from the UI alone that their Adobe RGB upload is being served as P3, not sRGB.

**P5 — Calibration notice visibility**: The tooltip is three interactions deep (Info sidebar → find Color details row → hover Info icon). For a client proofing wedding photos on an uncalibrated display, the chance of encountering this notice is low. A one-sentence banner at the top of the photo viewer when `color_primaries` is wide-gamut would close most of the real-world gap.

**P6 — No upload-time notification of color conversion**: When a photographer uploads an Adobe RGB JPEG, there is no upload-completion message that says "Your Adobe RGB image was converted to Display P3 for web delivery." The photographer discovers this (if at all) by opening the info sidebar after upload. A toast notification at upload-completion time would close this gap with a single line of server-action code.

**P7 — sRGB simulation / proofing toggle**: Still not implemented. A photographer delivering to a mixed P3/sRGB client base cannot preview how their P3 AVIF looks on an sRGB display from within GalleryKit. SmugMug and Pixieset also lack this; it remains an industry-wide gap.

**P8 — Histogram clip indicators**: The histogram shows the per-channel curve but does not highlight bins 0 or 255 (blown highlights / crushed shadows) differently. The "(sRGB clipped)" gamut label is the only clipping signal, and it is a source-gamut disclosure, not a per-channel clip indicator. A red overlay on the rightmost bins when they are above a threshold would give the photographer an instant "this photo has blown highlights" signal.
