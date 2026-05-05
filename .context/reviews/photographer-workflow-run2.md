# Photographer Workflow Review -- Cycle 1 (Run 2)

**Date**: 2026-05-05
**Focus**: Professional photographer ingest, EXIF, gallery browsing, sharing, organization, search, download/export, mobile

---

## Findings

### PWF-R2-01: EXIF metadata missing Artist and Copyright fields (Medium, High confidence)

**File**: `apps/web/src/lib/process-image.ts:135-151`, `apps/web/src/db/schema.ts:35-53`

The EXIF extraction (`ExifParamsRaw` interface and `extractExifForDb`) does not capture `Artist`, `Copyright`, or `ImageDescription` tags. For a professional photographer, these are the most legally important EXIF fields -- they prove authorship and licensing intent. The schema has no corresponding columns.

**Impact**: A wildlife photographer who embeds copyright in every RAW/JPEG will see that metadata silently stripped. Downloaded JPEGs contain no attribution. The JSON-LD `creditText` and `copyrightNotice` fields use the SEO author setting, not per-image EXIF.

**Suggestion**: Add `artist` and `copyright_notice` columns to `images` table, extract from `exifParams.Artist` / `exifParams.Copyright` (or `exifData.image.Artist`), and display in the info panel alongside camera/lens. Also embed in downloaded JPEGs.

---

### PWF-R2-02: f_number stored as float loses precision for half-stop apertures (Low, High confidence)

**File**: `apps/web/src/lib/process-image.ts:881`, `apps/web/src/db/schema.ts:40`

The schema uses MySQL `float` (32-bit) for `f_number`. Common half-stop values like f/1.8, f/2.8, f/5.6 are not exactly representable in 32-bit float. `f/1.8` might display as `f/1.7999999523162842` after a round-trip.

**Impact**: The photo viewer formats with `f/${image.f_number}` -- if the float is imprecise, the display will show too many decimal places.

**Suggestion**: Either use `double` column type or round to 1 decimal in the display layer. The display in `photo-viewer.tsx` line 698 uses the raw value without formatting.

---

### PWF-R2-03: Downloaded JPEG lacks EXIF metadata (Medium, High confidence)

**File**: `apps/web/src/lib/process-image.ts:651-717`

The `processImageFormats` function strips all EXIF metadata during derivative generation (Sharp's default behavior). The downloaded JPEG in `photo-viewer.tsx:846-854` serves the processed derivative, not the original. Professional photographers expect downloaded images to retain at minimum: camera, lens, capture date, copyright, and GPS (if not stripped).

**Impact**: A client downloading a portfolio image gets a metadata-stripped file with no attribution or camera info.

**Suggestion**: Use Sharp's `.withMetadata()` on JPEG derivatives (at minimum camera, date, copyright) or provide an admin-only "download original" that streams the private original file.

---

### PWF-R2-04: JPEG download serves middle-size derivative, not largest (Low-Med, High confidence)

**File**: `apps/web/src/components/photo-viewer.tsx:222-224`

```typescript
const downloadFilename = image?.filename_jpeg;
const downloadHref = image?.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;
```

The base JPEG filename (e.g. `uuid.jpg`) maps to the largest configured size. But if the admin configures image sizes like [640, 1536, 2048, 4096], `uuid.jpg` is the 4096px derivative. If they later change to [640, 1536], the base filename becomes the 1536px version. This is a data-driven concern -- the download quality depends on when the image was processed.

**Impact**: Download quality is inconsistent across images in the same gallery.

**Suggestion**: Document this behavior or add an explicit "best available" download path that picks the largest size variant for the JPEG.

---

### PWF-R2-05: Admin search limited to title/description/camera/topic -- no lens, tag, or EXIF search (Medium, High confidence)

**File**: `apps/web/src/lib/data.ts:1130-1260`

The `searchImages` function queries `title`, `description`, `camera_model`, `topic`, and `topics.label`. It does not search:
- `lens_model` (a photographer might search "70-200" to find all telephoto shots)
- Tag names directly (tags are searched via a separate JOIN, which is good)
- `original_format` (searching "ARW" or "HEIC")
- Focal length or ISO ranges

**Impact**: A photographer looking for all shots taken with a specific lens has no way to find them via the search bar.

**Suggestion**: Add `lens_model` to the main LIKE search. EXIF range filtering (focal length, ISO, aperture) is a larger feature but the lens field is a quick win.

---

### PWF-R2-06: "Uncalibrated" color space stored verbatim with no context for viewers (Low, Medium confidence)

**File**: `apps/web/src/lib/process-image.ts:886-897`

When `ColorSpace === 65535` (Uncalibrated), the string "Uncalibrated" is stored. In the photo viewer info panel, this displays as raw text. Photographers seeing "Uncalibrated" with no context won't know if the colors are Adobe RGB, Display P3, or something else.

**Impact**: Confusion about color accuracy, especially for print-oriented photographers.

**Suggestion**: Display a tooltip or note: "Uncalibrated -- actual profile determined by embedded ICC" when the ICC name is also available. Or resolve Uncalibrated to the actual ICC profile name if one is present.

---

### PWF-R2-07: No per-image upload progress or ETA during batch upload (Low-Med, High confidence)

**File**: `apps/web/src/components/upload-dropzone.tsx:188-286`

The upload progress shows `completedCount / totalFiles` and current filename, but there is no ETA or throughput indicator. For a photographer uploading 50+ wedding photos at 30MB each, the progress bar alone is insufficient to gauge whether to wait or come back later.

**Suggestion**: Add bytes/second throughput and estimated time remaining to the progress display.

---

### PWF-R2-08: Swipe threshold in lightbox may be too sensitive for one-handed mobile use (Low, Medium confidence)

**File**: `apps/web/src/components/lightbox.tsx:219`

```typescript
if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 50 || Math.abs(dx) / dt > 0.3))
```

The 50px minimum swipe distance is appropriate for most devices, but the 0.3 px/ms velocity threshold means a very quick 30px swipe triggers navigation. On smaller phones held one-handed, this could cause accidental navigation when trying to tap the image.

**Suggestion**: Consider raising the velocity threshold slightly (0.5 px/ms) or requiring at least 40px distance even with velocity.

---

### PWF-R2-09: Topic page has no sort order control (Low-Med, Medium confidence)

**File**: `apps/web/src/lib/data.ts:630-657`

Images are always sorted by `capture_date DESC, created_at DESC, id DESC`. There is no admin-facing option to sort by "date added" or "manual order" within a topic. A photographer curating a portfolio topic (e.g., "Best of 2024") cannot control the display order.

**Suggestion**: Add a per-topic sort preference (capture date, upload date, or manual) to the topics table and expose it in the admin settings.