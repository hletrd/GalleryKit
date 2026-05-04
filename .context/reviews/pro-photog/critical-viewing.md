# Pro Photographer Critical-Viewing Review
## ATIK.KR Gallery — Non-Color-Management Findings

**Scope:** Culling, rating, comparison, focus check, pixel-peeping — everything a working professional photographer needs during critical review.  
**Excluded:** Color management issues already covered in `.context/reviews/color-mgmt/_aggregate.md` (CM-CRIT-1 through CM-LOW-12).  
**Files reviewed:**
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/lib/image-zoom-math.ts`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/db/schema.ts`

---

## Severity Scale
- **PRO-CRIT** — Blocks professional use entirely; no workaround
- **PRO-HIGH** — Measurable productivity loss on real shoots; workaround is painful
- **PRO-MED** — Missing capability compared to Lightroom / Photo Mechanic / Capture One baseline
- **PRO-LOW** — Polish gap, quality-of-life issue, or deferred-feature flag

---

## PRO-CRIT: Critical Blockers

### PV-CRIT-1 — No true 1:1 pixel-peep (100% native-pixel zoom)
**File:** `apps/web/src/lib/image-zoom-math.ts:1-4`, `apps/web/src/components/image-zoom.tsx:161-178`  
**Selector:** `ImageZoom` click handler; `DEFAULT_ZOOM = 2.5`

`DEFAULT_ZOOM` is hardcoded at `2.5×` — an arbitrary design choice, not a pixel-accurate value. The `clampZoom` ceiling is `MAX_ZOOM = 5.0`. **Neither value corresponds to native pixel resolution** (1 image pixel = 1 device pixel). The math to compute the true 1:1 scale factor is:

```
zoom_100pct = image.naturalWidth / containerRect.width
```

This value changes with every viewport, every sidebar toggle (`showInfo` shifts the grid from `grid-cols-1` to `grid-cols-[1fr_350px]`), and every device-pixel-ratio. Without it, a photographer shooting a Sony A7R V (61 MP, 9504 × 6336 px) on a 1440p monitor gets an entirely meaningless "zoom" that may show far less than 1:1 detail (all images blurry) or overshoot so far that grain looks like mud.

**Shoot scenario:** Wedding photographer inspecting focus on the groom's eye across 400 burst frames. Cannot verify tack-sharp vs. nearly-sharp without pixel-peep. Currently the gallery is useless for this task. Photographer opens original in Finder Preview instead.

**Fix:**
1. Export `computeNativePixelZoom(imageNaturalWidth: number, containerWidth: number, devicePixelRatio: number): number` from `image-zoom-math.ts`.
2. Add a `Z` keyboard shortcut in `photo-viewer.tsx` (in the `handleKeyDown` useEffect, line 327) that calls `ImageZoom`'s reset-or-100%-toggle.
3. Add a `100%` zoom button to the toolbar alongside the existing `LightboxTrigger`. Surface the computed DPR-aware scale.
4. Ensure the lightbox `<img>` in `lightbox.tsx` (line 412) also supports 100% via the same `ImageZoom` wrapper — currently the lightbox image is a bare `<img>` with no zoom layer at all (see PV-CRIT-2).

---

### PV-CRIT-2 — Lightbox has no zoom mechanism whatsoever
**File:** `apps/web/src/components/lightbox.tsx:386-436`  
**Selector:** `<picture>` / `<img>` in the lightbox dialog; no `ImageZoom` wrapper

The lightbox `<img>` at line 412 is a raw `<img>` with `className="w-full h-full object-contain"` and `draggable={false}`. There is no `ImageZoom` wrapper, no pinch-to-zoom, no mouse-wheel zoom. Clicking or scrolling inside the full-screen lightbox does nothing to zoom the image. The wheel event listener at `lightbox.tsx:248-256` only calls `showControls(true)` — it resets the auto-hide timer, not the zoom level.

The `ImageZoom` component exists and works in the card viewer (`photo-viewer.tsx:613`), but it was never composed into the lightbox.

**Shoot scenario:** Studio photographer on an iPad doing client review in lightbox mode. Client wants to check if eyes are open in a group shot. Currently impossible — the image is locked at "fit to screen" and cannot be magnified at all.

**Fix:** Wrap the `<picture>` block in `lightbox.tsx` (lines 386-436) with an `<ImageZoom>` instance. The `onClick={handleBackdropClick}` on the outer `div` (line 379) must be suppressed when the zoom level is above `MIN_ZOOM`, matching the pattern already in `image-zoom.tsx:162-169`.

---

### PV-CRIT-3 — Lightbox loads a sized derivative, not the full-resolution source, so pixel-peep is impossible even if zoom were fixed
**File:** `apps/web/src/components/lightbox.tsx:336-340`  
**Selector:** `jpegSrc` computation; `imageSizes.length >= 3 ? imageSizes[imageSizes.length - 2]`

