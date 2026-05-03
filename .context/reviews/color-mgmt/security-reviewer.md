# Security Review — Color Profile and EXIF Handling

**Reviewer:** security-reviewer agent
**Repo:** /Users/hletrd/git/gallery
**Branch:** master
**Reviewed:** 2026-05-03
**Scope:** color-management & EXIF pipeline (Sharp 0.34.5 / libvips 8.17.3 / exif-reader 2.0.3)

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 3     |
| MEDIUM   | 6     |
| LOW      | 4     |
| INFO     | 2     |

**Overall risk level: MEDIUM-HIGH.** One confirmed PII-leakage finding (AVIF derivatives leak full EXIF including GPS, camera serials, lens metadata) and one decompression-bomb hardening gap (no `failOn` setting on Sharp constructor). The repo is in good shape for path-traversal, file extension, and ICC parsing bounds; libvips 8.17.3 is current. The biggest gaps are around metadata stripping policy versus what `Sharp.withMetadata({ icc })` actually does.

---

## HIGH

### H-1 — AVIF derivatives leak full EXIF (GPS, camera serial, lens, dates) despite `stripGpsOnUpload`

**Severity:** HIGH
**Confidence:** HIGH (verified against Sharp 0.34.5 source at `node_modules/sharp/lib/output.js` lines 390-447)
**Category:** Sensitive Data Exposure / Privacy
**Location:**
- `apps/web/src/lib/process-image.ts:560-564` — AVIF generation calls `.withMetadata({ icc: avifIcc })`
- Affects every uploaded image with EXIF, regardless of admin's `strip_gps_on_upload` setting

**Failure scenario:**

The AVIF derivative is the public output served at `/uploads/avif/<id>.avif`. The code does:

```ts
await sharpInstance
    .withMetadata({ icc: avifIcc })
    .avif({ quality: qualityAvif })
    .toFile(outputPath);
```

Sharp 0.34.5's `withMetadata()` is implemented as (verified in `node_modules/sharp/lib/output.js` line 419):

```js
function withMetadata (options) {
  this.keepMetadata();          // sets keepMetadata = 0b11111 — ALL metadata
  this.withIccProfile('srgb');  // overridden by options.icc below
  ...
  if (is.defined(options.icc)) {
    this.withIccProfile(options.icc);
  }
  ...
}
```

`keepMetadata()` (line 390) sets the bitmask to `0b11111` — meaning **EXIF + IPTC + XMP + ICC + (orientation)** are all kept from the input image. The `options.icc` param only changes which ICC profile is embedded; it does NOT scope the metadata-keep to ICC only.

**Concrete impact:**

Even with `stripGpsOnUpload=true` admin setting (line 107 of `lr/upload/route.ts` and 289 of `actions/images.ts`), only the **DB columns** `latitude`/`longitude` are nulled. The original image on disk still has EXIF GPS and the AVIF derivative still embeds it. Any visitor downloading `/uploads/avif/<id>.avif` and running `exiftool` on it gets:

- GPS lat/lon (defeats the GPS strip toggle entirely)
- Camera body serial number (`SerialNumber`, `InternalSerialNumber` IFD0 tags)
- Lens serial number (`LensSerialNumber`)
- Owner name / artist (`Artist`, `OwnerName`, `Copyright`)
- Software / firmware version
- Capture timestamps including sub-second and offset
- XMP regions (face crops with names if added in Lightroom/Photos)

This is a textbook "thought I stripped EXIF but actually didn't" finding. The WebP and JPEG paths use only `.keepIccProfile()` (which is `0b01000` only — ICC bit) so they DO strip EXIF. The AVIF path is the leak.

**Suggested fix (preferred — strict strip while preserving ICC):**

```ts
if (format === 'avif') {
    await sharpInstance
        .withIccProfile(avifIcc)   // attach ICC only — does NOT call keepMetadata()
        .avif({ quality: qualityAvif })
        .toFile(outputPath);
}
```

`withIccProfile(icc)` only sets the ICC bit (verified line 301-320 of output.js). It calls `keepIccProfile()` which sets only `0b01000`. Crucially, it does NOT call `keepMetadata()`. The default Sharp behavior strips everything else — exactly what the WebP/JPEG paths already get from `keepIccProfile()`. This is a one-line fix that closes the EXIF leak without changing color-management behavior.

**Test gap:** `process-image-p3-icc.test.ts` only verifies the ICC profile round-trips, never that EXIF/XMP are absent on AVIF output. Add:

