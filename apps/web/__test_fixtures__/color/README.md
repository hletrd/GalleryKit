# Color test fixtures

Synthetic color/HDR fixtures for the color-detection test suite. The fixtures
are generated programmatically (no proprietary samples) so reviewers can
reproduce them locally and the diff stays auditable.

## Inventory

| File | Purpose | Generator |
|---|---|---|
| `synth-srgb.png` | sRGB ICC, 8-bit, used as the baseline color reference | Sharp + sRGB ICC |
| `synth-p3-d65.png` | Display P3 ICC, 8-bit, wide-gamut input fixture | Sharp + Display P3 ICC |
| `synth-adobergb-flavored.icc` | AdobeRGB-equivalent chromaticities, opaque description (Eizo CG2700X-flavored) | `scripts/build-color-fixtures.ts` |
| `synth-srgb-chromaticities.icc` | sRGB primaries with custom name | `scripts/build-color-fixtures.ts` |
| `synth-prophoto-chromaticities.icc` | ProPhoto primaries (D50 white) with custom name | `scripts/build-color-fixtures.ts` |
| `synth-bt2020-chromaticities.icc` | Rec.2020 primaries with custom name | `scripts/build-color-fixtures.ts` |
| `synth-p3-chromaticities.icc` | P3-D65 primaries with custom name | `scripts/build-color-fixtures.ts` |

## Gap — real HEIF / AVIF fixtures

The plan calls for these additional fixtures:

- `pq-hdr-sample.heif` — 64×64 PQ HEIF (NCLX 9/16/9, 10-bit).
- `hlg-hdr-sample.heif` — 64×64 HLG HEIF (NCLX 9/18/9, 10-bit).
- `rec2020-cicp-only.avif` — 64×64 Rec.2020 SDR AVIF (NCLX 9/14/9), no ICC.
- `dci-p3-cinema.tiff` — 64×64 DCI-P3 TIFF (DCI white 0.314, 0.351).
- `iphone-15-hdr.heic` — small iPhone HDR HEIC with Apple gain map.

These cannot be produced from this CI environment because:

1. `avifenc` / `heif-convert` / `heif-enc` are not installed locally.
2. Sharp 0.34.x does not expose CICP signaling for AVIF/HEIF encode.
3. iPhone HEIC fixtures must be captured on real hardware (not synthesized).

The existing fixture-style unit tests (`__tests__/gain-map-detection.test.ts`,
`__tests__/icc-chromaticity.test.ts`, `__tests__/color-detection.test.ts`)
already exercise the byte-level parsers against hand-crafted ISOBMFF /
ICC buffers. Real HEIF / AVIF fixtures would only re-test the same parsers
through a thicker stack; the unit-test coverage is the source of truth.

## Reproduction recipe — when avifenc is available

```bash
# PQ HEIF (Rec.2020 / SMPTE ST 2084 / Rec.2020 NCL)
avifenc --cicp 9/16/9 --depth 10 --range full \
    -- 64x64-y-gradient.png pq-hdr-sample.heif

# HLG HEIF (Rec.2020 / ARIB STD-B67 / Rec.2020 NCL)
avifenc --cicp 9/18/9 --depth 10 --range full \
    -- 64x64-y-gradient.png hlg-hdr-sample.heif

# Rec.2020 SDR AVIF, no ICC
avifenc --cicp 9/14/9 --depth 10 --range full --ignore-icc \
    -- 64x64-rgb-gradient.png rec2020-cicp-only.avif
```

The `--cicp` triplet maps to (colour_primaries / transfer_characteristics /
matrix_coefficients) per Rec. ITU-T H.273. The detection tests verify that
these CICP triplets resolve to the expected `ColorSignals` outputs.

For the iPhone gain map fixture, capture in HDR mode on iOS 17+ then
strip everything except the structural ISOBMFF metadata (no pixel data
required):

```bash
# Apple Photos export keeps the gain map auxl reference. ImageMagick can
# strip the pixel payload while preserving meta for compact (≤ 50 KB) test
# distribution. Treat the resulting file as test-only — never decode it.
```

If you cannot capture on real hardware, the gain-map detector tests cover
the structural shapes (`urim` + URI, `tmap`, `auxl` iref) byte-for-byte at
the unit-test level — see `apps/web/src/__tests__/gain-map-detection.test.ts`.
