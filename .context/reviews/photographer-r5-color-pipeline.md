# Photographer Review — GalleryKit Color & HDR Pipeline (R5)

**Review date:** 2026-05-18
**Reviewer lane:** photographer-perspective code review
**Scope:** Full color/HDR pipeline from source detection through display delivery
**Confidence methodology:** High = test-locked or provably correct; Medium = logic appears correct but edge cases possible; Low = heuristic-based or platform-dependent behavior

---

## Executive Summary

| Severity | Count | Summary |
|----------|-------|---------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 4 | Documentation drift, heuristic fragility, backfill idempotency gap, loose substring matching |
| LOW | 5 | Comment typos, defensive-code gaps, UX polish, test coverage holes, naming clarity |

**Overall assessment:** The pipeline is architecturally sound and test-defended at multiple layers. The four MEDIUM issues are all fixable without structural changes. No data-loss or security risks were found. The pipeline correctly prioritizes photographer intent (NCLX > ICC chromaticity > ICC name) and delivers honest gamut-aware variants with cache-busting ETags.

---

## 1. Color Detection Accuracy

### [MEDIUM] `fullRange` bit mask comment contradicts code
**File:** `apps/web/src/lib/color-detection.ts:252`
**Code:**
```ts
const fullRange = (matrixByte & 0x80) !== 0; // bit 0 = full range
```
**Issue:** The comment says "bit 0" but `0x80` masks bit 7 (the most significant bit of the byte). In ITU-T H.273 / CICP, the video-range flag IS bit 7 of the matrix coefficients byte, so the code is correct and the comment is wrong.
**Photographer impact:** None on behavior, but a future maintainer reading the comment might think the mask is wrong and "fix" it, breaking video-range detection for BT.601/BT.709/BT.2020 content.
**Fix:** Change comment to `// bit 7 = full range`.
**Confidence:** High (bitwise logic is unambiguous).

### [LOW] `parseCicpFromHeif` returns early on first `colr` box without checking `colour_type`
**File:** `apps/web/src/lib/color-detection.ts:214-280`
**Issue:** The ISOBMFF walker finds the first `colr` box and immediately parses it as NCLX. If a future file carries a `colr` box with `colour_type === 'prof'` (ICC profile) before the NCLX `colour_type === 'nclx'`, the function will mis-parse the ICC bytes as CICP integers.
**Photographer impact:** For current files this is theoretical — NCLX `colr` boxes are typically first. But HEIF allows multiple `colr` boxes in any order, and the spec says the first applicable one wins. The code should verify `colour_type === 'nclx'` before parsing.
**Fix:** Add a guard after reading `colour_type` (4-byte ASCII type field at offset 8 inside the `colr` box): `if (colourType !== 'nclx') continue;`.
**Confidence:** Medium (no reproduction case found in current corpus, but spec-compliant).

### [LOW] ICC chromaticity cannot distinguish DCI-P3 from Display P3
**File:** `apps/web/src/lib/icc-chromaticity.ts:61-92`
**Issue:** The `PRESETS` table has no DCI-P3 entry. DCI-P3 and Display P3 share identical RGB primaries; they differ only in white point (D65 vs D63). The chromaticity matcher will therefore classify a DCI-P3 source as Display P3, and the downstream pipeline will apply a Bradford D65 adaptation that may already be present in the source profile.
**Photographer impact:** A DCI-P3 source tagged with a custom ICC profile (not on the name allowlist) will be detected as Display P3. The encoder then skips `rgb16` and trusts `toColorspace('p3')` to do Bradford adaptation. If the source already has a D65 white point (some DCI-P3-exporting apps embed D65), the double adaptation shifts neutrals. If the source is true D63, the adaptation is correct but the decision label says "from Display P3" which is misleading.
**Fix:** Add a DCI-P3 preset with D63 white point (`{ x: 0.314, y: 0.351 }`) to `PRESETS`, and teach `detectGamutFromIccChromaticity` to return a DCI-P3-specific signal. Then teach `resolveColorPipelineDecision` to emit `p3-from-dcip3` for chromaticity-matched DCI-P3, not just name-matched.
**Confidence:** Medium (depends on actual source corpus; most DCI-P3 sources are name-tagged).

