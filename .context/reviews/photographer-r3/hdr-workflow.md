# HDR Workflow Review (R3)

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. Deliver the photographer's HDR intent — PQ / HLG transfer, expanded dynamic range, scene-referred specular highlights — accurately to every viewer.
**Scope:** HDR source intake, CICP signaling, transfer-function detection, delivery state, badges, downloads, future-encoder readiness.

---

## 0. State of HDR in the codebase

**What works:**

- ✓ `colr` ISOBMFF parser correctly walks `meta`/`iprp`/`ipco` containers and reads NCLX boxes (`color-detection.ts:156-220`).
- ✓ NCLX maps match ITU-T H.273: transfer 13=sRGB, 14/15=gamma22, 16=PQ, 18=HLG; primaries 1=BT.709, 9=BT.2020, 11=DCI-P3, 12=P3-D65.
- ✓ `transferFunction = 'pq' | 'hlg'` correctly sets `isHdr = true` (`color-detection.ts:279`).
- ✓ Schema columns exist for `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr` (`schema.ts:64-67`).
- ✓ HDR badge in EXIF panel hidden via `@media (dynamic-range: high)` so non-HDR-display visitors don't see it.
- ✓ The R2 fix removed `<picture> <source media="(dynamic-range: high)">` from photo-viewer / lightbox / home-client. No 404 landmine on the inline `<picture>` path.
- ✓ Forced-colors mode rule for `.hdr-badge` (`globals.css:177-180`).
- ✓ `hdrBadgeAriaLabel` i18n: en "HDR (High Dynamic Range)", ko "HDR (하이 다이내믹 레인지)".

**What is broken or unfinished:**

- ✗ **HDR encoder (WI-09) not implemented.** `processImageFormats` does not branch on `isHdr`. PQ / HLG sources go through the SDR encode path, decoded as raw RGB (CF-CRIT-2 / HW-CRIT-2 below).
- ✗ **`_hdr.avif` files are never written.** No path in any encoder writes them.
- ✗ **The HDR download menu item points to `_hdr.avif` URLs that 404.** (HW-CRIT-1 / R3-C1 below.)
- ✗ **`is_hdr` flows to public consumers** — public HDR badge with no HDR delivery (HW-CRIT-3 / R3-C4).
- ✗ **No upload-time warning** for HDR sources that the encoder cannot handle.
- ✗ **No `hdr_variant_exists` column** to gate downstream UI on the actual presence of the variant file.
- ✗ **No HDR test fixture** — neither PQ HEIF nor HLG HEIF round-trip is exercised.

---

## 1. CRIT findings

### HW-CRIT-1 — `_hdr.avif` download item is a landmine

**Code:** `photo-viewer.tsx:189-190`:

```ts
const hdrAvifFilename = image?.filename_avif ? image.filename_avif.replace(/\.avif$/i, '_hdr.avif') : null;
const hdrDownloadHref = hdrAvifFilename ? imageUrl(`/uploads/avif/${hdrAvifFilename}`) : null;
```

`photo-viewer.tsx:859-869`:

```tsx
{image?.is_hdr && hdrDownloadHref && (
  <DropdownMenuItem asChild className="min-h-11">
    <a href={hdrDownloadHref} download={`photo-${image.id}_hdr.avif`} …>
      {t('viewer.downloadHdrAvif')}
    </a>
  </DropdownMenuItem>
)}
```

**Why it's broken:** `_hdr.avif` files do not exist anywhere on the filesystem. The encoder never writes them. The HDR encoder (WI-09) is deferred. The gate `image?.is_hdr` is the only condition; there is no per-file existence check.

**Effect:** for any photo with `is_hdr === true` (a small but legitimate set after the A1 backfill correctly identifies genuine PQ / HLG HEIFs), the download menu offers a "Download HDR AVIF" item. Click → 404.

