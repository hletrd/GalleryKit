# Color management — deep review aggregate

5 specialist reviewers fanned out in parallel: code-reviewer, security-reviewer, designer (UI/UX), perf-reviewer, test-engineer (omc).

Per-agent files in this directory: `code-reviewer.md`, `security-reviewer.md`, `designer.md`, `perf-reviewer.md`, `test-engineer.md`.

Severity scale: **CRITICAL** = product-incorrect color shipped to users; **HIGH** = visible-to-eye wrong color or privacy/security; **MEDIUM** = perceptible degradation; **LOW** = polish.

Cross-agent agreement on a finding raises confidence — when a finding has 2+ ✓ marks, treat it as confirmed.

## CRITICAL

### CM-CRIT-1 — AVIF: wide-gamut sources tagged as Display-P3 with no pixel transform
**Files:** `apps/web/src/lib/process-image.ts:283-288, 556-564, 301-330` (`resolveAvifIccProfile`)
**Reviewers:** code-reviewer ✓, perf-reviewer ✓, test-engineer ✓, security-reviewer (alluded) ✓

`resolveAvifIccProfile()` maps `Adobe RGB (1998)`, `ProPhoto RGB`, `ITU-R BT.2020 / Rec.2020` to ICC tag label `'p3'`. Then `image.clone().resize().keepIccProfile().withMetadata({icc: 'p3'}).avif()` runs — there is **no `.toColorspace('p3')`** between source decode and tag write. The pipeline embeds Apple's Display-P3 ICC profile **over Adobe-RGB-encoded pixel values** (or ProPhoto, or Rec.2020). Every wide-gamut export is colorimetrically wrong on ICC-aware browsers/displays.

Concrete failure: a Lightroom export at Adobe RGB has its red primary at chromaticity (0.6400, 0.3300). Tagged as P3 (red primary 0.680, 0.320) with the original Adobe-RGB pixel values, the browser CMS shifts saturation and hue. Reds desaturate ~12 %, greens shift ~8°. User-visible.

The existing `process-image-p3-icc.test.ts` only tests `resolveAvifIccProfile()` as a pure function, not the round-trip pixels.

Fix: either `pipelineColorspace('rgb16').toColorspace('p3')` before `.withMetadata({icc: 'p3'})`, OR convert the source to actual P3 pixel values via Sharp's CMS using the source ICC, OR (safest) only tag P3 when the source ICC is actually Display-P3 / P3-D65 / DCI-P3 — fall back to sRGB for everything else and convert via `.toColorspace('srgb')` first.

## HIGH

### CM-HIGH-1 — WebP / JPEG: `keepIccProfile()` propagates source ICC, contradicts comment claim "always sRGB"
**Files:** `apps/web/src/lib/process-image.ts:292-294, 556, 558-559, 565-566`
**Reviewers:** code-reviewer ✓, security-reviewer ✓, designer ✓, perf-reviewer ✓ (4/5 agreement)

Code comment lines 292-294 says "WebP and JPEG derivatives are always left at sRGB for universal compatibility." But the actual code at line 556 calls `.keepIccProfile()` — which carries the source ICC into both WebP and JPEG branches because no `.toColorspace('srgb')` runs and the WebP/JPEG branches never call `.withMetadata({icc: 'srgb'})`. Sharp's `keepIccProfile()` only takes effect at encode if `withMetadata()` is also called at encode time.

Net effect:
- If source has Display-P3 ICC → WebP/JPEG come out **untagged** with source pixel values (browser interprets as sRGB → washed-out greens, ~25% gamut clip).
- If source has Adobe RGB ICC → same washout, different shift.
- Documentation claim "always sRGB" is false.

Fix: Replace the `.keepIccProfile()` chain on WebP/JPEG with `.toColorspace('srgb').withIccProfile('srgb')` (or just `.withMetadata({icc: 'srgb'})`). For AVIF, replace `.withMetadata({icc: avifIcc})` with `.withIccProfile(avifIcc)` to avoid metadata leak (see CM-HIGH-2).

### CM-HIGH-2 — AVIF leaks GPS / camera serial / lens metadata via `withMetadata({icc})`
**Files:** `apps/web/src/lib/process-image.ts:560-564`
**Reviewers:** security-reviewer ✓, test-engineer ✓ (independently verified against Sharp 0.34.5 internals)

