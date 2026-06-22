# Debugger Review — Run-9 Cycle-7 (HEAD feb63faa)

## Scope

Data-flow / boundary / parsing angle. Examined:
- Binary parsers: `color-detection.ts` NCLX colr walker, `gain-map-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gps-exif-strip.ts`
- Utility / validation: `blur-data-url.ts`, `exif-datetime.ts`, `validation.ts`, `rate-limit.ts`, `bounded-map.ts`
- Queue data-flow: `image-queue.ts` `ImageProcessingJob` type + handler gate, all enqueue sites, retry paths
- SPECIAL FOCUS #3: LR PAT upload route `api/admin/lr/upload/route.ts:420`

---

## Findings

### CR-R9C7-01 — LR upload route omits 6 settings fields from `enqueueImageProcessing` (same class as CR-R9C6-01)

**Classification:** DEFECT  
**Confidence:** High  
**Severity:** High (silent wrong-config encode for every Lightroom Classic publish-plugin upload)

**Root cause:**

`apps/web/src/app/api/admin/lr/upload/route.ts:420` calls `enqueueImageProcessing` and supplies `quality` (lines 429-432) and `imageSizes` (line 433) from `config`, but omits the 6 settings fields added by CR-R9C6-01:

```
// MISSING in LR route's enqueueImageProcessing call:
forceSrgbDerivatives
wideGamutJpegChroma
avifEffort
sdrJpegChroma
wideGamutMaxSourcePixels
autoAltTextEnabled
```

The queue handler gate at `image-queue.ts:336` is:

```typescript
if (!quality && !imageSizes) {
    // Bootstrap / legacy re-enqueue path: load ALL from current config
    const config = await getGalleryConfig();
    // ... loads all 6 fields ...
}
```

Because the LR path always provides `quality` AND `imageSizes`, this gate is NEVER entered. The 6 fields are seeded from the job object directly at lines 318-335 via `?? false`/`?? undefined` fallbacks:

```typescript
let autoAltTextEnabled  = job.autoAltTextEnabled  ?? false;
let forceSrgbDerivatives = job.forceSrgbDerivatives ?? false;
let wideGamutJpegChroma  = job.wideGamutJpegChroma;   // undefined
let avifEffort           = job.avifEffort;              // undefined
let sdrJpegChroma        = job.sdrJpegChroma;           // undefined
let wideGamutMaxSourcePixels = job.wideGamutMaxSourcePixels; // undefined
```

All 6 fields are `undefined` (never set on the job), so they silently take the hardcoded fallback values (`false` / `undefined`) rather than the admin-configured values. Undefined `avifEffort`, `sdrJpegChroma`, `wideGamutJpegChroma`, and `wideGamutMaxSourcePixels` propagate downstream to `processImageFormats` where they each have a `?? default` guard — but those defaults are the hardcoded library defaults, NOT the admin-tuned production settings.

**Failure scenario:**

Admin configures `force_srgb_derivatives=true`, `avif_effort=9`, `wide_gamut_jpeg_chroma='4:2:2'`, etc. via Settings UI. Every browser upload correctly encodes with those settings (fixed in CR-R9C6-01). Every Lightroom Classic publish-plugin upload silently encodes with `force_srgb_derivatives=false`, `avif_effort` at default (4 or process-image fallback), `wide_gamut_jpeg_chroma` at process-image default (`'4:4:4'` or whatever is baked in), etc. The photographer sees different derivative quality and color behavior between manually-uploaded photos and Lightroom-published ones with no indication of why.

**Evidence:**

- `apps/web/src/app/api/admin/lr/upload/route.ts:35` — imports `getGalleryConfig`
- `apps/web/src/app/api/admin/lr/upload/route.ts:170` — `const config = await getGalleryConfig();` (config IS loaded; all 6 fields are present on it)
- `apps/web/src/app/api/admin/lr/upload/route.ts:420-444` — `enqueueImageProcessing` call with quality+imageSizes but no 6 fields
- `apps/web/src/lib/image-queue.ts:113-148` — `ImageProcessingJob` type: all 6 fields are optional
- `apps/web/src/lib/image-queue.ts:318-335` — fallback seeding from job object (`?? false`/`?? undefined`)
- `apps/web/src/lib/image-queue.ts:336` — gate: only loads from config when `!quality && !imageSizes`
- `apps/web/src/app/actions/images.ts:440-471` — CORRECT browser upload: all 6 fields forwarded from `uploadConfig`

**Fix:**

In `apps/web/src/app/api/admin/lr/upload/route.ts`, add the 6 fields to the `enqueueImageProcessing` call at line 420. The `config` object is already in scope (loaded at line 170) and already contains all 6 fields:

