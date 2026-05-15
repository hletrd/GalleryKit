# GalleryKit Color/HDR Pipeline — Architectural Review (Photographer Perspective)

**Review Date:** 2026-05-12
**Reviewer:** Architect (oh-my-claudecode)
**Scope:** `process-image.ts`, `image-queue.ts`, `data.ts`, `images.ts` (upload action), `lr/upload/route.ts`, `schema.ts`, `gallery-config-shared.ts`, `serve-upload.ts`, `settings-hash.ts`, `backfill-color-pipeline.ts`, `color-detection.ts`, `color-pipeline-decisions.ts`
**Premise:** Photos arrive AFTER editing. The encoder + viewer must deliver the photographer's intent accurately.

---

## Executive Summary

The color pipeline has matured significantly since the pre-versioned era, with explicit encoder decisions, NCLX parsing, ICC chromaticity fallback, and ETag-based cache invalidation. However, **three architectural gaps undermine photographer-intent fidelity**:

1. **The backfill script ignores admin-configured encoder settings** (critical), silently reverting backfilled images to hardcoded defaults while new uploads honor the admin's tuning.
2. **The ETag hash reads raw, unvalidated DB values** (high), so the cache invalidation signal can misrepresent the actual encoding parameters used to produce the file on disk.
3. **The Lightroom upload path silently discards color signals** (high) — NCLX primaries, transfer function, HDR flags, and gain-map detection are stored as NULL, breaking the Color Details audit panel and future HDR delivery for plugin uploads.

All other findings are medium or lower severity but compound operational risk at gallery scale.

---

## Detailed Findings

### R1 — CRITICAL: Backfill script ignores admin-configured encoder settings

| Field | Location |
|-------|----------|
| **File:Line** | `scripts/backfill-color-pipeline.ts:91-101` |
| **Confidence** | Confirmed by direct inspection |

**The code:**

```typescript
// backfill-color-pipeline.ts:91-101
await processImageFormats(
    originalPath,
    row.filename_webp,
    row.filename_avif,
    row.filename_jpeg,
    row.width,
    undefined,  // quality — falls back to hardcoded 90/85/90
    undefined,  // sizes — falls back to [640,1536,2048,4096]
    row.icc_profile_name,
    undefined,  // forceSrgbDerivatives — falls back to false
    row.color_primaries ? { colorPrimaries: row.color_primaries } : null,
    // wideGamutJpegChroma — omitted → falls back to '4:4:4'
    // avifEffort — omitted → falls back to 6
    // sdrJpegChroma — omitted → falls back to '4:2:0'
    // wideGamutMaxSourcePixels — omitted → falls back to 50_000_000
);
```

**Photographer risk:** An admin who tuned the gallery for their workflow (e.g., `avif_effort=9` for smaller files, `wide_gamut_jpeg_chroma='4:2:2'` for faster page loads, or `force_srgb_derivatives=true` for legacy embedder compatibility) runs the backfill after a pipeline version bump. Every backfilled image is re-encoded with **hardcoded defaults**, while newly uploaded images use the admin's tuned settings. The gallery now contains a **mixed population** of derivatives: some honor the photographer's intent, some silently revert to stock behavior. There is no warning, no audit log, and the admin dashboard shows a uniform `pipeline_version=6` for all images.

**Root cause:** The backfill script was written before tunable parameters (P3-20, P3-21, C2-A5, C2-A6) landed. It was never updated to read `getGalleryConfig()` and pass the current admin settings through to `processImageFormats`.

**Fix:**
- Import `getGalleryConfig` (or read settings directly from DB to avoid the React `cache()` wrapper) inside the backfill script.
- Pass resolved `quality`, `imageSizes`, `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, and `wideGamutMaxSourcePixels` to `processImageFormats`.
- Trade-off: Backfill script gains a DB dependency, but correctness outweighs the coupling cost.

---

### R2 — HIGH: ETag settings-hash reads raw DB values; encoder reads validated/fallback values

| Field | Location |
|-------|----------|
| **File:Line** | `lib/settings-hash.ts:59-67`, `lib/gallery-config.ts:96-100` |
| **Confidence** | Confirmed by direct inspection |

**The code:**

`settings-hash.ts:59-67` reads directly from the `admin_settings` table without validation:

```typescript
const rows = await db.select({ key: adminSettings.key, value: adminSettings.value })
    .from(adminSettings)
    .where(inArray(adminSettings.key, [...COLOR_IMPACTING_KEYS]));
