# Pipeline Architecture Review: Color Management System Design

**Reviewer:** Architect  
**Scope:** End-to-end data flow for color-accurate delivery  
**Date:** 2026-05-06  
**Codebase snapshot:** commit 02a3bcc (master)

---

## 1. End-to-End Data-Flow Diagram

```
                          COLOR SIGNAL FLOW
                          =================

  ┌──────────────┐
  │ Camera / RAW │  Embedded ICC profile (Display P3, Adobe RGB, ProPhoto, sRGB, ...)
  │   Editor     │  EXIF ColorSpace tag (1=sRGB, 65535=Uncalibrated)
  └──────┬───────┘  HEIF/AVIF nclx CICP box (primaries, transfer, matrix)
         │
         │  [A] Original file bytes (up to 200 MB)
         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  saveOriginalAndGetMetadata()                                       │
  │  apps/web/src/lib/process-image.ts:557-684                         │
  │                                                                     │
  │  1. Stream original to disk (data/uploads/original/)                │
  │  2. sharp(path, {failOn:'error', autoOrient:true})                  │
  │  3. metadata() → icc Buffer, depth string, exif Buffer              │
  │  4. extractIccProfileName(icc) → e.g. "Display P3"                 │
  │  5. resolveColorPipelineDecision(iccName) → e.g. "p3-from-displayp3"│
  │  6. detectColorSignals(path, image, metadata)                       │
  │     └─ parseCicpFromHeif() for HEIF/AVIF nclx box                  │
  │     └─ inferColorPrimaries / inferTransferFunction / inferMatrix    │
  │                                                                     │
  │  OUTPUT: {iccProfileName, colorPipelineDecision, colorSignals,      │
  │           bitDepth, blurDataUrl, width, height, exifData}           │
  └──────┬──────────────────────────────────────────────────────────────┘
         │
         │  [B] ColorSignals struct + ICC profile name
         │      color_primaries, transfer_function, matrix_coefficients, is_hdr
         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  uploadImages() server action                                       │
  │  apps/web/src/app/actions/images.ts                                 │
  │                                                                     │
  │  INSERT into images table:                                          │
  │    color_space, icc_profile_name, color_pipeline_decision,          │
  │    color_primaries, transfer_function, matrix_coefficients, is_hdr, │
  │    bit_depth, pipeline_version                                      │
  │                                                                     │
  │  Enqueue job → image-queue.ts                                       │
  └──────┬──────────────────────────────────────────────────────────────┘
         │
         │  [C] Job with iccProfileName for encode-time decisions
         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  processImageFormats()                                              │
  │  apps/web/src/lib/process-image.ts:693-884                         │
  │                                                                     │
  │  resolveAvifIccProfile(iccName) → 'p3' | 'p3-from-wide' | 'srgb'  │
  │                                                                     │
  │  Per format, per size:                                              │
  │  ┌─────────────────────────────────────────────────────────────┐    │
  │  │ AVIF:                                                       │    │
  │  │  wide-gamut? → pipelineColorspace('rgb16')                  │    │
  │  │             → .toColorspace('p3').withIccProfile('p3')      │    │
  │  │             → .avif({effort:6, bitdepth:10})                │    │
  │  │  sRGB?      → .toColorspace('srgb').withIccProfile('srgb') │    │
  │  │             → .avif({effort:6})                             │    │
  │  │                                                             │    │
  │  │  *** ICC profile embedded. NO CICP nclx box written. ***    │    │
  │  │  *** Sharp 0.34 avif() has no CICP signaling API.    ***    │    │
  │  ├─────────────────────────────────────────────────────────────┤    │
  │  │ WebP:                                                       │    │
  │  │  .toColorspace(targetIcc).withIccProfile(targetIcc)         │    │
  │  │  targetIcc = 'p3' when wide-gamut && !forceSrgbDerivatives  │    │
  │  ├─────────────────────────────────────────────────────────────┤    │
  │  │ JPEG:                                                       │    │
  │  │  .toColorspace(targetIcc).withIccProfile(targetIcc)         │    │
  │  │  wide-gamut → chromaSubsampling: '4:4:4'                    │    │
  │  └─────────────────────────────────────────────────────────────┘    │
  │                                                                     │
  │  OUTPUT: public/uploads/{avif,webp,jpeg}/<uuid>_<size>.<ext>       │
  │          ICC profile tag inside each file                           │
  │          NO CICP box in AVIF container                              │
  └──────┬──────────────────────────────────────────────────────────────┘
         │
         │  [D] On-disk files with embedded ICC tags
         │      ETag = W/"v{PIPELINE_VERSION}-{mtimeMs}-{size}"
         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  serveUploadFile()                                                  │
  │  apps/web/src/lib/serve-upload.ts:33-132                           │
  │                                                                     │
  │  Cache-Control: public, max-age=86400, must-revalidate             │
  │  ETag: W/"v5-1714987654321-245678"                                 │
  │  Content-Type: image/avif | image/webp | image/jpeg                │
  │  X-Content-Type-Options: nosniff                                   │
  │                                                                     │
  │  *** No Vary header. ***                                           │
  │  *** No X-Color-Pipeline debug header. ***                         │
  └──────┬──────────────────────────────────────────────────────────────┘
         │
         │  [E] HTTP response with ETag + Cache-Control
         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Service Worker (sw.js)                                             │
  │  apps/web/public/sw.js:1-266                                       │
  │                                                                     │
  │  stale-while-revalidate for /uploads/{avif,webp,jpeg}/*            │
  │  50 MB LRU cap (gk-images-{SW_VERSION})                            │
  │  Admin routes bypassed                                              │
  │                                                                     │
  │  *** Single cache bucket for ALL image formats/gamuts. ***         │
  │  *** No format-aware or gamut-aware partitioning.       ***        │
  └──────┬──────────────────────────────────────────────────────────────┘
         │
         │  [F] Cached or fresh response
         ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  <picture> element                                                  │
  │  apps/web/src/components/photo-viewer.tsx:397-422                   │
  │                                                                     │
  │  <source type="image/avif" srcSet="...avif sizes..." />            │
  │  <source type="image/webp" srcSet="...webp sizes..." />            │
  │  <img    src="jpeg_fallback" srcSet="...jpeg sizes..." />          │
  │                                                                     │
  │  *** No <source media="(dynamic-range: high)"> today. ***         │
  │  *** Browser picks format by type= support, then size. ***         │
  └──────┬──────────────────────────────────────────────────────────────┘
         │
         │  [G] Decoded pixels in browser compositor
         │      ICC profile → display color profile conversion
         ▼
  ┌──────────────┐
  │   Display    │  sRGB monitor: P3 gamut-clipped by browser
  │              │  P3 display: full P3 gamut rendered
  │              │  HDR display: SDR tone-mapped (no PQ/HLG signal)
  └──────────────┘
```

