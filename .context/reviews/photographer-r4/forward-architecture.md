# Forward-Architecture Review (R4)

**Date:** 2026-05-08
**Premise:** photos arrive AFTER editing. Architecture-readiness for the next major capability cuts (HDR delivery, JPEG XL, custom-ICC, gain map). Not bug-class; product-direction-class.
**Scope:** WI-09 readiness · gain map detection · custom-ICC chromaticity-based gamut detection · JPEG XL output · mastering metadata · `screen.colorGamut` JS API integration.

---

## 0. Current architecture state (post-cycle-9)

The encoder pipeline as it stands at `IMAGE_PIPELINE_VERSION = 6`:

```
upload → saveOriginalAndGetMetadata
       → detectColorSignals (NCLX colr walker + ICC name parse)
       → resolveColorPipelineDecision(iccName, signals)
       → resolveAvifIccProfile(iccName, signals)
       → reject if isHdr && !allowHdrIngest
       → enqueue
       → processImageFormats
         → 50 MP wide-gamut downscale gate
         → fan-out to AVIF (10-bit P3 / 8-bit sRGB), WebP (P3 / sRGB), JPEG (P3 4:4:4 / sRGB)
         → write _hdr.avif: NEVER (deferred to WI-09)
       → serve-upload route emits ETag W/"v6-mtime-size"
```

The schema:

```sql
images.color_space         varchar(255)  -- EXIF tag value ('sRGB' / 'Uncalibrated')
images.icc_profile_name    varchar(255)  -- ICC description ('Display P3', 'Adobe RGB (1998)', ...)
images.color_pipeline_decision varchar(64) -- enum, admin-only via _omitColorPipelineDecision
images.color_primaries     varchar(32)   -- 'p3-d65' | 'bt2020' | 'adobergb' | etc.
images.transfer_function   varchar(16)   -- 'srgb' | 'pq' | 'hlg' | etc., admin-only
images.matrix_coefficients varchar(16)   -- admin-only
images.is_hdr              boolean       -- admin-only
images.bit_depth           int           -- source bit depth
images.pipeline_version    int           -- for backfill idempotency
```

What's NOT yet built (or schema-only, not emitted):

- HDR AVIF variants (`_hdr.avif` files do not exist; no encoder branch).
- Apple gain map detection (`urim` / `tmap` / `auxl` boxes).
- Custom-ICC chromaticity detection (`wtpt` / `rXYZ` / `gXYZ` / `bXYZ` tags).
- Mastering display metadata (SMPTE 2086 / MaxCLL / MaxFALL — `clli` / `mdcv` boxes).
- JPEG XL output.
- ICC TRC-based PQ/HLG detection (P3-13 / C8-D3, also addressable by chromaticity per below).
- `hdr_variant_exists` schema column.

---

## FA-H1 — Apple HDR gain map detection

### Photographer-intent narrative

Modal HDR-shooting persona: an iPhone 14+ owner takes a photo in HDR mode (default since iOS 17). The HEIC file carries:

1. An SDR base image (Display P3, sRGB transfer, 8-bit YUV).
2. An auxiliary image item: the **Apple HDR gain map** (ISO/IEC 21496-1).
3. An `iref` `auxl` reference linking base → gain map.
4. Metadata: PQ / HLG-like signaling in the gain map's NCLX, but NOT in the base's NCLX.

iOS Photos.app, Apple Mail, iMessage, AirDrop, iCloud Photos all preserve gain maps. Modern Safari renders them as HDR on capable displays.

