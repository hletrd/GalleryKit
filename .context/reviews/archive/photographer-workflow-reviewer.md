# Photographer Workflow Review -- Cycle 1

**Reviewer**: photographer-workflow-reviewer
**Date**: 2026-05-04
**Scope**: Full repository review from professional photographer perspective
**Assumption**: Photos arrive fully edited and culled. No editing/scoring features needed.

---

## CRITICAL FINDINGS

### PWF-CRIT-01: No Original-Format Download for Admin
**File**: `apps/web/src/components/photo-viewer.tsx` lines 222-224, 844-855
**Confidence**: High | **Severity**: Medium-High

The download button on the photo viewer serves `filename_jpeg` -- a lossy derivative. When an admin views their own photo, there is no way to download the original file format (RAW, HEIC, TIFF, etc.) from the public viewer page. The admin must use the paid-download token path (`/api/download/[imageId]?token=...`) which is designed for customers, or manually SSH into the server.

**Impact**: Professional photographers routinely need to re-access originals (for re-editing, client requests, print at higher resolution). This is a daily friction point.

**Fix suggestion**: Add an "Download Original" button visible only to admins in the info sidebar, serving from `data/uploads/original/` with appropriate access control.

---

### PWF-CRIT-02: Upload Sends Files Sequentially -- Severe Bottleneck for Large Batches
**File**: `apps/web/src/components/upload-dropzone.tsx` lines 243-246
**Confidence**: High | **Severity**: Medium-High

```typescript
for (const item of files) {
    await uploadFile(item);
}
```

Each file is uploaded one at a time in a serial loop. For a photographer uploading 50-100 photos from a shoot, this means the upload time scales linearly. Each call to `uploadImages()` server action involves: saving the original to disk, extracting EXIF, inserting to DB, and enqueueing processing -- all before the next file starts.

The comment explains this is due to the server-side MySQL advisory lock (`gallerykit_upload_processing_contract`), but this lock is acquired/released per upload call. The client-side serialization is unnecessarily conservative.

**Impact**: A 50-photo upload at ~5 seconds per photo = 4+ minutes of waiting. Photographers expect upload to be a background task.

**Fix suggestion**: Consider batch uploading (multiple files per FormData call) with a progress indicator per-file, or implement a server-side upload queue that accepts files in parallel and processes them sequentially.

---

## HIGH-SEVERITY FINDINGS

### PWF-HIGH-01: No EXIF Search or Filtering
**File**: `apps/web/src/lib/data.ts` lines 1130-1260 (searchImages)
**Confidence**: High | **Severity**: High

Search only queries `title`, `description`, `camera_model`, `topic`, `topic_label`, and `tags`. There is no way to search/filter by:
- ISO range
- Focal length range
- Aperture range
- Date range (capture_date)
- Lens model
- White balance
- Color space
- Original format

The `smartCollections` feature (AST-based query) exists in the schema but its EXIF filtering capabilities are unclear from the code reviewed.

**Impact**: A professional photographer with thousands of photos cannot efficiently find "all photos shot at ISO 3200+" or "all 85mm portraits" or "all photos from March 2024". This is a core portfolio management need.

---

### PWF-HIGH-02: Upload Processing Has No Progress Visibility
**File**: `apps/web/src/components/image-manager.tsx` lines 431-436
**Confidence**: High | **Severity**: Medium-High

After upload completes, images appear in the admin dashboard with a spinning loading indicator and "Loading..." text while processing occurs in the background. There is no ETA, no progress percentage, and no indication of which processing stage is active (AVIF? WebP? JPEG?).

For large photos (50+ MP from medium format cameras), processing can take 30+ seconds per image. The admin has no visibility into this.

**Impact**: Photographers cannot plan their workflow. They upload, then stare at spinners not knowing if processing will take 2 minutes or 20.

---

### PWF-HIGH-03: EXIF Display Missing Key Professional Fields
**File**: `apps/web/src/lib/process-image.ts` lines 792-901 (extractExifForDb)
**File**: `apps/web/src/db/schema.ts` lines 35-53
**Confidence**: High | **Severity**: Medium

The following commonly-desired EXIF fields are not extracted or displayed:
- **Copyright** (EXIF `Copyright` tag) -- critical for professional portfolios
- **Artist/Author** (EXIF `Artist` tag)
- **Lens Make** (to complement LensModel)
- **Body Serial Number** (for multi-body shooters organizing by gear)
- **Software** (post-processing tool info)
- **Image Number / Sequence** (for burst/sequence grouping)

The schema has `camera_model` and `lens_model` but no `copyright` or `artist` field.

**Impact**: Photographers who embed copyright and artist info in their EXIF (standard professional practice) find that information is lost on upload.

---

### PWF-HIGH-04: No Reorder/Sort Position Control Within Topics
**File**: `apps/web/src/db/schema.ts` -- no `position` column on images table
**File**: `apps/web/src/lib/data.ts` -- ORDER BY `capture_date DESC, created_at DESC, id DESC`
**Confidence**: High | **Severity**: Medium

Photos are always sorted by capture_date descending (newest first), with no manual ordering option. For a portfolio/gallery, photographers want to curate the order of their best shots -- the hero image first, followed by a narrative sequence.

Shared groups have `position` on `sharedGroupImages`, but topic/gallery views have no equivalent.

