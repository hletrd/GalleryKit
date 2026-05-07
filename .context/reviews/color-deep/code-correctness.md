# Color-Correctness Code Review -- Code Quality Angle

**Reviewer:** code-reviewer (opus)
**Date:** 2026-05-06
**Scope:** Color pipeline code paths -- bugs, missed edge cases, unsafe assumptions, race conditions, memory pressure, dead code, type safety.
**Files reviewed:** `process-image.ts`, `color-detection.ts`, `serve-upload.ts`, `photo-viewer.tsx`, `lightbox.tsx`, `histogram.tsx`, `home-client.tsx`, `globals.css`, `schema.ts`, `og/photo/[id]/route.tsx`, `sw.js`, `data.ts`

---

## Summary

| Severity | Count |
|----------|-------|
| CRIT     | 1     |
| HIGH     | 4     |
| MED      | 7     |
| LOW      | 5     |

---

## Findings

### 1. Duplicated ICC parser in `color-detection.ts` diverges from canonical `process-image.ts` -- mluc (ICC v4) silently missed

**[HIGH]** `apps/web/src/lib/color-detection.ts:309-374` vs `apps/web/src/lib/process-image.ts:498-555`

The canonical `extractIccProfileName` in `process-image.ts` handles both `desc` (ICC v2 ASCII) and `mluc` (ICC v4 multi-localized Unicode) tag types, decoding UTF-16BE via `TextDecoder`. The duplicate in `color-detection.ts:309-374` uses a different `readAsciiFromTag` function that attempts mluc parsing at line 328-336 but reads it as raw ASCII bytes (`String.fromCharCode` loop at line 343-347), not UTF-16BE. For any ICC v4 profile whose `desc` tag is encoded as `mluc` with non-ASCII characters (e.g. a Japanese or Korean localized Display P3 profile from Apple), the canonical parser will return `"Display P3"` correctly, but the `color-detection.ts` duplicate will return garbage or an empty string. This causes `detectColorSignals` to produce `colorPrimaries: 'unknown'` for P3 images that `process-image.ts` correctly identifies, leading to a mismatch between the `icc_profile_name` column (correct) and the `color_primaries` column (wrong `'unknown'`).

Additionally, the duplicate parser searches for `dmdd` and `dmnd` tag signatures (device model description, device manufacturer description) which the canonical parser does not. This means `color-detection.ts` may return a manufacturer name like `"Apple Inc."` instead of the profile description `"Display P3"`, poisoning `colorPrimaries` inference.

The divergence also manifests in bounds checking: the canonical parser caps tag count to 100, the duplicate caps to 1024. Neither is wrong per se, but the inconsistency is a maintenance hazard.

**Failure mode:** A Rec. 2020 ICC v4 profile with an mluc `desc` tag gets `icc_profile_name = "ITU-R BT.2020-2"` (from the canonical parser at upload time) but `color_primaries = 'unknown'` (from the broken duplicate). The photo viewer then hides the color details section and the histogram skips the AVIF source path. The OG route also misses the P3 post-processing.

---

### 2. `colr` box FullBox assumption is wrong per ISOBMFF spec

**[HIGH]** `apps/web/src/lib/color-detection.ts:182-194`

The comment at line 183 says `"colr is a FullBox: version(1) + flags(3)"` and then reads `colour_type` at `dataStart + 4`. However, per ISO 14496-12 (ISOBMFF), the `colr` box (Color Information Box) is **not** a FullBox -- it is a regular Box. The first four bytes of the payload ARE the `colour_type` field directly at `dataStart + 0`, not at `dataStart + 4`. By skipping 4 bytes for a non-existent version+flags field, the parser reads four bytes past the actual `colour_type` and will never match `'nclx'`. The CICP triplet reads are likewise shifted by +4 bytes, returning garbage values.

**Failure mode:** Every HEIF/AVIF file with an nclx colr box is silently missed. The code falls through to ICC-based inference, which works for most cases, but means the explicit CICP signaling that cameras and encoders provide is never used. For PQ HDR content, this means `is_hdr` will only be true if the ICC profile description happens to contain "PQ" or "ST 2084" in its name string -- many HDR AVIF files from phone cameras use nclx without any special ICC naming, so they are stored as `is_hdr: false`.