Sharp 0.34.5 `withMetadata({...})` transitively calls `keepMetadata()` which sets all 5 metadata bits (`0b11111` = EXIF + IPTC + XMP + ICC + orientation). Passing `{icc: 'p3'}` does **not** restrict to ICC-only — it embeds the named ICC AND keeps every other metadata block from the source. AVIF derivatives served from `public/uploads/avif/*` therefore carry the photographer's GPS coordinates, camera serial, lens model, and full XMP. The DB-level `strip_gps_on_upload` toggle nulls DB columns but the AVIF on disk still has the GPS EXIF.

WebP/JPEG branches use `.keepIccProfile()` (only the ICC bit `0b01000`) and correctly strip everything else — so this is AVIF-specific.

Fix: replace `withMetadata({icc: avifIcc})` with `withIccProfile(avifIcc)` (Sharp 0.32+) which sets ICC bit only.

### CM-HIGH-3 — `failOn` defaults to `'warning'`: rejects valid uploads, accepts truncated ones
**Files:** `apps/web/src/lib/process-image.ts:421, 519`
**Reviewers:** code-reviewer ✓, security-reviewer ✓

`sharp(originalPath, { limitInputPixels })` is called twice with no `failOn` option. Sharp's default is `'warning'`, which (a) errors on libvips warnings that are typically benign (e.g. unknown EXIF chunk in an iPhone photo) and (b) accepts truncated input that emits a warning rather than an error. Neither is desired behavior for a photo gallery.

Fix: add `failOn: 'error'` and `sequentialRead: true` (which also helps perf — streaming decode).

### CM-HIGH-4 — No EXIF Orientation correction → portrait iPhone photos display rotated
**Files:** `apps/web/src/lib/process-image.ts` (entire pipeline — `.rotate()` / `.autoOrient()` never called)
**Reviewers:** code-reviewer ✓, security-reviewer ✓ (M-1 in their report), test-engineer ✓ (3/5 agreement)

The pipeline never calls `.rotate()` or `.autoOrient()` and `withMetadata({icc:'p3'})` keeps the source `Orientation` tag. Result depends on browser:
- Safari + iPhone landscape photo with Orientation=6 → rotates the (already pixel-correctly-oriented) image again → 90° wrong.
- Chrome may or may not honor EXIF Orientation depending on `image-orientation` CSS — defaults to `from-image`, which honors EXIF, so same effect.
- WebP and JPEG output: source EXIF stripped → orientation tag gone but pixels are unrotated source → portrait photos served sideways.

Fix: call `.autoOrient()` (Sharp 0.33+; alias for `.rotate()` with no arg) at pipeline start, before resize.

### CM-HIGH-5 — Cache-Control `max-age=31536000, immutable` blocks rolling out any color fix
**Files:** `apps/web/src/lib/serve-upload.ts:102`
**Reviewers:** code-reviewer (M-7) ✓, security-reviewer (HIGH-3) ✓, perf-reviewer (P0) ✓ (3/5 agreement)

Processed AVIF/WebP/JPEG are served with `Cache-Control: public, max-age=31536000, immutable`. Filenames are `{uuid}.{ext}` — no pipeline-version hash, no source-content hash. When you fix CM-CRIT-1 + CM-HIGH-1 + CM-HIGH-4, every CDN edge and every browser will continue serving the broken old derivative for up to a year unless the file is byte-identical to the new output (which it will not be). There is no invalidation path.

Fix options (pick one):
1. Add a pipeline-version segment to the URL: `/uploads/avif/{uuid}_v{N}.avif`. Bump `N` whenever the pipeline output changes.
2. Stop using `immutable`; use `max-age=86400, must-revalidate` and add an `ETag` based on a content hash so updated files invalidate naturally.
3. Rename UUIDs on reprocess so the URL changes.

Option 1 is the cleanest for CDNs.

### CM-HIGH-6 — Backfill script targets non-existent column → cannot reprocess existing assets
**Files:** `apps/web/scripts/backfill-p3-icc.ts:147-152`, schema `apps/web/src/db/schema.ts:45`
**Reviewers:** perf-reviewer (P0) ✓

Backfill queries `icc_profile_name` from `images` table; schema only has `color_space`. First run on prod throws `ER_BAD_FIELD_ERROR`. The operator-facing tool to re-derive existing assets after a color fix is **broken**. Combined with CM-HIGH-5, you cannot ship any of the color fixes today without operator intervention.

Fix: either rename the column reference to `color_space`, or add the missing column with proper migration, or rewrite the backfill to read ICC from each `original/*` file directly.

## MEDIUM