Even after fixing PV-CRIT-1 and PV-CRIT-2, the lightbox `<img>` loads a **pre-shrunk derivative** — specifically the second-largest configured size (e.g. 1536px wide for a default config). This means zooming to "100%" would actually show a scaled-up low-resolution buffer. True pixel-peep requires the full-resolution JPEG derivative (the unsized `filename_jpeg` file at `public/uploads/jpeg/`).

The `<source>` elements for AVIF and WebP use `imageSizes`-constrained srcSet with `sizes="100vw"`, so the browser picks the largest variant in the size array — again not the original.

**Shoot scenario:** Sports photographer needs to verify AF precision at 1:1 — is the catch-light sharp or is this a front-focus? The lightbox is showing a 1536px version of a 7952px-wide original. At 100% zoom on a 4K monitor, the displayed pixel is 5× the original pixel. The detail lost in resizing is exactly what focus-check needs.

**Fix:** Add a `showFullRes` state in `Lightbox`. When the user triggers pixel-peep (Z shortcut or 100% button), swap the `<picture>` source to `imageUrl('/uploads/jpeg/${image.filename_jpeg}')` — the full-resolution file, not a sized variant. Show a loading indicator during the swap. Only load the full-res file on demand; do not preload it on mount.

---

## PRO-HIGH: High-Priority Missing Features

### PV-HIGH-1 — No clipping warnings on histogram (highlight/shadow overlay)
**File:** `apps/web/src/components/histogram.tsx:143-210`  
**Selector:** `drawHistogram()` function; no clipping threshold logic

The histogram renders luminance and R/G/B channels correctly, but has no clipping warning:

1. **No threshold overlay on the histogram canvas itself** — bins above 250 should render in saturated red; bins below 5 should render in blue. This is standard practice in every histogram widget since Aperture 1.0 (2005).
2. **No "blinkies" / clipping mask overlay on the photo** — Lightroom's `J` shortcut projects a red transparent mask over clipped highlight pixels and a blue mask over clipped shadow pixels. This overlay lives on the image canvas, not the histogram canvas.
3. **No toggle control** — the clipping warning should be togglable (keyboard shortcut `J` per Lightroom convention).

**Shoot scenario:** Landscape photographer reviewing a sunset exposure. The sky may be blown. Squinting at a 240×120 histogram without zone markers to spot which bins are clipping is inadequate for a 2-stop bracketed sequence edit decision.

**Fix (histogram canvas — lower effort):**
In `drawHistogram()` (`histogram.tsx:143`), after the normal channel fill, add a second pass:
```ts
// Highlight clipping: bins 251-255 in red
ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
for (let i = 251; i <= 255; i++) { /* draw bar */ }
// Shadow clipping: bins 0-4 in blue
ctx.fillStyle = 'rgba(60, 120, 255, 0.9)';
for (let i = 0; i <= 4; i++) { /* draw bar */ }
```

**Fix (blinkies overlay — higher effort):** Add a `showClipping` boolean state to `Histogram`. When true, compute a clipping mask from the `HistogramData` by re-reading pixel data (already available from the canvas draw pass), then render a colored overlay `<canvas>` absolutely positioned over the photo image in `photo-viewer.tsx`. Wire `J` key in the keyboard handler at `photo-viewer.tsx:327`.

---

### PV-HIGH-2 — No discrete zoom steps (50% / 100% / 200% / Fit / Fill)
**File:** `apps/web/src/components/image-zoom.tsx:161-178`; `apps/web/src/lib/image-zoom-math.ts`

`ImageZoom` supports only two states: fully reset (`MIN_ZOOM = 1.0`) and a single click-target level (`DEFAULT_ZOOM = 2.5`). Wheel zoom is continuous. There is no UI for stepping to standard zoom levels, no zoom level indicator, and no keyboard shortcuts for specific levels.

Photographers in every professional tool use:
- `Fit` (current behavior — `1×` in the viewer sense)
- `Fill` (zoom until no black bars)
- `50%` — for context review
- `100%` — pixel-peep (see PV-CRIT-1)
- `200%` — extreme grain/noise inspection

**Shoot scenario:** Portrait photographer alternating between "does this composition work?" (Fit) and "is the mascara sharp?" (100%) — requires constant zoom-level switching without hunting with scroll wheel.

**Fix:** Add a zoom level HUD indicator (small `<span>` overlaid on the image area, e.g. `"142%"`, visible only when zoomed). Add keyboard shortcuts `1` → 100%, `2` → 200%, `0` → Fit in the `photo-viewer.tsx` keyboard handler. Expose a `zoomTo(level: number, anchor?: {x,y})` method from `ImageZoom` via `useImperativeHandle`. Note: `1` and `2` conflict with proposed star ratings (PV-HIGH-5); the zoom shortcuts should only fire when in lightbox mode or when the image area is focused.