---

### 3. `color_space` column stores `iccProfileName` at action layer -- semantic confusion

**[MED]** `apps/web/src/app/actions/images.ts:333`

The images action writes `color_space: data.iccProfileName || exifDb.color_space`. The `color_space` column was originally designed to hold the EXIF ColorSpace tag value (either `'sRGB'` or `'Uncalibrated'` from tag 0xA001), which `extractExifForDb` correctly produces at `process-image.ts:1007-1018`. But the action overrides it with the ICC profile name (e.g. `"Display P3"`, `"Adobe RGB (1998)"`), which is a completely different data domain. The result is that `color_space` shows `"Display P3"` on the photo viewer info panel while the schema/column name implies it holds EXIF ColorSpace semantics. Meanwhile `icc_profile_name` also stores the same value, making `color_space` a confusing near-duplicate that displays ICC names in a field labeled "Color Space".

**Failure mode:** A photo with EXIF ColorSpace = Uncalibrated and ICC = "ProPhoto RGB" shows `"ProPhoto RGB"` in the viewer's "Color Space" row instead of `"Uncalibrated"`. The P3 badge logic at `photo-viewer.tsx:727` checks `image.color_space.toLowerCase().includes('p3')`, which coincidentally works when the ICC name is "Display P3" but fails for `color_primaries === 'p3-d65'` images whose ICC name variant doesn't contain "p3" (e.g. "P3-D65" would work but "Apple Display Profile" would not).

---

### 4. `--display-gamut` and `--display-hdr` CSS custom properties are set but never consumed

**[LOW]** `apps/web/src/app/[locale]/globals.css:168-170`

These three lines define CSS custom properties `--display-gamut` and `--display-hdr` via `@media (color-gamut: p3)` and `@media (dynamic-range: high)` queries. A grep of the entire `src/` directory confirms they are never read by any component, JavaScript, or CSS rule. The actual P3 badge visibility is controlled by the `.gamut-p3-badge` class at line 173 which uses its own independent media query. The HDR badge in `photo-viewer.tsx:852-857` uses an inline `<style>` block with its own `@media (dynamic-range: high)` query. These custom properties are dead code.

---

### 5. Histogram canvas P3 colorspace reads sRGB-clipped JPEG pixels -- double conversion artifact

**[MED]** `apps/web/src/components/histogram.tsx:125-141`

When the display is P3-capable (`matchMedia('(color-gamut: p3)')`), the histogram creates a canvas with `{ colorSpace: 'display-p3' }`. The source image is either the JPEG derivative (always sRGB-tagged per the pipeline) or, for wide-gamut images, the AVIF derivative (P3-tagged). For the JPEG fallback path: the JPEG is sRGB-tagged and sRGB-clipped. Drawing it onto a P3 canvas causes the browser to convert sRGB values into the P3 working space, then `getImageData` returns values in P3 coordinates. The histogram bins then represent the P3-space values (compressed into the sRGB sub-volume of P3), not the original pixel values. This is not incorrect per se, but the histogram will show a narrower distribution than the source image actually had -- all values cluster toward the sRGB interior of the P3 cube, making the histogram look artificially compressed.

For the AVIF path: the AVIF is P3-tagged, and reading into a P3 canvas preserves the gamut correctly. But the histogram widget does not indicate which source it used, and the user sees different histogram shapes for the same photo depending on whether their browser decoded the AVIF or fell back to JPEG. The `isWideGamut` check at line 254 selects the AVIF URL when available, but the canvas colorspace is chosen based on `matchMedia('(color-gamut: p3)')` (display capability), not based on whether the AVIF was actually decoded. If AVIF decode support probing succeeds but the actual AVIF fetch fails (404, network), the histogram falls back to the JPEG URL silently at `img.onerror` (line 303), but the canvas is still P3-configured, producing the double-conversion artifact described above.

---

### 6. `processImageFormats` clones from a shared Sharp instance -- `pipelineColorspace('rgb16')` may leak across clones

**[HIGH]** `apps/web/src/lib/process-image.ts:768-771`