**Color signals that flow across each edge:**

| Edge | Signal present | Signal dropped or absent |
|------|---------------|--------------------------|
| A → B | ICC profile bytes, EXIF ColorSpace, nclx CICP box (HEIF/AVIF only) | Rendering intent (perceptual vs relative colorimetric) |
| B → C | `iccProfileName` string for encode decision | Full ICC profile bytes (not needed at encode time; Sharp re-reads from original) |
| C → D | ICC profile embedded in output file | CICP nclx box (Sharp 0.34 cannot write it); mastering display metadata; MaxCLL/MaxFALL |
| D → E | ETag encodes pipeline version; Content-Type set; ICC inside file bytes | No `Vary` header; no debug header; no color-pipeline provenance header |
| E → F | Stale-while-revalidate cache keyed by URL | No gamut-aware cache partition; no HDR/SDR split |
| F → G | Browser reads embedded ICC from decoded file; `type=` triggers format selection | No `(dynamic-range: high)` media query; no HDR source variant |
| G → display | Browser performs ICC-to-display profile conversion | HDR tone curve not signaled; display cannot engage HDR composition mode |

**Key invariant:** The pipeline currently guarantees that every delivered derivative contains a correct embedded ICC profile (either sRGB or Display P3). This is the irreducible color-accuracy contract and MUST be preserved through any HDR extension.

---

## 2. Schema Design for HDR

### Current State

The schema already contains the HDR foundation columns, added under US-CM04 (`schema.ts:63-68`):

