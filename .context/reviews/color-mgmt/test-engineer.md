# Color Management — Test Engineer Review

**Date:** 2026-05-03
**Reviewer role:** Test Engineer (coverage gaps, test design, TDD enforcement)
**Scope:** `apps/web/src/lib/process-image.ts` and all color/ICC/EXIF test files
**Sharp version in use:** `^0.34.5` (Sharp 0.34 API)
**Test framework:** Vitest `^4.1.4`

---

## Existing Test Files Audited

| File | Tests | What it covers |
|------|-------|----------------|
| `process-image-p3-icc.test.ts` | 14 | `resolveAvifIccProfile` decision matrix (pure fn); Sharp round-trip proves ICC buffer exists and differs between p3 vs sRGB |
| `process-image-metadata.test.ts` | 5 | `extractIccProfileName` (mluc/UTF-16BE decode, byte-bounding); `extractExifForDb` string truncation |
| `process-image-blur-wiring.test.ts` | 3 | Source-code contract: `assertBlurDataUrl` import and call-site wiring (static AST check) |
| `process-image-dimensions.test.ts` | 3 | `saveOriginalAndGetMetadata` rejects zero/undefined dimensions |
| `process-image-variant-scan.test.ts` | 3 | `deleteImageVariants` with `sizes=[]` directory-scan path |
| `serve-upload.test.ts` | 3 | `serveUploadFile` happy path, dir/ext mismatch, symlink traversal — does NOT cover the original-file download route |

No other test file in `__tests__/` touches color space, ICC profiles, EXIF orientation, CMYK conversion, 16-bit depth, or the `processImageFormats` pipeline directly.

---

## Finding Index

| # | Topic (from prompt) | Severity | Coverage status |
|---|---------------------|----------|-----------------|
| 1 | Display-P3 round-trip: ICC tag survives AVIF encode | Medium | Partial |
| 2 | Adobe RGB round-trip: pixel-transform absent (critical bug) | **High** | Missing |
| 3 | ProPhoto RGB round-trip | Medium | Missing |
| 4 | Untagged sRGB: no phantom ICC on output | Medium | Missing |
| 5 | 16-bit TIFF precision through 10-bit AVIF | Low | Missing |
| 6 | CMYK input: convert or reject cleanly | **High** | Missing |
| 7 | Hostile ICC: oversized/malformed — no OOM | **High** | Partial |
| 8 | EXIF ColorSpace vs ICC mismatch: which wins? | Medium | Missing |
| 9 | Pipeline color space for resize: linear-light vs gamma | Low | Missing |
| 10 | Three-encoding parity (AVIF/WebP/JPEG color agreement) | Medium | Missing |
| 11 | Reprocess idempotence: byte-identical output on second run | Low | Missing |
| 12 | Original-file download serves ICC-tagged source | Medium | Missing |
| 13 | `withMetadata({icc})` / `keepIccProfile()` option lock-in | **High** | Partial |
| 14 | AVIF derivative has no GPS/serial/lens in EXIF | **High** | Missing |
| 15 | EXIF orientation: rotated iPhone photos display upright | **High** | Missing |
| 16 | Visual regression fixtures for wide-gamut input | Low | Missing |

---

## Detailed Findings

### Finding 1 — Display-P3 round-trip: ICC tag survives AVIF encode
**Severity:** Medium | **Confidence:** High

**Existing coverage:** `process-image-p3-icc.test.ts` lines 105-142 write a 4×4 AVIF using Sharp's `withMetadata({ icc: 'p3' })` directly and confirm that `sharp(file).metadata().icc` is a non-null buffer that differs from the sRGB buffer.

**What is missing:** The test does not invoke `processImageFormats`. It calls `sharp({ create: ... }).withMetadata({ icc }).avif()` directly, bypassing the actual pipeline code path at `process-image.ts:556-564`. A refactor that inserts a step between `keepIccProfile()` and `withMetadata({ icc })` (e.g., a `.toColorspace()` call that strips embedded metadata) would not be caught.

The round-trip also does not verify the ICC profile *name* in the output file (only buffer non-null). A future change that switches `icc: 'p3'` to `icc: 'srgb'` for efficiency reasons would produce a non-null buffer that still passes the existing test while silently downgrading wide-gamut photos.

**Failure mode caught by a complete test:** P3 photos served as sRGB-tagged AVIF; wide-gamut colors clip/shift on Apple displays with P3 panels.