The function creates one `image` instance at line 713, then in the inner `generateForFormat` closure (which runs three times in parallel via `Promise.all` at line 880), each format calls `image.clone()` followed by `.pipelineColorspace('rgb16')` for wide-gamut sources. Sharp's `clone()` shares the decode pipeline but creates a separate encode pipeline. However, `pipelineColorspace()` is documented as affecting the pipeline colorspace for the *entire* processing chain. Whether `.clone().pipelineColorspace('rgb16')` affects only the clone or also the parent depends on the Sharp/libvips version: in Sharp 0.33+, clone() creates a snapshot, and pipelineColorspace on the clone should not affect siblings. But in some libvips versions, the pipeline state can leak back through the shared decode buffer.

If it does leak: all three parallel format encoders (AVIF, WebP, JPEG) end up with `rgb16` pipeline state even when only the wide-gamut path intended it. For sRGB images, this would double the decode buffer for no benefit. For wide-gamut images this is intended, but if two clones both call `pipelineColorspace('rgb16')` simultaneously on a shared parent, there is a theoretical data race on the internal pipeline state.

More concretely: the `base` variable at line 769-771 is created fresh per size iteration inside the `for` loop, which is correct. But the `image` it clones from at line 770 is shared across all three parallel `generateForFormat` calls. The three parallel calls each call `image.clone()` simultaneously. Sharp's clone() implementation is likely thread-safe for the JS API, but the comment should document this assumption.

---

### 7. High-bitdepth AVIF probe at `effort: 1` may not predict `effort: 6` behavior

**[MED]** `apps/web/src/lib/process-image.ts:53-71`

The probe creates a minimal 2x2 pixel image and encodes it with `effort: 1, bitdepth: 10`. The actual encode in `processImageFormats` uses `effort: 6`. The libheif encoder's effort level controls the search depth and algorithmic complexity of the encode. A `bitdepth: 10` encode at effort 1 exercises a simpler code path (fewer transform candidates, simpler quantization) than effort 6. It is theoretically possible for effort 1 to succeed but effort 6 to trigger a code path that rejects 10-bit -- for instance, some AOM libaom builds have effort-gated features that crash or error on high bit depths only at higher effort settings. The fallback catch at line 807-821 mitigates this by catching bitdepth-related errors and retrying without `bitdepth: 10`, so the failure mode is graceful (downgrade to 8-bit for that one image), but the probe's positive result is then misleading for all subsequent images that hit the same error. The probe promise is never reset after a per-image fallback, so the system continues to attempt 10-bit and catch+retry on every wide-gamut image for the rest of the process lifetime.

---

### 8. Process-lifetime probe result persists across container rebuilds

**[LOW]** `apps/web/src/lib/process-image.ts:51`

The `_highBitdepthAvifProbePromise` is a module-level singleton. In a containerized deployment, the Node.js process restarts on container rebuild, so the probe runs again with the new Sharp binary. This is correct behavior. However, in a long-lived development server with hot module reloading (HMR), the module may be re-imported without resetting the singleton, depending on the bundler's module cache behavior. Next.js 16 with Turbopack may or may not invalidate this module on HMR. This is a development-only concern, not a production bug.

---

### 9. OG route post-processing tags P3 ICC on a Satori PNG that contains sRGB-clipped pixels

**[CRIT]** `apps/web/src/app/api/og/photo/[id]/route.tsx:38-46`

The `postProcessOgImage` function checks `image.color_primaries` and, for wide-gamut sources, converts the Satori-rendered PNG to P3-tagged JPEG via `toColorspace('p3').withIccProfile('p3')`. The problem: the source photo was already fetched as a JPEG derivative at line 96 (`/uploads/jpeg/${jpegFilename}`). Per the pipeline, when `forceSrgbDerivatives` is false (default), JPEG derivatives ARE P3-tagged for wide-gamut sources (line 829-835 in process-image.ts). However, Satori renders the image as part of an SVG-to-PNG pipeline that operates entirely in sRGB space. Satori's `<img>` element decodes the embedded base64 JPEG, but SVG rendering engines (resvg, which Satori uses) do not perform ICC-aware compositing -- they strip ICC tags and render in the sRGB framebuffer. The resulting PNG is therefore sRGB-clipped regardless of the input JPEG's ICC tag.