| Column | Type | Current Usage |
|--------|------|---------------|
| `color_primaries` | `varchar(32)` | Populated at upload via `detectColorSignals()` |
| `transfer_function` | `varchar(16)` | Populated at upload; 'pq'/'hlg' for HDR sources |
| `matrix_coefficients` | `varchar(16)` | Populated at upload |
| `is_hdr` | `boolean NOT NULL DEFAULT false` | Set true when transfer is PQ or HLG |
| `color_pipeline_decision` | `varchar(64)` | Audit trail of encode-time gamut decision |
| `pipeline_version` | `int` | Set to `IMAGE_PIPELINE_VERSION` on successful processing |

### Proposed Additions for Full HDR

```
mastering_display_primaries  VARCHAR(128)  NULL   -- "R(0.680,0.320)G(0.265,0.690)B(0.150,0.060)WP(0.3127,0.3290)"
mastering_display_luminance  VARCHAR(32)   NULL   -- "min=0.0050,max=1000"
max_cll                      INT UNSIGNED  NULL   -- Maximum Content Light Level (nits)
max_fall                     INT UNSIGNED  NULL   -- Maximum Frame-Average Light Level (nits)
hdr_variant_generated        BOOLEAN       NOT NULL DEFAULT false
hdr_pipeline_version         INT           NULL   -- separate version for HDR encode path
```

**Design rationale:**

- `mastering_display_primaries` as VARCHAR(128): The SMPTE ST 2086 primaries are six decimal pairs plus a white point. A compact string is queryable, human-readable, and avoids a 14-column float explosion. Not indexable, but mastering metadata is display-only, never filtered.
- `max_cll` and `max_fall` as INT UNSIGNED: These are integer nit values per CTA-861.3. Indexable if a future smart-collection query needs "HDR photos above 1000 nits."
- `hdr_variant_generated` as BOOLEAN: Decouples HDR detection (upload-time) from HDR encode (pipeline-time). The pipeline can detect HDR sources now but cannot encode HDR AVIF until Sharp or an alternative encoder gains CICP support. This flag prevents the photo-viewer from attempting to fetch a non-existent `_hdr.avif` variant.
- `hdr_pipeline_version` as separate INT: HDR encode will evolve on a different cadence than the SDR pipeline. Coupling them into a single `IMAGE_PIPELINE_VERSION` would force SDR revalidation on every HDR encoder tweak.

**Migration strategy:**

All proposed columns are nullable with defaults. A standard `ALTER TABLE images ADD COLUMN` migration is backward-compatible: existing rows get NULL/false, existing code ignores the columns, and the Drizzle schema diff generates the migration automatically. No data backfill is required because the columns are only populated by future HDR encode jobs.

**De-duplication of `color_space` vs `icc_profile_name`:**

These serve different purposes and should both be retained:

- `color_space` (`schema.ts:45`): Stores the EXIF tag 0xA001 value (1=sRGB, 65535=Uncalibrated). This is what the camera wrote and is useful for EXIF display in the info sidebar.
- `icc_profile_name` (`schema.ts:46`): Stores the parsed ICC profile description string (e.g., "Display P3"). This is the actual source-of-truth for the encode pipeline's gamut decision (`resolveAvifIccProfile` at `process-image.ts:468`).
- `color_primaries` (`schema.ts:64`): Stores the CICP-equivalent canonical enum ('bt709', 'p3-d65', etc.). This is the machine-readable version of the ICC name, derived by `inferColorPrimaries()` at `color-detection.ts:37`.

The triad is not redundant: `color_space` is EXIF provenance, `icc_profile_name` is ICC provenance, and `color_primaries` is the canonical machine enum. Collapsing any two would lose information or break the display/encode boundary.

---

## 3. Pipeline-Version-Bump Cadence

### Current Mechanism

`IMAGE_PIPELINE_VERSION` is a single integer (`process-image.ts:107`, currently 5). It appears in three places:

1. **ETag formula** (`serve-upload.ts:97`): `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}"`. A bump invalidates every cached variant for every image across every CDN edge and every browser.
2. **DB marker** (`image-queue.ts:340`): `pipeline_version` column is set on successful processing, enabling backfill queries ("find images processed with version < N").
3. **Service worker** (`sw.js:17`): `SW_VERSION` is a separate build-time hash, not coupled to the pipeline version. Cache names are `gk-images-{SW_VERSION}`, so a SW deploy purges old caches independently.

### Analysis