### Positive observation
The NCLX precedence over ICC is test-locked at `apps/web/src/__tests__/color-detection.test.ts:330-358`. When NCLX and ICC disagree, NCLX wins — this is correct because NCLX is author-intent metadata in HEIF/AVIF containers, while ICC may be a legacy or default profile.

---

## 2. Encoder Decisions

### [MEDIUM] Backfill query skips already-decided rows on pipeline version bumps
**File:** `apps/web/scripts/backfill-color-pipeline.ts:220-223`
**Code:**
```ts
.where(and(
  ne(images.pipeline_version, IMAGE_PIPELINE_VERSION),
  or(isNull(images.color_pipeline_decision), /* … */)
))
```
**Issue:** The default WHERE clause includes `AND (color_pipeline_decision IS NULL)`. This means a photo that already has a decision (e.g., from a previous upload) will NOT be re-evaluated when `IMAGE_PIPELINE_VERSION` bumps, even though the encoder output bytes may have changed (e.g., new `wide_gamut_jpeg_chroma` default, new `avif_effort`, or new rgb16 pipeline logic). The `--force-reencode` flag bypasses this, but the default behavior silently leaves photos at stale encodes.
**Photographer impact:** After a pipeline version bump, some photos may still serve old variants that do not reflect the new color settings. For example, if v8 changes the SDR JPEG chroma default, already-decided sRGB photos won't be re-encoded.
**Fix:** Remove the `isNull(images.color_pipeline_decision)` clause from the default query. The pipeline version mismatch alone is sufficient to trigger re-encode. Keep `--force-reencode` for re-encoding even when versions match.
**Confidence:** High (the SQL is explicit).

### [LOW] Per-format fresh Sharp instances prevent cross-contamination but triple file I/O
**File:** `apps/web/src/lib/process-image.ts:943-959`
**Code:** The wide-gamut downscale path writes a TIFF intermediate, then creates a fresh `sharp(inputPath, …)` for each output format.
**Issue:** Each fresh Sharp instance re-reads the source file from disk. For a 50 MB source, this is ~150 MB of disk reads per image. On spinning rust or loaded NAS, this is measurable latency. The `clone()` approach used earlier in the file avoids this but was abandoned for wide-gamut because of shared-state contamination (WI-14).
**Photographer impact:** Upload processing latency for wide-gamut sources is higher than necessary. No quality impact.
**Fix:** Consider keeping the `sharp(inputPath)` instance alive after the TIFF intermediate and passing the same instance to each format's resize/encode chain, or use a memory buffer intermediate. This requires careful testing to ensure ICC state doesn't leak between formats.
**Confidence:** Low (performance impact is environment-dependent; quality is correct).

### Positive observation
The encoder decision matrix is comprehensive and correctly handles all major wide-gamut sources (Display P3, DCI-P3, Adobe RGB, ProPhoto, Rec.2020). The `p3-from-dcip3` path correctly skips `rgb16` and preserves the source ICC for Sharp's internal Bradford adaptation, avoiding a double transform.

---

## 3. Display Delivery Honesty

### [MEDIUM] Firefox is permanently downgraded to `'srgb'` regardless of actual display
**File:** `apps/web/src/lib/use-display-capability.ts:49-82`
**Code:**
```ts
if (typeof window !== 'undefined' && 'chrome' in window) { /* Chrome/Edge path */ }
// Firefox falls through to the MQ-based path, but Firefox does not
// implement `(color-gamut: p3)` as of Firefox 137, so it hits the
// final fallback: return 'srgb';
```
**Issue:** Firefox lacks both `screen.colorGamut` and `(color-gamut: p3)` media query support. The hook conservatively returns `'srgb'` for ALL Firefox browsers, even when the user has a genuine P3 or Rec.2020 display. This means:
1. P3 gamut badges are hidden.
2. HDR badges are hidden.
3. The `WideGamutHint` is suppressed (correct — avoids false nagging).
**Photographer impact:** A photographer reviewing their own gallery on Firefox (even with a calibrated P3 display) cannot see the P3/HDR badges without enabling `force_show_color_chips`. This is documented (R10-H4) but is a genuine platform gap.
**Fix:** None available without browser API support. The conservative fallback is the correct trade-off. Consider surfacing a one-time toast on Firefox: "Firefox does not report display gamut; enable 'Force show color chips' in admin settings to see gamut/HDR badges."
**Confidence:** High (this is a documented browser limitation, not a bug in the code).