When `postProcessOgImage` then calls `.toColorspace('p3').withIccProfile('p3')` on this sRGB-clipped PNG, Sharp converts the sRGB pixel values into the P3 colorspace (which is a widening conversion -- the values are unchanged but now interpreted in P3 coordinates) and embeds a P3 ICC tag. The output JPEG then declares "I am P3" but contains pixels that were clipped to sRGB by the SVG renderer. On a P3 display, the colors will appear slightly desaturated compared to the actual photo because the P3-tagged values are sRGB-interior.

This is the opposite of the bug the code tries to prevent: instead of gamut mismatch causing over-saturation, this causes under-saturation. On sRGB displays, the P3 ICC is ignored and the image looks normal. The net effect is that P3-capable social media clients (e.g. iMessage, some Twitter clients on Apple devices) will show a slightly washed-out OG image compared to the actual gallery photo.

**Failure mode:** All OG images for wide-gamut photos have incorrect P3 tagging over sRGB-clipped pixels. The visual difference is subtle (a few percentage points of saturation loss in greens/reds) but is the exact kind of color inaccuracy this codebase has invested significant effort to eliminate in the main pipeline.

---

### 10. Service worker stale-while-revalidate serves stale ICC-tagged images indefinitely

**[MED]** `apps/web/public/sw.js:136-166`

The service worker caches image derivatives (`/uploads/avif/`, `/uploads/webp/`, `/uploads/jpeg/`) using a stale-while-revalidate strategy. The revalidation fetch at line 144 happens in the background, and the stale cached version is returned immediately at line 158. The serve-upload.ts ETag includes `IMAGE_PIPELINE_VERSION`, and `Cache-Control` is `must-revalidate`. However, the service worker's `staleWhileRevalidateImage` does not check the ETag or `Cache-Control` headers before serving the stale response. It always returns the cached version first, then revalidates. This means that when the pipeline version bumps (e.g. from a color-correction fix), the first load after the SW update still serves the old (color-incorrect) cached image. The revalidation runs in the background and updates the cache, so the second load gets the correct version. This is standard SWR behavior, but for color-critical pipeline changes, the one-load-stale window may cause confusion (admin re-processes an image to fix color, but the first load shows the old version).

The SW version string `838e15b` is replaced at build time, so a new deployment gets a new cache namespace and the old cache is purged at activation (line 216-231). This mitigates the issue for full redeployments, but not for pipeline-version-only bumps within the same build.

---

### 11. `lastRendered` dedup logic does not account for colorspace differences across formats

**[MED]** `apps/web/src/lib/process-image.ts:738-756`

The `lastRendered` dedup at line 748 checks only `resizeWidth` equality. When the original image is smaller than consecutive configured sizes (e.g. a 1200px-wide image with sizes `[640, 1536, 2048, 4096]`), sizes 1536, 2048, and 4096 all clamp to `resizeWidth = 1200`, and the latter three are hard-linked copies of the first. This is correct within a single format because the colorspace pipeline is identical for all sizes within one `generateForFormat` call.

However, the dedup is isolated per format (each format has its own `lastRendered`), so cross-format dedup does not apply. This is correct. The concern in the prompt about "wide-gamut to SDR transition" does not apply because the colorspace decision is per-format, not per-size. Within a format, all sizes use the same `avifIcc`/`targetIcc` value. This finding is **not a bug** but the implicit assumption should be documented.

---

### 12. Memory pressure: `pipelineColorspace('rgb16')` + 3-way parallel fan-out on large images

**[HIGH]** `apps/web/src/lib/process-image.ts:768-884`

For a wide-gamut source, `pipelineColorspace('rgb16')` doubles the per-pixel working memory from 8 bits to 16 bits per channel. A 100 MP image (e.g. 12000x8000, common from medium-format cameras) has 96 million pixels. At 16 bits per channel, 3 channels = 6 bytes/pixel, the decode buffer is ~576 MB. The `Promise.all` at line 880 runs AVIF, WebP, and JPEG encoding in parallel, each of which calls `image.clone()`. Sharp's clone shares the decoded buffer, but each encoder's resize creates a new output buffer. The largest configured size (e.g. 4096px wide) at 16-bit/channel produces a ~150 MB resize buffer per format, so peak RSS during the parallel encode of the largest size is approximately:

- Shared decode buffer: ~576 MB
- 3x resize buffers (one per format): ~450 MB
- 3x encode buffers: ~100 MB (compressed)
- Total: ~1.1 GB peak for a single 100 MP wide-gamut image

With `QUEUE_CONCURRENCY > 1`, this multiplies. The default queue concurrency is 1 (line 3 in the comment), but the code reads `process.env.QUEUE_CONCURRENCY` elsewhere, and an operator setting it to 2 for throughput would risk 2.2 GB peak RSS from image processing alone. The `sequentialRead: true` flag at line 713 helps by streaming the decode, but `pipelineColorspace('rgb16')` forces the entire decoded image into memory for the colorspace conversion.

`sharp.cache(false)` at line 35 prevents the libvips operation cache from pinning buffers, which is correct. But the working set during encode is still very large.

---

### 13. `extractIccProfileName` off-by-one in `desc` tag ASCII parsing

**[MED]** `apps/web/src/lib/process-image.ts:522-524`

The `desc` tag parsing reads `declaredLength` from offset+8, then computes `strLen = Math.min(declaredLength, dataSize - 12, 1024)` and `strEnd = strStart + Math.max(0, strLen - 1)`. The `strLen - 1` subtracts one byte, presumably to exclude a null terminator. But the ICC spec says the `desc` tag's count field includes the null terminator. So `declaredLength` already counts the null. Using `strLen - 1` correctly excludes it. However, when `declaredLength` is 1 (a single null byte, meaning empty name), `strLen = 1`, `strLen - 1 = 0`, `strEnd = strStart`, and the check `strStart >= strEnd` at line 523 triggers `break`, returning `null`. This is correct for empty names.

The edge case is when `declaredLength` is 2 (one ASCII char + null). `strLen = 2`, `strEnd = strStart + 1`, so only 1 byte is read. This is correct -- the one meaningful character is read.

The real issue is that the `- 1` adjustment assumes the count always includes a null terminator. If a malformed ICC profile has a `declaredLength` that does NOT include the null (some Adobe-authored profiles), the last character of the profile name is truncated. For a name like `"sRGB"` with `declaredLength = 4` (no null), the code reads only 3 bytes: `"sRG"`. This would break the `resolveAvifIccProfile` matching, which checks `name.includes('srgb')` -- `"srg"` does not match.

**Failure mode:** Malformed ICC profiles from some Adobe software or third-party profile editors that omit the null from the count would have their names truncated by one character, causing misidentification. Most ICC profiles include the null in the count, so this is rare but not impossible.

---

### 14. `color_space` vs `icc_profile_name` vs `color_primaries` -- three columns, overlapping semantics, different consumers

**[MED]** `apps/web/src/db/schema.ts:45-64`

The schema defines three color-related varchar columns on the `images` table:

- `color_space` (varchar 255): originally EXIF ColorSpace tag (1=sRGB, 65535=Uncalibrated), but overwritten at insert time with `iccProfileName` (see finding 3). Displayed on photo-viewer info panel. Also drives the P3 badge via `.includes('p3')` string check.
- `icc_profile_name` (varchar 255): the parsed ICC profile description. Stored but never displayed to end users. Used internally by the backfill script to re-derive pipeline decisions.
- `color_primaries` (varchar 32): derived from `detectColorSignals()`, stored as a canonical enum-like string (`'bt709'`, `'p3-d65'`, etc.). Used by the photo viewer to show the color details panel, by the OG route for P3 post-processing, and by the histogram for AVIF source selection.

The triple representation creates confusion:
1. `color_space` is consumed by the viewer and the P3 badge but contains ICC names instead of EXIF values, so it shows misleading labels.
2. `icc_profile_name` is the most accurate source-of-truth but is not consumed by any rendering code.
3. `color_primaries` is the normalized canonical enum but relies on the duplicate (buggy) ICC parser in `color-detection.ts` (see finding 1).