The single-version approach is correct for a personal gallery at current scale (hundreds to low-thousands of images). The revalidation cost of a bump is:

- **Browser:** One conditional GET per image per visitor session (304 response, ~200 bytes). At 100 images viewed per session, this is ~20 KB of overhead per visitor after a bump.
- **CDN edge:** `max-age=86400` means edges re-fetch within 24 hours regardless. The ETag bump just makes the first post-bump request a cache miss instead of a stale hit.
- **Service worker:** stale-while-revalidate means the user sees the old image immediately and gets the new one on the next visit. No visible flash.

### Recommendation: Per-Format Version (Medium Priority)

Split into three version components with a composite ETag:

```
PIPELINE_VERSION_AVIF = 3
PIPELINE_VERSION_WEBP = 2
PIPELINE_VERSION_JPEG = 2
```

ETag becomes: `W/"a3w2j2-{mtimeMs}-{size}"` where the prefix encodes per-format versions.

**Rationale:** The most likely future bumps are AVIF-only (10-bit to 12-bit, effort tuning, CICP addition). Under the current scheme, a JPEG viewer on an old Android browser that never decodes AVIF would still pay the revalidation cost. Per-format versioning confines the blast radius.

**Trade-off:** Three constants to maintain instead of one. The `serve-upload.ts` handler already knows the format from `DIR_EXTENSION_MAP` (`serve-upload.ts:14-17`), so routing to the correct version component is trivial. The DB `pipeline_version` column should remain a single value (the max of all format versions) for backfill simplicity.

A per-gamut split (sRGB vs P3 vs HDR) is not worth the complexity. Gamut changes are coupled to format changes in practice (P3 is only meaningful in AVIF/WebP, not JPEG-on-old-browsers), so per-format versioning already captures the gamut dimension.

---

## 4. Variant URL Convention for HDR

### Current Convention

Variants follow `<uuid>_<size>.<ext>` naming (`process-image.ts:745`):

```
/uploads/avif/a1b2c3d4_640.avif
/uploads/avif/a1b2c3d4_2048.avif
/uploads/webp/a1b2c3d4_640.webp
/uploads/jpeg/a1b2c3d4_640.jpg
```

The base filename (no size suffix) is a hard link to the largest configured size (`process-image.ts:853`).

### Proposed HDR Convention

**Option A: Suffix-based (recommended)**
```
/uploads/avif/a1b2c3d4_2048_hdr.avif
```

This is consistent with the existing `_<size>` suffix convention and does not require new directories. The `_hdr` suffix comes after `_<size>` to maintain the `<uuid>_<size>` prefix as a stable sort key for filesystem listing.

**Option B: Separate directory**
```
/uploads/avif-hdr/a1b2c3d4_2048.avif
```

This would require adding `'avif-hdr'` to `ALLOWED_UPLOAD_DIRS` (`serve-upload.ts:8`) and `DIR_EXTENSION_MAP` (`serve-upload.ts:14`), creating a new `UPLOAD_DIR_AVIF_HDR` constant, and updating `deleteImageVariants()` to clean up the additional directory.

**Analysis:**

Option A is strongly preferred. The `SAFE_SEGMENT` regex (`serve-upload.ts:9`: `/^[a-zA-Z0-9._-]+$/`) already allows underscores, so `_hdr` passes validation without changes. No new directory constants, no new cleanup paths, no new `ensureDirs()` entry. The `isImageDerivative()` check in `sw-cache.ts:71` (`pathname.startsWith('/uploads/avif/')`) matches both SDR and HDR variants in the same directory.

The photo-viewer already constructs HDR filenames via this pattern (`photo-viewer.tsx:213`):
```typescript
const hdrAvifFilename = image?.filename_avif
    ? image.filename_avif.replace(/\.avif$/i, '_hdr.avif')
    : null;
```

This confirms the codebase has already committed to suffix-based HDR naming.

**WebP and JPEG:** No HDR variants are possible. WebP lacks PQ/HLG support entirely. JPEG has no 10-bit or HDR transfer curve capability. HDR is AVIF-only in the foreseeable future. The architecture should not reserve namespace for formats that cannot carry the signal.

---

## 5. `<picture>` Source-Order Strategy

### Current Source Order (`photo-viewer.tsx:398-422`)