### CM-MED-1 — 8-bit AVIF on wide-gamut source produces banding
**Files:** `apps/web/src/lib/process-image.ts:560-564`
**Reviewers:** code-reviewer ✓, perf-reviewer ✓, security-reviewer (INFO) ✓, test-engineer (Low #5) ✓

`.avif({quality: qualityAvif})` uses default `bitdepth: 8`. AVIF supports 10 and 12-bit. On a Display-P3 source, 8-bit shows visible banding in skies and skin tones at the gamut edges. ~2× CPU for 10-bit but matches what the AVIF format is for.

Fix: when source is non-sRGB, encode AVIF with `{bitdepth: 10}`.

### CM-MED-2 — Pipeline color-space is gamma (default), not linear-light → wrong resize math
**Files:** `apps/web/src/lib/process-image.ts:556` (no `pipelineColorspace()` call)
**Reviewers:** code-reviewer ✓, perf-reviewer ✓

Sharp's `resize()` runs in the pipeline color-space. Default is the source's color-space in gamma form. Correct resize math for photographic content is in linear light (`pipelineColorspace('rgb16')`). The difference shows up most as edge halos and slightly muddy gradients.

Fix: `image.pipelineColorspace('rgb16')` once after open, before clone.

### CM-MED-3 — JPEG chroma subsampling 4:2:0 default for wide-gamut source
**Files:** `apps/web/src/lib/process-image.ts:566`
**Reviewers:** perf-reviewer ✓

Sharp's JPEG default is `chromaSubsampling: '4:2:0'` below quality 90. For sRGB photo derivatives this is fine and saves bytes. For wide-gamut sources downconverted to sRGB, chroma resolution loss compounds the gamut compression and visibly softens color edges.

Fix: when source is non-sRGB, use `chromaSubsampling: '4:4:4'` for JPEG.

### CM-MED-4 — CSS color tokens are all sRGB HSL — no Display-P3 / oklch
**Files:** `apps/web/src/app/[locale]/globals.css:14-90`, `apps/web/tailwind.config.ts:13-53`
**Reviewers:** designer (M-1) ✓

Every design-system token uses `hsl(var(...))`, capping UI chrome to sRGB on P3 displays. The `--display-gamut` CSS variable is set by a `color-gamut: p3` media query but nothing reads it.

Fix: add `@supports (color: oklch(0 0 0)) { ... }` block redefining accent / primary / ring / destructive in `oklch()`.

### CM-MED-5 — Photo viewer container `dark:bg-white/5` instead of pure black on OLED
**Files:** `apps/web/src/components/photo-viewer.tsx:592`
**Reviewers:** designer (M-5) ✓

Wrapper around the hero photo resolves to ~`rgb(23,23,26)` in `.dark`, ~`rgb(12,12,12)` in `.oled` — neither is pure black. 8 px padding creates a chromatic surround that compresses perceived contrast for dark photos. Lightbox is correct (`bg-black`).

Fix: replace `dark:bg-white/5` with `dark:bg-black`.

### CM-MED-6 — Histogram canvas uses default sRGB 2D context → false-positive clipping for P3 photos
**Files:** `apps/web/src/components/histogram.tsx:115, 140`
**Reviewers:** designer (M-7) ✓

Both `getContext('2d')` calls lack `{colorSpace: 'display-p3'}`. P3 image composited into sRGB canvas → `getImageData()` returns sRGB-clamped pixels → histogram shows clipping where none exists.

Fix: pass `{colorSpace: 'display-p3'}` when `window.matchMedia('(color-gamut: p3)').matches`.

### CM-MED-7 — `fetchpriority="high"` missing on hero `<img>` in photo viewer (LCP regression)
**Files:** `apps/web/src/components/photo-viewer.tsx:385-396`
**Reviewers:** designer (HIGH-4) ✓

Not strictly color-management but found during the color-rendering audit. The `<picture>` path's `<img>` has `loading="eager"` but no `fetchPriority="high"`. The Next.js `<Image>` fallback path has `priority` correctly. On the single-photo page, the hero competes at equal priority with JS bundles and fonts.

Fix: add `fetchPriority="high"` to the `<picture>` `<img>`.

## LOW

- **CM-LOW-1** — `bit_depth` always stored as null because `extractExifForDb` never maps Sharp's string `'uchar'` (8-bit) / `'ushort'` (16-bit) to a number. (security-reviewer L-3)
- **CM-LOW-2** — `process-topic-image.ts` strips ICC entirely for topic thumbnails. Likely fine for thumbs but document the intent. (security-reviewer L-4)
- **CM-LOW-3** — `themeColor` meta is `#09090b`, doesn't match the OLED canvas pure black. (designer L)
- **CM-LOW-4** — No `@media print` block — masonry grid columns bleed and `content-visibility: auto` photos vanish. (designer L)
- **CM-LOW-5** — No `forced-colors` guard on hardcoded `text-white` overlays. (designer L)
- **CM-LOW-6** — Skeleton shimmer hardcoded `rgba(255,255,255,0.06)` regardless of theme. (designer L)
- **CM-LOW-7** — `prefers-reduced-transparency` not addressed for toolbar backdrop-filter. (designer L)
- **CM-LOW-8** — Hostile-ICC bounds in parser are exercised by no test. (test-engineer Med #7)
- **CM-LOW-9** — `Sharp.cache(false)` not set; recommended for server use. (perf-reviewer P1)
- **CM-LOW-10** — `Sharp.concurrency(N)` × `Promise.all` × `QUEUE_CONCURRENCY` over-subscribes libuv pool. (perf-reviewer P1)
- **CM-LOW-11** — AVIF `effort` left at default 4 — could drop to 2 for ~2× faster encode at ~3% size cost. (perf-reviewer P1)
- **CM-LOW-12** — EXIF Date branch is dead-but-buggy. (security-reviewer L-1)

## Test gaps

(All proposed by test-engineer review; complete list there.)

1. **No round-trip test for Adobe RGB / ProPhoto / Rec.2020 → AVIF pixel correctness** (catches CM-CRIT-1).
2. **No GPS-strip test on AVIF derivatives** (catches CM-HIGH-2).
3. **No EXIF Orientation test** (catches CM-HIGH-4).
4. **No `keepIccProfile() / withMetadata({icc})` lock-in test** — silent removal in a refactor wouldn't be caught.
5. **No CMYK input test** — `.tiff` is in `ALLOWED_EXTENSIONS`; Sharp's CMYK→sRGB is implicit.
6. **No hostile/oversized ICC test** — bounds-check guards exist but are untested.
7. **No three-encoding parity test** — AVIF/WebP/JPEG of same source should match within tolerance.
8. **No `pipelineColorspace` linear-light gradient test** (catches CM-MED-2).
9. **No ColorSpace EXIF tag mismatch test** (vs embedded ICC; which wins?).

## Recommended fix sequencing (to keep gates green per fix)

1. **PR 1 (test scaffolding)** — add CM-CRIT-1, CM-HIGH-2, CM-HIGH-4 RED tests with real Adobe-RGB / GPS-bearing / Orientation=6 fixtures. They should fail. Lock in `keepIccProfile()` / `withIccProfile()` source-contract assertions.
2. **PR 2 (CM-HIGH-3 + CM-HIGH-4)** — add `failOn: 'error'`, `sequentialRead: true`, and `.autoOrient()`. Cheap and unblocks correct downstream pixel reads.
3. **PR 3 (CM-HIGH-5 cache busting)** — add pipeline-version segment to derivative URLs OR switch to `must-revalidate` + ETag. Without this, none of the later fixes reach users.
4. **PR 4 (CM-CRIT-1 + CM-HIGH-1 + CM-HIGH-2)** — switch AVIF to either explicit P3-only (when source ICC actually says so) OR convert to P3 pixels via `pipelineColorspace`. Switch WebP/JPEG to explicit `.toColorspace('srgb').withIccProfile('srgb')`. Replace `withMetadata({icc})` with `withIccProfile()`.
5. **PR 5 (CM-HIGH-6 backfill)** — fix the `icc_profile_name` column reference. Run backfill in staging.
6. **PR 6 (perf + bit-depth)** — `pipelineColorspace('rgb16')`, `bitdepth: 10` for non-sRGB AVIF, `chromaSubsampling: '4:4:4'` for non-sRGB JPEG, `Sharp.cache(false)`, retune `Sharp.concurrency()`.
7. **PR 7 (CSS / display)** — oklch tokens, hero `fetchPriority="high"`, viewer pure black, histogram P3 canvas context.
8. **PR 8 (LOW polish)** — bit_depth mapping, forced-colors guards, print stylesheet, etc.

## Files most affected

| File | High/Critical | Med | Low |
|------|---:|---:|---:|
| `apps/web/src/lib/process-image.ts` | 4 | 2 | 3 |
| `apps/web/src/lib/serve-upload.ts` | 1 | 0 | 0 |
| `apps/web/scripts/backfill-p3-icc.ts` | 1 | 0 | 0 |
| `apps/web/src/components/photo-viewer.tsx` | 0 | 2 | 0 |
| `apps/web/src/components/histogram.tsx` | 0 | 1 | 0 |
| `apps/web/src/app/[locale]/globals.css` + `tailwind.config.ts` | 0 | 1 | 2 |
| `apps/web/src/__tests__/process-image-*.test.ts` | (gap) | (gap) | (gap) |