### [LOW] `force_show_color_chips` bypasses display detection but does not bypass canvas-P3 probe
**File:** `apps/web/src/components/histogram.tsx`
**Issue:** The histogram component uses a canvas P3 context probe to decide whether to render in P3 color space. The `force_show_color_chips` CSS override shows badges, but it does NOT force the histogram into P3 mode on an sRGB display. On an sRGB display with `force_show_color_chips=true`, the histogram will still compute in sRGB, which is inconsistent with the badges claiming P3.
**Photographer impact:** Minor — the histogram is an audit tool, not a color-managed delivery surface. But a photographer demoing on an sRGB laptop with `force_show_color_chips` might expect the histogram to also show P3-space data.
**Fix:** Thread `force_show_color_chips` through to the histogram component and use it as an override for the canvas-P3 probe decision.
**Confidence:** Low (UX inconsistency, not data loss).

### Positive observation
`useDisplayCapability` is snapshot-memoized to prevent React #185 infinite loops. The `getSnapshot` function returns a stable string reference, and the `subscribe` function correctly registers/unregisters MQ listeners. This is a well-implemented workaround for a React core bug.

---

## 4. HDR Workflow

### [LOW] HDR ingest warning message does not explain the SDR-downgrade consequence
**File:** `apps/web/src/app/actions/images.ts:304-306`
**Code:**
```ts
console.warn(`[upload] HDR source accepted with warning: ${file.name}`);
```
**Issue:** The warning is logged server-side only. The photographer uploading a PQ/HLG file sees no indication that their HDR content will be delivered as SDR until they open the Color Details accordion after processing.
**Photographer impact:** A photographer might upload an HDR photo expecting HDR delivery, not realizing the pipeline downgrades to SDR. The `allow_hdr_ingest` gate is opt-in, but the opt-in UI does not explain the limitation.
**Fix:** Add a flash message or upload-progress note: "HDR source detected. HDR delivery is not yet supported; this photo will be delivered as SDR."
**Confidence:** Medium (UX gap, not technical failure).

### [LOW] Apple HDR gain map detection uses loose substring matching
**File:** `apps/web/src/lib/gain-map-detection.ts:251-260`
**Code:**
```ts
if (itemType.includes('apple') && itemType.includes('hdr')) {
```
**Issue:** The `tmap` heuristic matches any item type containing both substrings. A malicious or malformed file could include `apple_hdr_foo` and trigger false positive gain-map detection.
**Photographer impact:** False positive causes the admin UI to show "Has gain map: yes" and "delivered as SDR base only" when there is no actual gain map. No delivery impact (the SDR base is still correct).
**Fix:** Use an exact match or a stricter prefix check against the known Apple URI patterns documented in the HEIF spec.
**Confidence:** Medium (heuristic fragility, no security risk).

### Positive observation
HDR ingest is correctly gated by `allow_hdr_ingest` (default `false`). The rejection message is localized. The `is_hdr` / `transfer_function` / `matrix_coefficients` fields are admin-only via `_PrivacySensitiveKeys`, so the public never sees an HDR badge for a photo that cannot deliver HDR bytes.

---

## 5. Post-Encode Verification