```html
<picture>
  <source type="image/avif" srcSet="...all sizes..." sizes="..." />
  <source type="image/webp" srcSet="...all sizes..." sizes="..." />
  <img    src="jpeg_fallback"  srcSet="...all sizes..." sizes="..." />
</picture>
```

Browser picks the first `<source>` whose `type=` it supports, then selects the size from `srcSet`. No `media=` queries are used.

### Proposed HDR Extension

```html
<picture>
  <source media="(dynamic-range: high)" type="image/avif"
          srcSet="...HDR AVIF sizes..." sizes="..." />
  <source type="image/avif" srcSet="...SDR P3/sRGB AVIF sizes..." sizes="..." />
  <source type="image/webp" srcSet="...WebP sizes..." sizes="..." />
  <img    src="jpeg_fallback" srcSet="...JPEG sizes..." sizes="..." />
</picture>
```

### Browser-Cache Implications

Adding the HDR `<source>` does NOT break existing variant caches. The `<picture>` element selects by URL, not by content negotiation. Each URL (`_2048_hdr.avif` vs `_2048.avif`) is a distinct cache entry. There is no `Accept` header variation; the browser fetches the URL it chose. Existing AVIF/WebP/JPEG cache entries remain valid and are still served to SDR visitors.

### Memory Implications on iOS Safari

This is the most significant architectural risk in the HDR extension. A 10-bit AVIF at 4096px wide with a 3:2 aspect ratio requires:

```
4096 x 2731 x 4 bytes (RGBA) x 2 (10-bit → 16-bit backing) = ~89 MB decoded
```

On a 4 GB RAM iPhone (iPhone SE 3rd gen, iPhone 14), Safari's per-tab memory budget is approximately 200-350 MB. Two such images in the decode pipeline (current image + prefetched next) would consume ~180 MB, leaving minimal headroom for the DOM, JavaScript heap, and compositor.

**Recommendation:** Cap HDR variant generation at `2048` max width regardless of the admin-configured `image_sizes` list. The 4096-wide size should only be generated for SDR variants. This limits decoded memory to ~22 MB per HDR image, which is safe on all current iOS devices. The `<source media="(dynamic-range: high)">` srcSet should only list sizes up to 2048.

This cap is enforced at encode time (in `processImageFormats`), not at `<picture>` render time. The photo-viewer should not need to know the cap; it should list whatever HDR sizes exist on disk.

---

## 6. Service-Worker Cache Partitioning

### Current State (`sw.js:17-21`)

```javascript
const IMAGE_CACHE = 'gk-images-' + SW_VERSION;  // single bucket
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;        // 50 MB LRU
```

All AVIF, WebP, and JPEG derivatives share a single 50 MB LRU cache. Eviction is by least-recently-used timestamp.

### Impact of HDR Variants

HDR AVIF files are 10-bit and typically 20-40% larger than their 8-bit SDR counterparts at the same quality setting. For a 2048-wide HDR AVIF at quality 85, expect 800 KB-1.5 MB per file vs 500 KB-1 MB for SDR AVIF.

If an HDR-capable visitor browses 20 photos with HDR variants, the cache fills with ~30 MB of HDR AVIFs alone, leaving only 20 MB for SDR variants and JPEG fallbacks. LRU eviction would quickly flush the SDR entries, which are the ones most likely to be needed on the next visit (since most visitors have SDR displays).

### Recommendation: Pass-Through for HDR (Low Priority)

HDR variants should bypass the service worker image cache entirely. Add a path check in `sw.js`:

```
if (pathname.includes('_hdr.')) return;  // pass through to network
```

**Rationale:** HDR-capable displays are a small minority of visitors. HDR files are large. The stale-while-revalidate strategy provides no UX benefit for HDR that a standard browser HTTP cache (with ETag) does not already provide. The 50 MB cap does not need raising.

**Trade-off:** HDR visitors lose the offline-first benefit of the service worker cache. For a photo gallery (not a productivity app), offline HDR viewing is not a meaningful use case. The standard browser HTTP cache with `max-age=86400` and ETag validation provides adequate caching for HDR assets.

---

## 7. CDN Compatibility

### Current Headers (`serve-upload.ts:106-118`)

```
Cache-Control: public, max-age=86400, must-revalidate
ETag: W/"v5-{mtimeMs}-{size}"
Content-Type: image/avif | image/webp | image/jpeg
X-Content-Type-Options: nosniff
```