---

### PV-HIGH-3 — No side-by-side comparison mode
**File:** N/A — feature is entirely absent  
**Scope:** Admin dashboard (`dashboard-client.tsx`) and public viewer (`photo-viewer.tsx`)

There is no multi-select-and-compare view. Burst photographers need to A/B two near-identical frames side-by-side at the same zoom level and pan offset to pick the sharper one. Lightroom calls this "Compare" mode (`C` shortcut). Photo Mechanic calls it "Compare Selected." Capture One has Survey mode for multi-image comparison.

**Current workaround:** Open two browser tabs, resize to half-screen. This does not sync zoom or pan.

**Shoot scenario:** Sports photographer with 12 frames of a peak-action moment, all similar but only one is tack-sharp and has the right expression. Must open each in a new tab and flip between them — not viable for 1200 images from a shoot.

**Fix (minimum viable):**
1. Add multi-select to `HomeClient` masonry grid (checkbox on hover, `Cmd+click`).
2. Add a `/compare?ids=123,456` route that renders two `ImageZoom` instances side-by-side.
3. Sync pan and zoom state between the two instances via a shared `useReducer` that propagates `zoomTo` and `panTo` calls to both.
4. Wire `C` keyboard shortcut when exactly 2 images are selected.

---

### PV-HIGH-4 — No quick-cull / filmstrip view in admin
**File:** `apps/web/src/components/image-manager.tsx`  
**Selector:** The `ImageManager` renders a data `Table` (line 381), not a visual culling interface

The admin image list is a paginated `<Table>` with 90×90px thumbnails (column `TableHead` renders `<OptimisticImage>` in a constrained cell). There is no:
- Large central "loupe" image showing the currently selected photo
- Horizontal filmstrip of surrounding frames for rapid arrow-key advance
- Keyboard-driven navigation (ArrowLeft / ArrowRight to move to adjacent image, keeping focus on the filmstrip)

This is the single largest gap for a working photographer using this as their primary portfolio management tool. Photo Mechanic's contact sheet + loupe combination is the gold standard. Lightroom's Library grid + loupe achieves the same in two key presses.

**Shoot scenario:** Photographer returns from a 3-hour fashion shoot with 800 images. Must select the 80 keepers. The current table UI requires opening each image in a new tab (`/p/[id]`), rating it mentally, returning to the table, scrolling to find it again. This takes hours instead of minutes.

**Fix (staged):**
- **Stage 1 (low effort):** In `image-manager.tsx`, add an `onRowClick` that pushes to `router.push(localizePath(locale, `/p/${image.id}`))` with `isAdmin=true`. Already partially achievable via the existing edit icon — just make the entire row clickable.
- **Stage 2 (medium effort):** Add a "Loupe" panel next to the table (collapsible, like the existing info sidebar pattern in `photo-viewer.tsx`). When a row is selected, the loupe shows the full `ImageZoom` component for that image.
- **Stage 3 (high effort):** Full filmstrip mode: full-screen loupe, thumbnails along the bottom, arrow-key navigation. Matches Photo Mechanic.

---

### PV-HIGH-5 — No rating or pick/reject workflow — schema and keyboard layer both absent
**File:** `apps/web/src/db/schema.ts:19-78`; `apps/web/src/components/photo-viewer.tsx:327-347`

The `images` table has no `rating` (0–5 stars), no `pick` (boolean), no `reject` (boolean), and no `color_label` column. The keyboard handler in `photo-viewer.tsx` responds to `ArrowLeft`, `ArrowRight`, `F`, and `I` only. Lightroom muscle memory (`1`-`5` for stars, `P` pick, `X` reject, `0` clear, color labels `6`-`9`) is entirely absent.

Without a rating system, this gallery cannot serve as a culling tool at all — only as a final-presentation gallery.

**Shoot scenario:** Event photographer finishing a 6-hour wedding. Must identify the 200 hero shots from 2,000 frames. Without star ratings or picks, every selection decision lives only in the photographer's mental state or in an external spreadsheet.

**Fix (schema first, keyboard second):**

Schema additions to `apps/web/src/db/schema.ts`, `images` table:
```ts
rating: int('rating').default(0),          // 0 = unrated, 1–5 stars
flag: varchar('flag', { length: 8 }).default('none'), // 'none' | 'pick' | 'reject'
color_label: varchar('color_label', { length: 16 }).default('none'), // 'none'|'red'|'yellow'|'green'|'blue'|'purple'
```

