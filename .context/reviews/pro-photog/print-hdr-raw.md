# Pro-photog review: print, HDR, RAW

Reviewer lens: working professional photographer, color-critical print + HDR + RAW workflows. Color-management aggregate (`.context/reviews/color-mgmt/_aggregate.md`) findings already shipped — this review surfaces what is STILL missing for production-grade output.

Scoping note: severity uses **PRO-CRIT / PRO-HIGH / PRO-MED / PRO-LOW** to distinguish from the color-mgmt aggregate; "confidence" reflects how certain I am the failure occurs in production today (HIGH = code reads + format spec confirm; MEDIUM = behavior is implementation-dependent; LOW = depends on photographer-specific monitor/printer chain).

Files audited: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/app/api/download/[imageId]/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/scripts/backfill-p3-icc.ts`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/__tests__/process-image-*.test.ts`.

---

## Findings index

| ID | Title | Severity | Confidence |
|----|-------|----------|------------|
| PP-1  | DPI / pixel density never written on derivatives or download | PRO-HIGH | HIGH |
| PP-2  | No output sharpening after downscale resize | PRO-HIGH | HIGH |
| PP-3  | Apple gain-map / ISO 21496-1 HDR is silently discarded on every encode | PRO-HIGH | HIGH |
| PP-4  | RAW allowlist locks out Canon / Nikon / Fuji / Olympus / Pentax / Panasonic | PRO-HIGH | HIGH |
| PP-5  | RAW (`.arw`) is allowed but libraw is NOT compiled into the runtime — silent failure | PRO-CRIT | HIGH |
| PP-6  | `/api/download/[imageId]` is paid-tier-only — no free / share / admin full-res download path | PRO-HIGH | HIGH |
| PP-7  | `autoOrient: true` strips Sharp's native orientation handling but `original_width/height` in DB are post-rotate, not source — RAW/HEIC orientation lookups break | PRO-MED | MEDIUM |
| PP-8  | CMYK input has no defined behavior — `.tiff` extension allowed, no toColorspace path covers CMYK | PRO-HIGH | HIGH |
| PP-9  | Wider-than-P3 sources are gamut-clipped to sRGB with no Rec.2020 / Adobe RGB output path | PRO-MED | HIGH |
| PP-10 | Backfill is not resumable / not idempotent against partial failure mid-image | PRO-HIGH | HIGH |
| PP-11 | EXIF camera/lens metadata stripped from every derivative — no curated subset preserved | PRO-MED | HIGH |
| PP-12 | DPR-aware delivery: `srcset` is width-descriptor-only, no `x` densities for 3× phones | PRO-MED | MEDIUM |
| PP-13 | 16-bit TIFF download path: serves original byte-for-byte (good) but no print-tier re-emit | PRO-LOW | HIGH |
| PP-14 | Soft-proofing canvas (FOGRA39 / GRACoL) — not implemented, opportunistic | PRO-LOW | HIGH |
| PP-15 | ICC v4 vs v2 round-trip emitted by `withIccProfile()` is undocumented in tests | PRO-LOW | MEDIUM |
| PP-16 | HEIC `.heic/.heif` allowed but Dockerfile does not pin libheif support — depends on libvips build flags | PRO-HIGH | MEDIUM |
| PP-17 | No JPEG progressive / mozjpeg-quality knob — print labs occasionally reject baseline quality < 90 | PRO-LOW | HIGH |
| PP-18 | No raw-pipeline preview (Sharp's `.raw().tiff()` for camera-original development) | PRO-LOW | HIGH |
| PP-19 | `metadata.depth = 'float'` from 32-bit float TIFF (e.g., HDR retouching scratch) returns 32 in `bit_depth` column — misleading for print spec checks | PRO-LOW | MEDIUM |
| PP-20 | EXIF `XResolution` / `YResolution` / `ResolutionUnit` not extracted into DB — print labs that auto-validate uploads have no ground truth | PRO-MED | HIGH |

---

## PRO-CRIT

### PP-5 — RAW upload (`.arw`) is allowed but libraw is NOT compiled into the runtime

**Files**
- `apps/web/src/lib/process-image.ts:71-73` — `.arw` in `ALLOWED_EXTENSIONS`
- `apps/web/src/components/upload-dropzone.tsx:163` — `.arw` advertised in dropzone accept list
- `apps/web/Dockerfile:1-51` — installs Sharp prebuilt via `@img/sharp-libvips-linux-${TARGETARCH}`. The `@img/sharp-libvips-*` prebuilts ship a pinned libvips that does NOT link libraw. There is no `apt-get install libraw20 libraw-dev` step, no `--build-from-source` for sharp, no `SHARP_FORCE_GLOBAL_LIBVIPS=1` env var.
- Confirmed in `package-lock.json:6418-6427` that the `@img/sharp-libvips-*` prebuilt families are the ONLY libvips source.

**Issue.** Per the libvips upstream build matrix, the prebuilt `@img/sharp-libvips-*` binaries (1.2.4 in this lockfile) are compiled WITHOUT libraw support. Sharp's "RAW" support depends on the underlying libvips having been built `--with-libraw`. When a Sony A7R V `.arw` upload hits `sharp(originalPath, { ..., autoOrient: true })` at `process-image.ts:451`, libvips will reject it with `unable to load <file>: unknown file format`.

The pre-flight UX promises `.arw` works (advertised in the dropzone). The post-upload reality is that:
1. The original is saved to disk fine (stream pipe at line 437-439).
2. The first call to `image.metadata()` at line 455 throws.
3. The catch at line 456-460 throws a generic `'Invalid image file. Could not process the file as an image.'` with NO hint about RAW support.
4. The `.arw` file remains orphaned in `UPLOAD_DIR_ORIGINAL` because the unlink at 458 happens, BUT if it didn't (e.g., a different code path or a rename race), it'd be a 50-150 MB file with no derivative.

The error is NOT user-actionable. The photographer thinks they hit a server bug, not "this server can't decode RAW".

**Photographer-facing failure.** Sony shooter uploads a wedding shoot directly from the field via the Lightroom plugin (the `/api/admin/lr/upload` route accepts the same File and runs the same `saveOriginalAndGetMetadata`). 200 ARW files. Every single one fails with "Invalid image file." Photographer rolls back to JPEG-only, loses two hours of evening time, and now has zero confidence in the upload pipeline. They never test ARW again.

**Severity.** PRO-CRIT because the feature is advertised and silently broken. Confidence HIGH (code reads + libvips prebuilt manifest + Sharp upstream documentation are unanimous).

**Fix.**

Two paths:

1. **Remove the lie (cheapest).** Drop `.arw` from `ALLOWED_EXTENSIONS` and the dropzone accept list. Add a clear error message in the action layer: `"RAW files are not supported. Export to TIFF or JPEG from your editor."` — same UX as Smugmug, Pixieset, Cloudinary's free tier.

2. **Add real RAW support.** Bump Dockerfile to `apt-get install -y --no-install-recommends libraw20 libraw-dev libgomp1 libimagequant0 libwebpdemux2 libheif1 libde265-0` plus the libvips build deps, and switch sharp install to `npm install --build-from-source --workspace=apps/web sharp` (after `SHARP_FORCE_GLOBAL_LIBVIPS=1` and a global libvips compiled with `--with-libraw --with-heif`). Cost: ~10 min added build time, ~80 MB more in the image. Benefit: every `.cr2/.cr3/.nef/.dng/.orf/.pef/.raf/.rw2` is also free since libraw covers them all.

Option 2 unlocks PP-4 too. Option 1 is the honest 1-line fix.

If keeping option 2, ALSO emit the camera-correct demosaic profile (libraw default is "Adobe Standard" — pros want "Camera Standard" or DCP). Sharp doesn't expose that knob; the pipeline would need a pre-pass via `dcraw_emu` or `libraw`'s C bindings. Out of scope for this review but flag the gap.

---

## PRO-HIGH

### PP-1 — DPI / pixel density never written on derivatives or download

**Files**
- `apps/web/src/lib/process-image.ts:617-661` — every encode chain (`webp`, `avif`, `jpeg`) lacks `.withMetadata({ density: <N> })` or any equivalent.
- `apps/web/src/app/api/download/[imageId]/route.ts:181-204` — full-res download streams the original byte-for-byte, so the original DPI is preserved, BUT only on the paid-tier endpoint. There is no public/admin download. See PP-6.

**Issue.** Sharp does NOT auto-set JPEG `pHYs` / EXIF `XResolution`+`YResolution`+`ResolutionUnit`. By default the JPEG written by `.jpeg({...})` has no density tag, which most operating systems and most print labs interpret as 72 DPI. Whitewall, Bay Photo, FotoPrizma, and WHCC all run automated print-size validation that reads JPEG density and rejects "low-DPI" submissions. A 3000×4500 print-quality JPEG ends up flagged as "12.5×18.75 inch print at 72 DPI — image may print blurry" even though it'd happily print 30×20 at 300 DPI.

Same problem on AVIF — AVIF can carry pixel density via `pixi`/`pasp` boxes plus the embedded ICC, but Sharp's `.avif()` doesn't write density either.

**Photographer-facing failure.** Wedding photographer downloads the JPEG derivative (the share-link UX) at the largest configured size (4096 px wide). She sends to Bay Photo for a 24×16 metallic. Bay's web app reads the JPEG, sees no DPI tag, computes "72 DPI native = 56×38 inch native size, your 24×16 print is sub-optimal" and warns her. She cancels the order, reshoots metadata in Photoshop, re-uploads. Hours lost.

**Severity.** PRO-HIGH. Confidence HIGH (Sharp source confirms no implicit density).

**Fix.**
```ts
// In each encode branch, after .toColorspace + before .webp/.avif/.jpeg:
.withMetadata({ density: 300 })  // or read from original's metadata.density
```
Better: read the source `metadata.density` (Sharp exposes it; default 72 if absent), preserve it on derivatives:
```ts
const density = metadata.density && metadata.density >= 72 ? metadata.density : 300;
// pipeline:
base.withMetadata({ density })
```
The `.withMetadata({ density })` here does NOT re-leak EXIF the way the old `.withMetadata({ icc })` did, because `withMetadata({ density })` only sets `density`. To be safe, combine with `withIccProfile` AFTER `withMetadata` — Sharp documents `withIccProfile` overrides any prior ICC bit set, so the metadata bits stay scoped.

Also confirm via test that the AVIF / WebP / JPEG derivatives carry density on round-trip — the existing `process-image-icc-options-lockin.test.ts` is the right place for the regression assertion.

For the download endpoint (PP-6), if a re-emit path lands later, the same density value should be written.

---

### PP-2 — No output sharpening after downscale resize

**Files** `apps/web/src/lib/process-image.ts:614-661` — pipeline does `pipelineColorspace('rgb16').resize(...).toColorspace(...).withIccProfile(...).<encoder>()` with NO `.sharpen()` between resize and encode.

**Issue.** Lightroom's "Export → Sharpening: Screen, Standard" and Capture One's equivalent both apply unsharp-mask AFTER downscale. Linear-light resize (which the pipeline already does correctly via `pipelineColorspace('rgb16')`) preserves edges better than gamma resize but still softens detail relative to source. Pros expect a 0.5-0.8 px radius unsharp mask at 50-80% amount on web exports.

The current output looks subjectively softer than competitor galleries (Smugmug, 500px, Behance) because those platforms all apply output sharpening. Photographers with trained eyes notice immediately on a 4K monitor.

**Photographer-facing failure.** Landscape shooter uploads a 60 MP Sony A7R V file (9504×6336). Pipeline downscales to 4096 wide, then 2048, then 1536, then 640 wide variants. The 1536 px viewer-preview AVIF on a 27" 4K monitor at 100% looks visibly softer than the same crop exported from Lightroom at 1536 px with "Output Sharpening: Screen, Standard". Photographer compares side-by-side, decides the gallery makes their work look worse than competitors.

**Severity.** PRO-HIGH. Confidence HIGH (Sharp documents that `resize()` does not auto-sharpen).

**Fix.** Add a per-format sharpening step. Sharp's `.sharpen({ sigma: 0.5 })` is the standard "screen" preset; for print-tier you'd use `sigma: 0.8`. Because the pipeline runs in `rgb16`, sharpening before `.toColorspace('srgb')` keeps it linear-light. Recommended:

```ts
const base = isWideGamutSource
    ? image.clone().pipelineColorspace('rgb16').resize({ width: resizeWidth }).sharpen({ sigma: 0.6 })
    : image.clone().resize({ width: resizeWidth }).sharpen({ sigma: 0.5 });
```

Tune sigma per output size (smaller derivatives benefit from lighter sharpening because the downscale ratio is bigger). Could be: `sigma = 0.4 + (resizeWidth / sortedSizes[sortedSizes.length-1]) * 0.4` — softer for smaller variants.

Bump `IMAGE_PIPELINE_VERSION` to 4 so cached derivatives invalidate. Test via a per-format pixel-correlation check (compare a known-source center crop against a Lightroom-exported reference) — generous tolerance, but the regression fingerprint of "sharpening missing" is unmistakable.

---

### PP-3 — Apple gain-map / ISO 21496-1 HDR is silently discarded

**Files**
- `apps/web/src/lib/process-image.ts:451, 565` — Sharp constructed without `unlimited: true` and without any HDR-aware decode path.
- The pipeline has no notion of `metadata.hasGainMap` or any gain-map preservation.

**Issue.** iPhone 14 Pro+ and iPhone 15+ Pro Max shoot "HDR Photo" by default. The HEIC file carries:
1. The base SDR image (in Display-P3, 8-bit by default).
2. An auxiliary "gain map" image (single-channel, lower-resolution) per Apple's gain-map spec (now ratified as ISO 21496-1 in 2024).
3. Metadata that tells HDR-capable displays how to combine base + gain map → HDR output.

libheif 1.18+ + libvips 8.16+ should preserve the gain map on decode. Sharp 0.34.5 does NOT expose `metadata.hasGainMap` in its TypeScript types but the underlying `vips_image_get_typeof()` call could surface it. In practice the current pipeline:

1. Decodes HEIC → libvips loads the BASE image only. Gain-map auxiliary is dropped at decode time unless the loader is invoked with `n=-1` (load all pages) or `subifd=N`. Sharp's HEIC loader does NOT do this by default.
2. `pipelineColorspace('rgb16').resize()` would force-flatten any gain-map even if it survived decode.
3. AVIF encoder via Sharp has no HDR path. AVIF spec supports HDR via `cicp` (color/transfer/matrix coefficients = 9/16/9 for Rec.2020 PQ, or 9/18/9 for HLG) plus optional `hdr_metadata` boxes. Sharp's `.avif({...})` accepts no `cicp` option.

**Photographer-facing failure.** iPhone 15 Pro Max shoots a sunset on a public beach. The HEIC HDR Photo on the photographer's phone shows a 4-stop highlight roll-off into a hot golden sun without clipping. Photographer uploads. Pipeline decodes the SDR base, drops the gain map, re-encodes to 10-bit P3 AVIF. On the gallery on the same iPhone (same display), the sun now clips white at 100 nits, the sky gradient flat-lines. Photographer sees their phone-original side-by-side with the gallery view and the gallery looks like a 2018-era export.

The gain map matters most for hand-held / phone shooters, but with the iPhone Pro line shooting ProRAW HDR by default, this affects every consumer iPhone uploader.

**Severity.** PRO-HIGH. Confidence HIGH for the gap; MEDIUM for libheif version (Dockerfile doesn't pin so depends on what `@img/sharp-libvips-linux-arm64@1.2.4` was compiled against — but Sharp's API doesn't expose gain-map preservation either way).

**Fix path.**

This is genuinely hard. Three tiers:

1. **Detect + warn (cheap).** Read `metadata.pages` from Sharp; HEIC HDR with gain map decodes as 2-page. If pages > 1, log a warning and store `images.has_gain_map = true` in DB. The gallery can then surface a "iPhone HDR original — preview is SDR" badge to manage photographer expectations. No fix to the encode path.

2. **Preserve on download only (medium).** Modify `/api/download/[imageId]` (PP-6 fix) to stream the HEIC original byte-for-byte. The download is the high-fidelity tier; the served AVIF/JPEG/WebP is the SDR universal tier. Photographers who care about HDR pull the original; everyone else gets the SDR preview. This matches what every paid gallery (Pixieset, ShootProof) does.

3. **HDR AVIF output (hard).** Re-encode to AVIF with `cicp: '9/16/9'` (Rec.2020 PQ) at 10-bit, embedding the gain map as an auxiliary item. Sharp has no API for this. Would require a `libheif`-direct path or `avifenc` shell-out. Probably out of scope for a self-hosted gallery; flag it but defer until iOS Safari + Chrome both ship reliable HDR-AVIF rendering (Chrome 116+ does; Safari 17+ does for some cicp values).

Recommend tier 1 + tier 2 now. Tier 3 is an 18-month roadmap item.

Add DB column: `has_gain_map BOOLEAN NOT NULL DEFAULT FALSE` and `is_hdr BOOLEAN NOT NULL DEFAULT FALSE`. Populate during `saveOriginalAndGetMetadata` from `metadata.pages > 1` AND iPhone-make heuristic AND `metadata.icc` decodes to Display-P3. Surface in admin UI as "HDR — view full quality on supported display."

---

### PP-4 — RAW allowlist locks out Canon / Nikon / Fuji / Olympus / Pentax / Panasonic

**File** `apps/web/src/lib/process-image.ts:71-73`

```ts
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.arw', '.heic', '.heif', '.tiff', '.tif', '.gif', '.bmp'
]);
```

**Issue.** Sony's `.arw` is the only RAW. Photographers shooting:
- Canon (`.cr2`, `.cr3`)
- Nikon (`.nef`)
- Adobe DNG (`.dng`) — used by Leica, Hasselblad, Pentax K-3 III, every iPhone ProRAW
- Olympus / OM Digital (`.orf`)
- Pentax (`.pef`)
- Fuji (`.raf`)
- Panasonic / Lumix (`.rw2`)

are silently rejected. The dropzone shows "image/*: .jpg .jpeg .png .webp .avif .arw .heic .heif .tiff .tif .gif .bmp" — Canon shooter sees no .cr3, drops file anyway, gets "File extension not allowed: .cr3" error.

DNG is the most painful exclusion: it's an open standard, every iPhone ProRAW is DNG, every Hasselblad is DNG, every Leica is DNG, and many photographers transcode their CR3/NEF to DNG via Adobe DNG Converter for archival.

**Photographer-facing failure.** Canon R5 + RF 24-70 shooter uploads via Lightroom plugin direct from the field. 80 .CR3 files. All fail with "File extension not allowed: .cr3". Photographer assumes the gallery is broken and reverts to Smugmug.

**Severity.** PRO-HIGH. Confidence HIGH (literal allowlist).

**Fix.** Tied to PP-5. If RAW support is added, expand the allowlist:

```ts
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif', '.gif', '.bmp', '.heic', '.heif',
    // RAW formats (require libraw):
    '.arw',  // Sony
    '.cr2', '.cr3',  // Canon
    '.nef',  // Nikon
    '.dng',  // Adobe / Leica / iPhone ProRAW / Hasselblad / Pentax K-3 III
    '.orf',  // Olympus / OM Digital
    '.pef',  // Pentax
    '.raf',  // Fuji
    '.rw2',  // Panasonic
    '.srw',  // Samsung (legacy but some pros still have NX1 archives)
    '.rwl',  // Leica (some bodies)
    '.iiq',  // Phase One
    '.3fr', '.fff',  // Hasselblad H-series
]);
```

If RAW support is NOT added (PP-5 option 1), at least update the dropzone accept list to remove `.arw` so the lie isn't advertised.

Update the dropzone at `apps/web/src/components/upload-dropzone.tsx:163` to match.

---

### PP-6 — `/api/download/[imageId]` is paid-tier-only — no free / share / admin full-res download path

**Files** `apps/web/src/app/api/download/[imageId]/route.ts` (entire file, 219 lines).

**Issue.** The download endpoint is gated by Stripe `entitlements`. There is no:
- Free download path for shared links / public photos.
- Admin "download original" button path.
- Print-tier re-emit path.

Reading the entire route: it requires a `dl_*` Stripe-issued token, looks up an entitlement row, checks expiry/refund/single-use, and only then streams the original. For a self-hosted personal gallery (which the README and CLAUDE.md describe), this is upside-down — the photographer's own admin UI cannot pull the full-res file unless they generate a $0 paid entitlement to themselves.

The full-res JPEG that ships in the responsive `<picture>` tree is the largest configured size variant (max 4096 wide by default), already gamut-clipped to sRGB and 8-bit per CM-CRIT-1 fix. That is NOT the original. There is no path for an admin to retrieve their own 60-megapixel ARW or 16-bit TIFF source after upload.

**Photographer-facing failure.** Photographer uploads a 60 MP A7R V TIFF straight from Capture One for portfolio review. A month later their laptop dies with the only local copy. They want their original back — there's no admin "download original" button. The only path: SSH into the server, find the UUID, scp the file out. Or buy themselves a $0 Stripe checkout.

Also: shared-link viewers (e.g., a client previewing a wedding gallery) cannot ever pull the full-res. They get the 4096px sRGB JPEG. For wedding clients who paid for prints, this is a regression vs. Pixieset / ShootProof / SmugMug.

**Severity.** PRO-HIGH. Confidence HIGH (route reads).

**Fix.** Add a separate authenticated admin route (`/api/admin/download/[imageId]`) that:
1. Requires admin session (use `withAdminAuth` from `lib/api-auth.ts`).
2. Streams the original via the same `lstat` + realpath traversal guard as the existing route.
3. No token, no single-use claim — admins can pull as many times as needed.
4. Sets `Content-Disposition: attachment; filename="<original-name>"` — but use the user-uploaded filename (`images.user_filename`) not just `photo-<id>.<ext>`.

Optionally add a public "free download" toggle per image (admin-controlled, defaulted off) for the share-link case. Photographers who give a wedding client free print-quality access can flip it on.

For pro-print needs, ALSO add a print-tier re-emit at this admin route: query param `?format=tiff&depth=16&space=adobe-rgb` re-runs the encoder for the print lab. This is rare but pros notice galleries that offer it.

---

### PP-8 — CMYK input has no defined behavior

**File** `apps/web/src/lib/process-image.ts:71-73, 555-661`

**Issue.** `.tiff` and `.tif` are in `ALLOWED_EXTENSIONS`. TIFF is the canonical CMYK transport format. An art-print shop preparing FOGRA39-proofed work uploads a CMYK TIFF as their gallery source.

The pipeline does NOT branch on source mode. `pipelineColorspace('rgb16')` is the only colorspace transform on the wide-gamut path. For a CMYK source:
- Sharp will emit a libvips warning that gets swallowed (no `failOn: 'warning'`).
- libvips will attempt CMYK → RGB via the source ICC if present; if absent (very common for press-prepared CMYK that uses tagless device CMYK), libvips falls back to a generic CMYK→sRGB transform via SWOP/Coated v2, which produces visibly wrong color (~10-15 ΔE shift for saturated CMYK primaries).
- The output AVIF/WebP/JPEG looks washed-out / shifted toward magenta-yellow.

The CM aggregate flagged this as a test gap (#5 in test gaps) but didn't propose a fix.

**Photographer-facing failure.** Print shop uploads a soft-proofed CMYK TIFF for a press check. The gallery preview looks markedly different from the press proof. Client ordering off the gallery picks colors that won't print correctly. Print run is rejected.

**Severity.** PRO-HIGH. Confidence HIGH (libvips CMYK behavior is well documented).

**Fix.** Branch the pipeline on `metadata.space`:

```ts
const sourceSpace = metadata.space; // 'srgb' | 'rgb' | 'cmyk' | 'b-w' | 'lab' | ...

if (sourceSpace === 'cmyk') {
    // Convert CMYK → sRGB explicitly via the source ICC if present, else
    // SWOP-coated (libvips default). Tag the output sRGB.
    const base = image.clone().pipelineColorspace('rgb16').resize({...}).toColorspace('srgb');
    // Then encode as usual.
}
```

For art-print workflows, support a "preserve CMYK" admin toggle that emits a CMYK TIFF on download (PP-6 print-tier).

Add CMYK fixture test to `__tests__/process-image-color-roundtrip.test.ts` — `sharp({create:...}).toColorspace('cmyk').tiff()`.

---

### PP-10 — Backfill is not resumable / not idempotent against partial failure mid-image

**File** `apps/web/scripts/backfill-p3-icc.ts:93-143`

**Issue.** For a 50,000-photo catalog, the backfill estimate at 2-image concurrency on a Mac mini M2 is ~6-10 hours (at ~2 sec/image for a 24 MP source — three formats × four sizes). If the script crashes at photo 30,000 (DB connection drop, OOM, server reboot), there's no resume token. The next run starts at photo 1.

The script has no notion of:
- "Was this row processed at pipeline version N already?"
- Per-image checkpointing.
- Skip-on-already-emitted-current-version check.

Each row read is `WHERE processed = TRUE` only — no `pipeline_version` column in DB to gate skip logic. So the backfill always reprocesses every row regardless.

The reprocessing is also not transactional w.r.t. the file system. `processImageFormats` writes new derivatives over old ones (with atomic rename for the BASE filename, NOT for the per-size suffixed variants — see line 597-601 fallback to copyFile). If the script crashes mid-image:
- Some sizes (e.g., 640) may be new pipeline output.
- Other sizes (e.g., 4096) may still be old pipeline output.
- The `images` table is untouched (no DB write in the reprocess path), so there's no signal which rows are mid-state.

For the intended use case (after every encoder change, reprocess 50K photos) this is genuinely broken at scale.

**Photographer-facing failure.** 50K-photo wedding archive. Gallery owner runs backfill on Friday night. Server reboots Sunday afternoon (kernel update). Owner reruns backfill Monday morning, takes 8 more hours. Total downtime: 3 days. Client noticed broken cache during that window because some derivatives were updated and others weren't.

**Severity.** PRO-HIGH. Confidence HIGH (script reads).

**Fix.** Three changes:

1. **Add `pipeline_version` column** to `images` schema:
   ```sql
   ALTER TABLE images ADD COLUMN pipeline_version INT NOT NULL DEFAULT 0;
   ```
   Update `process-image.ts` `processImageFormats` to write `pipeline_version = IMAGE_PIPELINE_VERSION` after successful encode. Update backfill to:
   ```ts
   WHERE processed = TRUE AND pipeline_version < ${IMAGE_PIPELINE_VERSION}
   ORDER BY id ASC
   ```
   Resumable + idempotent for free.

2. **Per-row commit.** Backfill writes `pipeline_version = N` to the row inside a transaction with the file-system writes (or at least immediately after). On rerun, completed rows are skipped.

3. **Add `--resume-from <id>` CLI flag** for paranoid operators.

This is a 1-PR fix. Schema migration + script change + add the version write to `processImageFormats`. Tests: a resumed backfill should skip already-versioned rows.

---

### PP-16 — HEIC `.heic/.heif` allowed but Dockerfile does not pin libheif support

**Files** `apps/web/src/lib/process-image.ts:71-73, 39`, `apps/web/Dockerfile:1-51`, `apps/web/src/components/upload-dropzone.tsx:163`.

**Issue.** Same flavor as PP-5 but for HEIC. `@img/sharp-libvips-linux-arm64@1.2.4` (per `package-lock.json:6420`) is built WITH libheif (libvips 8.17.3 ships with HEIC by default since 1.2.0+). However:
- The Dockerfile does NOT pin or test libheif version. A future libvips bump that drops libheif (e.g., compile error on a new libheif release) would silently break HEIC support.
- The HEIC code path is exercised by ZERO tests — no `__tests__/process-image-heic*.test.ts` exists.
- `HAS_HIGH_BITDEPTH_AVIF = !sharp.versions.heif` at `process-image.ts:39` uses the heif version as a 10-bit-AVIF gate, which couples HEIC support to AVIF bit-depth in a way that's hard to reason about. If `sharp.versions.heif` is undefined (no heif support compiled in), the expression evaluates to `!undefined === true`, which means 10-bit AVIF gets enabled — which is the OPPOSITE of the intent. Read the comment at line 36-39:
  > "Sharp's prebuilt binaries ship libheif without 10/12-bit AVIF support — passing bitdepth:10 throws there."

  The logic is `HAS_HIGH_BITDEPTH_AVIF = !sharp.versions.heif`. Translation: "we have 10-bit AVIF only when heif is NOT installed". This is upside-down for the prebuilt path which DOES ship libheif. Either the comment is wrong, or the gate is wrong. Looking at `versions.heif`: Sharp 0.34 sets it to the libheif version string (e.g., '1.20.2') when heif is compiled in. So `!sharp.versions.heif` is `false` when heif IS compiled in, and `HAS_HIGH_BITDEPTH_AVIF = false`, so 10-bit AVIF is disabled. The comment matches this reading: the prebuilt heif lacks 10-bit AVIF support, so when heif is present we must disable 10-bit. Correct logic, confusing variable name.

  But: this means **10-bit AVIF is permanently disabled on the Docker prebuilt path**. The CM-MED-1 fix only takes effect on a custom-built libvips that lacks libheif (an unusual configuration). On the deployed gallery.atik.kr, every wide-gamut AVIF is still 8-bit. The CM aggregate test at `process-image-dimensions.test.ts:23` mocks `versions: { heif: '1.20.2' }` which forces `HAS_HIGH_BITDEPTH_AVIF = false` in the test env — confirming the gate.

**Photographer-facing failure (HEIC drift).** A Sharp version bump in 6 months drops HEIC support due to a packaging bug. Every iPhone uploader hits the same silent "Invalid image file" path as PP-5. No alert.

**Photographer-facing failure (10-bit AVIF gate inversion is an unreviewed contradiction).** The CM-MED-1 fix advertised "10-bit AVIF for wide-gamut" but in production it's 8-bit always. The whole point of the wide-gamut output path was to avoid sky-banding. It still bands.

**Severity.** PRO-HIGH for the gate inversion. Confidence HIGH (read code + comment + test mock all agree the gate disables 10-bit on heif-compiled binaries).

**Fix.**

1. **Add a HEIC fixture test.** A 4×4 HEIC encoded by Sharp itself, decode round-trip via `processImageFormats`. If libheif drops out of the prebuilt, this test fails immediately at CI.

2. **Either fix the 10-bit AVIF gate or drop the false advertising.** Sharp 0.34.5 + libheif 1.18+ DO support 10-bit AVIF encode (libheif 1.18 added 10-bit AVIF in May 2024). The gate is based on a stale assumption. Replace with a version check:
   ```ts
   const HAS_HIGH_BITDEPTH_AVIF = (() => {
       const heifVer = sharp.versions.heif;
       if (!heifVer) return false; // libvips built without heif; 10-bit AVIF still works via libavif
       const [major, minor] = heifVer.split('.').map(Number);
       // libheif 1.18+ supports 10/12-bit AVIF encoding through Sharp.
       return major > 1 || (major === 1 && minor >= 18);
   })();
   ```
   Better: just try-catch a one-pixel 10-bit encode at module load and cache the result.

3. **Pin libheif version in Dockerfile.** Even with prebuilt libvips, an explicit `apt-get install libheif1=1.18.x` in `runner-base` would survive a libvips repackage (Sharp resolves dynamic linking against the system lib if `SHARP_FORCE_GLOBAL_LIBVIPS=1`).

---

### PP-20 — EXIF `XResolution` / `YResolution` / `ResolutionUnit` not extracted into DB

**File** `apps/web/src/lib/process-image.ts:737-846` (`extractExifForDb`)

**Issue.** Companion to PP-1. The DB schema (`images` table) has no `dpi_x`, `dpi_y`, or `resolution_unit` columns. The `extractExifForDb` function reads `FNumber`, `ISO`, `LensModel`, etc. but skips resolution. So even if the original carries 300 DPI tags from Lightroom export, those are not surfaced anywhere in the DB or UI.

This compounds PP-1 — even if the photographer wanted to know "what density did my camera/Lightroom write?", they can't query it.

**Photographer-facing failure.** Photographer wants to find all images they exported at 300 DPI vs. 72 DPI for an audit before sending to a print lab. SQL query against `images` table: no column. Stuck.

**Severity.** PRO-MED. Confidence HIGH.

**Fix.** Add columns + extraction:
```sql
ALTER TABLE images
  ADD COLUMN dpi_x SMALLINT UNSIGNED,
  ADD COLUMN dpi_y SMALLINT UNSIGNED,
  ADD COLUMN resolution_unit VARCHAR(8);
```

Update `extractExifForDb`:
```ts
const xRes = imageParams.XResolution as number | undefined;
const yRes = imageParams.YResolution as number | undefined;
const resUnit = imageParams.ResolutionUnit as number | undefined;
// ResolutionUnit: 2 = inch, 3 = cm
return {
    ...
    dpi_x: typeof xRes === 'number' && xRes > 0 ? Math.round(xRes) : null,
    dpi_y: typeof yRes === 'number' && yRes > 0 ? Math.round(yRes) : null,
    resolution_unit: resUnit === 2 ? 'inch' : resUnit === 3 ? 'cm' : null,
};
```

Surface in admin photo-detail UI. Use as default for derivative `density` value (PP-1).

---

## PRO-MED

### PP-7 — `autoOrient: true` may put `original_width/height` in DB at post-rotate (not source) values

**File** `apps/web/src/lib/process-image.ts:451-475`

**Issue.** Sharp's constructor option `autoOrient: true` rotates pixels at decode time and zeroes the orientation tag. After this:
- `metadata.width` and `metadata.height` reflect the rotated (visual) dimensions.
- The DB columns `width`, `height`, `original_width`, `original_height` are all set from these post-rotate values.

This is correct for the displayed visual orientation — masonry grid math works. But there's an information loss: if a photographer queries "what was the camera's native sensor orientation?", the DB says "post-rotate". For Sony A1 portrait shots, original sensor pixels are 6336×9504; after autoOrient the DB says `original_width=6336, original_height=9504`. That's the rotated value. Fine for web. Bad for print-spec validation that wants to know native sensor dimensions.

A subtler bug: if a future reprocess pass changes the autoOrient setting, the DB columns now disagree with the on-disk file. There's no cross-check.

**Severity.** PRO-MED. Confidence MEDIUM (depends on how the photographer uses the metadata).

**Fix.** Either:
1. Add `sensor_orientation_tag INT` column storing the original EXIF Orientation value (1-8) so it's recoverable.
2. Document the intent: "`width`/`height`/`original_*` are visual / post-rotate dimensions. EXIF orientation is normalized."

Option 2 is cheaper. Just add a comment in `schema.ts` and a sentence in CLAUDE.md.

---

### PP-9 — Wider-than-P3 sources are gamut-clipped to sRGB with no Rec.2020 / Adobe RGB output path

**Files** `apps/web/src/lib/process-image.ts:338-355, 612-661`

**Issue.** `resolveAvifIccProfile` returns `'srgb'` for Adobe RGB, ProPhoto, Rec.2020. Then the encode chain calls `.toColorspace('srgb')`, which gamut-compresses these wider-than-P3 sources into sRGB. This is documented in the function comment as an explicit trade-off:

> "Wider-than-P3 gamuts (Adobe RGB / ProPhoto / Rec.2020) are gamut-clipped to sRGB at encode time. This is a knowing trade-off: accurate-but-narrower colors today, in exchange for the option to add a true wide-gamut path later (10-bit AVIF + actual ProPhoto-aware conversion) without breaking existing assets."

Pro reality:
- Adobe RGB shooters (default for many Canon/Nikon JPEG-out-of-camera setups) lose their gamut on the gallery view.
- ProPhoto Lightroom exports lose ~30% of their saturation range.
- Rec.2020 sources (rare on consumer hardware but standard for cinema print) are heavily clipped.

For a Wacom Cintiq Pro 27" or EIZO ColorEdge CG279X user viewing the gallery, the difference is visible. They're the photographers who notice color management most.

**Severity.** PRO-MED. Confidence HIGH (code reads + chromaticity math).

**Fix.** Genuinely wider gamut output is a multi-PR project. Tier 1 quick win:

1. **Tag-only path for Display-P3 sources** (already done — keep).
2. **Adobe RGB AVIF output path.** Add `'adobe-rgb'` as a third output ICC option:
   ```ts
   if (name.includes('adobe rgb') || name.includes('adobergb')) return 'adobe-rgb';
   ```
   Then in encode chain: `.toColorspace('adobe-rgb').withIccProfile('adobe-rgb').avif({ bitdepth: 10 })`. Sharp does NOT bundle Adobe RGB in its named profile list — would need to ship the ICC profile in the repo (Adobe-licensed but free for redistribution per the AdobeRGB1998 ICC license).
3. **Rec.2020 / ProPhoto** — defer to tier 3 (requires real CMS support beyond Sharp's named profiles).

---

### PP-11 — EXIF camera/lens stripped from every derivative — no curated subset preserved

**Files** `apps/web/src/lib/process-image.ts:617-661` — every encode chain uses `.withIccProfile()` which sets ICC bit only.

**Issue.** Per CM-HIGH-2 fix, the AVIF / WebP / JPEG derivatives correctly strip ALL EXIF (including GPS, camera serial). Good for privacy, bad for SEO and pro presentation. Pros want the camera + lens preserved on the public derivative because:
- "Sony A1 + 70-200mm f/2.8 GM" appears in image SEO.
- Right-click → properties on a downloaded JPEG shows the gear, which is the photographer's marketing.
- Some social platforms (Behance, 500px) extract camera info from EXIF for display.

The current pipeline forces an all-or-nothing: either keep EVERYTHING (and leak GPS/serial) or keep NOTHING. There's no curated "preserve Make, Model, LensModel, FNumber, ExposureTime, ISO, FocalLength, CaptureDate; strip GPS, serials, IPTC, XMP" path.

**Severity.** PRO-MED. Confidence HIGH.

**Fix.** Add an admin toggle `preserve_camera_metadata_on_derivatives` (default false for privacy). When on, post-process the AVIF/WebP/JPEG to inject a curated EXIF block:

```ts
const exifSubset = {
    IFD0: {
        Make: meta.exif?.Make,
        Model: meta.exif?.Model,
        Software: 'Gallery'
    },
    ExifIFD: {
        FNumber: meta.exif?.FNumber,
        ExposureTime: meta.exif?.ExposureTime,
        ISO: meta.exif?.ISO,
        FocalLength: meta.exif?.FocalLength,
        LensModel: meta.exif?.LensModel,
        DateTimeOriginal: meta.exif?.DateTimeOriginal,
    },
    // GPSIFD intentionally omitted
};

await base
    .withIccProfile(targetIcc)
    .withExif(exifSubset)  // Sharp 0.33+ has withExif(); sets only EXIF bit
    .avif({...});
```

Test with a fixture that has GPS + camera + lens, asserting GPS is stripped but camera survives.

---

### PP-12 — DPR-aware delivery: `srcset` is width-descriptor-only

**Files**
- `apps/web/src/components/photo-viewer.tsx:374-396`
- `apps/web/src/components/home-client.tsx:213-256`
- `apps/web/src/components/lightbox.tsx:386-410`

**Issue.** All three components use `<picture><source srcSet={... ${w}w}>` width-descriptor `srcset`, which is correct semantically — the browser does the right thing on a 3× DPR iPhone (it picks the 4096 variant for a 1366px CSS width if the photo is full-viewport). But:
- Browsers use width-descriptor `srcset` based on `sizes`, not the actual device pixel ratio. The `sizes` attribute on the photo viewer is `(min-width: 1024px) calc(100vw - 414px), 100vw` (per `getPhotoViewerImageSizes`). For an iPhone 15 Pro Max in landscape (window.innerWidth = 932 logical, 2796 physical), this resolves to `100vw = 932 CSS px`. The browser then picks the smallest variant ≥ 932 × DPR = 932 × 3 = 2796 — so the 4096 variant. Good.

So actually, width-descriptor srcset DOES handle high-DPR correctly. The CM aggregate's CM-MED-7 already added `fetchPriority="high"` (per our read of photo-viewer.tsx:395). So the DPR concern is mostly satisfied.

The remaining gap: at certain breakpoints, the `sizes` hint mismatches the actual layout. e.g., the home-client masonry has `sizes="(min-width: 1536px) 20vw, (max-width: 640px) 100vw, ..."`. If the user resizes the window after layout, `sizes` is static — but the browser re-evaluates. Mostly OK.

The TRUE gap: there is no high-DPI download path. A photographer wants to give a print client a 3× retina-quality 1080-tall image (i.e., 3240-tall) for a press release. The largest variant is 4096 wide; for a portrait photo (3:2) that's 6144 tall — but a 4096 wide × 2730 tall landscape doesn't have a 3× retina-tall variant. The variant table is width-axis only.

**Severity.** PRO-MED. Confidence MEDIUM.

**Fix.** Two options:
1. Store both width-fitted and height-fitted variants. Doubles storage, but matters for portrait/landscape presentation parity.
2. Just communicate the existing variants more clearly to admins and add an "export at retina size" button in admin.

Option 2 is cheap. For most pros it's fine.

---

## PRO-LOW

### PP-13 — 16-bit TIFF download path

**File** `apps/web/src/app/api/download/[imageId]/route.ts:181-204`

The download endpoint streams the original byte-for-byte (`createReadStream(resolvedFilePath)` then `Readable.toWeb(stream)`). 16-bit TIFF round-trips perfectly. Good. NO action needed.

The PP-6 fix should preserve this byte-stream behavior.

### PP-14 — Soft-proofing canvas

Not implemented. Almost no web gallery does this. Defer indefinitely. Mention only as "future".

### PP-15 — ICC v4 vs v2 emitted by `withIccProfile()`

Sharp's `withIccProfile('srgb' | 'p3')` emits a v4 ICC profile (verified via libvips ICC profile bundle). Older Lightroom (pre-9.x) writes v2 sRGB. Browser CMS handles both, but a round-trip test that asserts which version `withIccProfile` emits is missing. Add to `process-image-icc-options-lockin.test.ts`:

```ts
it('emits ICC v4 profile (not v2)', async () => {
    const dest = path.join(tmpDir, 'v4-check.avif');
    await sharp({create:{...}}).withIccProfile('p3').avif({quality:50}).toFile(dest);
    const meta = await sharp(dest).metadata();
    // ICC v4 has '4' at byte 8 of the header (profile version major).
    expect(meta.icc![8]).toBe(0x04);
});
```

### PP-17 — JPEG progressive / mozjpeg-quality

No `progressive: true` set on `.jpeg()`. Progressive JPEGs render incrementally on slow connections — pros notice on 3G previews. Some print labs (rare) reject baseline JPEGs at quality < 90.

Fix: `.jpeg({ quality: qualityJpeg, progressive: true, mozjpeg: true, ... })`. `mozjpeg: true` enables Sharp's mozjpeg backend for ~10% smaller files at same quality. No regression.

### PP-18 — Raw-pipeline preview

For pixel-peeping. Sharp can `.raw()` a Bayer pattern but it's a debugging tool. Out of scope.

### PP-19 — `bit_depth = 32` on float TIFF

`metadata.depth = 'float'` maps to 32 in `DEPTH_TO_BITS` table at `process-image.ts:512`. For a 16-bit TIFF, depth is `'ushort'` → 16. For a 32-bit float TIFF (HDR retouching scratch, rare but real), depth is `'float'` → 32.

Print labs spec'ing "16-bit-per-channel input" treat the DB column literally and accept a 32-bit float, which they shouldn't (they want integer 16-bit). Cosmetic; flag and document.

---

## Summary of recommended fix sequencing

| PR | Bundle | What it ships | Ownership |
|----|--------|---------------|-----------|
| PR 1 | PP-5 honest | Drop `.arw` from allowlist + dropzone, return clear "RAW not supported" error | small, ship today |
| PR 2 | PP-1 + PP-20 | Density on every derivative, `dpi_x/dpi_y/resolution_unit` columns | medium |
| PR 3 | PP-2 | Output sharpening with size-aware sigma; bump pipeline version to 4 | medium |
| PR 4 | PP-16 gate fix | Try-catch 10-bit AVIF probe; HEIC fixture test; pin libheif | small |
| PR 5 | PP-10 | `pipeline_version` column; resumable backfill | medium |
| PR 6 | PP-6 | Admin download route + share-link free download toggle | medium |
| PR 7 | PP-3 tier 1+2 | Detect gain map, store `has_gain_map`, surface badge; original-byte download preserves HEIC HDR | medium |
| PR 8 | PP-8 | CMYK→sRGB explicit branch + test fixture | small |
| PR 9 | PP-11 | Curated EXIF preservation toggle + tests | medium |
| PR 10 | PP-4 + PP-5 (real) | libraw in Docker; expand RAW allowlist; tests | large |
| PR 11 | PP-9 | Adobe RGB AVIF output path (ship the ICC profile, branch the resolver) | large |
| PR 12 | PP-17 | mozjpeg + progressive JPEG | tiny |

PR 1 + PR 4 are immediate confidence wins for almost zero cost. PR 2 + PR 3 are the highest-leverage pro-quality wins. PR 10 is the gating change for "this gallery actually competes with Pixieset for serious shooters."

---

## Cross-cutting observations

**The pipeline-version mechanism is an excellent foundation for color-mgmt evolution.** `IMAGE_PIPELINE_VERSION = 3` plus the ETag-based revalidation means future encoder fixes (PP-2, PP-3, PP-9) ship without operator intervention. Bump to 4 on the next encoder change.

**The test suite is denser than typical for a self-hosted gallery.** `process-image-color-roundtrip.test.ts` and `process-image-icc-options-lockin.test.ts` lock in the exact contracts that protect against silent regressions (e.g., the source-text grep for `withIccProfile` is ugly but it works). Recommend extending this pattern to PP-1 (assert `withMetadata({ density:` appears) and PP-2 (assert `.sharpen(` appears) on the next round.

**Backfill at 50K-photo scale is the operational bottleneck.** PP-10 fix is the biggest operability improvement available short of a full storage overhaul.

**HEIC + RAW are the two big "feels broken to pros" surfaces.** Fix the gate (PP-16), drop or really-add `.arw` (PP-5), and the gallery will stop feeling like "JPEG-only with extra steps".