No `Vary` header is set. This is correct.

### Analysis

The `<picture>` element performs URL-based selection, not content negotiation. The browser requests `/uploads/avif/uuid_2048.avif` directly; it does not send `Accept: image/avif` and expect the server to vary the response. Each URL returns exactly one format, so `Vary: Accept` is unnecessary and would be actively harmful (it would cause CDN cache fragmentation with no benefit).

With HDR variants at separate URLs (`_hdr.avif`), the same analysis applies. No `Vary` header is needed.

The ETag formula is CDN-safe: it is deterministic (same version + same file = same ETag), `must-revalidate` ensures edges check in, and the weak validator prefix (`W/`) correctly signals semantic equivalence. The only CDN concern is that some providers (Cloudflare in particular) strip weak ETags on compressed responses, but image files are not gzip-compressed, so this does not apply.

---

## 8. Observability Surfaces

### Current State

- `color_pipeline_decision` column (`schema.ts:53`, `process-image.ts:385-438`): Records the gamut mapping decision per image. Values like `p3-from-displayp3`, `srgb-from-adobergb`, `srgb-from-unknown` enable SQL queries like "what percentage of uploads are wide-gamut?"
- `pipeline_version` column (`schema.ts:69`): Enables "how many images are on version < current?"

### Gaps

1. **No per-request debug header.** When a photographer suspects incorrect color, there is no way to verify the pipeline decision without querying the database. A response header like `X-Color-Pipeline: p3-from-displayp3;v5` on image responses would make this debuggable from browser DevTools.

2. **No aggregate distribution surface.** The `color_pipeline_decision` column supports ad-hoc SQL, but there is no dashboard endpoint or admin UI widget showing the distribution. A `GET /api/admin/color-stats` returning `{srgb: 450, "p3-from-displayp3": 38, "srgb-from-adobergb": 12, "srgb-from-unknown": 5}` would be trivial and high-value.

3. **No HDR detection rate tracking.** The `is_hdr` boolean is stored but not surfaced. The admin dashboard should show "N HDR sources detected, M HDR variants generated" once HDR encoding is implemented.

### Recommendations (Prioritized)

1. **Debug header on image responses** (Low effort, High impact): In `serve-upload.ts`, query `color_pipeline_decision` and `pipeline_version` from the DB by filename, add `X-Color-Pipeline: {decision};v{version}` to the response. Concern: this adds a DB query per image request. Mitigation: only emit the header when a `?debug=color` query param is present, or behind an admin cookie check. Alternative: embed the pipeline decision in the filename itself (`uuid_2048_p3.avif`) but this conflicts with existing URL conventions.

2. **Admin color-stats endpoint** (Low effort, Medium impact): `SELECT color_pipeline_decision, COUNT(*) FROM images WHERE processed = true GROUP BY color_pipeline_decision`. Add to the existing admin settings/dashboard page.

3. **Sampling rate for production logging** (Not needed at current scale): A personal gallery processes images in single digits per session. Console logging at `process-image.ts` already covers every encode decision. Structured logging with sampling rates is over-engineering for this topology.

---

## 9. Rollback Architecture

### Current Contract

The pipeline version is write-once per image processing job (`image-queue.ts:340`):
```typescript
.set({ processed: true, pipeline_version: IMAGE_PIPELINE_VERSION })
```

Schema migrations are additive (nullable columns with defaults). The Drizzle migration system generates forward-only DDL. There is no explicit rollback migration mechanism.

### Rollback Procedure for Encoder Behavior Change

1. **Revert the code** (git revert the commit that changed encoder behavior). This decrements `IMAGE_PIPELINE_VERSION` or reverts the encode parameters.
2. **Deploy.** The new (reverted) `IMAGE_PIPELINE_VERSION` is now lower than the version stored in the DB for recently-processed images. However, the ETag formula in `serve-upload.ts:97` uses the runtime constant, not the per-image DB value. So the ETag changes immediately, forcing cache revalidation to fetch the same (unchanged) file from disk. This is a no-op from the browser's perspective: the file bytes are unchanged, only the ETag is different.
3. **Re-process affected images.** Query `SELECT id FROM images WHERE pipeline_version > {REVERTED_VERSION}`. Mark them as `processed = false` and restart the queue. The queue re-encodes from originals with the reverted parameters.