**Audience affected:** photographers who shoot PQ ProRAW on iPhone 15 Pro, HLG on Sony α7 IV, or PQ HEIF exports from Apple ProRes / DJI Mavic 3. They are explicitly the audience this product is designed to serve.

**Asymmetry with mobile:** `info-bottom-sheet.tsx:471-490` does NOT include the HDR menu item. Desktop user sees the broken option; mobile user is silently better-off. Inconsistent.

**Fix shape:**

**Option A (immediate, honest):** delete the HDR menu item from `photo-viewer.tsx` until WI-09 ships. Symmetry with mobile.
```diff
-{image?.is_hdr && hdrDownloadHref && (
-  <DropdownMenuItem asChild className="min-h-11">
-    <a href={hdrDownloadHref} download={`photo-${image.id}_hdr.avif`}>
-      {t('viewer.downloadHdrAvif')}
-    </a>
-  </DropdownMenuItem>
-)}
+{/* HDR variant download deferred until WI-09 (HDR encoder) ships. */}
```

**Option B (forward-compatible):** add `images.hdr_variant_exists` column, default false. Only emit the menu item when the column is true. Future-proof but adds a schema migration today.

**Recommendation:** Option A. The schema migration is wasted work today; the encoder isn't shipping in this iteration. When WI-09 lands, re-add the JSX with proper gating.

**Severity:** **CRIT**. The photographer's HDR audit story breaks at the download.

---

### HW-CRIT-2 — PQ / HLG sources silently miscolor (no inverse OETF)

Repeated from `color-fidelity.md` CF-CRIT-2. The HDR-specific framing:

A photographer shoots PQ ProRAW on iPhone 15 Pro. The HEIF carries:
- NCLX nclx box with `primaries=9, transfer=16 (PQ), matrix=9`.
- 10-bit pixel data encoded with the PQ EOTF (SMPTE ST 2084).

Upload → `detectColorSignals` → `transferFunction='pq'`, `isHdr=true`. ✓ correctly identified.

Upload → `processImageFormats(originalPath, …, iccProfileName)`:
- `iccProfileName` is null (HEIF has only NCLX, no embedded ICC).
- `resolveAvifIccProfile(null) → 'srgb'`.
- `resolveColorPipelineDecision(null) → 'srgb-from-unknown'`.
- `isWideGamutSource = false` → no rgb16 path.
- `targetIcc = avifIcc = 'srgb'`.
- Sharp `image.clone().resize(…)` decodes via libheif. **libheif decodes PQ-encoded values into RGB pixel buffers without applying the inverse PQ EOTF.** The buffer contains PQ code values interpreted as gamma-2.2 RGB.
- `toColorspace('srgb').withIccProfile('srgb').jpeg/webp/avif()` encodes those values as sRGB. Embedded ICC says sRGB IEC61966-2.1.
- Color-managed viewers (Safari, Chrome, Firefox 124+) interpret these pixels with sRGB tone-response.

**Result:** the photo's tonality is wrong by a non-linear amount. PQ encodes near-black at code value ~0.05 (≈ 0.005 nits in scene-linear); sRGB at code value 0.05 is ~0.4% gray. Brighter regions are even more shifted.

**Why no test catches this:** no fixture. The `color-detection.test.ts` covers detection but not delivery. `process-image-color-roundtrip.test.ts` skips HDR sources.

**Photographer-intent impact:** the photographer's intent — captured-with-1000-nit-highlights, expanded-dynamic-range — is silently mis-rendered as muddy SDR. The audit panel says "HDR" (correctly identified). The bytes look wrong. **The photographer's intent and the delivered result diverge silently.**

**Fix shape (Direction A — honest, today):** at the upload action, after `saveOriginalAndGetMetadata` returns the `colorSignals`, check `signals.isHdr === true`:

```ts
if (data.colorSignals?.isHdr) {
  await fs.unlink(originalPath).catch(() => {});
  return {
    error: t('imageManager.hdrNotSupported'),  // "HDR sources cannot be ingested yet. Please export this photo as SDR Display P3 or sRGB and try again."
  };
}
```