```

`gallery-config.ts:96-100` validates and falls back to defaults:

```typescript
function validatedNumber(map: Map<string, string>, key: GallerySettingKey): number {
    const raw = getSetting(map, key);
    if (!isValidSettingValue(key, raw)) return Number(DEFAULTS[key]);
    return Number(raw);
}
```

**Photographer risk:** Suppose an admin (or a buggy script) writes `image_quality_avif=150` to the DB. `getGalleryConfig()` rejects it and falls back to `85`. New uploads are encoded at Q=85. But `getColorSettingsHash()` reads the raw `150`, so the ETag is `...-hash(150)`. When the admin fixes the value to `80`, the hash changes to `hash(80)`, the ETag changes, and every cached browser re-fetches. **But the file on disk was encoded with Q=85, not Q=80.** The browser receives the old Q=85 bytes with an ETag that claims they were encoded under the new setting. If the admin later runs a backfill (which, per R1, also uses defaults), the inconsistency deepens.

More subtly: if the invalid raw value happens to match the fallback after correction (e.g., invalid `150` → corrected to `85` which equals the fallback), the ETag changes but the bytes do not. The browser re-downloads identical data. This wastes bandwidth but does not harm color accuracy. The real harm is the **false confidence** the ETag gives: the admin believes the cache invalidated because the encoding changed, when in fact only the ETag string changed.

**Root cause:** Two code paths read settings independently. The encoder uses the validated/resolved `GalleryConfig` object; the ETag builder reads raw strings directly from the DB. They can diverge.

**Fix:**
- Have `getColorSettingsHash()` accept an optional `GalleryConfig` object and compute the hash from resolved values.
- In `serve-upload.ts`, call `getGalleryConfig()` (cached) and pass resolved settings to `getColorSettingsHash()`.
- Trade-off: `serve-upload.ts` gains a dependency on `gallery-config.ts` (already server-side). The cache TTL in `settings-hash.ts` (5 s) may need adjustment if `getGalleryConfig()` itself is cached per-request.

---

### R3 — HIGH: Lightroom upload route silently drops color signals

| Field | Location |
|-------|----------|
| **File:Line** | `app/api/admin/lr/upload/route.ts:112-132` (insert), `route.ts:137-152` (enqueue) |
| **Confidence** | Confirmed by direct inspection |

**The code:** The Lightroom plugin upload route calls `saveOriginalAndGetMetadata()` which returns `colorSignals`, `iccProfileName`, `bitDepth`, and `colorPipelineDecision`. The route stores NONE of the color/HDR columns except `color_space` (derived from ICC name) and `bit_depth`:

```typescript
// app/api/admin/lr/upload/route.ts:112-132
const insertValues = {
    // ... filename, width, height, etc.
    color_space: data.iccProfileName || exifDb.color_space,
    bit_depth: data.bitDepth,
    original_format: ...,
    original_file_size: fileEntry.size,
    // MISSING: color_pipeline_decision, color_primaries, transfer_function,
    //          matrix_coefficients, is_hdr, has_gain_map, pipeline_version
};
```

The enqueue call at `route.ts:137-152` also omits `colorSignals`:

```typescript
enqueueImageProcessing({
    id: imageId,
    // ... filenames, width, topic, quality, imageSizes
    iccProfileName: data.iccProfileName,
    // MISSING: colorSignals
});
```

**Photographer risk:** A photographer using the Lightroom Classic publish plugin to upload an Apple HDR HEIC (iPhone 14+) or a Display-P3 JPEG from Photoshop will see:
- `color_primaries = NULL` instead of `p3-d65`
- `transfer_function = NULL` instead of `srgb`
- `is_hdr = false` instead of `true` (for PQ/HLG sources)
- `has_gain_map = false` instead of `true` (for Apple HDR HEICs)
- `color_pipeline_decision = NULL` instead of `p3-from-displayp3`
- The Color Details accordion shows incomplete/missing data.
- If the original is ever re-processed (bootstrap after crash, backfill, or future HDR delivery), the NCLX-derived signals are lost permanently because the DB never stored them.

**Root cause:** The Lightroom route was implemented before the color/HDR columns were added to the schema (US-CM04). It was not updated when those columns landed.

**Fix:**
- Mirror the browser upload path in `images.ts:354-365`: store `color_pipeline_decision`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, and `pipeline_version` in the DB insert.
- Pass `colorSignals` in the `enqueueImageProcessing` call.
- Trade-off: Slight code duplication between browser and Lightroom upload paths. Consider extracting a shared "build image insert values" helper to prevent future drift.

---

### R4 — HIGH: `bit_depth` leaks to public queries (should be admin-only)

| Field | Location |
|-------|----------|
| **File:Line** | `lib/data.ts:224` (in `adminSelectFields`), `data.ts:276-293` (publicSelectFields derivation) |
| **Confidence** | Confirmed by direct inspection + CLAUDE.md cross-reference |

**The code:** `bit_depth` is included in `adminSelectFields` at line 224, but it is **not** in the destructuring-omit list for `publicSelectFields` (lines 276-289). Therefore `bit_depth` flows into `publicSelectFields` and is exposed to unauthenticated visitors via `getImagesLite`, `getImage`, and shared-group queries.

**Photographer risk:** While `bit_depth` is not PII, the CLAUDE.md "Database Schema" section states that color/HDR columns are "admin-only via `_PrivacySensitiveKeys` guard." The `bit_depth` column reveals technical metadata about the photographer's workflow (e.g., 16-bit exports from Lightroom vs. 8-bit from-camera JPEGs). More importantly, it violates the documented privacy boundary: the compile-time guard at `data.ts:339` does not include `bit_depth` in `_PrivacySensitiveKeys`, so a future refactor that moves fields around will not catch this leakage.

**Fix:**
- Add `bit_depth: _omitBitDepthPublic` to the destructuring-omit block for `publicSelectFields`.
- Add `'bit_depth'` to `_PrivacySensitiveKeys`.
- Trade-off: None. This is a pure bug fix.

---

### R5 — MEDIUM: 10-bit AVIF probe permanently disabled on first transient failure

| Field | Location |
|-------|----------|
| **File:Line** | `lib/process-image.ts:60-86` |
| **Confidence** | Confirmed by direct inspection |

**The code:** `_highBitdepthAvifProbePromise` is a Promise singleton. Once `_probeHighBitdepthAvif()` rejects (e.g., disk full during the 2x2 probe encode, OOM, or a Sharp binary load race), the promise resolves to `false` and is cached forever:

```typescript
let _highBitdepthAvifProbePromise: Promise<boolean> | null = null;