Keyboard handler additions in `photo-viewer.tsx` `handleKeyDown` (line 327):
```ts
// Ratings
if (['1','2','3','4','5'].includes(e.key)) rateImage(currentImageId, parseInt(e.key));
if (e.key === '0') rateImage(currentImageId, 0);
// Pick/reject
if (e.key === 'p' || e.key === 'P') flagImage(currentImageId, 'pick');
if (e.key === 'x' || e.key === 'X') flagImage(currentImageId, 'reject');
// Color labels (Lightroom convention)
if (e.key === '6') labelImage(currentImageId, 'red');
if (e.key === '7') labelImage(currentImageId, 'yellow');
if (e.key === '8') labelImage(currentImageId, 'green');
if (e.key === '9') labelImage(currentImageId, 'blue');
```

These call server actions that update the new columns and optimistically update UI state.

---

### PV-HIGH-6 — No published/hidden state — all processed images are public
**File:** `apps/web/src/db/schema.ts:73` (`processed` boolean); no `published` column

The `processed` boolean indicates whether the background Sharp pipeline has completed, not whether an image is intended to be public. Once `processed = true`, the image appears on the public gallery. There is no `published` / `visible` / `draft` state. An admin uploading 400 images from a shoot cannot do so without them instantly appearing on the public site.

**Shoot scenario:** Photographer uploads a full wedding gallery overnight. Tomorrow morning, during culling, wants to select the 80 keepers before the client sees anything. Currently impossible — all 400 images appear on the public gallery the moment processing completes.

**Fix:** Add `published: boolean('published').notNull().default(false)` to the `images` table. Update all public-facing queries in `apps/web/src/lib/data.ts` to add `AND published = 1` (or Drizzle equivalent). Add a "Publish" button and a "Publish all selected" bulk action to `ImageManager`. The `processed` flag retains its existing meaning.

---

## PRO-MED: Medium-Priority Gaps

### PV-MED-1 — EXIF panel missing focal-length equivalent (crop factor)
**File:** `apps/web/src/components/photo-viewer.tsx:688-693`; `apps/web/src/components/info-bottom-sheet.tsx:281-285`  
**Selector:** `{hasExifData(image.focal_length) && <p>{image.focal_length}mm</p>}`

Both the desktop sidebar and mobile bottom sheet display raw focal length (e.g. "50mm") but never compute or display the 35mm equivalent. Pros reverse-engineer shots constantly — "what focal length was this 85mm equivalent look shot at on APS-C?" requires mental arithmetic (`85 × 1.5 = 127mm on Nikon APS-C` or `85 × 1.6 = 136mm on Canon APS-C`).

The crop factor cannot be derived from EXIF alone in the general case — it requires a camera model → sensor size lookup table. However:
1. If `image.width` and `image.height` are available alongside `focal_length`, approximate crop factor via known sensor resolutions is feasible for common bodies.
2. Alternatively, surface the `FocalLengthIn35mmFilm` EXIF tag (ExifTool tag `0xa405`) if stored — Sharp/exifr exposes this. Check whether the extraction pipeline reads it.

**Fix (minimal):** Check whether `focal_length_35mm` is already in the DB via a Grep of `extractExifForDb`. If not, add `focal_length_35mm: float('focal_length_35mm')` to schema and read `exif.FocalLengthIn35mmFormat` from the Sharp metadata. Display as `{image.focal_length}mm ({image.focal_length_35mm}mm eq.)` when the 35mm value differs from the native focal length.

---

### PV-MED-2 — EXIF panel: exposure compensation raw string, not human-readable stops
**File:** `apps/web/src/components/photo-viewer.tsx:761-767`  
**Selector:** `<p className="font-medium">{image.exposure_compensation}</p>`

`exposure_compensation` is stored as a raw varchar. EXIF spec stores EV as a rational (numerator/denominator), e.g. `"2/3"`. The UI dumps whatever string the extractor stored. On Sony bodies this may be `"0.3 EV"`; on Canon it may be `"1/3"`; on older Nikon bodies it may be a decimal. There is no normalization into the standard photographer unit `"+0.3 EV"` or `"-1 EV"`.

**Fix:** Add a `formatExposureCompensation(raw: string): string` utility (similar to the existing `formatShutterSpeed`) that parses rational strings, decimals, and passthrough strings into a canonical `±N.N EV` format. Display that instead.

---

### PV-MED-3 — Histogram only computes from the sized JPEG derivative, not the full-res file
**File:** `apps/web/src/components/photo-viewer.tsx:808-812`  
**Selector:** `imageUrl('/uploads/jpeg/${image.filename_jpeg.replace(..._640.jpg)}')` passed to `<Histogram>`