**Proposed test** (integration, uses `processImageFormats` with real Sharp):
```typescript
it('processImageFormats embeds Display-P3 ICC in AVIF output for P3 source', async () => {
    // Create a 4x4 Display-P3 source JPEG fixture, write to tmpDir/original/
    // Call processImageFormats(srcPath, ..., iccProfileName: 'Display P3')
    // Read output AVIF metadata, check meta.icc !== null
    // Extract ICC profile name from buffer via extractIccProfileName
    // Expect name to include 'display p3' (case-insensitive)
});
```

---

### Finding 2 — Adobe RGB round-trip: no pixel transform (critical design bug)
**Severity:** High | **Confidence:** High

**Existing coverage:** `process-image-p3-icc.test.ts:59-64` tests that `resolveAvifIccProfile('Adobe RGB (1998)')` returns `'p3'`. This only tests the decision function.

**What is missing and why it matters:** The code at `process-image.ts:526,562` passes `avifIcc = 'p3'` to `withMetadata({ icc: avifIcc })`. This *tags* the AVIF with a P3 ICC profile. However, the pipeline calls `keepIccProfile()` at line 556, which carries the *source* Adobe RGB ICC into the encode stage, and then `withMetadata({ icc: 'p3' })` *replaces* the embedded profile with Apple's Display-P3 ICC — without performing a pixel-value conversion from Adobe RGB primaries to Display-P3 primaries.

The result is that pixel values encoded from an Adobe RGB source are labeled as Display-P3, causing a systematic color error: colors that were in the Adobe RGB gamut but outside P3 will display incorrectly (typically over-saturated greens and cyans) on P3 displays, and even more incorrectly on sRGB displays that ignore the ICC tag.

A correct implementation would need either:
- `.toColorspace('display-p3')` before encode (converts pixels), or
- `.withIccProfile(adobeRgbIccBuffer).toColorspace('p3')` chain

This is the most impactful gap because it means every Adobe RGB photo in the gallery displays with wrong colors on any ICC-aware viewer.

**Proposed test** (integration, sampling pixel values):
```typescript
it('Adobe RGB source AVIF does not clip red-green after profile tag (known bug regression)', async () => {
    // Create a synthetic image with a color that is in Adobe RGB but outside sRGB
    // (e.g., r=0, g=255, b=0 in Adobe RGB primaries maps to a different chroma than P3 g=255)
    // Process through processImageFormats with iccProfileName: 'Adobe RGB (1998)'
    // Read output AVIF raw pixel via sharp(avifPath).raw().toBuffer()
    // Compare a known-safe pixel in P3 gamut: value should differ from naive sRGB passthrough
    // This test SHOULD FAIL until pixel transform is added — marks the bug
});
```

Note: this test should be written to FAIL against the current code to document the bug (TDD RED phase). It becomes GREEN once the pixel transform is implemented.

---

### Finding 3 — ProPhoto RGB round-trip
**Severity:** Medium | **Confidence:** High

**Existing coverage:** `resolveAvifIccProfile('ProPhoto RGB')` returns `'p3'` is tested. Pipeline behavior is not tested.

**What is missing:** ProPhoto RGB has a gamut much wider than Display-P3. Mapping ProPhoto to P3 by relabeling (same bug as Finding 2) discards the out-of-P3-gamut information and mislabels the remaining pixel values. A test that verifies the ICC profile name in the output AVIF (analogous to Adobe RGB) would at minimum catch relabeling vs. conversion.

**Proposed test:** Same shape as Finding 2, using `iccProfileName: 'ProPhoto RGB'`. Given that ProPhoto is even wider than Adobe RGB, the color error is larger but affects fewer real-world cameras (primarily medium-format and raw converters).

---

### Finding 4 — Untagged sRGB input produces no phantom ICC on output
**Severity:** Medium | **Confidence:** High

**Existing coverage:** `resolveAvifIccProfile(null)` returns `'srgb'` is tested (pure function). No test verifies what the pipeline physically writes when the source has no ICC.

**What is missing:** When a JPEG has no embedded ICC (common for older cameras and scanned images), Sharp's `keepIccProfile()` at line 556 has nothing to keep. The subsequent `withMetadata({ icc: 'srgb' })` call then embeds Apple's sRGB ICC profile. This is correct behavior, but it is untested. A future change that switches from `withMetadata({ icc: avifIcc })` to a bare `withMetadata()` (to "save bytes") would silently produce untagged output.

