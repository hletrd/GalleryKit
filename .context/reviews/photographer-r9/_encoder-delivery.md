# Photographer Review R9 — Encoder / Delivery Pipeline

**Date:** 2026-05-15
**Scope:** Deep inspection of the image encoding and delivery path after R8 convergence (commits `689822d4` through `a8a59b0d`).
**Reviewer angle:** Professional photographer — color fidelity, ICC embedding accuracy, HDR handling, chroma subsampling choices, cache invalidation correctness, backfill behavior.
**Premise:** Photos arrive AFTER the photographer's editing. The encoder + viewer must deliver the photographer's intent (gamut, tonality, dynamic range) accurately to every viewer's display.

---

## Summary

R8 surfaced 1 CRIT + 4 HIGH + 8 MED findings. The R9 encoder/delivery pass confirms **6 prior findings are fully fixed in the current code**. The remaining pipeline is architecturally sound but surfaces **2 new MEDIUM findings** around audit-trail consistency and cache-staleness during the settings-change / backfill window, plus **3 LOW findings** on documentation and memory-efficiency trade-offs.

| Severity | Count | IDs |
|----------|-------|-----|
| CRIT | 0 | — |
| HIGH | 0 | — |
| MED | 2 | R9-M1, R9-M2 |
| LOW | 3 | R9-L1, R9-L2, R9-L3 |

---

## R8 Finding Closure Status