```ts
it('AVIF derivatives strip EXIF even when source has GPS', async () => {
    const meta = await sharp(p3OutputWithSourceExif).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
});
```

---

### H-2 — `Sharp` constructor missing `failOn` setting → silent acceptance of malformed/hostile input

**Severity:** HIGH
**Confidence:** HIGH (Sharp 0.34.5 default for `failOn` is `'warning'`, but several decoders in libvips 8.17 surface only as `'error'` or `'truncated'`)
**Category:** Input Validation / Decompression Bomb
**Location:**
- `apps/web/src/lib/process-image.ts:421, 519` — `sharp(originalPath, { limitInputPixels: maxInputPixels })`
- `apps/web/src/lib/process-topic-image.ts:68` — same omission

**Failure scenario:**

Per Sharp docs (https://sharp.pixelplumbing.com/api-input/#failon), the `failOn` constructor option controls when libvips treats malformed input as a hard error. The default is `'warning'`, which means:

1. Truncated JPEG/HEIC files past warning threshold are silently accepted
2. JPEGs with invalid Huffman tables process partially
3. PNGs with broken iCCP/IDAT chunks parse with partial output
4. Large embedded ICC profiles past the safe parsing threshold may be accepted

For a public-facing image upload endpoint, `failOn: 'error'` is a safer baseline. With `'warning'` (the current default), an attacker can craft a JPEG with a deliberately corrupted ICC profile chunk that:
- Triggers a warning during `metadata()` parse
- Returns an `icc` Buffer that may have bizarre internal offsets
- Gets passed to `extractIccProfileName()` which then runs the bounded parser

The bounded parser in `process-image.ts:333-390` is well-written (good upper bounds on tag count and string length), but `failOn: 'warning'` means we feed it more pathological input than necessary.

**Concrete impact:**

Combined with `IMAGE_MAX_INPUT_PIXELS=256MB pixels` (256M pixels is ~1GB at 32-bit RGBA decoded), an attacker can push a 16K×16K animated AVIF that decodes warnings-only and produces a partial output that gets served as a derivative. Memory pressure during `processImageFormats` is not bounded by libvips before pixel decode.

**Suggested fix:**

```ts
// In process-image.ts saveOriginalAndGetMetadata + processImageFormats:
const image = sharp(originalPath, {
    limitInputPixels: maxInputPixels,
    failOn: 'error',                   // reject malformed input fast
    sequentialRead: true,              // streaming decode, lower peak RAM
    unlimited: false,                  // (default — keep)
});
```

`failOn: 'error'` rejects truncated and corrupt input. `sequentialRead: true` is a free win — it tells libvips to use streaming decode rather than random access, which cuts peak RAM on big inputs and is exactly what this pipeline wants (resize + write, no second-pass random access). Same for the topic-image path.

**Note on libvips version:** Confirmed `@img/sharp-libvips-darwin-arm64@1.2.4` ships libvips 8.17.3 (per the `.dylib` symbol). This is well above the 8.14 ICC-bug threshold mentioned in the prompt, so we are NOT exposed to the historical libvips ICC parsing CVEs. Good. The `failOn` issue is independent of libvips version.

---

### H-3 — Cache-Control: public, max-age=31536000, immutable on AVIF endpoint with embedded EXIF

**Severity:** HIGH (becomes CRITICAL once H-1 is fixed and old derivatives need invalidation)
**Confidence:** MEDIUM
**Category:** Cache Poisoning of PII / Sensitive Data Lifecycle
**Location:** `apps/web/src/lib/serve-upload.ts:102` — `'Cache-Control': 'public, max-age=31536000, immutable'`

**Failure scenario:**

Once H-1 is fixed, all AVIF derivatives generated before the fix still contain the original EXIF (with GPS). They are served with `immutable` and one-year max-age. Any CDN, browser cache, or shared HTTP cache will hold these for up to a year. There is no cache invalidation path because the filenames are content-addressed by upload UUID, not by content hash.

When the photographer-admin discovers the leak and re-runs `processImageFormats` against existing originals to regenerate derivatives without EXIF, every CDN-cached copy of the old EXIF-bearing AVIF persists.

**Suggested fix:**

1. Build a remediation script: enumerate all `images` rows, re-run `processImageFormats` with the H-1 fix, and bump filenames or write `Last-Modified`-aware ETags so caches invalidate.
2. Even without the rewrite, `immutable` is too aggressive for a content-addressed public asset that contains user-derived data. Drop `immutable` for `.avif`/`.webp`/`.jpeg` endpoints and use ETag-based revalidation. The build cost is negligible compared to the privacy cost.
3. Or change derivative filenames to include a content hash so cache busts on re-encode.

---

## MEDIUM

### M-1 — `withMetadata({ icc })` also keeps EXIF Orientation tag → potential double-rotation when source is auto-rotated

**Severity:** MEDIUM
**Confidence:** MEDIUM
**Category:** Correctness / Image Display Bug
**Location:** `apps/web/src/lib/process-image.ts:556-562`

**Failure scenario:**

`keepMetadata()` (called transitively by `withMetadata({icc})`) preserves the EXIF Orientation tag (`0xA006`) in the AVIF output. Sharp's resize pipeline by default does NOT auto-rotate based on orientation unless `.rotate()` is called explicitly. So the AVIF gets:
- Pixels in their original orientation (un-rotated)
- An EXIF Orientation tag saying "rotate 90° on display"

A modern AVIF viewer that honors EXIF orientation (Safari does, Chrome partially) will rotate on render, double-rotating the displayed image. Some users see correctly-oriented photos, others see sideways photos.

**Suggested fix:** The H-1 fix (use `withIccProfile` instead of `withMetadata`) also fixes this — orientation is dropped because the EXIF bit isn't preserved. If you need orientation to be honored at decode, call `.rotate()` (with no arg, which auto-rotates from EXIF) BEFORE the resize, then drop EXIF on output:

```ts
const sharpInstance = image.clone()
    .rotate()                       // auto-rotate from EXIF, then strip
    .resize({ width: resizeWidth })
    .withIccProfile(avifIcc);
```

---

### M-2 — `extractIccProfileName` parses input ICC even when `failOn: 'warning'` lets corrupt profiles through

**Severity:** MEDIUM
**Confidence:** HIGH (good defensive bounds, but the entry condition is too permissive)
**Category:** Input Validation
**Location:** `apps/web/src/lib/process-image.ts:333-390`

**Failure scenario:**

The function bounds tag count to 100, string length to 1024 bytes, and per-record length to 1024. These bounds are sane. However, the entry guard is only `icc.length <= 132` — there's no upper bound on profile size. ICC profiles in pathological inputs can be tens of MB (libvips parses them lazily). Before fix H-2, a 50 MB ICC profile gets handed to this function as a `Buffer`, all of which is heap-resident.

The function is read-only and bounded, so this is not RCE risk — it's a memory amplification vector. The buffer is held until `metadata()` resolves and then GC'd, but combined with `SHARP_CONCURRENCY` of `cpuCount-1` and `QUEUE_CONCURRENCY` of 1, a small concurrent upload burst can pin gigabytes briefly.

**Suggested fix:**

```ts
const MAX_ICC_PROFILE_BYTES = 4 * 1024 * 1024;  // 4 MB — generous; spec is 1 MB

export function extractIccProfileName(icc?: Buffer | null): string | null {
    if (!icc || icc.length <= 132 || icc.length > MAX_ICC_PROFILE_BYTES) return null;
    ...
}
```

Combined with H-2's `failOn: 'error'`, this gives belt-and-braces.

---

### M-3 — EXIF ColorSpace tag (`exifParams.ColorSpace`) trusted without ICC cross-validation

**Severity:** MEDIUM
**Confidence:** HIGH
**Category:** Color-Management Correctness
**Location:** `apps/web/src/lib/process-image.ts:687-698` (in `extractExifForDb`) and `apps/web/src/app/actions/images.ts:330` (the merge `data.iccProfileName || exifDb.color_space`)

**Failure scenario:**

The code stores `data.iccProfileName || exifDb.color_space` as the public `color_space` column. This is shown to visitors via the photo viewer with a "P3" badge (line 716 of `photo-viewer.tsx`) when the string contains "p3".

Real-world: cameras frequently lie or differ between EXIF tag 0xA001 (`ColorSpace`: 1=sRGB, 65535=Uncalibrated) and the actual embedded ICC. Examples:
- iPhone shoots Display P3 but writes `ColorSpace=1` (sRGB) in EXIF
- Some Sony cameras embed AdobeRGB ICC but write `ColorSpace=65535`
- Manually-tagged files via `exiftool` have whatever the user set

The current logic falls back to EXIF only when the ICC profile name is missing. That's reasonable but the EXIF value is never reconciled against the ICC. So a malicious upload can arrange:
- ICC profile says "sRGB IEC61966-2.1"
- EXIF ColorSpace=65535 → labeled "Uncalibrated" in DB
- Photo viewer doesn't show P3 badge (good, ICC takes precedence)
- But the AVIF is encoded with `avifIcc='srgb'` because `resolveAvifIccProfile` saw "sRGB" in the name

This is mostly cosmetic / display correctness (no security impact), but the data exposed via `color_space` column is misleading. For a public-facing color-space label, prefer the ICC-extracted name OR if there is an ICC, ignore the EXIF tag entirely.

**Suggested fix:**

In `images.ts:330`:
```ts
color_space: data.iccProfileName ?? exifDb.color_space,  // null-coalesce, not OR
```

Currently `data.iccProfileName || exifDb.color_space` will fall through to EXIF when the ICC name is `''` (empty string). Use `??` to only fall back on null/undefined. Same for `lr/upload/route.ts:128`.

---

### M-4 — `exif-reader` 2.0.3 + Sharp metadata are two parsers reading the same EXIF buffer; can disagree

**Severity:** MEDIUM
**Confidence:** MEDIUM
**Category:** Defense in Depth / Parser Differential
**Location:** `apps/web/src/lib/process-image.ts:435` — `exifData = exifReader(metadata.exif)`

**Failure scenario:**

Sharp's `metadata()` returns the raw EXIF blob (`metadata.exif: Buffer`). The code feeds that buffer to `exif-reader` (a separate npm package). Both parsers handle slightly different EXIF dialects:
- `exif-reader` follows the Exif 2.32 spec strictly
- Sharp/libvips uses libexif which has historically been more permissive

For a malformed-but-valid EXIF blob, the two parsers can return different values for fields like `DateTimeOriginal`, `LensModel`, or `Orientation`. The code currently uses Sharp for size/dimensions and `exif-reader` for everything else. There's no cross-check.

`exif-reader` 2.0.3 is the latest stable as of audit date. Looking at `npm view exif-reader`, no known CVEs. The library is small and only does parsing, not interpretation, so risk is low.

**Suggested fix:**

Pin `exif-reader` to an exact version (currently `^2.0.3`, allows minor) and add a defensive `try/catch` around the `exifReader(metadata.exif)` call (already done at line 435 — good). Consider logging the raw buffer length when the parse throws so operators can spot malformed-input attacks.

---

### M-5 — `metadata.exif` Buffer never explicitly nulled after parse → held until Sharp instance GC

**Severity:** MEDIUM
**Confidence:** MEDIUM
**Category:** Memory Pressure / DoS
**Location:** `apps/web/src/lib/process-image.ts:421-476`

**Failure scenario:**

The `image` Sharp instance is kept alive through the entire `saveOriginalAndGetMetadata` function. Sharp internally caches the metadata (including the EXIF and ICC buffers). For a 100 MB raw with a 10 MB embedded XMP block (custom Lightroom edits), this sits in heap until `image` is GC'd at end of function.

The `image.clone()` calls in `processImageFormats` (line 556) inherit the buffer references too. So during processImageFormats, the original EXIF/ICC/XMP buffers are pinned across all three derivative encodes. With max-concurrency 1 in the queue, this is OK; with the env-tunable `SHARP_CONCURRENCY` and `QUEUE_CONCURRENCY` bumped, multiple full uploads pin metadata buffers concurrently.

**Suggested fix:**

After the metadata extract, drop references explicitly:
```ts
const iccProfileName = extractIccProfileName(metadata.icc);
const exifBufLen = metadata.exif?.length ?? 0;
// release buffer references; subsequent `image.clone()` re-reads from disk
metadata.exif = undefined;
metadata.icc = undefined;
metadata.xmp = undefined;
```

This is best-effort (Sharp may still hold internal copies), but at least the JS-side references are released.

---

### M-6 — Concurrent Sharp pipelines can poison ICC profile state via libvips global cache

**Severity:** MEDIUM
**Confidence:** LOW (libvips is generally thread-safe, but global ICC profile cache exists)
**Category:** Race Condition
**Location:** `apps/web/src/lib/process-image.ts:26` — `sharp.concurrency(sharpConcurrency)` + `image-queue.ts:151` — `concurrency: Number(process.env.QUEUE_CONCURRENCY) || 1`

**Failure scenario:**

`sharp.concurrency()` controls libvips worker threads. When `SHARP_CONCURRENCY > 1` and `QUEUE_CONCURRENCY > 1`, multiple `Sharp` pipelines run concurrently. libvips maintains a global ICC profile cache (vips_icc_*) that is process-wide. Two simultaneous pipelines that both reference an external ICC by path can collide — though within Sharp's API, profiles are referenced by name (`'srgb'`, `'p3'`, `'cmyk'`) which are bundled as static resources.

Sharp 0.34.5 + libvips 8.17.3 do not have known CVEs around this, but concurrent ICC operations are an under-tested code path. In the current default config (`QUEUE_CONCURRENCY=1`), only one pipeline runs at a time, which avoids the issue. If an operator raises `QUEUE_CONCURRENCY` to scale, they may hit subtle ICC-profile contamination (one image's P3 profile bleeding onto another's sRGB output).

**Suggested fix:**

Document explicitly in `gallery-config-shared.ts` (or wherever queue tuning is exposed) that `QUEUE_CONCURRENCY > 1` is **untested** with the wide-gamut path. Defer raising it until there's a soak test. Alternatively, call `sharp.cache(false)` at module load to disable libvips' file-level caching, at the cost of some throughput:

```ts
// Disable libvips file cache so ICC profile state cannot leak between pipelines.
sharp.cache(false);
```

This is mostly defensive — I have no test case showing actual contamination.

---

## LOW

### L-1 — EXIF DateTimeOriginal is interpreted as wallclock and stored as `YYYY-MM-DD HH:MM:SS` MySQL DATETIME with no timezone

**Severity:** LOW
**Confidence:** HIGH
**Category:** Correctness / Sortability Bug
**Location:** `apps/web/src/lib/process-image.ts:121-163` (`parseExifDateTime`)

**Findings:**

The code does the right thing for camera-string format ("YYYY:MM:DD HH:MM:SS") — keeps it as wallclock. But the `Date`/numeric branches (lines 142-158) call `value.toISOString()` and then strip the `Z`. This forces UTC interpretation:

```ts
if (value instanceof Date && ...) {
    return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
```

Sharp/libvips never returns a `Date` for EXIF DateTimeOriginal in practice (`exif-reader` returns strings), so this branch is mostly dead code. But if `exif-reader` is updated to return Dates, every photo's capture date would be converted from local-camera-wallclock to UTC interpreted as local — a many-hour shift.

**Suggested fix:**

For `Date` and numeric branches, document that the value is treated as UTC wallclock (since EXIF doesn't carry TZ). Add a unit test for the `Date` branch — there is none in `process-image-metadata.test.ts`.

Also: EXIF 2.32 introduced `OffsetTimeOriginal` (`0x9011`) which is the actual TZ offset. `exif-reader` exposes it but the code doesn't read it. If the camera writes both DateTimeOriginal and OffsetTimeOriginal, the gallery loses TZ info on import. Capturing it would let the photo viewer render dates in the right local time.

---

### L-2 — `filename_original` extension is preserved verbatim from upload, but the AVIF/WebP/JPEG paths overwrite extension via `path.extname` — no length cap on `original_format`

**Severity:** LOW
**Confidence:** HIGH
**Category:** Defensive Coding
**Location:** `apps/web/src/app/actions/images.ts:336` — `(data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10)`

**Findings:**

`getSafeExtension` in `process-image.ts:66-76` whitelist-checks the extension against `ALLOWED_EXTENSIONS` and strips non-`[a-z0-9.]`. So `data.filenameOriginal.split('.').pop()` is provably safe ASCII. The 10-char slice is a belt-and-braces cap. Good — this matches the comment at line 332-335.

**Note (no fix needed):** This is fine; just calling out that the chain `getSafeExtension` → `randomUUID` → `path.extname` provides robust filename safety. No path-traversal risk in the ICC/EXIF extraction code (which is what cycle 3 was about). I confirm no leak here.

---

### L-3 — `bit_depth` returned from Sharp metadata is trusted as-is; Sharp returns string for some formats

**Severity:** LOW
**Confidence:** HIGH
**Category:** Type Safety
**Location:** `apps/web/src/lib/process-image.ts:478-479`

**Findings:**

```ts
const rawBitDepth = metadata.depth
    ? (typeof metadata.depth === 'string' ? parseInt(metadata.depth, 10) : metadata.depth)
    : null;
```

Wait — `metadata.depth` in Sharp is actually a string like `'uchar'`, `'ushort'`, `'float'`. It is NOT a number, ever. The current code always calls `parseInt('uchar', 10)` → `NaN` → `Number.isFinite(NaN)` → false → `null`. So `bit_depth` is **always null**, defeating the column's purpose.

To get bit depth, query `metadata.depth` plus channel count, or use `metadata.bitsPerSample` (newer Sharp). Looking at Sharp 0.34.5 metadata typedef, the field is documented as a string union. There's no numeric bit depth in Sharp's metadata API directly.

**Suggested fix:** Map `metadata.depth` to bits explicitly:

```ts
const DEPTH_TO_BITS: Record<string, number> = {
    uchar: 8, char: 8, ushort: 16, short: 16, uint: 32, int: 32,
    float: 32, complex: 64, double: 64, dpcomplex: 128,
};
const bitDepth = typeof metadata.depth === 'string'
    ? (DEPTH_TO_BITS[metadata.depth] ?? null)
    : null;
```

This is a correctness bug, not a security bug, but fixes the displayed "Bit depth" in the photo viewer which currently shows nothing.

---

### L-4 — `process-topic-image.ts` unconditionally overwrites tempPath ICC → strips ICC from topic banner

**Severity:** LOW (not a security issue, but correctness)
**Confidence:** HIGH
**Category:** Color Management Correctness
**Location:** `apps/web/src/lib/process-topic-image.ts:68-72`

```ts
await sharp(tempPath, { limitInputPixels: MAX_INPUT_PIXELS_TOPIC })
    .resize({ width: 512, height: 512, fit: 'cover' })
    .webp({ quality: 90 })
    .toFile(outputPath);
```

No `keepIccProfile()`, no `withIccProfile('srgb')`. Sharp's default strips all metadata and converts to sRGB pixels but does NOT embed an ICC profile in the output. The banner WebP renders fine on most browsers (assumed sRGB) but loses color accuracy on wide-gamut displays.

**Suggested fix:** Add `.withIccProfile('srgb')` for an explicit web-safe ICC tag:

```ts
await sharp(tempPath, { limitInputPixels: MAX_INPUT_PIXELS_TOPIC, failOn: 'error' })
    .resize({ width: 512, height: 512, fit: 'cover' })
    .withIccProfile('srgb')
    .webp({ quality: 90 })
    .toFile(outputPath);
```

---

## INFO

### I-1 — Sharp version 0.34.5 + libvips 8.17.3 are current; no known CVEs

Verified versions:
- `sharp@0.34.5` (per `node_modules/sharp/package.json`)
- `@img/sharp-libvips-darwin-arm64@1.2.4` shipping `libvips-cpp.8.17.3.dylib`
- `exif-reader@2.0.3` (per `apps/web/package.json:44`)

libvips 8.17.3 is well above the 8.14 threshold mentioned in the prompt for ICC handling bugs. Display P3 and Rec.2020 ICC profiles parse cleanly. No outstanding CVEs against any of these versions as of 2026-05-03.

**Recommendation:** Lock minor versions in `package.json` for image-pipeline deps so a `npm install` doesn't pull a sharp pre-release. Currently `sharp: "^0.34.5"` allows `0.99.x`. Use `"~0.34.5"` for tighter pin.

---

### I-2 — 8-bit AVIF on a 16-bit Display-P3 source: visible banding

**Severity:** INFO (quality finding; no security implication)
**Confidence:** HIGH
**Category:** Color Management Quality

**Findings:**

The AVIF encoder is called as `.avif({ quality: qualityAvif })` with no explicit `bitdepth: 10` or `bitdepth: 12`. Sharp's default AVIF bitdepth is 8. For a 16-bit Display-P3 source (modern iPhones, Sony/Canon raw exports), the 8-bit AVIF on the wide-gamut path will exhibit banding in dark gradients (sky, skin tones).

Modern AVIF decoders (Chrome 100+, Safari 16+) handle 10-bit transparently. The wider gamut + 10-bit combination is the main reason to use AVIF over WebP at all.

**Suggested improvement (not a security fix):**

```ts
if (format === 'avif') {
    const sourceIsHighBitDepth = (bitDepth ?? 8) > 8;
    await sharpInstance
        .withIccProfile(avifIcc)
        .avif({
            quality: qualityAvif,
            bitdepth: sourceIsHighBitDepth ? 10 : 8,
        })
        .toFile(outputPath);
}
```

Note that the `bitDepth` propagation requires fixing L-3 first (currently always null).

---

## Cross-Cutting Observations

### 1. Path traversal: clean

Filename safety is well-enforced:
- `getSafeExtension` (process-image.ts:66) whitelist-strips
- `isValidFilename` (validation.ts:123) blocks `..`, `/`, `\`
- Download endpoint (`api/download/[imageId]/route.ts:118-143`) does `path.resolve` + prefix check + `lstat` symlink check + `realpath` cross-check
- Serve-upload (`lib/serve-upload.ts:54-83`) has same realpath + symlink defense

I confirm there is **no path traversal vector** in the ICC-extraction or EXIF-extraction code paths. The buffers passed to `extractIccProfileName` come exclusively from Sharp's parsed metadata, never from filename construction.

### 2. The download endpoint preserves EXIF in the original

`api/download/[imageId]/route.ts:182` streams the file at `UPLOAD_DIR_ORIGINAL/<filename_original>` with no Sharp processing. **Original on disk retains all EXIF including GPS** even when `stripGpsOnUpload=true`. The DB columns are nulled but the file isn't touched.

This is a **policy gap**: an admin who toggles `stripGpsOnUpload` likely expects the on-disk original to be sanitized too. Currently, only the search/listing/viewer surfaces respect the toggle. Anyone with a valid download token (paid licensee, admin) gets the GPS-bearing original.

For Stripe-paid downloads, this may be intentional (photographer wants to deliver the unmodified file). But it should be a separate setting, not silently bundled with `strip_gps_on_upload`.

**Suggested fix:** Add a sibling setting `strip_exif_from_original_on_upload` that, when true, runs the original through Sharp once at upload to strip EXIF before persisting. Or document explicitly that the toggle is metadata-only and originals are always full-fidelity.

### 3. Filename interpolation in Content-Disposition: clean

`api/download/[imageId]/route.ts:192-194` uses `path.extname` then strips to `[a-zA-Z0-9.]` and length-caps. RFC 6266 quoted-string compliant. Good defense in depth.

### 4. ICC `mluc` parser handles surrogate pairs correctly

`apps/web/src/lib/process-image.ts:362-381` decodes UTF-16BE via `TextDecoder` (line 256-257). Test `process-image-metadata.test.ts:68-79` verifies surrogate pair round-trip with U+1F600. No DBCS/surrogate corruption here.

---

## Security Checklist

- [x] No hardcoded secrets in color-pipeline code
- [x] All inputs validated (extension whitelist, pixel cap, file size cap)
- [ ] **EXIF stripped from public derivatives** ← FAIL on AVIF (H-1)
- [x] EXIF stripped from public derivatives ← OK on WebP/JPEG
- [x] GPS DB columns nulled when toggle on
- [ ] **GPS stripped from on-disk original when toggle on** ← FAIL (cross-cutting #2)
- [x] Path traversal: defended (multiple layers)
- [x] Symlink TOCTOU: defended (lstat + realpath at serve & download)
- [x] ICC profile parsing: bounded (tag count, string length, record count)
- [x] Decompression bomb: partial defense (`limitInputPixels`); missing `failOn`/`sequentialRead` (H-2)
- [x] libvips version: current (8.17.3)
- [x] Sharp version: current (0.34.5)
- [x] exif-reader version: current (2.0.3)

---

## Recommended Fix Priority

1. **H-1 (immediate):** Replace `withMetadata({ icc: avifIcc })` with `withIccProfile(avifIcc)` in `process-image.ts:560-564`. One-line change. Also add a test that asserts AVIF output has no EXIF buffer.
2. **H-2 (immediate):** Add `failOn: 'error'` and `sequentialRead: true` to all three Sharp constructor calls.
3. **H-3 (short-term):** Plan a one-time re-encode of all existing AVIF/WebP/JPEG derivatives to flush the legacy EXIF leak from CDN caches. Consider dropping `immutable` from cache headers for derivative files.
4. **M-1 through M-6 (next sprint):** Defensive hardening — orientation handling, ICC size cap, color-space label semantics, exif-reader pinning, metadata buffer cleanup, concurrency documentation.
5. **L-1 through L-4 (backlog):** Correctness fixes — bit_depth mapping, topic image ICC, exif-reader Date branch test coverage, OffsetTimeOriginal capture.