Plus an admin override (`allow_hdr_ingest` setting, default false) for power users who knowingly want raw HDR-as-SDR delivery.

**Fix shape (Direction B — eventually correct, WI-09):** apply BT.2390 EETF or ACES tonemap from PQ → SDR before encoding. Sharp / libvips lacks `tonemap_bt2390`. Options:
- Shell out to `avifenc` with `--cicp 9/16/9` for HDR variant + a separate libavif decode + manual JS BT.2390 curve for the SDR variant.
- Wait for libvips upstream to ship BT.2390 (issue tracker: months out).
- Pure-JS BT.2390 over the rgb16 buffer (slow but feasible; ~200 ms per 4096-wide).

Direction A ships in days. Direction B is the WI-09 work item.

**Severity:** **CRIT**. Silent miscolor on the exact source class the schema is designed to recognize.

---

### HW-CRIT-3 — `is_hdr` is public, HDR delivery is missing (false promise)

Repeated from `color-fidelity.md` CF-CRIT-3 / aggregate R3-C4.

`color-details-section.tsx:130-141` renders the HDR badge whenever `image.is_hdr === true`. The badge is hidden on non-HDR displays via `@media (dynamic-range: high)`. So:

- Visitor on iPhone 15 Pro (HDR display) sees "HDR" badge.
- Visitor on MacBook Pro M3 (HDR display via `display-p3` MQ but NOT `dynamic-range: high` on Chrome/Firefox — Safari only) sees badge on Safari, not Chrome / Firefox.
- Visitor on Windows 11 + Dell XDR (HDR display) sees badge only on Edge with HDR mode enabled.
- Visitor on SDR display sees nothing.

For all of the above who DO see the badge: the bytes delivered are not HDR. They are SDR-as-HDR-source-with-curve-mismatch (per HW-CRIT-2). The badge promises something the bytes don't fulfill.

**Photographer-intent impact:** the visitor sees the photographer's "HDR" claim but the actual rendered photo is SDR. The audit story is broken from the visitor's side too.

**Fix shape (immediate):** in `data.ts`, move `is_hdr`, `transfer_function`, `matrix_coefficients` into the `_omit*` block so they don't flow to `publicSelectFields`:

```ts
const {
  latitude: _omitLatitude,
  longitude: _omitLongitude,
  filename_original: _omitFilenameOriginal,
  user_filename: _omitUserFilename,
  processed: _omitProcessed,
  original_format: _omitOriginalFormat,
  original_file_size: _omitOriginalFileSize,
  color_pipeline_decision: _omitColorPipelineDecision,
  pipeline_version: _omitPipelineVersion,
+ is_hdr: _omitIsHdr,
+ transfer_function: _omitTransferFunction,
+ matrix_coefficients: _omitMatrixCoefficients,
} = adminSelectFields;
```

Update `_PrivacySensitiveKeys` type guard accordingly:

```ts
type _PrivacySensitiveKeys = 'latitude' | 'longitude' | 'filename_original'
  | 'user_filename' | 'processed' | 'original_format' | 'original_file_size'
  | 'color_pipeline_decision'
+ | 'is_hdr' | 'transfer_function' | 'matrix_coefficients';
```

Public ImageDetail no longer carries `is_hdr` / `transfer_function` / `matrix_coefficients`. The HDR badge only renders for admin views. The photographer (when logged in) still sees the badge; visitors don't.

`color_primaries` STAYS public (wide-gamut delivery is honest via P3 AVIF/WebP/JPEG).

**Severity:** **CRIT**. Misleads visitors.

---

## 2. HIGH findings

### HW-HIGH-1 — ICC-only HDR profiles fall through to a fragile heuristic

**Code:** `color-detection.ts:57-91` `inferTransferFunction`.