There is no single canonical column. A fix plan should pick one source of truth.

---

### 15. `withIccProfile('p3')` fallback when Sharp/libvips lacks built-in P3 profile

**[LOW]** `apps/web/src/lib/process-image.ts:779,800,832`

Sharp's `withIccProfile('p3')` embeds a built-in Display P3 ICC profile. If the Sharp build does not include the built-in P3 profile (some minimal Docker builds strip ICC data), the call throws. The catch at line 807-821 only handles `bitdepth`-related errors (checks `/bitdepth/i` in the error message). A missing-profile error would propagate up and fail the entire image processing. There is no fallback to sRGB when P3 embedding fails.

**Failure mode:** On a stripped Sharp build, all wide-gamut image processing fails entirely. This is unlikely in practice because the project uses Sharp's default npm prebuilds which include P3 profiles, but there is no defensive check.

---

### 16. `image.clone()` for blur placeholder does not inherit `autoOrient`

**[LOW]** `apps/web/src/lib/process-image.ts:621`

The blur placeholder is generated via `image.clone().resize(16, ...).blur(2).jpeg(...)`. The parent `image` was created with `autoOrient: true` at line 592, which is an option passed to the Sharp constructor, not a pipeline method. Sharp's `clone()` should inherit constructor options, so `autoOrient` should apply to the clone as well. This is correct behavior in Sharp 0.33+. Verified: no bug here.

---

### 17. `color-detection.ts` readAsciiFromTag mluc parsing reads wrong offsets

**[LOW]** `apps/web/src/lib/color-detection.ts:328-336`

The mluc branch in `readAsciiFromTag` reads `recCount` at `start + 8`, then `recSize` at `recOffset + 8` where `recOffset = start + 16`. Per the ICC mluc structure: after the 4-byte type signature and 4-byte reserved, byte 8 is the record count (UInt32), byte 12 is the record size (UInt32), and records start at byte 16. Each record is: language(2) + country(2) + stringLength(4) + stringOffset(4) = 12 bytes. The code reads `recSize` at `recOffset + 8` which is `start + 24` -- this reads the `stringOffset` field of the first record, not the string length. Then it sets `strLen = Math.min(recSize, ...)` which is the string offset interpreted as a length. If the string starts at byte 28 relative to the tag, `stringOffset = 28` would be read as `recSize = 28`, and the code would read 28 bytes starting at `recOffset + 12 = start + 28`, which happens to be the correct start but with a wrong length. This bug is partially masked because `stringOffset` (the value read as `recSize`) is often larger than the actual string, so the null-terminator scan at line 343-347 stops early. But for long profile names, extra garbage bytes after the null could be included.

---

## Positive Observations

- The color pipeline version (`IMAGE_PIPELINE_VERSION`) baked into the ETag is an excellent cache-busting mechanism that avoids the immutable-cache orphan problem. Well-thought-out.
- The `resolveColorPipelineDecision` and `resolveAvifIccProfile` functions are clearly documented with decision matrices. The separation of observability labels from encode decisions is a clean pattern.
- The `canUseHighBitdepthAvif` Promise-based singleton with its anti-race design (finding 8 notwithstanding) is a solid improvement over the original lazy-probe pattern.
- Bounds checking throughout the ICC parser (`Math.min`, cap on tagCount, cap on string length, size checks) shows defense-in-depth against malformed input.
- The `forceSrgbDerivatives` parameter provides a clean escape hatch for operators who need sRGB-only output.
- `<picture>` source order is consistent across all three consumer components (photo-viewer, lightbox, home-client): AVIF first, WebP second, JPEG fallback. Type attributes are all plain `image/avif` and `image/webp` without codec parameters, which is correct for broad compatibility.

---

## Verdict: REQUEST CHANGES

Two findings -- the CRIT-severity OG route P3 mislabeling and the HIGH-severity nclx parser FullBox offset bug -- require fixes before the color pipeline can be considered correct. The HIGH-severity ICC parser divergence between the two modules should be resolved by sharing a single implementation.