### Backward-Compatibility Guarantee

Schema migrations are backward-compatible by construction: all HDR columns are nullable with defaults, and no existing column is renamed or dropped. A rollback to pre-HDR code simply ignores the new columns (Drizzle reads only the fields listed in `adminSelectFields`/`publicSelectFields` at `data.ts:185-314`).

The one risk is the `hdr_pipeline_version` column proposed in Section 2. If the HDR encoder writes this value and then the code is rolled back to a version that does not know about `hdr_pipeline_version`, the column becomes orphaned but harmless. A re-deploy of the HDR code would resume writing to it. No data corruption is possible because the column has no foreign-key or NOT NULL constraint.

### Trade-off

The re-processing step is the expensive part. For a 5000-image gallery at QUEUE_CONCURRENCY=1 with AVIF effort:6, full re-encode takes approximately 8-12 hours. The `pipeline_version` column enables partial re-processing (only images at the broken version), which bounds the blast radius.

---

## 10. Architectural Risks

### Sharp / libvips API Limits for CICP Signaling

This is the single blocking constraint for HDR delivery.

**Current state** (`process-image.ts:799-806`): Sharp 0.34.5 (`package.json:63`) exposes `.avif({quality, effort, bitdepth})` but has no parameter for CICP nclx box signaling. The libvips `heif_save` operation (which Sharp wraps) passes through to libheif, which does support nclx writing via `heif_image_set_nclx_color_profile()`. But Sharp does not expose this API.

**Implications:** The pipeline can detect HDR sources (PQ/HLG transfer function via `detectColorSignals` at `color-detection.ts:222-282`) and store the metadata in the DB, but it cannot encode an AVIF file that tells the browser "render this with PQ tone mapping." The browser will decode the ICC profile (which is sRGB or P3) and render SDR. The HDR information is lost at the encode boundary.

**US-CM12 deferral comment** (`schema.ts:58-63`): The codebase explicitly acknowledges this limitation:
> "Sharp 0.34.5 does not expose CICP signaling in the avif() encoder API, so PQ/HLG transfer functions cannot be written into AVIF CICP boxes."

### Option C: Shell Out to aomenc / libavif

**Feasibility:** Operationally feasible but architecturally invasive.

- `aomenc` (libaom CLI encoder) supports `--color-primaries`, `--transfer-characteristics`, `--matrix-coefficients` flags for CICP signaling. The output is a raw AV1 bitstream that must be muxed into an AVIF container via `mp4box` or `avifenc`.
- `avifenc` (libavif CLI) directly produces AVIF files with `--cicp` flags and supports 10/12-bit encoding with PQ/HLG transfer.

**Impact on queue worker concurrency:**

The current pipeline spawns Sharp's internal libvips thread pool for AVIF/WebP/JPEG in parallel (`process-image.ts:880`). Shelling out to `avifenc` for the HDR variant would add a fourth concurrent child process per image. At `QUEUE_CONCURRENCY=1` and `sharpConcurrency` tuned to `Math.max(1, floor((cpuCount-1)/3))` (`process-image.ts:26`), this would exceed the CPU budget by ~33%.

**Recommendation:** If Option C is pursued, the HDR encode should be serialized after the SDR encode completes (not parallel with it). The HDR variant is a supplementary asset, not a replacement. Its generation can be deferred to a lower-priority queue or a separate `QUEUE_CONCURRENCY_HDR` setting.

**Alternative:** Wait for Sharp to expose CICP signaling. The libvips `heifsave` operation already forwards nclx parameters to libheif; the missing piece is a Sharp JS binding for those parameters. This is tracked upstream and is the cleanest architectural path.

**Trade-off table:**

| Approach | Correctness | Operational complexity | Timeline risk |
|----------|------------|----------------------|---------------|
| Wait for Sharp CICP API | Perfect (when available) | Zero (no new dependencies) | Unknown; depends on Sharp maintainer |
| Shell out to avifenc | Full CICP control | Medium (new binary dependency, Docker image change, error handling) | Immediate (avifenc is stable) |
| libavif Node.js binding | Full CICP control | High (native addon compilation, Docker build changes) | Medium (binding maturity varies) |
| Encode HDR as HEIF instead of AVIF | Possible via Sharp's existing heif pipeline | Low | Browser support for HEIF HDR is poor |