When a HEIF / AVIF carries an ICC profile (no NCLX), the heuristic checks:

```ts
if (desc.includes('pq') || desc.includes('st 2084') || desc.includes('smpte 2084') ||
    name.includes('pq') || name.includes('st2084')) {
  return 'pq';
}
if (desc.includes('hlg') || desc.includes('hybrid log') || desc.includes('arib') ||
    name.includes('hlg')) {
  return 'hlg';
}
```

**Problems:**

1. The heuristic uses `iccDescription` parameter that is hardcoded as `null` in `detectColorSignals` (`color-detection.ts:270`). So only `name` matching fires. The `desc.includes('pq')` branch never matches.
2. `name` is normalized via `normalizeName` (`color-detection.ts:30-32`) which lowercases and strips non-alphanumeric. So `name.includes('pq')` matches "Display P3" → `'displayp3'`.includes('pq') → **false**, but matches "PQ Encoded" → `'pqencoded'`.includes('pq') → **true**. OK.
3. But `name.includes('pq')` also matches "Apple ProRes 422 LT" → `'appleprores422lt'`.includes('pq') → **false**. OK.
4. False positive: an ICC named `"BBQ Sunset 2026"` → `'bbqsunset2026'`.includes('pq') → **true** → flagged as PQ HDR. Unlikely but not impossible.

**Photographer-intent impact:** an obscure ICC name could mis-trigger the HDR badge. Equally, a legitimately PQ-tagged ICC with a different description (e.g. "ColorMaster Reference Display HDR") may be missed.

**Fix shape:** parse the ICC profile's actual transfer characteristic from the curve tags (TRC) instead of name-matching. ICC v2 has `kTRC`, ICC v4 has `bTRC`. PQ has a known curve shape; HLG has a known curve shape; gamma 2.2 has a known shape. Match by sampling 5-10 points and computing a fingerprint.

This is a follow-up. **Severity: HIGH** (correctness for ICC-only HDR).

---

### HW-HIGH-2 — No upload-time signal that HDR can't be ingested

**Code:** `actions/images.ts:282-339` upload action. After `saveOriginalAndGetMetadata`, the row is written with `is_hdr=true` if signals say so. The encoder runs in the background queue. No warning is surfaced to the photographer at upload.

**Photographer-intent impact:** the photographer drags a PQ ProRAW into the upload pane, sees "Upload complete", expects normal delivery. Background queue runs, emits SDR-with-curve-mismatch derivatives (per HW-CRIT-2), the photographer reviews their gallery and sees muddy color. Without a CICP-aware test, they cannot diagnose what went wrong.

**Fix shape:** at upload time, surface a warning toast for HDR-detected sources:

```
This photo appears to be HDR (PQ / HLG transfer). HDR delivery is not yet
supported in this gallery. The photo will be displayed as an SDR
approximation. For best results, export your photo as SDR Display P3 or
sRGB JPEG before uploading.
```

If `allow_hdr_ingest=false` (default), reject the upload entirely.

If `allow_hdr_ingest=true` (admin opt-in for power users), accept with the warning above.

**Severity:** **HIGH** for the audience this product is supposed to serve.

---

### HW-HIGH-3 — HDR badge styling is muted; doesn't read as "this is special"

**Code:** `color-details-section.tsx:131-140`:

```tsx
<span
  className="hdr-badge items-center gap-1 px-2 py-1 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 rounded border border-amber-200 dark:border-amber-800"
  …
>
  {t('viewer.hdrBadge')}
</span>
```

`bg-amber-100 text-amber-700` is muted, similar to a "warning" tag in shadcn. On HDR-capable displays (the only display class that sees the badge per `@media (dynamic-range: high)`), the badge appears next to mundane EXIF text and reads as another label.

For comparison:
- Apple Photos uses a high-contrast pill with a gradient that scales with the photo's luminance.
- Google Photos uses a slim "HDR" overlay in white-on-transparent on the photo thumbnail itself.
- SmugMug uses a discrete "HDR available" pill in the metadata panel.