The histogram is fed the 640px-wide thumbnail (`findNearestImageSize(imageSizes, 640)`). Resizing to 640px before histogram computation means:
1. Highlight and shadow bins near the extremes are affected by resizing interpolation (especially with the default gamma-space resize noted in CM-MED-2 from the color review).
2. The histogram represents a downsampled tone distribution, not the true distribution of the 45–61 MP original.
3. Clipping warnings (PV-HIGH-1) based on this histogram will have false positives/negatives.

For critical exposure evaluation, pros need histograms computed from the full-resolution or at minimum the largest available derivative.

**Fix:** Pass the largest available derivative URL instead: `findNearestImageSize(imageSizes, imageSizes[imageSizes.length - 1])`. Alternatively, add an option to `Histogram` to accept a `quality: 'preview' | 'full'` prop and swap the URL. The performance cost is real (downloading a 2–4MB JPEG instead of 40KB), so make it opt-in via a "High Quality Histogram" toggle.

---

### PV-MED-4 — Histogram and EXIF are never simultaneously visible on mobile
**File:** `apps/web/src/components/info-bottom-sheet.tsx:236`; `apps/web/src/components/histogram.tsx`

On mobile, the `InfoBottomSheet` shows EXIF data when expanded (`sheetState === 'expanded'`), but the histogram is not rendered in the bottom sheet at all — it only appears in the desktop sidebar (`photo-viewer.tsx:806-812`). A mobile user (e.g. reviewing on an iPad in client session) cannot see histogram and EXIF together.

**Fix:** Add a `<Histogram>` block inside the `InfoBottomSheet` expanded content section (after the EXIF grid, before the capture date), guarded by `image.filename_jpeg`. Mirror the desktop sidebar's pattern at `photo-viewer.tsx:806-812`.

---

### PV-MED-5 — No hover/loupe magnifier on the masonry grid
**File:** `apps/web/src/components/home-client.tsx:181-278`  
**Selector:** `.masonry-card` div; `group-hover:scale-105` on the `<img>` (line 240)

On hover, masonry cards scale the image up by 5% (`group-hover:scale-105`). This is a decorative effect. There is no loupe: a small fixed-size overlay showing a 3–4× crop of the cursor area without requiring navigation to the photo detail page.

Pixieset proofing galleries have this. It lets a photographer or client scan a grid of 200 images and immediately assess sharpness on hover without clicking into each one.

**Shoot scenario:** Art director reviewing 60 candidate portraits on the gallery. Wants to spot-check focus on eyes without navigating away from the grid. Currently must click each photo individually.

**Fix:** Add a `<Loupe>` component that positions a `200×200px` clipped viewport (CSS `clip-path` or `overflow: hidden` + transform) anchored to the cursor. On `mousemove` over a `.masonry-card`, update the loupe's background-image position to show the zoomed region. The zoomed image source should be the medium derivative (1280–1536px), which is already preloaded for the card.

---

### PV-MED-6 — No filmstrip / position context in the lightbox
**File:** `apps/web/src/components/lightbox.tsx:517-570`

The lightbox shows prev/next chevron buttons and a position counter in the non-lightbox viewer (`{currentIndex + 1} / {images.length}` at `photo-viewer.tsx:622`), but the lightbox itself has no filmstrip or thumbnail strip showing surrounding frames. The position counter in the lightbox is embedded only in the `<img>` `aria-label` attribute (line 421), not visible to sighted users.

**Fix:** Add a thin filmstrip strip at the bottom of the lightbox (hidden during auto-hide, revealed on mouse-move or tap). Each thumbnail links to the corresponding image via `onNavigate`. Show 5–7 thumbnails centered on the current image. This matches Lightroom's filmstrip and nearly every professional proofing system.

---

### PV-MED-7 — Admin image list: original (camera) filename not displayed alongside gallery filename
**File:** `apps/web/src/components/image-manager.tsx:397`  
**Selector:** `<TableHead>{t('imageManager.filename')}</TableHead>` — maps to `user_filename`