### [LOW] `verifyAvifNclxInBuffer` does not verify the actual NCLX values match intent
**File:** `apps/web/src/lib/process-image.ts:135-169`
**Code:** The function checks that an AVIF `colr` box exists and that `colour_type === 'nclx'`, but does not verify that `colour_primaries`, `transfer_characteristics`, or `matrix_coefficients` match the intended values.
**Issue:** If Sharp/libvips writes an NCLX box with unexpected values (e.g., defaults to BT.709 primaries for a P3 source), the verification passes because it only checks presence, not correctness.
**Photographer impact:** A mis-tagged AVIF file could be served to visitors. Browsers would decode it in the wrong color space, shifting hues for wide-gamut sources.
**Fix:** Extend `verifyAvifNclxInBuffer` to read the 3-byte CICP values and assert they match the expected `color_primaries` / `transfer_function` / `matrix_coefficients` for the pipeline decision.
**Confidence:** Low (defensive code gap — no known Sharp bug triggers this).

### Positive observation
Post-encode verification exists for both AVIF NCLX (`verifyAvifNclxInBuffer`) and WebP ICC (`verifyWebpIccInBuffer`). This is above-average diligence for an open-source project. The WebP verification correctly checks ICC profile presence after Sharp's `withIccProfile` call.

---

## 6. ETag / Cache Invalidation

### Positive observation (no issues found)
The ETag formula `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash.slice(0,8)}"` correctly invalidates cached derivatives when:
1. The pipeline version bumps (encoder output changes).
2. The file is re-encoded (mtime changes).
3. Color-impacting admin settings change (settingsHash covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `image_sizes`, `wide_gamut_max_source_pixels`).

The `settings-hash.ts` module uses an explicit `COLOR_IMPACTING_KEYS` array, preventing accidental omission of new settings. The `must-revalidate` Cache-Control directive ensures browsers revalidate after the max-age expires.

---

## 7. Histogram

### [LOW] Histogram luminance coefficients differ between worker and main thread
**File:** `apps/web/public/histogram-worker.js:16-18`
**Code:**
```js
const lr = isP3 ? 0.22897 : 0.2126;
const lg = isP3 ? 0.69174 : 0.7152;
const lb = isP3 ? 0.07929 : 0.0722;
```
**Issue:** The worker uses Display P3 luminance coefficients when `isP3` is true, but the main thread's `drawHistogram` function does not recompute luminance — it relies on the worker's computed bins. However, the `isClipped` threshold logic in `histogram.tsx:476` uses a hardcoded `0.5%` of total pixels without accounting for P3-vs-sRGB luminance differences.
**Photographer impact:** The clip-warning threshold (`isClipped`) may fire at slightly different rates for P3 vs sRGB because the luminance distribution differs, but the threshold is percentage-based so the impact is minimal.
**Fix:** Document the coefficient source (ITU-R BT.709-6 vs SMPTE RP 431-2 / Display P3) in a comment. Consider whether the clip threshold should be gamut-aware.
**Confidence:** Low (minor numerical difference, no visual defect).

### Positive observation
The histogram's priority chain (AVIF → sized JPEG → fallback base JPEG) correctly handles legacy photos missing sized derivatives. The fallback was added in a recent commit and is test-covered. The canvas P3 context probe correctly detects browser support before attempting P3 rendering.

---

## 8. Backfill

### [MEDIUM] Backfill script does not validate that `pipeline_version` bumps are monotonic
**File:** `apps/web/scripts/backfill-color-pipeline.ts`
**Issue:** The script compares `ne(images.pipeline_version, IMAGE_PIPELINE_VERSION)`. If a DB row has `pipeline_version = 99` (corruption or manual edit) and `IMAGE_PIPELINE_VERSION = 7`, the script will attempt to backfill it. This is mostly harmless (re-encode at current settings), but if the corruption represents a future version, the backfill is a downgrade.
**Photographer impact:** None in normal operation. Only relevant if a DB is manually edited or a rollback deploy occurs.
**Fix:** Add an upper-bound check: `lt(images.pipeline_version, IMAGE_PIPELINE_VERSION)` instead of `ne(...)`.
**Confidence:** Low (requires manual DB corruption).