When this HEIC is uploaded to GalleryKit:
- `Sharp(heic).metadata()` reads the SDR base only. The gain map is NOT exposed.
- `detectColorSignals` returns `transfer='srgb'` (true for the base), `is_hdr=false` (false negative for the photographer's HDR intent).
- Encoder emits sRGB / P3 SDR derivatives.
- The HDR gain map is silently dropped.

The photographer's `is_hdr` audit signal is missing. The visitor on a HDR-capable iPhone doesn't see HDR. iOS Photos.app would have rendered HDR; GalleryKit doesn't.

### Why prior reviews missed it

R3 + cycles focused on PQ / HLG transfer functions parsed from the BASE's NCLX. The Apple gain map is a separate signaling path:

- Container: HEIF auxiliary image with `urn:com:apple:photo:2020:aux:hdrgainmap` (legacy) or ISO 21496-1 `tmap` brand.
- Detected by walking `iinf` (item info), looking for items with `infe.item_type == 'urim'` and the URI matching gain map.
- Or by walking `iref` for `auxl` references.

`detectColorSignals` does NOT walk these. The `colr` parser only reads color signaling.

### Detection spec

New file: `apps/web/src/lib/gain-map-detection.ts` (~80 lines):

```ts
/**
 * Detect Apple HDR gain map auxiliary items in a HEIF container.
 * Returns true if any item carries the gain map URN, OR if any iref
 * `auxl` reference points to an item whose infe.item_type is 'urim'.
 */
export function hasGainMap(buffer: Buffer): boolean {
  // Walk meta -> iinf -> infe items
  // Look for item_type === 'urim'
  // For each such item, check the optional URI for gainmap signature
  // OR walk meta -> iref for 'auxl' (auxiliary) references
  // Return true if ≥ 1 gain map item found
}
```

Plug into `detectColorSignals`:

```ts
const gainMap = format === 'heif' ? hasGainMap(buffer) : false;
return { ..., hasGainMap: gainMap };
```

### Schema

```sql
ALTER TABLE images
  ADD COLUMN has_gain_map BOOLEAN NOT NULL DEFAULT FALSE;
```

Drizzle: `has_gain_map: boolean('has_gain_map').notNull().default(false)`. Admin-only via `_omitHasGainMap` add to the omit block in `data.ts`.

### Audit surface

In `color-details-section.tsx`, when `isAdmin && image.has_gain_map`:

```tsx
<div className="col-span-2">
  <p className="text-muted-foreground text-xs">{t('viewer.gainMap')}</p>
  <p className="font-medium">
    {t('viewer.gainMapPresent')}
    <span className="ml-2 text-xs italic text-amber-700 dark:text-amber-300">
      {t('viewer.gainMapDeliveredAsSdr')}
    </span>
  </p>
</div>
```

i18n:
- en: `gainMap: "Apple HDR gain map"`, `gainMapPresent: "Detected"`, `gainMapDeliveredAsSdr: "(delivered as SDR base only)"`
- ko: `gainMap: "Apple HDR 게인 맵"`, `gainMapPresent: "감지됨"`, `gainMapDeliveredAsSdr: "(SDR 베이스로만 전달됨)"`

### Acceptance

- [ ] iPhone 14+ HDR HEIC upload sets `has_gain_map=true`.
- [ ] iPhone 14+ SDR HEIC (HDR-off in Camera settings) sets `has_gain_map=false`.
- [ ] Sony / Canon / Nikon HEIF (no gain map): `has_gain_map=false`.
- [ ] Admin Color Details panel shows the row when `has_gain_map=true`.
- [ ] Public never sees the row (admin-only via privacy guard).
- [ ] Test fixture: small (< 50 KB) iPhone HDR HEIC committed.

### Severity

**HIGH** for the iPhone-photographer audience (modal for personal galleries — the exact target of this product).

### Effort

**S** for detection + audit. **XL** for transcode (deferred to WI-09 — when avifenc + libavif 1.0+ ship gain map support, GalleryKit can transcode HDR HEIC → AVIF gain map and deliver actual HDR).

---

## FA-H2 — Custom monitor ICC chromaticity-based gamut detection

### Photographer-intent narrative

Pro photographers calibrate their monitors. Their export workflow embeds the calibrated ICC profile into the JPEG / TIFF / HEIF. Profile description names like:

- `EIZO ColorEdge CG2700X — 2026-04-12 calibrated`
- `BenQ SW272U — D65 native 2026-03-20`
- `Custom — sRGB ColorMunki 2025-12-01`
- `Apple Pro Display XDR — sRGB`
- `Adobe RGB Workspace`

The current resolver (`resolveColorPipelineDecision` + `resolveAvifIccProfile`) string-matches against these descriptions. None of the custom names match the allowlist (`'display p3'`, `'adobe rgb'`, `'prophoto'`, `'rec.2020'`, `'srgb'`). Result: `'srgb-from-unknown'` decision and `'srgb'` AVIF tag.

But the ACTUAL gamut may be wider:
- Eizo CG2700X native: ~99% Adobe RGB, ~98% P3.
- BenQ SW272U native: ~99% Adobe RGB, ~95% P3.
- Apple Pro Display XDR native: ~Display P3.

For the first three, the photographer's wide-gamut work is silently delivered as sRGB-clipped. For the last (Apple Pro Display XDR with sRGB ICC choice), the sRGB clip is the photographer's own choice — correct.

### Why R3 marked this LOW

R3 mentioned this once (CF-LOW-1) at LOW severity. The audience IS photographer-modal (the user persona). The volume of custom-ICC photos may be small, but every one of them is a photographer who specifically chose to calibrate — and silently has their work clipped.

R4 promotes to **HIGH** for the photographer-intent product narrative.

### Detection spec

New file: `apps/web/src/lib/icc-chromaticity.ts` (~150 lines):

```ts
/**
 * Parse an ICC profile and detect the working gamut from chromaticity tags.
 *
 * Returns the closest gamut preset (sRGB, Display P3, Adobe RGB, ProPhoto,
 * Rec.2020) within ΔE 0.005 tolerance, or 'unknown' if no match.
 *
 * Reads:
 *   wtpt (white point XYZ)
 *   rXYZ (red primary XYZ)
 *   gXYZ (green primary XYZ)
 *   bXYZ (blue primary XYZ)
 *
 * Converts XYZ → xy chromaticity via x = X/(X+Y+Z), y = Y/(X+Y+Z).
 *
 * Compares against gamut presets:
 *   sRGB:     R(0.640, 0.330) G(0.300, 0.600) B(0.150, 0.060) WP(0.3127, 0.3290)
 *   P3-D65:   R(0.680, 0.320) G(0.265, 0.690) B(0.150, 0.060) WP(0.3127, 0.3290)
 *   AdobeRGB: R(0.640, 0.330) G(0.210, 0.710) B(0.150, 0.060) WP(0.3127, 0.3290)
 *   ProPhoto: R(0.7347, 0.2653) G(0.1596, 0.8404) B(0.0366, 0.0001) WP(0.3457, 0.3585)
 *   Rec.2020: R(0.708, 0.292) G(0.170, 0.797) B(0.131, 0.046) WP(0.3127, 0.3290)
 *
 * Distance metric: max(|Δr|, |Δg|, |Δb|, |Δwp|) where each Δ is the
 * 2D Euclidean distance between source and preset chromaticity coords.
 *
 * Tolerance ≤ 0.005 — sufficient to catch calibration noise without
 * confusing close-but-distinct gamuts (sRGB vs AdobeRGB blue is 0 — they
 * share the blue primary, but green differs by 0.11).
 */
export function detectGamutFromIccChromaticity(icc: Buffer): {
  primary: 'srgb' | 'p3-d65' | 'adobergb' | 'prophoto' | 'bt2020' | 'unknown';
  whitePoint: { x: number; y: number };
  confidence: 'high' | 'medium' | 'low';
};
```

ICC tag structure (v2 / v4):
- ICC header (128 bytes).
- Tag table: `tagCount` followed by 12-byte entries (signature, offset, size).
- For each tag, signature is 4-char ASCII.
- `wtpt`, `rXYZ`, `gXYZ`, `bXYZ` payloads are `XYZType`: 8-byte type tag (`XYZ ` + reserved) + 12-byte XYZ triple as s15Fixed16 numbers.

Bounded parser: max tags 100, max scan offset 4 KB. No new dependency.

### Wire-up

Plug into `detectColorSignals` as a third resolver:

```ts
export async function detectColorSignals(filepath, _image, metadata): Promise<ColorSignals> {
  const iccName = metadata.icc ? extractIccProfileName(metadata.icc) : null;
  const iccChromaticity = metadata.icc ? detectGamutFromIccChromaticity(metadata.icc) : null;
  const nclxCicp = (format === 'heif' || format === 'avif') ? parseCicpFromHeif(filepath) : null;

  // Precedence: NCLX > ICC chromaticity > ICC name > heuristic
  let colorPrimaries: ColorPrimariesValue;
  if (nclxCicp) {
    colorPrimaries = NCLX_PRIMARIES_MAP[nclxCicp.colourPrimaries] ?? 'unknown';
  } else if (iccChromaticity && iccChromaticity.primary !== 'unknown' && iccChromaticity.confidence !== 'low') {
    colorPrimaries = iccChromaticity.primary;
  } else if (iccName) {
    colorPrimaries = inferColorPrimaries(iccName);
  } else {
    colorPrimaries = 'unknown';
  }
  // ...
}
```

`resolveColorPipelineDecision` and `resolveAvifIccProfile` already accept `signals`; they will pick up the chromaticity-derived primaries automatically.

### Acceptance

- [ ] Eizo CG2700X tagged JPEG (ICC name not in allowlist, but chromaticities ≈ Adobe RGB) → `color_primaries='adobergb'`, `color_pipeline_decision='p3-from-adobergb'`, AVIF P3-tagged.
- [ ] BenQ SW272U tagged JPEG → same as Eizo.
- [ ] Custom sRGB-calibrated ICC → `color_primaries='bt709'`, `color_pipeline_decision='srgb'`, AVIF sRGB-tagged.
- [ ] Apple Display P3 tagged JPEG (matches name allowlist anyway) → unchanged behavior.
- [ ] Test fixtures: 3 custom ICC profiles committed (Eizo-flavored, sRGB-flavored, AdobeRGB-flavored).

### Severity

**HIGH** for pro photographer audience.

### Effort

**M** (~150 lines parser + tests + integration).

---

## FA-M1 — Real PQ HEIF / HLG HEIF / Rec.2020-NCLX-only / custom-monitor-ICC test fixtures

(Re-promoted from cycle-8 deferred C8-D7.)

### Why this matters

Today's 17 color-related tests cover the encoder behavior with synthetic ICCs. None of:
- PQ HEIF round-trip (the source class P3-2 rejects).
- HLG HEIF round-trip.
- Rec.2020-NCLX-only AVIF (no ICC).
- Custom-monitor ICC profile (the FA-H2 audience).

Without these, the relevant code paths are theoretical.

### Spec

Commit to `apps/web/__test_fixtures__/color/`:

| Filename | Size | Source | Used by |
|---|---|---|---|
| `pq-hdr-sample.heif` | < 50 KB | `avifenc --cicp 9/16/9 --depth 10` over a 64×64 synthetic gradient | `process-image-hdr-rejection.test.ts` |
| `hlg-hdr-sample.heif` | < 50 KB | `avifenc --cicp 9/18/9 --depth 10` | same |
| `rec2020-cicp-only.avif` | < 50 KB | `avifenc --cicp 9/14/9` (Rec.2020 SDR no ICC) | new `process-image-rec2020-cicp.test.ts` |
| `dci-p3-cinema.tiff` | < 100 KB | LUT'd to DCI white point 0.314, 0.351 | new `process-image-dci-p3-bradford.test.ts` |
| `eizo-cg2700x.icc.jpg` | < 50 KB | small JPEG with custom ICC `EIZO_CG2700X_2026-04-12.icc` (chromaticities ≈ Adobe RGB) | new `process-image-icc-chromaticity.test.ts` (FA-H2) |

Sources: synthesize via `avifenc` / `heif-convert` from public-domain seeds. Document repro recipe.

### Effort

**S**.

### Acceptance

- [ ] All 5 fixtures committed and < 250 KB total.
- [ ] Each fixture used by ≥ 1 test.
- [ ] CI green; no regression on existing tests.

---

## FA-FORWARD-1 — WI-09 HDR encoder readiness checklist (consolidated)

Today's WI-09 readiness is scattered across plans 36 / 38 / cycle plans. Consolidate into a single living checklist.

### Pre-flight blockers (must be true before WI-09 ships)

- [ ] **avifenc binary** in Dockerfile (libavif-bin package on Debian-bookworm).
- [ ] **BT.2390 / ACES tonemap** path implemented (Sharp lacks `tonemap_bt2390`; options: avifenc shell-out for HDR + Sharp-pipeline-with-manual-curve for SDR fallback).
- [ ] **Mastering metadata schema** (SMPTE 2086 / MaxCLL / MaxFALL → `clli` / `mdcv` boxes) — blocks tone-map target choice. See FA-FORWARD-2.
- [ ] **`hdr_variant_exists` schema column** populated only when encoder successfully writes `_hdr.avif`. Default false.
- [ ] **Service worker bypass** for `*_hdr.avif` URLs (don't starve SDR LRU cache).
- [ ] **`<picture> <source media="(dynamic-range: high)">` re-added** in viewer / lightbox / home-client; gated on `image.hdr_variant_exists`.
- [ ] **HDR download menu item re-added** in photo-viewer + bottom sheet; gated on `image.hdr_variant_exists`.
- [ ] **`is_hdr` moved back to public select** (with the `hdr_variant_exists` gate honoring delivery honesty).
- [ ] **Touch-target audit** updated for any new lightbox HDR pip details.
- [ ] **Manual smoke matrix** on Safari 17 / iPhone 15 Pro / MacBook Pro M3 / Edge with Auto HDR.

### Migration concerns

- Existing photos with `is_hdr=true` (legacy, ingested before P3-2 reject ship) have NO `_hdr.avif` files. Need a migration path:
  - Option A: bulk-process them with the new encoder via the backfill script.
  - Option B: leave `hdr_variant_exists=false`; treat them as SDR forever.
  - Recommendation: **A** (operator runs `npm run backfill-cicp-recheck && npm run backfill-color-pipeline` to re-encode).

### Apple gain map integration

WI-09 should also handle FA-H1: when `has_gain_map=true`, transcode the gain map into AVIF gain map (libavif 1.0+) and emit alongside the SDR base. Browser support for AVIF gain maps: Safari 18+, Chrome 130+ (behind flag).

### Test infrastructure

- Add `pq-hdr-sample.heif` and `hlg-hdr-sample.heif` round-trip tests verifying CICP `9/16/9` or `9/18/9` in the output AVIF.
- Add ACES tonemap correctness fixture (compare BT.2390 reference vs. delivered SDR).
- Add gain-map-bearing iPhone HDR HEIC round-trip test.

### Effort

**XL**. The whole HDR encoder is the largest piece in plan 36; this checklist is just consolidation.

### Acceptance

This file consolidates the checklist; the actual work happens when WI-09 is scheduled.

---

## FA-FORWARD-2 — Mastering metadata schema (SMPTE 2086 / MaxCLL / MaxFALL)

### Why it matters

For HDR delivery, the encoder needs to know the **mastering display's peak luminance** (e.g., 1000 nits / 2000 nits / 4000 nits) and the **content's max luminance** (MaxCLL — frame-level peak) and **average luminance** (MaxFALL — content-level average).

These drive tone-mapping target choice:
- 1000-nit-mastered content → tone-map to 1000 nit target on iPhone Pro display.
- 4000-nit-mastered content → tone-map to 1000-2000 nit on phone.
- Without metadata: assume 1000-nit, may over-saturate brighter sources.

Pro HDR exports (DaVinci Resolve, Apple Compressor, Adobe Premiere Pro) carry `clli` and `mdcv` boxes in the AVIF / HEIF container.

### Schema

```sql
ALTER TABLE images
  ADD COLUMN mastering_display_max_luminance INT NULL,    -- in cd/m² × 10000 (per SMPTE 2086)
  ADD COLUMN mastering_display_min_luminance INT NULL,
  ADD COLUMN max_cll INT NULL,                             -- in cd/m²
  ADD COLUMN max_fall INT NULL;
```

All admin-only.

### Parsing

Walk `mdcv` (Mastering Display Colour Volume — SMPTE 2086) and `clli` (Content Light Level Information) boxes in the HEIF / AVIF container. ISOBMFF parser already exists in `color-detection.ts` — extend the box walker.

### Audit surface

Admin Color Details panel:

```
Mastering: 1000 nit peak / 0.05 nit black
Max CLL: 850 cd/m²
Max FALL: 220 cd/m²
```

### Effort

**M**.

### Severity

**LOW** today (no HDR encoder ships). **HIGH** when WI-09 schedules — without metadata, tone-map quality is degraded.

### Acceptance

- [ ] Sony α7 IV HLG HEIF mastering metadata extracted and stored.
- [ ] Apple iPhone PQ ProRAW mastering metadata extracted.
- [ ] Synthetic HDR AVIF (avifenc-generated) mastering metadata extracted.
- [ ] Admin panel displays the four numeric fields.

---

## FA-FORWARD-3 — JPEG XL output as 4th derivative

### Why it matters

JPEG XL (JXL) is a modern lossless / lossy image format that supports:
- Wider gamut than 8-bit JPEG (12-bit / 16-bit per channel).
- Better compression at perceptual-equivalence than AVIF.
- Lossless and lossy modes.
- Animation, alpha, multi-frame.
- Browser support: Safari 17+ ✓; Chrome 145+ behind a flag; Firefox 129+ behind a flag.

For a photographer-grade gallery, JXL is the next compression frontier. Adding it as a 4th derivative would let early-adopter Safari visitors get smaller files than AVIF.

### Architecture

Sharp 0.34+ supports JXL via libjxl. Add to `processImageFormats`:

```ts
await Promise.all([
  generateForFormat('jxl', UPLOAD_DIR_JXL, filenameJxl),
  generateForFormat('avif', UPLOAD_DIR_AVIF, filenameAvif),
  generateForFormat('webp', UPLOAD_DIR_WEBP, filenameWebp),
  generateForFormat('jpeg', UPLOAD_DIR_JPEG, filenameJpeg),
]);
```

`<picture>` source order: JXL → AVIF → WebP → JPEG.

### Concerns

- JXL Sharp encode is currently SLOWER than AVIF effort=6 (~2× per image). Operator throughput impact.
- Storage: +50% on a 4-format library. Operator awareness needed.
- libjxl version pinning matters — older versions had bugs.

### Severity

**LOW** today. Track for when libjxl + Sharp + browser support stabilize.

### Effort

**M** (similar to AVIF derivative addition).

### Acceptance

- [ ] Sharp 0.35+ available in Docker image.
- [ ] libjxl support stable.
- [ ] Safari 17+ market share > 30% AND Chrome ships JXL out-of-flag.
- [ ] Then ship.

---

## FA-FORWARD-4 — `screen.colorGamut` JS API integration

(Cross-reference: R4-M1 in `_aggregate.md`.)

### Why it matters

`window.screen.colorGamut` returns `'srgb' | 'p3' | 'rec2020'`. Available in:
- Chromium 121+ (Chrome / Edge / Opera / Brave).
- Safari 18+ (TP shipped 2024-Q4).
- Firefox: not yet shipped (tracking bug).

More reliable than `(color-gamut: p3)` MQ on Firefox (which is permanently false until Mozilla bug 1591455 fixes).

### Architecture

New shared hook `apps/web/src/lib/use-display-capability.ts`:

```ts
'use client';
import { useSyncExternalStore } from 'react';

interface DisplayCapability {
  colorGamut: 'srgb' | 'p3' | 'rec2020';
  isHdr: boolean;
}

function detect(): DisplayCapability {
  // Layered detection in priority order:
  //   1. screen.colorGamut (Chromium 121+, Safari 18+)
  //   2. matchMedia('(color-gamut: p3)') — Chrome/Safari/Edge but NOT Firefox
  //   3. canvas-P3 feature probe — Firefox 113+
  let gamut: 'srgb' | 'p3' | 'rec2020' = 'srgb';
  if ('screen' in window && 'colorGamut' in window.screen) {
    const cg = (window.screen as Screen & { colorGamut?: string }).colorGamut;
    if (cg === 'rec2020') gamut = 'rec2020';
    else if (cg === 'p3') gamut = 'p3';
  } else if (window.matchMedia?.('(color-gamut: p3)').matches) {
    gamut = 'p3';
  } else if (probeCanvasP3()) {
    gamut = 'p3';
  }

  const isHdr = window.matchMedia?.('(dynamic-range: high)').matches ?? false;

  return { colorGamut: gamut, isHdr };
}

export function useDisplayCapability(): DisplayCapability { /* useSyncExternalStore */ }
```

Consumers:
- `wide-gamut-hint.tsx` — hide hint when `colorGamut !== 'srgb'`.
- `histogram.tsx` — gate canvas-P3 path on `colorGamut !== 'srgb'`.
- `force-show-color-chips` — admin-override interaction.
- Future LightboxColorPip — show HDR pip on `isHdr`.

### Severity

**MED**. Photographer audience is meaningful for Firefox + P3 display.

### Effort

**S**.

### Acceptance

- [ ] Firefox 124+ on macOS internal P3 display: `colorGamut === 'p3'` (via canvas-P3 fallback).
- [ ] Chrome 122+ on macOS P3: `colorGamut === 'p3'` (via screen.colorGamut).
- [ ] Edge with HDR display + auto-HDR mode: `isHdr === true`.
- [ ] `WideGamutHint` not rendered for any P3-display visitor.

---

## FA-L1 — ETag formula could include settings hash

### Why it matters

`serve-upload.ts:97`: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs}-${stats.size}"`.

When admin flips `wide_gamut_jpeg_chroma` 4:4:4 → 4:2:2 without re-running the backfill script, cached clients keep stale 4:4:4 variants. Operator-discipline issue.

### Spec

```ts
import { sha256 } from 'crypto';
const settingsHash = sha256(JSON.stringify({
  jpegChroma: config.wideGamutJpegChroma,
  avifEffort: config.avifEffort,
  forceSrgb: config.forceSrgbDerivatives,
  // ... add new color-impacting settings here
})).slice(0, 8);
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs}-${stats.size}-${settingsHash}"`;
```

### Severity

**LOW** (operator-discipline today).

### Effort

**S**.

---

## Severity-rated summary

| ID | Severity | Effort |
|---|---|---|
| FA-H1 (Apple gain map detection) | HIGH | S detect / XL transcode (WI-09) |
| FA-H2 (ICC chromaticity-based detection) | HIGH | M |
| FA-M1 (HEIF/HLG/Rec2020 fixtures) | MED | S |
| FA-FORWARD-1 (WI-09 readiness consolidation) | DOC | S |
| FA-FORWARD-2 (Mastering metadata schema) | LOW (now) / HIGH (WI-09) | M |
| FA-FORWARD-3 (JPEG XL) | LOW | M (when stable) |
| FA-FORWARD-4 (screen.colorGamut hook) | MED | S |
| FA-L1 (ETag settings hash) | LOW | S |

---

## Out of scope

- HDR10+ / Dolby Vision dynamic metadata.
- HDR video / cine.
- Print color management (CMYK).
- Print proofing / soft-proof preview.
- 3D LUT support.
- Custom ICC generator UI.
- Color picker / eye-dropper.
- ColorChecker patch overlay calibration.
- Camera RAW demosaic.
- Edit / culling / scoring features.