**Proposed test:**
```typescript
it('AVIF output for source with no ICC carries an explicit sRGB ICC tag', async () => {
    // Create a 4x4 JPEG with NO embedded ICC (sharp().jpeg() without withMetadata)
    // Process through processImageFormats(srcPath, ..., iccProfileName: null)
    // Read output AVIF: expect meta.icc to be non-null
    // Confirm ICC name contains 'srgb' (via extractIccProfileName)
});
```

---

### Finding 5 — 16-bit TIFF precision through 10-bit AVIF
**Severity:** Low | **Confidence:** Medium

**Existing coverage:** `bitDepth` is extracted and stored (`process-image.ts:478-479`). No test covers the encode fidelity path.

**What is missing:** The AVIF encoder in Sharp (libavif) defaults to 8-bit encode. A 16-bit TIFF source is downsampled to 8-bit unless `bitdepth: 10` or `bitdepth: 12` is passed to `.avif()`. The current code calls `.avif({ quality: qualityAvif })` with no `bitdepth` option, meaning 16-bit input is silently truncated to 8-bit AVIF. A histogram-distance test would catch any banding. At minimum a test that verifies the output bit depth from Sharp's metadata would document the current behavior and prevent silent regression.

**Proposed test (behavior-documentation level):**
```typescript
it('AVIF output for 16-bit TIFF input records the source bitDepth and does not crash', async () => {
    // Create a 16-bit TIFF using sharp(...).tiff({ bitdepth: 16 })
    // Call saveOriginalAndGetMetadata — check result.bitDepth === 16
    // Call processImageFormats — confirm output AVIF file is non-empty (no crash)
    // NOTE: This test documents that 10-bit encode is NOT currently requested;
    //       upgrade to histogram-distance check once bitdepth option is added.
});
```

---

### Finding 6 — CMYK input: convert or reject cleanly
**Severity:** High | **Confidence:** High

**Existing coverage:** None. CMYK (`.tiff` with CMYK colorspace) is in the ALLOWED_EXTENSIONS set and will reach `processImageFormats`.

**What is missing:** Sharp handles CMYK by converting to sRGB via `toColorspace('srgb')` when an output format is specified without explicit colorspace conversion. However, this behavior is implicit and version-dependent. If Sharp changes its default (or if a corrupt CMYK profile confuses libvips), the pipeline could crash with `Error: Unsupported colorspace conversion`, producing no output file. The output file size check at lines 617-628 would then throw `Image processing failed: generated file could not be verified`, but the error would be confusing and the upload record would be left in a broken state.

**Proposed test:**
```typescript
it('processImageFormats converts CMYK TIFF to sRGB AVIF without crashing', async () => {
    // Create a CMYK TIFF: sharp(...).toColorspace('cmyk').tiff()
    // Call processImageFormats(...)
    // Confirm all three output files are non-empty
    // Confirm output JPEG/WebP is readable by sharp (no corrupt output)
});
```

This test also documents the implicit Sharp CMYK-to-sRGB behavior so a future Sharp major upgrade that changes it is caught immediately.

---

### Finding 7 — Hostile ICC: oversized or malformed chunk
**Severity:** High | **Confidence:** High

**Existing coverage:** `extractIccProfileName` has bounds checks at `process-image.ts:340` (`Math.min(..., 100)` tag count bound), line 365 (`Math.min(..., 100)` record count), and line 372 (`Math.min(..., 1024)` string length). The function is wrapped in a `try/catch` at line 386.

**What is partially missing:** There is no test that exercises the bounds-checking code with a crafted hostile ICC buffer. The existing tests only use the `makeMlucIcc` helper which produces well-formed buffers. A buffer with `tagCount = 0xFFFFFFFF` (before the `Math.min` cap) is never exercised. The `Math.min` at line 340 caps to 100 iterations but there is no test confirming this cap fires. If someone removes the cap during refactoring (e.g., reasoning "the loop is O(1) per tag"), the protection disappears silently.

Additionally, the `extractIccProfileName` function returns `null` when the buffer is too short (`icc.length <= 132`), but there is no test for a buffer of exactly length 132 (boundary value) or 133 (first accepted length).