async function _probeHighBitdepthAvif(): Promise<boolean> {
    try {
        await sharp({ create: ... }).avif({ ... bitdepth: 10 }).toBuffer();
        return true;
    } catch {
        return false;  // ← Any error → permanently disabled
    }
}
```

**Photographer risk:** A transient error at process startup (e.g., Docker volume not yet mounted) causes every wide-gamut image for the lifetime of that process to be encoded as 8-bit AVIF. Skies and skin tones that should be 10-bit smooth band. The photographer has no visibility into this — the Color Details panel shows "10-bit" for the source but the delivered AVIF is 8-bit. Restarting the process fixes it, but on a long-running production container the banding persists indefinitely.

**Root cause:** The probe uses a singleton promise with no retry mechanism. The `catch` swallows ALL errors indiscriminately.

**Fix:**
- Retry the probe up to 3 times with exponential backoff before concluding 10-bit is unavailable.
- Distinguish "Sharp rejected bitdepth" (expected on builds without libheif) from transient errors (EIO, ENOSPC).
- Alternatively: retry on every process restart (already happens) AND provide an admin-visible health-check endpoint that reports `canUseHighBitdepthAvif()` status.
- Trade-off: Slightly more complex startup logic. Worth it for photographer-intent fidelity.

---

### R6 — MEDIUM: `image_sizes` not in `COLOR_IMPACTING_KEYS`; ETag stale on size config change

| Field | Location |
|-------|----------|
| **File:Line** | `lib/settings-hash.ts:29-39` |
| **Confidence** | Confirmed by direct inspection |

**The code:** `COLOR_IMPACTING_KEYS` includes qualities, chroma, effort, and force-sRGB, but NOT `image_sizes`.

**Photographer risk:** An admin changes `image_sizes` from `[640,1536,2048,4096]` to `[640,1024,2048]` to reduce storage. Existing images still have `_4096.webp` files on disk. The base filename (e.g., `id.webp`) is linked to `_4096.webp`. The ETag does not change because `image_sizes` is not in the hash. Browsers with cached 4096px variants continue to receive them. New uploads get the new size list. The gallery has a mixed population of size variants with no cache invalidation signal.

More subtly: the `sizes` parameter affects the `lastRendered` dedup logic in `process-image.ts:781-790`. If sizes change, the hard-link dedup pattern may link a `_1024` variant to `_2048` (or vice versa) on re-encode. The base filename stays the same but the underlying size variant changes. Without ETag invalidation, browsers keep the old cached bytes.

**Fix:**
- Add `image_sizes` to `COLOR_IMPACTING_KEYS`.
- Trade-off: Every image size change triggers a global cache revalidation. This is correct behavior — the photographer's delivery surface changed.

---

### R7 — MEDIUM: 24-hour `max-age` cache window delays color-fix visibility

| Field | Location |
|-------|----------|
| **File:Line** | `lib/serve-upload.ts:125` |
| **Confidence** | Confirmed by direct inspection |

**The code:** `Cache-Control: public, max-age=86400, must-revalidate`

**Photographer risk:** A photographer uploads a Display-P3 image, notices the colors look wrong on their sRGB laptop, and flips `force_srgb_derivatives=true` to fix it. The ETag changes immediately. However, any browser (including the photographer's) that loaded the image in the last 24 hours will NOT send a revalidation request until the `max-age` expires. The photographer sees stale, wrong-color images for up to a day. They may conclude the fix didn't work and revert it, or file a bug report.

The `must-revalidate` directive only takes effect AFTER `max-age` expires. During the 24-hour window, intermediaries (CDNs, browser caches) serve the stale response without contacting the origin.

**Fix:**
- Reduce `max-age` to a shorter value for color-impacting changes, OR
- Use `no-cache` (which forces revalidation on every request) for the first N hours after a pipeline version or settings hash change, OR
- Add a cache-busting query parameter mechanism for admin-initiated re-encodes.
- Trade-off: Shorter max-age increases origin load. For a self-hosted gallery with modest traffic, `max-age=3600` (1 hour) or `max-age=1800` (30 min) is a reasonable compromise between cache efficiency and fix visibility.

---

### R8 — MEDIUM: Non-rgb16 encode path uses shared `image.clone()` across parallel format jobs

| Field | Location |
|-------|----------|
| **File:Line** | `lib/process-image.ts:754`, `process-image.ts:812` |
| **Confidence** | Hypothesis — no observed failure, but architectural risk exists |

**The code:**

```typescript
// process-image.ts:754 — ONE Sharp instance created before Promise.all
const image = sharp(processingInputPath, { ... });