---

## References

- `apps/web/src/lib/process-image.ts:107` -- `IMAGE_PIPELINE_VERSION = 5`
- `apps/web/src/lib/process-image.ts:385-438` -- `ColorPipelineDecision` type and `resolveColorPipelineDecision()`
- `apps/web/src/lib/process-image.ts:440-496` -- `resolveAvifIccProfile()` decision matrix
- `apps/web/src/lib/process-image.ts:498-555` -- `extractIccProfileName()` ICC parser
- `apps/web/src/lib/process-image.ts:557-684` -- `saveOriginalAndGetMetadata()` upload-time detection
- `apps/web/src/lib/process-image.ts:693-884` -- `processImageFormats()` encode pipeline
- `apps/web/src/lib/process-image.ts:39-77` -- High-bitdepth AVIF probe singleton
- `apps/web/src/lib/process-image.ts:18-32` -- Sharp concurrency tuning (CPU / 3 format fan-out)
- `apps/web/src/lib/color-detection.ts:16-27` -- `ColorSignals` interface
- `apps/web/src/lib/color-detection.ts:37-49` -- `inferColorPrimaries()`
- `apps/web/src/lib/color-detection.ts:56-90` -- `inferTransferFunction()` (PQ/HLG detection)
- `apps/web/src/lib/color-detection.ts:151-214` -- `parseCicpFromHeif()` ISOBMFF nclx walker
- `apps/web/src/lib/color-detection.ts:222-282` -- `detectColorSignals()` top-level detector
- `apps/web/src/lib/serve-upload.ts:8` -- `ALLOWED_UPLOAD_DIRS` (jpeg, webp, avif)
- `apps/web/src/lib/serve-upload.ts:14-17` -- `DIR_EXTENSION_MAP` format-to-extension whitelist
- `apps/web/src/lib/serve-upload.ts:92-97` -- ETag formula with pipeline version
- `apps/web/src/lib/serve-upload.ts:106-118` -- Cache-Control and response headers
- `apps/web/src/lib/sw-cache.ts:12-13` -- `IMAGE_CACHE_NAME`, `MAX_IMAGE_CACHE_BYTES`
- `apps/web/src/lib/sw-cache.ts:66-78` -- `isImageDerivative()` path matcher
- `apps/web/public/sw.js:17-21` -- SW cache name and byte cap
- `apps/web/public/sw.js:85-112` -- `recordAndEvict()` LRU implementation
- `apps/web/public/sw.js:135-166` -- `staleWhileRevalidateImage()` fetch strategy
- `apps/web/src/db/schema.ts:19-94` -- `images` table definition
- `apps/web/src/db/schema.ts:45-46` -- `color_space` and `icc_profile_name` columns
- `apps/web/src/db/schema.ts:53` -- `color_pipeline_decision` column
- `apps/web/src/db/schema.ts:63-69` -- HDR foundation columns (US-CM04)
- `apps/web/src/lib/data.ts:185-232` -- `adminSelectFields` (includes all color columns)
- `apps/web/src/lib/data.ts:287-314` -- `publicSelectFields` derivation
- `apps/web/src/lib/data.ts:213-217` -- Color columns in admin select
- `apps/web/src/components/photo-viewer.tsx:397-422` -- `<picture>` element construction
- `apps/web/src/components/photo-viewer.tsx:213-214` -- HDR filename construction
- `apps/web/src/components/photo-viewer.tsx:216-226` -- HDR variant existence check (HEAD request)
- `apps/web/src/components/photo-viewer.tsx:816-866` -- Color details UI section
- `apps/web/src/app/api/og/photo/[id]/route.tsx:38-46` -- `postProcessOgImage()` ICC-tagged JPEG
- `apps/web/src/app/api/og/photo/[id]/route.tsx:32` -- `WIDE_GAMUT_PRIMARIES` constant
- `apps/web/src/lib/image-queue.ts:312-322` -- `processImageFormats()` call with `forceSrgbDerivatives`
- `apps/web/src/lib/image-queue.ts:340` -- `pipeline_version` write on successful processing
- `apps/web/src/lib/gallery-config-shared.ts:34-36` -- `force_srgb_derivatives` setting
- `apps/web/package.json:63` -- Sharp ^0.34.5