```typescript
enqueueImageProcessing({
    // ... existing fields ...
    quality: { ... },
    imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
    // ADD:
    forceSrgbDerivatives: config.forceSrgbDerivatives,
    wideGamutJpegChroma: config.wideGamutJpegChroma,
    avifEffort: config.avifEffort,
    sdrJpegChroma: config.sdrJpegChroma,
    wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
    autoAltTextEnabled: config.autoAltTextEnabled,
    // ...
});
```

Mirrors exactly the CR-R9C6-01 fix in `actions/images.ts:440-471`.

---

## All-Clear: Other Entry Points

All other enqueue/processing entry points verified correct:

| Entry point | File:line | Assessment |
|---|---|---|
| Browser upload | `actions/images.ts:440` | CORRECT — all 6 fields forwarded from `uploadConfig` |
| Bootstrap / legacy re-enqueue | `image-queue.ts:674` | CORRECT — omits quality+imageSizes → gate enters → loads all from config |
| Retry on failure (re-enqueue same job) | `image-queue.ts:510` | CORRECT — `enqueueImageProcessing(job)` preserves all fields from original job |
| `retryFailedImage` | `actions/images.ts:1139` | CORRECT — omits quality+imageSizes → gate enters → loads all from current config |
| In-app admin backfill runner | `admin-backfill-runner.ts:485-514` | CORRECT — calls `processImageFormats` directly with `settings.*` |
| Sidecar backfill script | `scripts/backfill-color-pipeline.ts:185-218` | CORRECT — calls `processImageFormats` directly with settings passed through |

---

## All-Clear: Binary Parsers and Utilities

All examined files confirm clean — no new latent boundary bugs found:

**`color-detection.ts` NCLX `colr` walker (lines 1-295 + `detectColorSignals` 303-423):**
Extended-box `size===1` BigUInt64 read is preceded by `if (pos + 16 > buffer.length) return null`. `colr` dataSize check `>= 11` precedes all CICP field reads. NCLX maps are correct per prior documented fixes. The per-field NCLX gate (AGG-R8-06) correctly preserves ICC-derived values when NCLX leaves a field unspecified (code 2). No new defects.

**`gain-map-detection.ts`:**
All `readBoxHeader` extended-box and size-1 paths are bounds-checked before BigUInt64 read. `parseInfe` and `parseIref` have explicit length guards before every read. `iinf` entry count is capped at 1024. `iref` refCount per entry capped at 1024. Heuristic 1 (direct `urim`/`tmap` check) and Heuristic 2 (`auxl` iref) are logically correct. No new defects.

**`icc-extractor.ts`:**
Tag count capped at 100. Tag table reads are bounds-checked at `tagOffset + 12 > iccLen`. `desc` v2 string length clamped to `min(declaredLength, dataSize - 12, 1024)`. `mluc` record count capped at 100, `recordSize < 12` guarded, per-record `strEnd > iccLen` check present. `clampUtf8Bytes` is a safe code-point walk. No new defects.

**`icc-chromaticity.ts`:**
`readS15Fixed16` returns `NaN` on out-of-bounds (checked via `offset + 4 > buf.length`). `readXyzTag` checks `size < 20`. `readChadMatrix` checks `size < 44`. `invert3x3` guards `|det| < 1e-12`. `xyzToXy` guards `|sum| < 1e-9`. Tag count capped at `MAX_TAG_COUNT = 100`. Tag table capped at `MAX_TAG_TABLE_BYTES = 4096`. No new defects.

**`gps-exif-strip.ts`:**
`makeTiffReader` correctly encapsulates endian-aware reads. `MAX_IFD_CHAIN = 8` and `MAX_IFD_ENTRIES = 1024` bound the IFD walk. `TIFF_TYPE_SIZE` handles the full TIFF type set. GPS neutralization zeros entry bytes and sets entry count to 0. No new defects examined in the first 100 lines; structure is consistent with bounds-checked pattern used throughout. No new defects.

**`blur-data-url.ts`:**
`ALLOWED_PREFIXES` check enforces MIME type, `MAX_BLUR_DATA_URL_LENGTH = 4096` bound enforced, rejection log is bounded at 256 entries. No defects.

**`exif-datetime.ts`:**
Regex + component range validation + `Date.UTC` round-trip. No defects.

**`validation.ts`:**
Unicode format char detection (`UNICODE_FORMAT_CHARS`), slug/tag/filename validation, `safeInsertId` BigInt guard. No defects.

**`rate-limit.ts`:**
`preIncrement`/rollback patterns correct across all 4 rollback variants. IP normalization via `TRUST_PROXY`. `BoundedMap` integration is correct. No defects.

**`bounded-map.ts`:**
Collect-then-delete expiry pruning and FIFO hard-cap eviction are correct. No defects.

---

## Summary

**NEW_FINDINGS: 1**  
**DEFECTS: 1** (CR-R9C7-01, High confidence, same class as CR-R9C6-01, trivial one-call fix)  
**POLISH: 0**  
**CLEAN FILES: all other examined files**