**Photographer-intent impact:** the photographer's HDR work is presented to the visitor with the same visual weight as "Lens: 24-70mm". Doesn't communicate "this is special; check it out on an HDR display."

**Fix shape:**
- Bump to `bg-gradient-to-r from-amber-300 to-orange-400 text-white` for HDR display visibility.
- Add a subtle `box-shadow: 0 0 8px rgba(251, 191, 36, 0.4)` glow for that "this is HDR" cue.
- Optionally animate a `pulse` once on first visibility.
- Forced-colors mode falls back to `border` + `Highlight`/`HighlightText` — keep.

**Severity:** **HIGH** (UI signaling) / **MED** (correctness).

---

### HW-HIGH-4 — Lightbox / fullscreen has no HDR surface

Cross-reference: ui-ux-photographer.md UX-HIGH-2.

In lightbox mode (`lightbox.tsx`), the visitor sees the photo full-bleed. There is NO color metadata UI. The HDR badge / P3 chip / Color details accordion are all in the photo-viewer's `Card` sidebar, which is hidden behind the lightbox backdrop.

**Photographer-intent impact:** photographer demoes a HDR photo to a client → opens lightbox → photo fills the screen → client says "wow that's saturated, what is it?" → photographer cannot point to a "HDR" pip without leaving fullscreen. Compare: Apple Photos shows a small HDR pip in lightbox bottom-right.

**Fix shape:** add a small HDR / P3 pip in the lightbox bottom-left corner (matches the existing `1 / 12` position indicator placement). Fade in on mouse move; fade out with controls. Tap reveals a slide-up panel with full color metadata.

**Severity:** **HIGH** for photographer's demo workflow.

---

## 3. MED findings

### HW-MED-1 — `display: inline-flex !important` on `.hdr-badge` is a sledgehammer

**Code:** `globals.css:172-173`:

```css
.hdr-badge { display: none; }
@media (dynamic-range: high) { .hdr-badge { display: inline-flex !important; } }
```

The `!important` is needed because the React component sets `className="hdr-badge items-center gap-1 …"` which Tailwind compiles to `inline-flex` (via `flex` + `inline`) at higher specificity than the media-query rule.

**Problem:** `!important` overrides ALL other display rules including `display: none` from screen-reader-only utilities, `aria-hidden` clones, `[hidden]` attribute styling, etc.

**Fix shape:** structure the React component so the default state is `hidden` (no Tailwind display class), and the media query adds the display:

```tsx
// component
<span className="hdr-badge items-center gap-1 px-2 py-1 …">
```

```css
.hdr-badge {
  display: none;
  align-items: center;
  gap: 0.25rem;
  …
}
@media (dynamic-range: high) {
  .hdr-badge {
    display: inline-flex;
  }
}
```

Drop Tailwind `inline-flex`; use explicit CSS. No `!important` needed.

**Severity:** MED.

---

### HW-MED-2 — `is_hdr` boolean wins over a more granular signal

The schema has `is_hdr: boolean('is_hdr').notNull().default(false)`. This conflates:
- PQ-encoded (specular highlights to 1000+ nits)
- HLG-encoded (broadcast HDR with backwards-compatible SDR base)
- ICC-only with a HDR-named profile (heuristic match)
- Mastering metadata says HDR but pixel values are SDR-clamped

For audit and future delivery, the `transfer_function` column is the granular signal. `is_hdr` is a derived bool. UI should prefer the granular signal where available.

**Fix shape:** in `color-details-section.tsx`, render the badge based on `transfer_function in ('pq', 'hlg')` rather than `is_hdr`. Same effective behavior today; richer for future when (e.g.) Dolby Vision or HDR10+ is added.

**Severity:** LOW (refactor).

---

### HW-MED-3 — Mobile bottom sheet's HDR badge alignment