### Positive observation
The backfill acquires the `gallerykit_color_pipeline_backfill` MySQL advisory lock on a dedicated connection, preventing concurrent runs from racing the same rows. The `--force-reencode` flag allows intentional re-encode even when versions match. The script is idempotent for normal cases.

---

## 9. Schema / Data Layer

### Positive observation (no issues found)
The `_PrivacySensitiveKeys` compile-time guard in `apps/web/src/lib/data.ts:366-369` ensures that any new admin-only field added to `adminSelectFields` must also be added to the privacy exclusion list, or TypeScript fails. This is a strong compile-time defense against accidental leakage of color/HDR metadata to public queries.

The `_SensitiveKeysInPublic` guard further ensures that `publicSelectFields` cannot accidentally include sensitive keys. Both `is_hdr` and `transfer_function` are correctly excluded from public responses.

The `images` table schema correctly uses nullable columns for all color/HDR fields, allowing graceful handling of legacy rows where color detection was not run.

---

## 10. Browser / OS / Display Matrix

### [LOW] `useDisplayCapability` does not handle `screen.colorGamut` API additions
**File:** `apps/web/src/lib/use-display-capability.ts`
**Code:** The Chrome/Edge path checks `'chrome' in window`, then accesses `screen.colorGamut`. The Firefox path falls through to MQ detection.
**Issue:** If a future Firefox version adds `screen.colorGamut` without adding `(color-gamut: p3)` MQ support, the code will still take the Firefox fallback path because of the browser-sniffing guard. The more robust approach is to feature-detect `screen.colorGamut` first, then fall back to MQ, then fall back to `'srgb'`.
**Photographer impact:** When Firefox eventually implements `screen.colorGamut`, the hook will not use it until the browser-sniffing code is updated.
**Fix:** Reorder the detection: `if (typeof screen !== 'undefined' && 'colorGamut' in screen) { return screen.colorGamut; }` as the first check, before any browser sniffing.
**Confidence:** Medium (future-proofing, not a current bug).

### Positive observation
The browser/OS/display matrix documentation in `CLAUDE.md` is accurate and comprehensive. It correctly notes that Firefox lacks `(color-gamut: p3)` MQ support, that Edge supports `(dynamic-range: high)` only when Auto HDR is ON, and that Chrome on Android 13- mid-range devices delivers sRGB-clipped variants. This level of platform awareness is unusual for a self-hosted project.

---

## Recommendations Summary

| Priority | Issue | Fix |
|----------|-------|-----|
| 1 (MEDIUM) | Backfill skips decided rows | Remove `isNull(color_pipeline_decision)` from default WHERE |
| 2 (MEDIUM) | `fullRange` comment typo | Change to `// bit 7 = full range` |
| 3 (MEDIUM) | Gain-map heuristic too loose | Use exact match or stricter prefix |
| 4 (MEDIUM) | DCI-P3 vs Display P3 ambiguity | Add DCI-P3 chromaticity preset + decision path |
| 5 (LOW) | Firefox feature detection order | Check `screen.colorGamut` before browser sniffing |
| 6 (LOW) | HDR upload warning invisible to user | Surface SDR-downgrade notice in upload UI |
| 7 (LOW) | AVIF NCLX value verification | Assert CICP bytes match expected values |
| 8 (LOW) | `force_show_color_chips` histogram gap | Thread override to histogram canvas probe |
| 9 (LOW) | Backfill downgrade risk | Use `<` instead of `!==` for version comparison |
| 10 (LOW) | NCLX `colour_type` guard | Verify `'nclx'` before parsing CICP integers |

---

## Verdict

**REQUEST CHANGES** on the 4 MEDIUM issues (items 1-4 above). All are low-risk, high-clarity fixes that close real gaps.

**COMMENT** on the 5 LOW issues (items 5-10). Address at convenience; none block correctness or security.

No CRITICAL or HIGH issues were found. The pipeline is production-ready for photographer-intent delivery with the noted improvements.