**Proposed tests:**
```typescript
it('extractIccProfileName returns null without throwing for buffer with forged tagCount=0xFFFFFFFF', () => {
    const buf = Buffer.alloc(200, 0);
    buf.writeUInt32BE(0xFFFFFFFF, 128); // tagCount = max uint32
    // should not throw, should return null
    expect(() => extractIccProfileName(buf)).not.toThrow();
    expect(extractIccProfileName(buf)).toBeNull();
});

it('extractIccProfileName returns null for buffer of exactly 132 bytes (boundary)', () => {
    expect(extractIccProfileName(Buffer.alloc(132))).toBeNull();
});

it('extractIccProfileName handles buffer with dataOffset pointing beyond buffer end', () => {
    const buf = Buffer.alloc(200, 0);
    buf.writeUInt32BE(1, 128);       // tagCount = 1
    buf.write('desc', 132, 'ascii'); // tagSig = 'desc'
    buf.writeUInt32BE(9999, 136);    // dataOffset = beyond buffer
    buf.writeUInt32BE(8, 140);       // dataSize
    expect(() => extractIccProfileName(buf)).not.toThrow();
    expect(extractIccProfileName(buf)).toBeNull();
});
```

---

### Finding 8 — EXIF ColorSpace tag mismatch with embedded ICC
**Severity:** Medium | **Confidence:** High

**Existing coverage:** `extractExifForDb` is tested for string truncation only. The `color_space` field logic at `process-image.ts:687-697` is entirely untested. Specifically, the code returns `'Uncalibrated'` when `ColorSpace === 65535`, which is the EXIF value written by Adobe Lightroom for Adobe RGB and P3 images. The `iccProfileName` (from actual ICC parsing) is the authoritative source for `resolveAvifIccProfile`, but `color_space` and `iccProfileName` are stored as separate DB columns. No test verifies what happens when they disagree (e.g., `ColorSpace=1` (sRGB) but ICC says `Display P3`).

**What the failure mode is:** A camera that writes `ColorSpace=1` for a P3 export (some Canon/Sony bodies do this when the photo is captured in Display P3 mode) would get `color_space='sRGB'` in the DB while `iccProfileName='Display P3'`. The AVIF would be correctly tagged P3 (because `resolveAvifIccProfile` uses `iccProfileName`), but the display metadata shown in the UI would say "sRGB". Not a pixel-level corruption but a misleading user-facing display.

**Proposed test:**
```typescript
it('extractExifForDb returns Uncalibrated for ColorSpace=65535 (Adobe RGB/P3 EXIF pattern)', () => {
    const result = extractExifForDb({ exif: { ColorSpace: 65535 } });
    expect(result.color_space).toBe('Uncalibrated');
});

it('extractExifForDb returns sRGB for ColorSpace=1', () => {
    const result = extractExifForDb({ exif: { ColorSpace: 1 } });
    expect(result.color_space).toBe('sRGB');
});

it('extractExifForDb returns null for absent ColorSpace', () => {
    const result = extractExifForDb({ exif: {} });
    expect(result.color_space).toBeNull();
});
```

These are pure-function unit tests, zero-cost to run.

---

### Finding 9 — Pipeline color space: resize step in linear-light vs gamma
**Severity:** Low | **Confidence:** Medium

**Existing coverage:** None.

**What is missing:** Sharp's `resize()` defaults to `kernel: 'lanczos3'` in the sRGB (gamma-encoded) domain in most libvips builds, but libvips can be configured to linearize before resizing. The pipeline at line 556 calls `.resize({ width: resizeWidth })` with no explicit `kernel` or `fastShrinkOnLoad` option. This means the resize color space is determined by libvips build flags, which can differ between the development Docker image and production. A gradient test (produce a smooth gradient, resize it, verify no unexpected banding at the center of the gradient) would detect this. This is a low-priority cosmetic issue, not a data-correctness one.

**Proposed test (documentation level):** A static assertion that `generateForFormat` does not pass `kernel: 'nearest'` (which would be visually worst-case) to `resize()` is feasible as a source-code contract test. A full pixel-sampling gradient test requires Sharp integration and is proportional to the risk.

---

### Finding 10 — Three-encoding parity (AVIF/WebP/JPEG from same source)
**Severity:** Medium | **Confidence:** High

**Existing coverage:** None. `processImageFormats` runs all three format pipelines in parallel but there is no test comparing their output colors.