**Code:** `color-details-section.tsx:131-140` is shared between desktop sidebar and mobile bottom sheet. The badge sits in `col-span-2` on a 2-column grid.

On mobile (especially in landscape), the col-span-2 expands the badge to half-screen-wide while the badge text is short. Visual asymmetry.

**Fix shape:** wrap the badge in a `flex justify-start` so it stays compact regardless of column span.

**Severity:** LOW.

---

### HW-MED-4 — No "HDR mastering metadata" surface

The schema has `transfer_function`, `matrix_coefficients` but no SMPTE 2086 (mastering display primaries) or MaxCLL / MaxFALL (max content light level / max frame-average light level) columns. These are emitted by professional HDR workflows (DaVinci Resolve, Adobe Premiere Pro, Apple Compressor) and would let a future HDR delivery encoder pick an appropriate tone-map target.

**Photographer-intent impact:** today's audit panel shows "PQ (ST 2084)" but doesn't say "mastered for 1000-nit display". For pro work this is meaningful provenance.

**Fix shape:** future schema columns `mastering_max_luminance`, `mastering_min_luminance`, `max_cll`, `max_fall`. Parse from the AVIF `clli` box and HEIF `mdcv`/`mlhe` boxes. Defer to the WI-09 plan.

**Severity:** MED for completeness; LOW for this iteration.

---

## 4. LOW findings

- **HW-LOW-1** — `humanizeTransferFunction('pq')` returns "PQ (ST 2084)". Korean translation is missing — falls back to English. Add `transferFunctionPq: "PQ (ST 2084)"` to ko.json.
- **HW-LOW-2** — Forced-colors rule for `.hdr-badge` uses `forced-color-adjust: none` which disables system-color overrides. Acceptable for a brand badge; verify with high-contrast users.
- **HW-LOW-3** — No keyboard shortcut to focus the HDR badge / read the description. SR users tab into the accordion → button → descriptive text. Acceptable; could be smoother with a `kbd` shortcut.
- **HW-LOW-4** — `is_hdr` defaults `false` in schema with `notNull`. For pre-WI-09 rows this is correct. Post-WI-09, when the encoder writes `_hdr.avif` files, a separate `hdr_variant_exists` boolean would gate UI without conflating "source is HDR" with "we can deliver HDR".

---

## 5. Browser × HDR display matrix

For a hypothetical correctly-delivered HDR AVIF (post-WI-09), what would each combo do today?

| Browser | OS | Display | `(dynamic-range: high)` MQ | `<picture media>` selection | HDR badge visible | Renders HDR with extended luminance |
|---|---|---|---|---|---|---|
| Safari 17+ | macOS 14+ Sequoia | Internal P3 + 1000-nit (M3 MBP) | ✓ | HDR `<source>` | ✓ | ✓ |
| Safari 17+ | iOS 17+ | iPhone 15 Pro (1600-nit peak) | ✓ | HDR `<source>` | ✓ | ✓ |
| Chrome 122+ | macOS | Same MBP | **✗** (Chromium gap) | SDR `<source>` | **✗** | ✗ |
| Chrome 122+ | Windows 11 | Dell U2723QE w/ HDR | **✗** | SDR `<source>` | ✗ | ✗ |
| Edge 122+ | Windows 11 | Same with Auto HDR enabled | partial | SDR `<source>` | partial | ✗ |
| Firefox 124+ | macOS | Same MBP | **✗** | SDR `<source>` | ✗ | ✗ |
| Chrome 122+ | Android 14 | Pixel 8 (HDR display) | **✗** | SDR `<source>` | ✗ | partial |

**Today's effective HDR audience: Safari only.** Chrome/Edge/Firefox lag on the `dynamic-range` MQ.

**Photographer-intent impact:** even AFTER WI-09 ships, most non-Safari visitors will see the SDR fallback. The HDR delivery is Safari-skewed. This is a browser-vendor problem, not a GalleryKit problem.