The `ImageType` interface (line 52-63) includes `user_filename` (the original camera filename, e.g. `DSC03245.ARW`). This is displayed in the table. However `filename_jpeg` (the gallery's internal UUID-based filename) is not shown. Pros cross-referencing between the gallery and their Lightroom catalog or backup drive need both:
1. The camera filename to find the original RAW
2. The gallery filename to identify the file in `public/uploads/`

Currently only `user_filename` is surfaced (`t('imageManager.filename')` column).

**Fix:** Rename the filename column header to "Camera Filename" and add a second column "Gallery ID" showing `image.id` and/or the first 8 chars of `filename_jpeg`. This is particularly critical for tracking down which UUID corresponds to which RAW for re-export or dispute resolution.

---

### PV-MED-8 — Metadata overlay absent from grid tiles (admin has no scan-by-metadata capability)
**File:** `apps/web/src/components/home-client.tsx:263-275`

The masonry card hover overlay shows only `displayTitle` and `topic` (lines 264-274). No metadata is surfaced even in the admin context: no capture date, no rating (once added), no flag status, no file size, no dimensions, no processing status indicator. The `processed` boolean (`ImageType.processed`) is available but never shown.

**Shoot scenario:** Admin scanning a gallery of 200 images, looking for the ones uploaded last Tuesday that haven't been processed yet. No visual cue on the grid tiles distinguishes `processed = false` images from complete ones. Must page through the table view instead.

**Fix:**
1. In `HomeClient` (public view): no change needed; keep it clean.
2. In `ImageManager` (admin view): switch from the table to a grid layout (matching the masonry) with a more information-dense hover overlay including: capture date, dimensions, processing status badge, and (once added) rating stars and color label dot.

---

### PV-MED-9 — Slideshow lacks per-photo progress indicator and interval control
**File:** `apps/web/src/components/lightbox.tsx:161-178`, `apps/web/src/components/lightbox.tsx:487-506`

The slideshow Play/Pause button exists and works. Missing:
1. **Progress bar** showing how far through the current interval the slideshow is (clients expect this from every presentation tool since Flash era)
2. **Interval control** — the interval is fixed at `slideshowIntervalSeconds` from config. No per-session UI to change from 5s to 10s during a client presentation
3. **Loop toggle** — slideshow wraps via `onSlideshowAdvance` (`photo-viewer.tsx:869-872`) using `% images.length`, but there is no "stop at end" option

**Fix:** Add a `<progress>` element or CSS `animation`-driven progress bar at the bottom of the lightbox controls overlay. Add a `<select>` or segmented control for interval (3s / 5s / 10s / 15s) in the controls overlay. These only appear when `controlsVisible` is true.

---

### PV-MED-10 — No focus point overlay
**File:** `apps/web/src/lib/process-image.ts` (EXIF extraction pipeline)

AF point data is stored in manufacturer MakerNotes: Sony `AFInfo`, Canon `AFInfo2`, Nikon `AFInfo2`. Sharp does not extract MakerNotes. The `exifr` library (if used) has partial support. The `images` table has no column for AF point data.

**Shoot scenario:** Photographer reviewing a frame where the subject's face appears soft — was it front focus (AF hit the nose) or back focus (AF hit the ear)? Without AF point visualization they cannot diagnose it from the gallery.

**Fix (deferred):** Flag as future feature. No EXIF parser in the current stack supports all three major brands' AF metadata. Recommendation: add `af_points_json: text('af_points_json')` to schema now (nullable), and plan a post-processing hook using `exiftool` (CLI) which does support MakerNotes across all major brands. The UI overlay can be implemented once data is available.

---

## PRO-LOW: Polish and Deferred Features

### PV-LOW-1 — Zoom level indicator absent — user cannot tell current magnification
**File:** `apps/web/src/components/image-zoom.tsx`

When zoomed, there is no percentage readout (e.g. "142%"). The cursor changes to `cursor-grab` but the user cannot know if they are at 100%, 200%, or 142% arbitrary. Every professional imaging tool shows a zoom percentage.

**Fix:** Add a small `<span>` absolutely positioned in the bottom-left corner of the `ImageZoom` container (similar to the position counter in `photo-viewer.tsx:622`). Visible only when `isZoomed`. Update via the existing `applyTransform` call.

---

### PV-LOW-2 — Mouse-wheel zoom in lightbox does nothing (photog expects dolly-zoom)
**File:** `apps/web/src/components/lightbox.tsx:247-256`

The lightbox has a wheel event listener (line 247) that calls `showControls(true)` — it wakes the controls overlay. It does **not** zoom. This is the opposite of what every photographer using Lightroom or Capture One expects: mouse wheel = zoom in/out. The wheel zoom logic lives entirely in `ImageZoom`, which is not composed into the lightbox (see PV-CRIT-2).

**Fix:** Resolved when PV-CRIT-2 is fixed by adding `ImageZoom` wrapper to the lightbox. The existing wheel listener can then be removed or merged.

---

### PV-LOW-3 — Pinch-to-zoom absent in lightbox
**File:** `apps/web/src/components/lightbox.tsx:191-208`

The lightbox handles touch events for swipe navigation (`handleTouchStart` / `handleTouchEnd`, lines 191-208). Two-finger pinch is not handled — `e.touches.length === 2` is never checked. On an iPad, a client pinching in the lightbox gets nothing.

**Fix:** Again resolved by adding `ImageZoom` to the lightbox (PV-CRIT-2). The swipe-navigation logic in `lightbox.tsx` will need to be conditioned on `zoomLevel <= MIN_ZOOM` to not conflict with pinch-zoom pan.

---

### PV-LOW-4 — Before/after toggle: schema has no `before_filename` or revision concept
**File:** `apps/web/src/db/schema.ts`

Not present. A photographer who wants to A/B raw vs. retouched or two processing variants has no mechanism for this in the current schema. Skip for a public portfolio gallery; flag for a proofing / commercial workflow variant.

---

### PV-LOW-5 — Loading state for original-resolution download is instant redirect, no progress
**File:** `apps/web/src/components/photo-viewer.tsx:844-856`  
**Selector:** `<a href={downloadHref} download>` — native browser download link

The "Download JPEG" button is a native `<a download>` link. Clicking it triggers the browser's built-in download manager, which shows progress in the browser chrome. This is acceptable for single-file downloads. However, there is no in-page progress indicator — the button does not visually change state during download.

For the paid download path (`/api/download/[imageId]?token=…`), the same issue applies. A 40MB original takes several seconds on a slow connection with no feedback.

**Fix (PRO-LOW because browser chrome handles it):** On click, set `isDownloading = true` and show a spinner on the button. Listen for the `fetch` response stream progress if using the programmatic download path. Reset on completion or timeout.

---

### PV-LOW-6 — No `Z` keyboard shortcut documented in the shortcuts hint
**File:** `apps/web/src/components/photo-viewer.tsx:417`  
**Selector:** `<p className="mb-2 text-xs text-muted-foreground">{t('viewer.shortcutsHint')}</p>`

The shortcuts hint string (in `messages/en.json` and `messages/ko.json`) currently documents only the shortcuts that exist: arrows, `F`, `I`. Once PV-CRIT-1 adds `Z` for pixel-peep, `1`-`5` for stars, `P`/`X` for pick/reject, and `J` for clipping warnings, the hint text must be updated to surface them. Pros rely on this hint to discover keyboard shortcuts.

---

### PV-LOW-7 — Focus point overlay (deferred — see PV-MED-10)
AF point rendering requires exiftool MakerNote extraction. Flagged as a planned future feature, not an omission to fix immediately.

---

### PV-LOW-8 — Lens vignetting / distortion preview overlay
Not present. Skip — this is typically a RAW processor function, not a JPEG gallery function. Would require storing distortion correction data from lens profiles. Out of scope.

---

### PV-LOW-9 — Soft-proofing / print preview
Not present. Skip — soft-proofing requires an ICC-aware rendering pipeline in-browser (which is non-trivial and blocked by PV-CRIT-3 full-res source issues). Flag as future only.

---

### PV-LOW-10 — Color labels need text names, not just hue, for color-blind admins
**File:** `apps/web/src/db/schema.ts` — `color_label` column (proposed in PV-HIGH-5)

When color labels are implemented, the UI must always show a text label alongside the color swatch (e.g. "Red", "Yellow", "Green") so that color-blind users (protanopia, deuteranopia affect ~8% of males) are not excluded from the workflow.

**Fix:** In whatever color-label chip component is built, always render the label name as visible text or at minimum as `aria-label` and `title`. Never rely on hue alone.

---

## Summary Table

| ID | Severity | Feature | File | Status |
|----|----------|---------|------|--------|
| PV-CRIT-1 | PRO-CRIT | No 1:1 native-pixel zoom | `image-zoom-math.ts`, `image-zoom.tsx`, `photo-viewer.tsx` | Missing |
| PV-CRIT-2 | PRO-CRIT | Lightbox has no zoom at all | `lightbox.tsx:386-436` | Missing |
| PV-CRIT-3 | PRO-CRIT | Lightbox loads sized derivative, not full-res | `lightbox.tsx:336-340` | Wrong |
| PV-HIGH-1 | PRO-HIGH | No clipping warnings (blinkies / J shortcut) | `histogram.tsx:143-210` | Missing |
| PV-HIGH-2 | PRO-HIGH | No discrete zoom steps (50/100/200/Fit/Fill) | `image-zoom.tsx`, `image-zoom-math.ts` | Missing |
| PV-HIGH-3 | PRO-HIGH | No side-by-side compare mode | `home-client.tsx`, `photo-viewer.tsx` | Missing |
| PV-HIGH-4 | PRO-HIGH | No quick-cull / filmstrip in admin | `image-manager.tsx` | Missing |
| PV-HIGH-5 | PRO-HIGH | No rating / pick / reject / color label | `schema.ts`, `photo-viewer.tsx` | Missing schema + UI |
| PV-HIGH-6 | PRO-HIGH | No published/hidden state | `schema.ts` | Missing schema |
| PV-MED-1 | PRO-MED | No 35mm equivalent focal length | `photo-viewer.tsx:688`, `info-bottom-sheet.tsx:281` | Missing |
| PV-MED-2 | PRO-MED | EV comp raw string, not formatted stops | `photo-viewer.tsx:761`, `info-bottom-sheet.tsx:347` | Unformatted |
| PV-MED-3 | PRO-MED | Histogram from 640px thumbnail, not full-res | `photo-viewer.tsx:808-812` | Wrong source |
| PV-MED-4 | PRO-MED | Histogram absent from mobile bottom sheet | `info-bottom-sheet.tsx:236` | Missing |
| PV-MED-5 | PRO-MED | No hover loupe on masonry grid | `home-client.tsx:181-278` | Missing |
| PV-MED-6 | PRO-MED | No filmstrip in lightbox | `lightbox.tsx:517-570` | Missing |
| PV-MED-7 | PRO-MED | Original (camera) filename not shown alongside gallery filename in admin | `image-manager.tsx:397` | Incomplete |
| PV-MED-8 | PRO-MED | No metadata overlay on admin grid tiles | `home-client.tsx:263-275`, `image-manager.tsx` | Missing |
| PV-MED-9 | PRO-MED | Slideshow lacks progress bar and interval control | `lightbox.tsx:161-178` | Missing |
| PV-MED-10 | PRO-MED | No AF point overlay (deferred, no parser support) | `process-image.ts` extraction | Deferred |
| PV-LOW-1 | PRO-LOW | No zoom level indicator (%) | `image-zoom.tsx` | Missing |
| PV-LOW-2 | PRO-LOW | Mouse wheel in lightbox does not zoom | `lightbox.tsx:247-256` | Bug (resolved by CRIT-2) |
| PV-LOW-3 | PRO-LOW | Pinch-to-zoom absent in lightbox | `lightbox.tsx:191-208` | Missing (resolved by CRIT-2) |
| PV-LOW-4 | PRO-LOW | Before/after toggle — no schema concept | `schema.ts` | Deferred |
| PV-LOW-5 | PRO-LOW | No in-page download progress indicator | `photo-viewer.tsx:844-856` | Missing |
| PV-LOW-6 | PRO-LOW | Shortcut hint text does not list new shortcuts | `photo-viewer.tsx:417` | Stale (future) |
| PV-LOW-7 | PRO-LOW | Focus point overlay (deferred) | `process-image.ts` | Deferred |
| PV-LOW-8 | PRO-LOW | Lens vignetting/distortion overlay | — | Out of scope |
| PV-LOW-9 | PRO-LOW | Soft-proofing / print preview | — | Out of scope |
| PV-LOW-10 | PRO-LOW | Color labels need text names for a11y | Schema (future) | Deferred |

---

## Recommended Fix Sequencing

### Phase 1 — Unblock basic professional use (PRO-CRIT)
1. **PV-CRIT-2 + PV-LOW-2 + PV-LOW-3** together: Add `ImageZoom` wrapper to `lightbox.tsx`. One change fixes all three.
2. **PV-CRIT-3**: Swap lightbox image source to full-resolution on pixel-peep trigger.
3. **PV-CRIT-1**: Compute and expose 1:1 native zoom level; wire `Z` shortcut.

### Phase 2 — Culling workflow (schema first, UI second)
4. **PV-HIGH-6** (schema): Add `published` column + migration. Update all public queries.
5. **PV-HIGH-5** (schema): Add `rating`, `flag`, `color_label` columns + migration.
6. **PV-HIGH-5** (keyboard): Wire rating/flag keyboard shortcuts in `photo-viewer.tsx`.
7. **PV-MED-10** (schema stub): Add `af_points_json` column now while schema is being touched.

### Phase 3 — Histogram and exposure evaluation
8. **PV-HIGH-1**: Add clipping threshold visualization to `histogram.tsx`. Wire `J` shortcut.
9. **PV-MED-3**: Switch histogram source URL to largest derivative.
10. **PV-MED-4**: Add `<Histogram>` to `InfoBottomSheet` expanded content.

### Phase 4 — Comparison and culling UI
11. **PV-HIGH-4**: Add loupe panel to admin dashboard alongside the image table.
12. **PV-HIGH-2**: Add discrete zoom steps and zoom level indicator.
13. **PV-HIGH-3**: Add basic side-by-side compare route.
14. **PV-MED-5**: Add hover loupe to masonry grid.
15. **PV-MED-6**: Add filmstrip to lightbox.

### Phase 5 — Polish
16. **PV-MED-1**: Add 35mm equivalent focal length to EXIF panel.
17. **PV-MED-2**: Format exposure compensation as `±N.N EV`.
18. **PV-MED-7**: Show both camera filename and gallery filename in admin table.
19. **PV-MED-8**: Add metadata overlay to admin grid tiles.
20. **PV-MED-9**: Add slideshow progress bar and interval control.
21. **PV-LOW-1**: Add zoom percentage indicator.
22. **PV-LOW-5**: Add download progress feedback.
23. **PV-LOW-6**: Update shortcuts hint text.