**What is missing:** The three formats use different Sharp pipelines: AVIF calls `withMetadata({ icc: avifIcc })`, WebP calls `keepIccProfile()` then `.webp()`, JPEG calls `keepIccProfile()` then `.jpeg()`. For an sRGB source, all three should produce visually identical colors within quantization tolerance. For a P3 source, AVIF should retain P3 gamut while WebP and JPEG should retain sRGB-clamped values (no P3 embedding, per the code comment at line 292-294). This behavior is documented in comments but untested.

**Proposed test:**
```typescript
it('sRGB source produces consistent luma across AVIF, WebP, and JPEG outputs', async () => {
    // Create a 4x4 neutral grey sRGB source
    // Process through processImageFormats(...)
    // Read the center pixel from each output via sharp(path).raw().toBuffer()
    // Expect all three RGB triples to be within ±3 of each other (quantization tolerance)
});
```

---

### Finding 11 — Reprocess idempotence
**Severity:** Low | **Confidence:** Medium

**Existing coverage:** None.

**What is missing:** If `processImageFormats` is called twice on the same original (e.g., admin triggers a reprocess after changing quality settings), the second run should produce the same output. Because AVIF and WebP encoders are deterministic for the same input and quality settings, byte-identical output is achievable. The main risk is the atomic rename path (lines 582-604) leaving a stale `.tmp` file that the second run cannot overwrite. There is no test verifying the second run completes without error and that the output is not corrupted.

This is addressed partially by `cleanOrphanedTmpFiles` in `image-queue.ts`, but the correctness of the second-run output itself is not tested.

---

### Finding 12 — Original-file download serves ICC-tagged source
**Severity:** Medium | **Confidence:** High

**Existing coverage:** `serve-upload.test.ts` covers the `/uploads/[jpeg|webp|avif]/` derivative endpoints only. The `/api/download/[imageId]` route (which serves `UPLOAD_DIR_ORIGINAL`) has no color-management test.

**What is missing:** The download endpoint at `apps/web/src/app/api/download/[imageId]/route.ts` serves the file from `UPLOAD_DIR_ORIGINAL` with `Content-Type: application/octet-stream`. The original file is written by `saveOriginalAndGetMetadata` via a raw stream with no Sharp processing, so the original ICC profile is preserved by definition (Sharp is not in the path). However:

1. There is no test confirming that the served file is byte-identical to the uploaded original (the route's streaming path is untested).
2. The `Content-Type: application/octet-stream` header means browsers will not auto-display the original with color management; they will prompt a download. Whether this is intentional (the comments say "download" semantics) is not verified by any test.

These are integration concerns rather than unit test gaps, but at minimum a contract test asserting the route reads from `UPLOAD_DIR_ORIGINAL` (not a derivative directory) would prevent a future refactor from accidentally pointing at the AVIF directory.

---

### Finding 13 — `withMetadata({icc})` / `keepIccProfile()` option lock-in
**Severity:** High | **Confidence:** High

**Existing coverage:** `process-image-blur-wiring.test.ts` is an excellent precedent: it reads the source file as text and asserts that `assertBlurDataUrl` is imported and called. The same pattern should be applied to the ICC options.

**What is missing:** There is no test that asserts the presence of `keepIccProfile()` and `.withMetadata({ icc: avifIcc })` in the source. A future contributor refactoring the pipeline could remove `keepIccProfile()` (reasoning: "withMetadata handles it") or replace `withMetadata({ icc: avifIcc })` with bare `withMetadata()`, silently stripping ICC profiles from all derivatives.

**Proposed test** (source-code contract, same style as `process-image-blur-wiring.test.ts`):
```typescript
describe('process-image ICC option lock-in', () => {
    it('calls keepIccProfile() on the resize chain', () => {
        const source = readSource(); // same helper as blur-wiring test
        expect(source).toMatch(/\.keepIccProfile\(\)/);
    });

    it('calls withMetadata({ icc: avifIcc }) on the AVIF branch', () => {
        const source = readSource();
        expect(source).toMatch(/\.withMetadata\(\s*\{\s*icc:\s*avifIcc\s*\}\)/);
    });

    it('does not call bare withMetadata() without the icc key on the AVIF branch', () => {
        // Negative: bare .withMetadata() (no icc key) on the avif branch would silently
        // embed EXIF/GPS and drop the ICC tagging decision
        const source = readSource();
        // Acceptable: withMetadata({ icc: ... }) — this is what we want
        // Not acceptable: .withMetadata() with no argument or withMetadata({}) on avif path
        // This is a soft assertion; precise regex depends on formatting conventions.
    });
});
```

---

### Finding 14 — AVIF derivative has no GPS/serial/lens EXIF metadata
**Severity:** High | **Confidence:** High

**Existing coverage:** None.

**What is missing:** The AVIF path calls `.withMetadata({ icc: avifIcc })`. Per Sharp 0.34 internals, `withMetadata()` with any argument activates metadata passthrough for ALL metadata (EXIF, IPTC, XMP, ICC). The `icc` key within `withMetadata()` *also* overrides the embedded ICC profile. This means the AVIF derivative currently retains the full EXIF block from the source, including:
- GPS coordinates (latitude/longitude) — privacy leak if `strip_gps_on_upload` is `false`
- Camera serial number (Exif.Photo.BodySerialNumber)
- Lens model and serial
- Author/copyright IPTC fields from the source

The `strip_gps_on_upload` setting (gallery-config.ts line 97) controls DB storage of GPS data, but there is no evidence that it strips GPS from the output derivative files themselves. The AVIF file served at `/uploads/avif/` would contain GPS EXIF even if the gallery admin has enabled "strip GPS" in settings.

This is a **privacy-critical** gap. The original (`UPLOAD_DIR_ORIGINAL`) retaining EXIF is expected (download token flow). The derivatives should not.

**Proposed test** (integration, requires real Sharp):
```typescript
it('AVIF derivative has no GPS EXIF even when source has GPS', async () => {
    // Create a source image with GPS EXIF via sharp(...).withMetadata({ exif: { ... GPS ... } })
    // Process through processImageFormats(...)
    // Read output AVIF: await sharp(avifPath).metadata()
    // Check meta.exif is null or contains no GPSLatitude
    // (Use exif-reader to parse meta.exif if non-null)
});

it('AVIF derivative has no camera serial EXIF', async () => {
    // Same shape, check BodySerialNumber absent
});
```

If this test is written now and run against the current code, it will likely FAIL, confirming the privacy leak. It transitions to GREEN once `.withMetadata({ icc: avifIcc, exif: false })` or `.withExifMerge({ icc: ... })` is used, or once an explicit `.removeAlpha().withMetadata({ icc: avifIcc })` chain that discards EXIF is applied.

The WebP and JPEG paths call `keepIccProfile()` then the encoder directly, with no `withMetadata()`. `keepIccProfile()` in Sharp 0.34 preserves the ICC block only and strips EXIF/IPTC/XMP. So WebP and JPEG are NOT affected by this issue — only AVIF.

---

### Finding 15 — EXIF orientation: rotated iPhone photos display upright
**Severity:** High | **Confidence:** High

**Existing coverage:** None. The word "orientation" does not appear anywhere in `process-image.ts`.

**What is missing:** iPhones store photos in sensor orientation with an EXIF Orientation tag (values 1-8) indicating the rotation needed for upright display. Sharp's default behavior when loading an image is to apply the orientation correction automatically (`autoOrient` is the new Sharp 0.34 API; older versions used `.rotate()` without arguments). However, looking at line 556:

```typescript
const sharpInstance = image.clone().resize({ width: resizeWidth }).keepIccProfile();
```

There is no `.rotate()` or `.autoOrient()` call anywhere in `processImageFormats`. This means:

1. A portrait iPhone photo with `Orientation: 6` (90° clockwise) would be stored and served as a landscape-oriented image.
2. All three derivative formats (AVIF, WebP, JPEG) would be incorrectly oriented.
3. The EXIF Orientation tag is retained in JPEG/WebP derivatives (because `keepIccProfile()` strips only ICC, not EXIF, and the JPEG encoder preserves the source stream's EXIF), causing browsers that respect EXIF Orientation to rotate the already-wrongly-stored dimensions, resulting in double rotation.

This is a user-visible correctness bug affecting a large fraction of mobile uploads.

The correct fix in Sharp 0.34 is to call `.autoOrient()` (Sharp 0.34+ API, formerly `.rotate()` with no args in 0.33 and earlier) before `.resize()`.

**Proposed test** (integration):
```typescript
it('portrait iPhone JPEG (Orientation=6) is served upright in AVIF derivative', async () => {
    // Create a 4x8 JPEG (taller than wide) with EXIF Orientation=6 (90° CW)
    // using sharp({ create: ... }).jpeg().withMetadata({ orientation: 6 })
    // Process through processImageFormats(...)
    // Read output AVIF dimensions: expect width < height (portrait, upright)
    // The current code WILL FAIL this test (it stores landscape-oriented pixels)
});
```

This test should be written RED immediately to document the bug.

---

### Finding 16 — Visual regression fixtures for wide-gamut input
**Severity:** Low | **Confidence:** High

**Existing coverage:** None. The `test/` directory at the monorepo root contains "import utilities and sample data" (per CLAUDE.md) but no wide-gamut reference images.

**What is missing:** There are no reference fixture files (e.g., a known P3 JPEG with a saturated green swatch, a known sRGB version of the same swatch, and an expected AVIF output) committed to the repository. Without fixtures, visual regressions (e.g., a Sharp upgrade that changes tone-mapping behavior) can only be detected by human inspection.

This is the lowest priority because it requires significant fixture generation work and a pixel-comparison strategy (e.g., SSIM or per-channel max-delta), but it is the only way to catch subtle color-shift regressions from libvips or libavif upgrades.

**Recommendation:** At minimum, commit one reference fixture: a 4×4 P3 AVIF generated from a known P3 source with a specific ICC buffer hash. A test that generates the same file and compares the ICC buffer hash (not pixel values — those can vary by libavif version) would serve as a regression tripwire.

---

## Sharp 0.34 API Notes for Test Authors

Sharp 0.34 (the version in use) changed several APIs relevant to these tests:

| Behavior | Sharp 0.33 and earlier | Sharp 0.34 |
|----------|----------------------|------------|
| Auto-apply EXIF orientation | `.rotate()` (no args) | `.autoOrient()` |
| Keep ICC profile | `.withMetadata()` | `.keepIccProfile()` |
| `withMetadata({ icc })` effect | Embeds named ICC, passes other metadata | Same, but also passes EXIF/IPTC/XMP |
| `limitInputPixels` | Constructor option | Still constructor option |

The pipeline already uses `keepIccProfile()` correctly (Sharp 0.34 API). The orientation fix requires adding `.autoOrient()`.

---

## Priority Order for New Tests

1. **Finding 15** (orientation) — write RED test, implement `.autoOrient()`, turn GREEN
2. **Finding 14** (AVIF EXIF/GPS leak) — write RED test, fix `withMetadata` options, turn GREEN
3. **Finding 2** (Adobe RGB no pixel transform) — write RED test to document the bug
4. **Finding 6** (CMYK input) — integration test, defensive coverage
5. **Finding 7** (hostile ICC boundary tests) — pure unit tests, zero cost
6. **Finding 13** (option lock-in source contract) — 3-line source-text assertion, mirrors existing blur-wiring pattern
7. **Finding 8** (ColorSpace EXIF unit tests) — pure unit tests, extractExifForDb already exported
8. **Finding 4** (untagged sRGB) — integration test using real Sharp
9. **Finding 1** (P3 round-trip via processImageFormats) — integration test
10. **Finding 10** (three-encoding parity) — integration test
11. **Findings 3, 9, 11, 12, 5, 16** — lower priority, document current behavior

---

## Test Report Summary

**Coverage (color management domain):** approximately 15% of the identified behavioral surface
**Test Health:** NEEDS ATTENTION

### Tests Written
None in this review pass — this is a coverage-gap audit, not a test-authoring session. The review identifies what to write and in what order.

### Coverage Gaps
- `process-image.ts:556` — no `.autoOrient()` call and no test — Risk: **High** (every portrait mobile upload)
- `process-image.ts:562` — `withMetadata({icc})` passes full EXIF to AVIF, no GPS-strip test — Risk: **High** (privacy)
- `process-image.ts:526` — Adobe RGB/ProPhoto tagged as P3 without pixel transform — Risk: **High** (color accuracy)
- `process-image.ts:504-629` — `processImageFormats` function has zero integration tests — Risk: **High**
- `extractExifForDb:687-697` — `color_space` computed field has zero unit tests — Risk: **Medium**
- `extractIccProfileName:333-390` — bounds-check paths exercised by no test — Risk: **High** (hostile input)

### Flaky Tests Fixed
None identified in existing suite.

### Verification
Tests were not run in this audit session. Before any new test is committed, run:
```bash
cd apps/web && npx vitest run --reporter=verbose
```
and confirm all existing tests pass (establishing the baseline) before adding tests for Findings 14 and 15 (which are expected to fail RED against the current code).