**Impact**: Portfolio presentation is entirely automated. A photographer cannot place their strongest image first in a topic gallery.

---

### PWF-HIGH-05: No Bulk Download / Export
**File**: No bulk download route exists
**Confidence**: High | **Severity**: Medium

There is no way to download multiple photos at once. No ZIP export, no multi-select download. For a photographer sharing photos with a client via a shared group link, the client must download photos one by one.

**Impact**: A wedding photographer sharing 200 photos via a group link forces the client to click download 200 times.

---

## MEDIUM-SEVERITY FINDINGS

### PWF-MED-01: Shared Group Links Cannot Expire or Be Password-Protected
**File**: `apps/web/src/app/actions/sharing.ts` lines 179-298
**File**: `apps/web/src/db/schema.ts` lines 100-117

Shared groups support `expires_at` in the schema but the creation action (`createGroupShareLink`) never sets it. There is no UI to configure expiration. There is no password protection option.

**Impact**: Photographers sharing sensitive client galleries (weddings, events) cannot time-limit access or add a passcode.

---

### PWF-MED-02: No EXIF Date/Timezone Override
**File**: `apps/web/src/lib/process-image.ts` lines 177-226 (parseExifDateTime)
**Confidence**: High | **Severity**: Low-Medium

EXIF datetimes are camera-local times stored without timezone info. There is no way for the photographer to:
1. Set the timezone for a batch of photos (e.g., "these were shot in JST")
2. Correct a wrong camera date
3. Bulk-adjust capture dates

**Impact**: Photos from cameras with incorrect date/time settings (common after traveling across timezones) show wrong dates permanently.

---

### PWF-MED-03: No Per-Image Processing Priority
**File**: `apps/web/src/lib/image-queue.ts`
**Confidence**: Medium | **Severity**: Low-Medium

The processing queue uses FIFO order with PQueue. When uploading a batch of 100 photos, the photographer must wait for all preceding photos to process before their most important photo is available.

**Impact**: No way to mark a hero image for priority processing.

---

### PWF-MED-04: Tag Input UX Friction for Large Tag Vocabularies
**File**: `apps/web/src/components/tag-input.tsx`
**Confidence**: Medium | **Severity**: Low-Medium

Tag input uses a datalist-based autocomplete. For photographers with hundreds of tags, this flat list becomes unwieldy. No tag categories, no recent/frequent tags, no tag hierarchy.

---

### PWF-MED-05: No Photo Comparison / Lightbox Multi-Select
**File**: `apps/web/src/components/lightbox.tsx`
**Confidence**: Medium | **Severity**: Low

Lightbox shows one photo at a time. Photographers reviewing selects from a shoot often want to compare 2-3 candidates side by side. No split-view or comparison mode exists.

---

### PWF-MED-06: Masonry Grid Cannot Toggle to List/Timeline View
**File**: `apps/web/src/components/home-client.tsx`
**Confidence**: Medium | **Severity**: Low-Medium

The gallery only offers a masonry grid view. No option for:
- List view (compact, showing metadata)
- Timeline view (grouped by date)
- Detail view (larger thumbnails with EXIF summary)

The timeline page exists at `/timeline` but it's a separate route, not a view toggle within the main gallery.

---

### PWF-MED-07: JPEG Download Size is Not the Largest Derivative
**File**: `apps/web/src/components/photo-viewer.tsx` line 224
**Confidence**: High | **Severity**: Low-Medium

```typescript
const downloadHref = image?.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;
```

The download button always uses `filename_jpeg` which is the base JPEG filename (largest configured size). However, when `imageSizes` has been changed over time, the base filename may point to a stale derivative. The button should download the largest available JPEG derivative.

---

### PWF-MED-08: No Watermark Option
**Confidence**: Medium | **Severity**: Low

No watermarking capability for shared/public photos. Professional photographers sharing previews with clients typically want watermarked derivatives. This would require a new feature in the processing pipeline.

---

## LOW-SEVERITY FINDINGS

### PWF-LOW-01: No Drag-to-Reorder for Photos Within Admin Dashboard
The admin dashboard table view has no drag-to-reorder capability. Combined with PWF-HIGH-04, there is no way to control photo order.

### PWF-LOW-02: No Map View Integration for Photo Browsing
The map page (`/map`) exists but is a separate experience. There is no way to filter the main gallery by location or see a mini-map in the photo info sidebar.

### PWF-LOW-03: No "On This Day" / Date-Based Discovery in Main Gallery
The `on-this-day-widget` component exists but is only shown in specific contexts. Date-based browsing (e.g., "show me all photos from this week last year") is not surfaced in the main gallery navigation.

### PWF-LOW-04: No Image Rating/Label System
No star rating, color label, or pick/reject system. Photographers coming from Lightroom are accustomed to culling with ratings. The current system only has tags, which are not comparable to a quick 1-5 star rating workflow.

---

## Summary

The gallery handles the basic display and sharing workflows competently. EXIF extraction is thorough for the fields it covers, and the color management pipeline is well-engineered. The main gaps for professional photographer workflow are:

1. **Upload throughput** (sequential upload, no batch progress)
2. **Search/discovery** (no EXIF-based filtering)
3. **Organization** (no manual ordering, limited bulk operations)
4. **Export** (no original download, no bulk download)
5. **Sharing** (no expiration/password, no bulk download for recipients)
6. **EXIF completeness** (missing copyright, artist fields)