// process-image.ts:808-812 — per-format pipeline
const base = needsRgb16
    ? sharp(processingInputPath, ...).pipelineColorspace('rgb16').resize(...)  // fresh instance
    : image.clone().resize({ width: resizeWidth });  // shared clone
```

The three formats (WebP, AVIF, JPEG) are generated in parallel via `Promise.all` at line 931. The rgb16 path (wide-gamut, non-DCI-P3) was fixed in WI-14 to use a fresh `sharp()` instance per format. But the sRGB path and DCI-P3 path still use `image.clone()` from a shared parent.

**Photographer risk:** Sharp's `clone()` documentation states it creates a new pipeline, but the implementation may share internal state (input buffers, metadata caches) with the parent. Under concurrent mutation from three parallel encodes (especially with large files), there is a theoretical risk of:
- Race conditions in metadata caching
- Corrupted output for one format if another mutates shared ICC profile data
- Non-deterministic color output (one format gets slightly different pixels than another)

This has not been observed in production, but the rgb16 path was explicitly fixed for WI-14 because shared-state contamination DID occur. The sRGB path shares the same risk profile.

**Fix:**
- Apply the WI-14 fix universally: use a fresh `sharp(processingInputPath, ...)` instance for ALL three formats, not just rgb16.
- Remove the `image` variable entirely; each format creates its own instance.
- Trade-off: Slightly higher memory peak (three independent input buffers vs. one shared). At personal-gallery scale this is negligible. Correctness is paramount.

---

### R9 — LOW: Backfill loads all candidate rows into memory (no streaming cursor)

| Field | Location |
|-------|----------|
| **File:Line** | `scripts/backfill-color-pipeline.ts:185-200` |
| **Confidence** | Confirmed by direct inspection |

**The code:** The backfill fetches all candidate rows in a single query:

```typescript
const rawRows = await db.execute(sql`
    SELECT id, filename_original, filename_avif, filename_webp, filename_jpeg,
           icc_profile_name, color_primaries, width
    FROM images
    WHERE ${whereClause}
    ORDER BY id ASC
`);
```

**Photographer risk:** For a gallery with 100k+ images, this loads tens of megabytes of row data into Node.js heap before processing begins. On memory-constrained deployments (e.g., small VPS), this can cause OOM or force the OS to swap, slowing the backfill to a crawl. The `PQueue` concurrency of 2 keeps the Sharp pipeline bounded, but the upfront SELECT is unbounded.

**Fix:**
- Use a cursor or paginated `LIMIT/OFFSET` loop (e.g., fetch 500 rows at a time) instead of a single unbounded SELECT.
- Trade-off: Slightly more code. Standard pattern for batch operations.

---

### R10 — LOW: Schema lacks columns for WI-09 HDR delivery

| Field | Location |
|-------|----------|
| **File:Line** | `db/schema.ts:64-72` |
| **Confidence** | Design gap — acknowledged in code comments |

**The code:** The schema stores CICP-equivalent columns (`color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`) but lacks:
- Content Light Level Information (CLLI): `maxCLL`, `maxFALL` — needed for tone mapping HDR to SDR displays.
- Mastering display metadata: primaries, white point, max luminance — needed for accurate HDR rendering.
- Gain map file path / variant filename — when WI-09 implements HDR AVIF delivery, the gain map will need its own derivative file.
- HDR AVIF variant filename — separate from the SDR base filename.

**Photographer risk:** When WI-09 ships, the schema will need a migration. If the migration is non-trivial (adding multiple columns, backfilling CLLI from originals), it may delay HDR delivery. The current schema comment at `schema.ts:57-62` acknowledges this deferral.

**Fix:**
- Add placeholder columns now (nullable, default null) so future migrations are additive only: `max_cll`, `max_fall`, `hdr_avif_filename`, `gain_map_filename`.
- Trade-off: Schema bloat. But nullable columns have near-zero storage cost in InnoDB.

---

### R11 — LOW: UI/encoder coupling via shared `COLOR_PIPELINE_DECISIONS` enum

| Field | Location |
|-------|----------|
| **File:Line** | `lib/color-pipeline-decisions.ts:22-30`, `lib/process-image.ts:436-470` |
| **Confidence** | Design observation — not a bug, but a coupling tension |

**The code:** The `ColorPipelineDecision` enum (`srgb`, `p3-from-displayp3`, etc.) is used by BOTH the encoder (`resolveColorPipelineDecision`) and the UI (`humanizeColorPipelineDecision` in i18n files, `isP3Pipeline` for download button labels).

**Photographer risk:** Tight coupling means a future encoder change (e.g., adding `p3-from-bt2100hlg` for HDR P3 delivery) requires simultaneous updates to:
1. The encoder resolver (`process-image.ts`)
2. The canonical enum (`color-pipeline-decisions.ts`)
3. i18n translations (`messages/en.json`, `messages/ko.json`)
4. The i18n smoke test (`__tests__/color-pipeline-decision-i18n.test.ts`)

If any step is missed, the UI shows an untranslated raw string to the photographer. The existing test coverage mitigates this, but the coupling tension remains.

**Fix:**
- No immediate fix required. The current architecture (centralized enum + exhaustive i18n test) is the right trade-off for a small team.
- For future scale: separate the encoder's internal decision model from the UI-facing label. The encoder could emit a structured object `{ gamut: 'srgb' | 'p3', source: 'displayp3' | 'dcip3' | ... }` and the UI maps that to labels.
- Trade-off: More code, more indirection. Not worth it at current scale.

---

## Summary Table

| ID | Severity | File:Line | Finding | Effort |
|----|----------|-----------|---------|--------|
| R1 | **CRITICAL** | `scripts/backfill-color-pipeline.ts:91-101` | Backfill ignores admin-configured encoder settings | Medium |
| R2 | **HIGH** | `lib/settings-hash.ts:59-67` | ETag hash reads raw DB values; encoder reads validated values | Medium |
| R3 | **HIGH** | `app/api/admin/lr/upload/route.ts:112-152` | Lightroom upload drops color signals (NCLX, HDR, gain map) | Medium |
| R4 | **HIGH** | `lib/data.ts:224,276-293` | `bit_depth` leaks to public queries | Low |
| R5 | **MEDIUM** | `lib/process-image.ts:60-86` | 10-bit AVIF probe permanently disabled on transient failure | Medium |
| R6 | **MEDIUM** | `lib/settings-hash.ts:29-39` | `image_sizes` omitted from ETag hash | Low |
| R7 | **MEDIUM** | `lib/serve-upload.ts:125` | 24-hour max-age delays color-fix visibility | Low |
| R8 | **MEDIUM** | `lib/process-image.ts:754,812` | Shared `image.clone()` across parallel format encodes | Medium |
| R9 | **LOW** | `scripts/backfill-color-pipeline.ts:185-200` | Backfill loads all rows into memory | Low |
| R10 | **LOW** | `db/schema.ts:64-72` | Schema lacks WI-09 HDR delivery columns | Low |
| R11 | **LOW** | `lib/color-pipeline-decisions.ts:22-30` | UI/encoder coupling via shared enum | Low (design) |

---

## Recommendations (Prioritized)

1. **Fix R1 (CRITICAL)** — Update backfill to read `getGalleryConfig()` and pass all tunable parameters to `processImageFormats`. Without this, every backfill run silently corrupts the photographer's delivery intent for existing images.

2. **Fix R3 (HIGH)** — Update Lightroom upload route to store and enqueue color signals, matching the browser upload path in `images.ts`. The Lightroom plugin is a first-class upload surface; it must not be a second-class citizen for color fidelity.

3. **Fix R2 (HIGH)** — Align `getColorSettingsHash()` with `getGalleryConfig()` so the ETag reflects validated, resolved settings. The ETag is a contract with the browser about what encoding produced the bytes; it must not lie.

4. **Fix R4 (HIGH)** — Add `bit_depth` to the public-select omit list and `_PrivacySensitiveKeys` guard. One-line fix.

5. **Fix R5 (MEDIUM)** — Add retry logic to the 10-bit AVIF probe, distinguishing expected failures (libheif missing) from transient errors (EIO, ENOSPC).

6. **Fix R8 (MEDIUM)** — Apply WI-14 fresh-instance pattern to ALL format encodes, not just rgb16. Eliminate shared-state risk entirely.

7. **Fix R6, R7 (MEDIUM/LOW)** — Add `image_sizes` to `COLOR_IMPACTING_KEYS`; consider reducing `max-age` for faster fix visibility.

8. **Fix R9 (LOW)** — Paginate backfill SELECT.

9. **Address R10 (LOW)** — Add nullable HDR preview columns to schema proactively.

10. **Accept R11** — Current coupling is managed well by tests. No action needed unless the decision enum grows beyond 10 values.

---

## Consensus Addendum

- **Antithesis (steelman):** The ETag/settings-hash architecture intentionally decouples the serving layer from the config layer to avoid a DB query per image request. Adding `getGalleryConfig()` to `serve-upload.ts` would introduce a DB dependency on the hot path. The 5-second TTL in `settings-hash.ts` already amortizes this, but `getGalleryConfig()` has its own (React `cache()`) semantics that may not interact cleanly with the debounced hash cache.
- **Tradeoff tension:** Correctness vs. performance. Resolving settings in the ETag path guarantees correctness but adds ~1-2ms latency per image on cold cache. For a gallery serving dozens of images per page, this adds up. The current architecture optimizes for speed at the cost of potential hash skew on invalid DB values.
- **Synthesis:** A middle path: keep the raw DB read in `settings-hash.ts` for speed, but add a startup validation that warns (or fails) if any `COLOR_IMPACTING_KEY` has an invalid raw value. This catches the divergence at deploy time rather than per-request.