**Implication for the badge:** even when HDR delivery is honest, the BADGE will still be invisible to most visitors due to MQ false-negatives. Consider:
- An admin-opt-in setting "show HDR badge regardless of display" for photographer demo workflows.
- A JS feature-detect for HDR via `screen.colorGamut` API (Chromium 121+) as a secondary signal.

---

## 6. WI-09 readiness checklist

When the HDR encoder finally ships, the following must all be true:

- [ ] PQ HEIF / HLG HEIF round-trip test fixtures committed.
- [ ] avifenc binary in Dockerfile.
- [ ] `encodeHdrAvif` shell-out wrapper with bounded args.
- [ ] BT.2390 / ACES tonemap path for SDR fallback.
- [ ] CICP nclx triplet in output AVIF (verified by `parseCicpFromAvif` test).
- [ ] `images.hdr_variant_exists` column populated only on success.
- [ ] `<picture> <source media="(dynamic-range: high)">` re-added in viewer / lightbox / home-client.
- [ ] HDR download menu item re-added with `hdr_variant_exists` gate.
- [ ] Mobile bottom sheet HDR download item parity restored.
- [ ] Service worker bypass for `_hdr.avif` URLs.
- [ ] `is_hdr` moved back from admin-only to public select.
- [ ] HDR badge color upgraded for visibility.
- [ ] Lightbox HDR pip implemented.
- [ ] Manual smoke matrix on Safari 17 / iPhone 15 Pro / MacBook Pro M3.

This is the WI-09 implementation plan. Defer to a separate plan when the work is scheduled.

---

## 7. Recommended fixes (HDR track)

Numbered to align with the plan in `.context/plans/38-photographer-r3-followup.md`:

1. **HW-CRIT-1** → P3-1 Close HDR download dropdown landmine (deletion).
2. **HW-CRIT-2** → P3-2 Reject HDR ingest with clear error until WI-09 ships (Direction A).
3. **HW-CRIT-3** → P3-3 Move `is_hdr`, `transfer_function`, `matrix_coefficients` to admin-only.
4. **HW-HIGH-1** → P3-13 ICC TRC-based HDR detection (replaces fragile name match).
5. **HW-HIGH-2** → P3-14 Upload-time HDR warning toast.
6. **HW-HIGH-3** → P3-15 HDR badge visibility / contrast bump.
7. **HW-HIGH-4** → P3-16 Lightbox HDR pip + slide-up color panel.
8. **HW-MED-1** → P3-17 Drop `!important` on `.hdr-badge`.
9. **HW-MED-2** → P3-18 Render badge based on `transfer_function`, not `is_hdr`.
10. **WI-09 readiness checklist** → tracked as separate plan when scheduled.

---

## 8. Open product questions for HDR

1. **Direction A vs B for HDR ingest.** Reject vs. tonemap. Recommendation: **A (reject) until WI-09 ships, plus admin opt-in to allow ingest with a warning**.
2. **HDR badge placement on lightbox.** Bottom-left corner pip vs. top-right banner vs. fade-in-on-hover. Recommendation: **bottom-left with controls fade**.
3. **`hdr_variant_exists` column now or post-WI-09?** Adding now is dead schema until WI-09. Recommendation: **defer to WI-09**.
4. **Korean phrasing for "HDR".** Loanword "HDR" vs. Korean "넓은 명암 표현" / "고명암 영상" / "하이 다이내믹 레인지". Recommendation: **acronym "HDR" + parenthetical Korean expansion** (matches current i18n).
5. **Admin override `allow_hdr_ingest`.** Default false (reject). Power users opt-in. Recommendation: yes.

---

## 9. Out of scope (per task premise)

- HDR10+ / Dolby Vision dynamic metadata.
- HDR video / cine.
- HDR print pipelines.
- HDR camera RAW demosaic.
- 3D LUT support for HDR.
- HDR soft-proof preview.