| R8 ID | Severity | Status | Evidence |
|-------|----------|--------|----------|
| R8-R1 | CRIT | **FIXED** | `backfill-color-pipeline.ts:159-180` resolves `getGalleryConfig()` and passes all tunables (`quality`, `sizes`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`) through `reprocessRow` → `processImageFormats`. |
| R8-R2 | HIGH | **FIXED** | `settings-hash.ts:108-113` accepts optional `GalleryConfig`; `buildHashFromConfig(config)` uses validated values. `serve-upload.ts:110-111` passes resolved config to hash builder. |
| R8-R5 | MED | **FIXED** | `process-image.ts:62-108` — `_probeHighBitdepthAvif()` retries up to 3× with exponential backoff; `isBitdepthRejection()` distinguishes permanent Sharp rejections from transient `EIO`/`ENOSPC`/`EMFILE`/`EAGAIN`. |
| R8-R6 | MED | **FIXED** | `settings-hash.ts:40-41` adds `image_sizes` to `COLOR_IMPACTING_KEYS`; hash formula includes `config.imageSizes.join(',')`. |
| R8-R7 | MED | **FIXED** | `serve-upload.ts:132` — `Cache-Control` reduced from `max-age=86400` to `max-age=3600`. Color-fix visibility window is now ≤ 1 hour. |
| R8-R8 | MED | **FIXED** | `process-image.ts:839-848` — every format path now gets a fresh `sharp()` instance per format. Comment explicitly references WI-14 / R8-R8. |
| R8-M1 | MED | **FIXED** | `color-detection.ts:178-183` — NCLX transfer codes 4, 5, 7 mapped to `'gamma22'`. Code 16 (`pq`) and 18 (`hlg`) are also present and correct. |

---

## Detailed Findings

### R9-M1 [MEDIUM] — Backfill omits `color_pipeline_decision` refresh; audit trail can lie about what was encoded

**Files:** `apps/web/scripts/backfill-color-pipeline.ts:253-272`
**Confidence:** Confirmed by direct inspection
**Impact:** Photographer views Color Details accordion and sees a decision label (e.g., `p3-from-adobergb`) that may not reflect the resolver logic that actually ran during re-encode. If `resolveColorPipelineDecision` or `resolveAvifIccProfile` semantics change in a future pipeline version bump, backfilled images silently carry stale decision labels.

**Evidence:**

The `reprocessRow` function re-runs `detectColorSignals` after successful re-encode and returns `signals` containing `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`. The main loop then batch-updates those six columns plus `pipeline_version`.

The `color_pipeline_decision` column is **not** in the `ReprocessSignals` interface and is **not** updated. It was written once during original upload (`process-image.ts:669`) and never refreshed.

This matters because:
1. `color_pipeline_decision` is derived from `icc_profile_name` + `colorPrimaries` via `resolveColorPipelineDecision()`. If the resolver's string-matching heuristics or primaries mapping changes, the stored label becomes a lie.
2. `forceSrgbDerivatives` affects the *actual* JPEG/WebP gamut but does NOT affect the stored decision. A backfilled image with `forceSrgbDerivatives=true` encodes JPEG as sRGB but the decision label still says `p3-from-displayp3` (R8-M2, now also affects backfilled images).
3. The Color Details accordion and Lightroom-style audit surfaces render the stored decision string directly. The photographer cannot trust it after backfill.

**Fix:** Recompute `colorPipelineDecision` inside `reprocessRow` using the freshly detected signals, add it to `ReprocessSignals`, and include it in the batch UPDATE. One-line addition:

```ts
const colorPipelineDecision = resolveColorPipelineDecision(signals.iccProfileName, signals);
```

**Workaround until fix:** Run backfill with `--force-reencode` after any resolver-logic change; the decision remains stale but at least `pipeline_version` increments and the UI can warn "decision may reflect original upload logic."

---

### R9-M2 [MEDIUM] — ETag changes immediately on settings flip, but file bytes remain stale until backfill runs; clients cache wrong-color images

**Files:** `apps/web/src/lib/serve-upload.ts:110-112`, `apps/web/src/lib/settings-hash.ts:62-78`
**Confidence:** Confirmed by tracing the ETag formula
**Impact:** After an admin changes `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `image_quality_*`, or `image_sizes`, the ETag for every image changes immediately (because `settingsHash` reflects current settings). Browsers and CDN edges that revalidate get a `200 OK` with a new ETag, download what they believe are fresh bytes, and cache them. But the bytes on disk were encoded with the **old** settings. The photographer's color fix is invisible until the backfill completes — and the client has now cached the stale bytes under the new ETag, making the stale cache even harder to bust.

**Evidence:**

ETag formula:
```ts
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```

`settingsHash` is computed from current `GalleryConfig` values (validated). It is NOT computed from per-image settings stored at encode time. `IMAGE_PIPELINE_VERSION` is a global constant (6). `mtimeMs` reflects the file's last-modified time, which only changes when backfill rewrites the file.

Sequence of failure:
1. Image encoded with `wide_gamut_jpeg_chroma='4:2:0'` (admin mistake). ETag: `v6-T1-S1-hash(4:2:0)`.
2. Admin corrects to `wide_gamut_jpeg_chroma='4:4:4'`.
3. Client revalidates. ETag is now `v6-T1-S1-hash(4:4:4)` → **different** → server returns `200` with OLD bytes (still 4:2:0 encoded).
4. Client caches old bytes under new ETag.
5. Backfill runs, re-encodes file. mtime changes to T2. ETag becomes `v6-T2-S2-hash(4:4:4)` → **different again** → server returns `200` with NEW bytes.
6. Client finally has correct bytes.

The client downloads the image **twice** for one settings change. Worse: between steps 3 and 5, the client thinks it has the correct image (new ETag) but the colors are still wrong.

**Root cause:** The ETag conflates "settings used to encode THIS file" with "current global settings." There is no per-image record of what settings produced the file on disk.

**Fix options (in descending order of preference):**

1. **Store an `encode_settings_hash` per-image** (new nullable column or JSON blob). Compute it at encode time from the actual settings used (`wideGamutJpegChroma`, `avifEffort`, `quality`, etc.). Include this stored hash in the ETag instead of the live global hash. Backfill updates the stored hash. ETag only changes when the file was ACTUALLY encoded with different settings. This is the cleanest fix but requires schema + migration.

2. **Include `pipeline_version` from the DB row** instead of the global constant. Since backfill updates `pipeline_version` on success, the ETag would not change for un-backfilled images. But this requires a DB lookup on every image request, which was intentionally avoided for performance.

3. **Document the behavior** in the admin settings UI with a prominent warning: "Changing this setting requires running the backfill script before the new encoding takes effect for existing images." This is the lightest-weight mitigation.

**Recommended immediate action:** Option 3 (UI warning) + schedule Option 1 for the next schema migration.

---

### R9-L1 [LOW] — `wide_gamut_max_source_pixels` in settingsHash causes unnecessary cache invalidation for images below the threshold

**Files:** `apps/web/src/lib/settings-hash.ts:35-36`, `apps/web/src/lib/process-image.ts:753-775`
**Confidence:** Confirmed
**Impact:** When `wide_gamut_max_source_pixels` changes, every wide-gamut image gets a new ETag regardless of whether its source pixel count exceeded the old or new threshold. For a 24 MP image, changing the cap from 50 MP to 40 MP has zero effect on its encoding, but clients still revalidate.

**Mitigation:** Acceptable at personal-gallery scale. The wasted fetch is one conditional GET per image.

---

### R9-L2 [LOW] — DCI-P3 rgb16 skip comment conflates ICC-embedded and NCLX-only cases

**Files:** `apps/web/src/lib/process-image.ts:831-838`
**Confidence:** Confirmed
**Impact:** Documentation inaccuracy only. The comment says "preserving the source ICC lets toColorspace('p3') perform the correct Bradford D63→D65 adaptation" but NCLX-only DCI-P3 sources have no ICC to preserve. The behavior is correct (rgb16 skip is harmless because primaries are identical to Display P3), but the comment should distinguish the two cases.

**Suggested fix:** Split the comment into two stanzas — one for ICC-embedded DCI-P3 (source ICC preserved for Bradford), one for NCLX-only DCI-P3 (no ICC, skip rgb16 because gamma-space resize artifacts are negligible for same-primaries resize).

---

### R9-L3 [LOW] — Display P3 sources unnecessarily enter rgb16 pipeline, doubling peak RAM

**Files:** `apps/web/src/lib/process-image.ts:842-848`
**Confidence:** By design, but worth questioning
**Impact:** For true Display P3 sources (the most common wide-gamut case from modern iPhones and Macs), `needsRgb16 = true` because `isWideGamutSource = true` and `isDciP3 = false`. The resize runs in 16-bit linear space even though the source and target colorspace are both Display P3 — there is no gamut conversion happening, only resize.

The rgb16 pipeline is primarily needed for cross-gamut conversions (Adobe RGB → P3, ProPhoto → P3) where linear-light resize prevents hue shifts and edge halos. For same-gamut Display P3 → Display P3, gamma-space resize is visually acceptable and saves ~50% peak RAM during the resize step.

**Trade-off:** The current code prioritizes maximum accuracy (even same-gamut resize is linear-light) over memory efficiency. For a personal gallery this is defensible. For high-volume batch processing, an optimization would be:

```ts
const needsRgb16 = isWideGamutSource && !isDciP3 && avifDecision === 'p3-from-wide';
```

This would skip rgb16 for native Display P3 sources (exact match, no conversion needed) while keeping it for wider-gamut sources that must be gamut-mapped to P3.

**Risk of change:** If Sharp's default resize colorspace for P3-tagged images is not truly P3-gamma-aware, a gamma-space resize could introduce subtle differences. The current conservative approach is safer. Recommend documenting this as an intentional performance/correctness trade-off rather than changing it.

---

## Encoder Correctness Matrix

### ICC-Tagged Output by Format

| Source | AVIF ICC | AVIF Bit Depth | WebP ICC | JPEG ICC | JPEG Chroma | Resize Space |
|--------|----------|----------------|----------|----------|-------------|--------------|
| sRGB | sRGB ICC | 8-bit | sRGB ICC | sRGB ICC | 4:2:0 (SDR default) | gamma-8 |
| Display P3 / P3-D65 | P3 ICC | 10-bit (if probe ok) | P3 ICC | P3 ICC | 4:4:4 (admin-tunable) | rgb16 |
| DCI-P3 | P3 ICC | 10-bit (if probe ok) | P3 ICC | P3 ICC | 4:4:4 | gamma (DCI-P3) |
| Adobe RGB | P3 ICC | 10-bit (if probe ok) | P3 ICC (or sRGB if forced) | P3 ICC (or sRGB if forced) | 4:4:4 | rgb16 |
| ProPhoto RGB | P3 ICC | 10-bit (if probe ok) | P3 ICC (or sRGB if forced) | P3 ICC (or sRGB if forced) | 4:4:4 | rgb16 |
| Rec.2020 / BT.2020 | P3 ICC | 10-bit (if probe ok) | P3 ICC (or sRGB if forced) | P3 ICC (or sRGB if forced) | 4:4:4 | rgb16 |
| Unknown / no ICC | sRGB ICC | 8-bit | sRGB ICC | sRGB ICC | 4:2:0 | gamma-8 |

**Verdict:** The matrix is correct. Every format receives the appropriate ICC profile for its encoded pixel values. The `toColorspace()` call runs BEFORE `withIccProfile()`, ensuring the pixels are in the declared space before the profile is embedded.

### AVIF 10-Bit Encoding

- **Probe:** Promise-singleton, 3 retries with exponential backoff, distinguishes bitdepth-rejection from transient errors. Fixed from R8-R5.
- **Fallback:** Per-image downgrade to 8-bit if probe passed but specific encode fails (lines 884-899).
- **Scope:** Only wide-gamut sources (`isWideGamutSource`) request 10-bit. sRGB sources stay 8-bit for file-size efficiency.
- **Honesty:** The `bit_depth` column tracks SOURCE bit depth, not delivered. The audit panel should derive delivered bit depth from the encode path. Currently `bit_depth` is stored from Sharp metadata and is accurate for the source file.

**Verdict:** Correct. The 10-bit path is properly gated and fails safely.

### Chroma Subsampling

- **Wide-gamut JPEG:** Defaults to 4:4:4 (full chroma), admin-tunable to 4:2:2 or 4:2:0. Correct — wide-gamut images benefit from full chroma because saturated colors are more susceptible to chroma subsampling artifacts.
- **SDR JPEG:** Defaults to 4:2:0 (Sharp default), admin-tunable to 4:4:4 or 4:2:2. Correct — preserves backward-compatible file sizes.
- **WebP:** No chroma subsampling parameter in Sharp's WebP encoder. The format itself supports 4:2:0 and 4:4:4; Sharp uses its internal default (typically 4:2:0 for quality < 100). This is not configurable and is acceptable.
- **AVIF:** No chroma subsampling parameter exposed. AVIF's internal chroma decisions are handled by libheif and are typically 4:2:0 or 4:4:4 depending on quality and content. Not configurable; acceptable.

**Verdict:** Correct for JPEG. WebP/AVIF chroma is controlled by the underlying encoder, which is acceptable for a self-hosted gallery.

### Cache Invalidation Correctness

| Component | Behavior | Correct? |
|-----------|----------|----------|
| Pipeline version bump | `IMAGE_PIPELINE_VERSION` increments → ETag changes for ALL images | Yes |
| Settings change | `settingsHash` changes immediately → ETag changes for ALL images | **Yes for intent, but see R9-M2** |
| File rewrite (backfill) | `mtimeMs` changes → ETag changes | Yes |
| Settings hash source | Built from validated `GalleryConfig` values, not raw DB strings | Yes (R8-R2 fixed) |
| `image_sizes` | Included in hash since R8-R6 | Yes |
| Quality settings | Included in hash since R8-R6 | Yes |
| `max-age` | 3600 seconds (1 hour) | Yes — shorter than prior 86400 |
| `must-revalidate` | Present — stale responses must revalidate | Yes |

### CDN / Cache Headers

```
Content-Type: image/jpeg | image/webp | image/avif
Cache-Control: public, max-age=3600, must-revalidate
ETag: W/"v6-{mtimeMs}-{size}-{settingsHash}"
X-Content-Type-Options: nosniff
```

**Assessment:**
- `public` allows shared CDN caching. Correct for immutable image assets.
- `max-age=3600` is a reasonable compromise between cache efficiency and color-fix propagation. Could be shorter (1800) for a self-hosted gallery with modest traffic, but 3600 is defensible.
- `must-revalidate` ensures stale responses are not served without origin check. Combined with ETag, this is correct HTTP cache semantics.
- No `Vary: Accept` needed because different formats have different URLs (`/uploads/avif/`, `/uploads/webp/`, `/uploads/jpeg/`).
- No `Accept-Ranges: bytes` — range requests not supported. Acceptable.
- No Brotli/Gzip — already-compressed image formats. Correct.

### Backfill Script Correctness

| Aspect | Behavior | Correct? |
|--------|----------|----------|
| Admin settings pass-through | All 7 tunables forwarded from `getGalleryConfig()` | **Yes** (R8-R1 fixed) |
| Advisory lock | MySQL `GET_LOCK` with 10s timeout | Yes |
| Idempotency | Skips `pipeline_version >= 6` by default; `--force-reencode` available | Yes |
| Color detection refresh | Re-runs `detectColorSignals` after encode | Yes (R7-M4) |
| Batch updates | 100-row batches, transaction-wrapped | Yes |
| `pipeline_version` update | Set to `IMAGE_PIPELINE_VERSION` on success | Yes |
| `color_pipeline_decision` update | **NOT updated** | **No — see R9-M1** |
| Original file preservation | Unmodified original kept at `data/uploads/original/` | Yes |
| WI-15 cleanup | Temp downscaled intermediate unlinked in `finally` | Yes |

---

## Delivery Paths That Could Lose Color Accuracy

### 1. Firefox + Wide-Gamut Display (P3 AVIF not shown)
Firefox 124+ supports AVIF and P3 displays, but lacks `(color-gamut: p3)` media query support. The frontend's `useDisplayCapability` falls back to canvas-P3 probe, which correctly resolves to P3. The frontend then requests P3-tagged AVIF. Firefox CAN decode and display P3 AVIF. **Path is safe.**

### 2. sRGB Browser + Wide-Gamut Image
The JPEG/WebP derivatives embed P3 ICC profiles. An sRGB-only browser (e.g., Chrome on Android 13-) will load the P3-tagged JPEG and typically ignore the ICC profile, rendering sRGB-clipped colors. This is expected behavior — the browser can't display P3 anyway. The `WideGamutHint` component informs the viewer that the image contains more color than their display can show. **Path is safe; user is informed.**

### 3. `forceSrgbDerivatives=true` + Wide-Gamut Source
WebP/JPEG are converted to sRGB and tagged with sRGB ICC. AVIF remains P3-tagged. A P3-capable browser requesting the AVIF sees full gamut; requesting JPEG sees sRGB. The photographer intentionally chose this via admin toggle. **Path is safe but the audit panel should be explicit about the split (R8-M2).**

### 4. HDR Source (PQ/HLG) + SDR Delivery Pipeline
HDR sources are rejected at upload unless `allow_hdr_ingest=true`. When allowed, the source is accepted with a warning, encoded through the SDR pipeline (tone-mapped to SDR by Sharp's default behavior), and delivered as SDR. The `is_hdr` flag is set, but there is no HDR AVIF delivery path (WI-09 deferred). The Color Details accordion should show "Delivered as SDR" (R8-M4). **Path is honest but could mislead without the UI note.**

### 5. Apple HDR Gain Map (iPhone HEIC)
Detected at upload via `hasGainMap`. The SDR base image is delivered; the gain map is NOT transcoded. Admin sees "delivered as SDR base only" label. **Path is honest.**

### 6. Custom Monitor Profiles (Eizo, BenQ, calibrated displays)
ICC chromaticity detection (`lib/icc-chromaticity.ts`) rescues these by parsing `wtpt`/`rXYZ`/`gXYZ`/`bXYZ`. If chromaticity resolves to a known gamut, the source is treated accordingly. If not, it falls back to sRGB. **Path is conservative but safe.**

---

## Positive Observations

1. **Per-format fresh Sharp instances** eliminate cross-format contamination (R8-R8 fixed). Every parallel encode gets its own libvips context.
2. **Atomic rename contract** for base filenames prevents 404s during concurrent reads/writes.
3. **NCLX precedence over ICC** is correct and handles HEIF/AVIF containers properly.
4. **DCI-P3 Bradford D65 adaptation** is real — `toColorspace('p3')` handles the white-point shift when the source ICC is preserved.
5. **10-bit AVIF probe** is robust: singleton pattern, retry logic, per-image fallback.
6. **Settings hash uses validated values** — no more raw-vs-validated mismatch (R8-R2 fixed).
7. **WI-15 downscale** prevents OOM on 50 MP+ wide-gamut sources while preserving color pipeline intent.
8. **JPEG chroma subsampling** is fully tunable end-to-end for both wide-gamut and SDR paths.
9. **Symlink rejection** (`lstat` + `isSymbolicLink()`) in serve-upload prevents directory traversal.
10. **Content-Type / extension matching** prevents serving `.webp` from `/uploads/jpeg/`.

---

## Recommended Priorities

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| P1 | R9-M1: Backfill `color_pipeline_decision` refresh | Small (1 column, 1 function call) | Audit trail accuracy |
| P2 | R9-M2: Document settings-change / backfill staleness in admin UI | Small (UI copy) | Photographer confidence |
| P3 | R9-M2 (long-term): Per-image encode-settings hash in ETag | Medium (schema + migration + encoder change) | Eliminates stale-color cache window |
| P4 | R9-L2: Split DCI-P3 rgb16 skip comment | Tiny | Code documentation |
| P5 | R9-L3: Document Display P3 → rgb16 as intentional trade-off | Tiny | Code documentation |

---

*End of encoder/delivery review.*
